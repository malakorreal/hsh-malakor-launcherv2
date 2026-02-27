const express = require('express');
const bodyParser = require('body-parser');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const open = require('open');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// Helper: Check if process is running (Windows)
const isProcessRunning = (processName) => {
    return new Promise((resolve, reject) => {
        if (!processName) return resolve(false);
        const cmd = `tasklist`;
        exec(cmd, (err, stdout, stderr) => {
            if (err) return resolve(false); // Tasklist failed or not found
            // Simple check: does the stdout contain the process name?
            resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
        });
    });
};

// Helper: Kill process (Windows)
const killProcess = (processName) => {
    return new Promise((resolve, reject) => {
        if (!processName) return resolve();
        // /F = force, /IM = image name
        const cmd = `taskkill /F /IM "${processName}"`;
        exec(cmd, (err, stdout, stderr) => {
            // Ignore error if process not found (already dead)
            resolve();
        });
    });
};

const net = require('net');
const HOSTS_FILE = process.platform === 'win32' 
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' 
    : '/etc/hosts';
const TARGET_API_DOMAIN = 'api.homesweethomegame.com';

let proxyServer = null;

// Helper: Modify Hosts File
const modifyHostsFile = (shouldRedirect) => {
    try {
        let hostsContent = fs.readFileSync(HOSTS_FILE, 'utf8');
        const redirectLine = `127.0.0.1 ${TARGET_API_DOMAIN}`;
        
        // Remove existing lines first to avoid duplicates
        const lines = hostsContent.split('\n').filter(line => !line.includes(TARGET_API_DOMAIN));
        
        if (shouldRedirect) {
            lines.push(redirectLine);
        }
        
        fs.writeFileSync(HOSTS_FILE, lines.join('\n'));
        console.log(`Hosts file updated: ${shouldRedirect ? 'Redirected' : 'Restored'}`);
        return true;
    } catch (err) {
        console.error('Failed to modify hosts file:', err);
        return false;
    }
};

// Helper: Start TCP Proxy
const startProxy = (targetHost, targetPort = 443) => {
    if (proxyServer) return; // Already running

    proxyServer = net.createServer((clientSocket) => {
        const serverSocket = net.createConnection(targetPort, targetHost, () => {
            clientSocket.pipe(serverSocket);
            serverSocket.pipe(clientSocket);
        });

        serverSocket.on('error', (err) => {
            console.error('Proxy target connection error:', err);
            clientSocket.end();
        });

        clientSocket.on('error', (err) => {
            console.error('Proxy client connection error:', err);
            serverSocket.end();
        });
    });

    proxyServer.listen(443, '0.0.0.0', () => {
        console.log(`Proxy listening on port 443, forwarding to ${targetHost}:${targetPort}`);
    });

    proxyServer.on('error', (err) => {
        console.error('Proxy server error:', err);
    });
};

// Helper: Stop TCP Proxy
const stopProxy = () => {
    if (proxyServer) {
        proxyServer.close();
        proxyServer = null;
        console.log('Proxy server stopped');
    }
};

// Clean up on exit
process.on('exit', () => modifyHostsFile(false));
process.on('SIGINT', () => { modifyHostsFile(false); process.exit(); });

// --- CENTRAL SERVER LOGIC (When running on Cloud) ---
// Simple in-memory storage for demo. Use database for production.
let centralConfig = {
    targetDomain: "game.example.com", // Default
    motd: "Welcome to Malakor Launcher"
};

let onlineClients = {}; // Store client status: { clientId: { status, lastSeen } }

// API to get Global Config (Called by Launcher)
app.get('/api/central/config', (req, res) => {
    res.json(centralConfig);
});

// API to update Global Config (Called by Admin - unsecured for demo)
app.post('/api/central/config', (req, res) => {
    const { targetDomain, motd } = req.body;
    if (targetDomain) centralConfig.targetDomain = targetDomain;
    if (motd) centralConfig.motd = motd;
    res.json({ success: true, config: centralConfig });
});

// API to report status (Called by Launcher)
app.post('/api/central/heartbeat', (req, res) => {
    const { clientId, status } = req.body;
    onlineClients[clientId] = {
        status,
        lastSeen: new Date()
    };
    res.json({ success: true });
});

