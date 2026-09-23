@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   PoE2 Kit - Windows Overlay
echo ============================================
echo.

REM --- check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo Node.js: %NODEVER%
echo.

REM --- install dependencies (first run only) ---
if not exist node_modules (
  echo Installing dependencies, first run only - this takes a few minutes...
  echo Note: Electron is downloaded from github.com on first install.
  call npm ci
  if errorlevel 1 (
    echo.
    echo [ERROR] npm ci failed.
    echo   - Check Node.js version: need ^>= 20 LTS.
    echo   - If the native module "koffi" failed to install, install
    echo     Visual Studio Build Tools with the C++ workload.
    echo   - If the Electron download timed out, re-run this script -
    echo     npm will resume; or set a mirror first:
    echo       set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
    pause
    exit /b 1
  )
)

REM --- build core + overlay ---
echo.
echo Building core and overlay...
call npm run build -w @poe2-kit/core
if errorlevel 1 goto err
call npm run build -w @poe2-kit/overlay
if errorlevel 1 goto err

echo.
echo Starting the overlay...
echo.
echo HOW TO USE IN GAME:
echo   1. Launch Path of Exile 2.
echo   2. Hover over an item and press Ctrl+C (copies item text).
echo   3. Press Ctrl+Alt+Space - the overlay appears near the top-right
echo      corner of the game window and shows the price estimate.
echo.
call npm run start -w @poe2-kit/overlay
goto end

:err
echo.
echo [ERROR] Build failed. See the messages above.
pause

:end
endlocal
