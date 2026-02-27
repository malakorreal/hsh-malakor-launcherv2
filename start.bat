@echo off
echo Starting Malakor Launcher (Dev Mode)...
npm run dev
if %errorlevel% neq 0 (
    echo.
    echo An error occurred. If you see an error about sqlite3, you might need to rebuild native modules.
    echo Try running: npm install --save-dev electron-rebuild
    echo Then: .\node_modules\.bin\electron-rebuild
    pause
)
