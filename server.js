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
            return res.status(400).json({ error: 'Game executable not found at path' });
        }

        // Check if already running
        const exeName = path.basename(gamePath);
        const isRunning = await isProcessRunning(exeName);
        if (isRunning) {
            return res.json({ success: true, message: 'Game is already running' });
        }

        const args = [];
        if (serverAddress) {
            args.push(serverAddress); 
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
        });

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
