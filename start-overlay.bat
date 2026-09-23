@echo off
setlocal
REM Консоль в UTF-8: логи оверлея пишутся по-русски.
chcp 65001 >nul
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

REM ── Self-update: git pull (git-копия репозитория) ────────────────────────────
REM (структура через goto, чтобы %OLD_HEAD%/%NEW_HEAD% раскрывались в момент строки)
if not exist .git goto afterupdate
where git >nul 2>nul
if errorlevel 1 (
  echo [WARN] git not found in PATH - skipping update check.
  goto afterupdate
)
echo Checking for updates (git pull origin main)...
set OLD_HEAD=
for /f %%h in ('git rev-parse HEAD 2^>nul') do set OLD_HEAD=%%h
git pull --ff-only --quiet origin main
if errorlevel 1 echo [WARN] git pull failed ^(no network / local changes^) - running current code.
set NEW_HEAD=
for /f %%h in ('git rev-parse HEAD 2^>nul') do set NEW_HEAD=%%h
if not "%OLD_HEAD%"=="%NEW_HEAD%" (
  echo.
  echo ================= UPDATED =================
  git log --oneline %OLD_HEAD%..%NEW_HEAD%
  echo ===========================================
  echo.
)
:afterupdate
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
echo   3. Ctrl+F1  - price check of the item from clipboard.
echo   4. Ctrl+F3  - import build: copy a PoB share-code / link, then press.
echo      Also: a poe.ninja character profile link + Ctrl+F3 enables
echo      auto-sync (your equipped gear is checked against the build).
echo   5. Ctrl+F2  - build shopping list panel (items you wear are shown).
echo   6. Ctrl+F4  - leveling context (zone hints from the game log).
echo   7. Ctrl+F5  - move the overlay window (press again to pin it).
echo.
echo The window auto-resizes to fit the panel. Logs: %%APPDATA%%\@poe2-kit\overlay\overlay.log
echo.
call npm run start -w @poe2-kit/overlay
goto end

:err
echo.
echo [ERROR] Build failed. See the messages above.
pause

:end
endlocal
