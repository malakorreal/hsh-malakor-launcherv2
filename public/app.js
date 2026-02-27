document.addEventListener('DOMContentLoaded', () => {
    const setupSection = document.getElementById('setup-section');
    const installSection = document.getElementById('install-section');
    const launcherSection = document.getElementById('launcher-section');
    
    // Updated Elements for File Selection
    const selectGameBtn = document.getElementById('select-game-btn');
    const gamePathFile = document.getElementById('gamePathFile');
    const selectedPathDisplay = document.getElementById('selected-path-display');
    
    const serverAddressInput = document.getElementById('serverAddress');
    const centralServerUrlInput = document.getElementById('centralServerUrl');
    const saveConfigBtn = document.getElementById('save-config-btn');
    
    const installBtn = document.getElementById('install-btn');
    const progressFill = document.getElementById('progress-fill');
    
    const playBtn = document.getElementById('play-btn');
    const stopBtn = document.getElementById('stop-btn');
    const statusText = document.getElementById('status-text');
    const changeSettingsLink = document.getElementById('change-settings');

    let currentStatus = {
        gamePath: '',
        serverAddress: '',
        centralServerUrl: '',
        isInstalled: false,
        isRunning: false
    };

    let pendingGamePath = '';

    // Poll status every 2 seconds
    setInterval(fetchStatus, 2000);
    setInterval(syncWithCentralServer, 10000); // Sync every 10 seconds

    fetchStatus();

    async function fetchStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            currentStatus = data;
            
            // Auto-fill inputs if empty
            if (data.centralServerUrl && !centralServerUrlInput.value) {
                centralServerUrlInput.value = data.centralServerUrl;
            }
            if (data.serverAddress && !serverAddressInput.value) {
                serverAddressInput.value = data.serverAddress;
            }

            // Update displayed path if available and not manually changed yet
            if (data.gamePath && !pendingGamePath && selectedPathDisplay.textContent === 'No file selected') {
                selectedPathDisplay.textContent = data.gamePath;
                selectedPathDisplay.style.color = '#fff';
            }

            updateUI();
        } catch (err) {
            console.error('Failed to fetch status:', err);
            statusText.textContent = 'Connection Error';
        }
    }

    async function syncWithCentralServer() {
        if (!currentStatus.centralServerUrl) return;

        try {
            // 1. Fetch Config (Domain Server)
            const configRes = await fetch(`${currentStatus.centralServerUrl}/api/central/config`);
            if (configRes.ok) {
                const config = await configRes.json();
                if (config.targetDomain && config.targetDomain !== currentStatus.serverAddress) {
                    console.log('Syncing new target domain:', config.targetDomain);
                    // Update local config
                    await fetch('/api/configure', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ serverAddress: config.targetDomain })
                    });
                }
            }

            // 2. Send Heartbeat
            await fetch(`${currentStatus.centralServerUrl}/api/central/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    clientId: 'user-' + Math.floor(Math.random() * 10000), // Simple ID
                    status: currentStatus.isRunning ? 'playing' : 'idle' 
                })
            });

        } catch (err) {
            console.error('Failed to sync with central server:', err);
        }
    }

    function updateUI() {
        // Decide which section to show
        if (!currentStatus.gamePath) {
            showSection(setupSection);
            // If we have a pending path selected by user, don't overwrite it.
            // If no pending path and no current status path, it stays default.
        } else if (!currentStatus.isInstalled) {
            showSection(installSection);
        } else {
            showSection(launcherSection);
            
            // Update Launcher Status
            if (currentStatus.isRunning) {
                statusText.textContent = 'Game Running';
                statusText.style.color = '#4CAF50';
                playBtn.classList.add('hidden');
                stopBtn.classList.remove('hidden');
            } else {
                statusText.textContent = 'Ready to Play';
                statusText.style.color = '#bbb';
                playBtn.classList.remove('hidden');
                stopBtn.classList.add('hidden');
            }
        }
    }

    function showSection(section) {
        // Hide all
        setupSection.classList.add('hidden');
        installSection.classList.add('hidden');
        launcherSection.classList.add('hidden');
        
        // Show target
        section.classList.remove('hidden');
    }

    // File Selection Logic
    selectGameBtn.addEventListener('click', () => {
        gamePathFile.click();
    });

    gamePathFile.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            // In Electron with nodeIntegration: true, the File object has a 'path' property containing the absolute path.
            if (file.path) {
                pendingGamePath = file.path;
                selectedPathDisplay.textContent = pendingGamePath;
                selectedPathDisplay.style.color = '#fff';
            } else {
                // Fallback for browser testing (mock path)
                pendingGamePath = file.name;
                selectedPathDisplay.textContent = file.name;
            }
        }
    });

    // Save Configuration
    saveConfigBtn.addEventListener('click', async () => {
        const gamePath = pendingGamePath || currentStatus.gamePath; // Use existing if not changed
        const serverAddress = serverAddressInput.value.trim();
        const centralServerUrl = centralServerUrlInput.value.trim();
        
        if (!gamePath) {
            alert('Please select the game executable (HSHO.exe).');
            return;
        }

        try {
            await fetch('/api/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gamePath, serverAddress, centralServerUrl })
            });
            fetchStatus(); // Refresh
        } catch (err) {
            alert('Failed to save configuration.');
        }
    });

    // Auto Install
    installBtn.addEventListener('click', async () => {
        installBtn.disabled = true;
        installBtn.textContent = 'Installing...';
        progressFill.style.width = '0%';
        
        // Simulate progress bar locally for UX
        let progress = 0;
        const interval = setInterval(() => {
            progress += 5;
            if (progress > 90) clearInterval(interval);
            progressFill.style.width = `${progress}%`;
        }, 100);

        try {
            await fetch('/api/install', { method: 'POST' });
            progressFill.style.width = '100%';
            setTimeout(() => {
                fetchStatus();
            }, 500);
        } catch (err) {
            alert('Installation failed.');
            installBtn.disabled = false;
            installBtn.textContent = 'Auto Install';
        }
    });

    // Launch Game
    playBtn.addEventListener('click', async () => {
        playBtn.disabled = true;
        playBtn.textContent = 'Launching...';
        
        try {
            const res = await fetch('/api/launch', { method: 'POST' });
            const data = await res.json();
            
            if (data.error) {
                alert('Launch Error: ' + data.error);
                playBtn.disabled = false;
                playBtn.textContent = 'PLAY';
                
                // If path not found, offer reset
                if (data.error.includes('not found')) {
                    if (confirm('Game executable not found. Do you want to reset settings and select the file again?')) {
                        await fetch('/api/reset', { method: 'POST' });
                        location.reload();
                    }
                }
            } else {
                // Success, wait for next poll to update UI
                fetchStatus();
            }
        } catch (err) {
            alert('Failed to launch game.');
            playBtn.disabled = false;
            playBtn.textContent = 'PLAY';
        }
    });

    // Stop Game
    stopBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        stopBtn.textContent = 'Stopping...';
        
        try {
            await fetch('/api/stop', { method: 'POST' });
            fetchStatus();
        } catch (err) {
            alert('Failed to stop game.');
            stopBtn.disabled = false;
            stopBtn.textContent = 'STOP GAME';
        }
    });
    
    // Change Settings Link
    changeSettingsLink.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm('Are you sure you want to reset settings? This will require re-configuration.')) {
            try {
                await fetch('/api/reset', { method: 'POST' });
                // Reset local state
                pendingGamePath = '';
                selectedPathDisplay.textContent = 'No file selected';
                selectedPathDisplay.style.color = '#888';
                serverAddressInput.value = '';
                // UI will update automatically on next poll
            } catch (err) {
                alert('Failed to reset settings.');
            }
        }
    });
});
