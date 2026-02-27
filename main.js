const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');

// Fix for sandbox: Store user data locally instead of AppData
app.setPath('userData', path.join(__dirname, 'userData'));

// Check for Administrator Privileges (Windows)
if (process.platform === 'win32') {
    exec('net session', function(err, stdout, stderr) {
        if (err || (stderr && stderr.length > 0)) {
            // Not Admin
            console.log("Not running as admin, relaunching...");
            const { spawn } = require('child_process');
            
            // Relaunch as Admin using PowerShell
            const command = `Start-Process "${process.execPath}" -ArgumentList "${process.argv.slice(1).join(' ')}" -Verb RunAs`;
            spawn('powershell', ['-Command', command], {
                detached: true,
                stdio: 'ignore'
            }).unref();
            
            app.quit();
        } else {
            // Is Admin, continue normally
            console.log("Running as admin.");
        }
    });
}

// Handle File Selection via Native Dialog
ipcMain.handle('select-game-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Executables', extensions: ['exe'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

const server = require('./server'); // Import the express server

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false // For simplicity in this example
        },
        autoHideMenuBar: true, // Clean look
        title: "Malakor Game Launcher"
    });

    // Load the local server
    // Since server.js starts listening on port 3000, we can load localhost:3000
    // We should wait a bit or ensure server is ready, but typically it's fast enough.
    // Alternatively, we could serve files directly via file:// protocol but since we have API logic in express,
    // keeping the server running in the background is easier for logic reuse.
    
    // Retry loading if connection fails
    const loadApp = () => {
        win.loadURL('http://localhost:3000').catch((err) => {
            console.log('Server not ready, retrying in 1s...');
            setTimeout(loadApp, 1000);
        });
    };
    
    setTimeout(loadApp, 1000);

    // Open DevTools for debugging (optional)
    // win.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