// --- LOCAL LAUNCHER LOGIC (When running on Desktop) ---

// Get current status
app.get('/api/status', async (req, res) => {
    try {
        const gamePath = await db.getSetting('game_path');
        const serverAddress = await db.getSetting('server_address');
        const isInstalled = await db.getSetting('is_installed');
        const centralServerUrl = await db.getSetting('central_server_url');
        
        let isRunning = false;
        if (gamePath) {
            const exeName = path.basename(gamePath);
            isRunning = await isProcessRunning(exeName);
        }

        res.json({
            gamePath,
            serverAddress,
            centralServerUrl,
            isInstalled: isInstalled === 'true',
            isRunning
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Configure settings
app.post('/api/configure', async (req, res) => {
    const { gamePath, serverAddress } = req.body;
    try {
        if (gamePath) await db.setSetting('game_path', gamePath);
        if (serverAddress) await db.setSetting('server_address', serverAddress);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Install (Simulated)
app.post('/api/install', async (req, res) => {
    try {
        // Simulate installation delay
        setTimeout(async () => {
            await db.setSetting('is_installed', 'true');
            res.json({ success: true });
        }, 3000);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Launch Game
app.post('/api/launch', async (req, res) => {
    try {
        const gamePath = await db.getSetting('game_path');
        const serverAddress = await db.getSetting('server_address');

        if (!gamePath) {
            return res.status(400).json({ error: 'Game path not configured' });
        }

        // Verify file exists
        if (!fs.existsSync(gamePath)) {
            return res.status(400).json({ error: `Game executable not found at path: ${gamePath}` });
        }

        // Check if already running
        const exeName = path.basename(gamePath);
        const isRunning = await isProcessRunning(exeName);
        if (isRunning) {
            return res.json({ success: true, message: 'Game is already running' });
        }

        const args = [];
        // Note: serverAddress is now used for the Proxy Target, but we still pass it if needed.
        // If the game supports args, we keep it. If not, it's harmless.
        if (serverAddress) {
            args.push(serverAddress); 
            
            // --- MALAKOR PROXY LOGIC ---
            // 1. Modify Hosts to point official API to localhost
            const hostsSuccess = modifyHostsFile(true);
            
            if (hostsSuccess) {
                // 2. Start Proxy forwarding to our custom serverAddress
                // We assume serverAddress is a domain or IP.
                // If it's a full URL (http://...), we need to parse it.
                let targetHost = serverAddress;
                try {
                    // Try to handle if user entered http/https
                    if (targetHost.startsWith('http')) {
                        const url = new URL(targetHost);
                        targetHost = url.hostname;
                    }
                } catch (e) { /* ignore */ }
                
                startProxy(targetHost, 443);
            } else {
                console.warn('Could not modify hosts file. Run as Administrator?');
                // We proceed anyway, maybe the user did it manually.
            }
        }

        const cwd = path.dirname(gamePath);
        console.log(`Launching ${gamePath} with args: ${args} in ${cwd}`);

        const child = spawn(gamePath, args, {
            cwd: cwd,
            detached: true,
            stdio: 'ignore' 
        });

        child.on('error', (err) => {
            console.error('Failed to start game:', err);
            modifyHostsFile(false); // Revert if launch fails
            stopProxy();
        });
        
        // Restore hosts/proxy when game exits?
        // Since we detached, we can't easily know when it exits unless we kept the reference.
        // Ideally we should monitor the process.
        // For now, we keep the proxy running until the user clicks "Stop" or closes the launcher.

        child.unref(); 

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stop Game
app.post('/api/stop', async (req, res) => {
    try {
        const gamePath = await db.getSetting('game_path');
        if (!gamePath) {
             return res.status(400).json({ error: 'Game path not configured' });
        }
        
        const exeName = path.basename(gamePath);
        await killProcess(exeName);
        
        // Cleanup Proxy
        modifyHostsFile(false);
        stopProxy();
        
        res.json({ success: true, message: 'Stop command issued' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reset Settings
app.post('/api/reset', async (req, res) => {
    try {
        await db.setSetting('game_path', '');
        await db.setSetting('is_installed', 'false');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    // No longer opening browser automatically as Electron handles the UI
});

module.exports = app; // Export for potential use or testing
