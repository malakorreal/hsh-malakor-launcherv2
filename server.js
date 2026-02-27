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

let gameProcess = null;

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
        
        // Check if process is running (simple check by variable, robust check would be tasklist)
        // For this demo, we use the variable. If the server restarts, this resets.
        const isRunning = !!gameProcess;

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

        const args = [];
        if (serverAddress) {
            // Assuming the game accepts a server address as an argument
            // Adjust this based on actual game requirements. 
            // For now, we append it as a standard argument.
            args.push(serverAddress); 
        }

        const cwd = path.dirname(gamePath);

        console.log(`Launching ${gamePath} with args: ${args} in ${cwd}`);

        gameProcess = spawn(gamePath, args, {
            cwd: cwd,
            detached: true,
            stdio: 'ignore' 
        });

        gameProcess.on('error', (err) => {
            console.error('Failed to start game:', err);
            gameProcess = null;
        });

        gameProcess.on('exit', (code) => {
            console.log(`Game exited with code ${code}`);
            gameProcess = null;
        });

        gameProcess.unref(); // Allow the server to keep running even if child exits? Or rather, allow child to run independently.
        // But we want to track it for "Stop". So maybe don't unref if we want to kill it via variable.
        // Actually, if we want to kill it, we should keep the reference.
        // "detached: true" allows it to run even if parent dies, but we can still kill it if we have the PID.

        res.json({ success: true, pid: gameProcess.pid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stop Game
app.post('/api/stop', async (req, res) => {
    try {
        if (gameProcess) {
            gameProcess.kill();
            gameProcess = null;
            res.json({ success: true, message: 'Game stopped via process handle' });
        } else {
            // Fallback: Try to kill by name "HSHO.exe"
            exec('taskkill /IM HSHO.exe /F', (err, stdout, stderr) => {
                if (err) {
                    // It might not be running
                    return res.json({ success: false, message: 'Process not found or could not be killed' });
                }
                res.json({ success: true, message: 'Game stopped via taskkill' });
            });
        }
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
