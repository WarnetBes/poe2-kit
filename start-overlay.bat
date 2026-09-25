@echo off
setlocal
REM Консоль в UTF-8: логи оверлея пишутся по-русски.
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   PoE2 Kit - Windows Overlay
echo ============================================
echo.

REM ── Portable-сборка: Node.js и npm НЕ нужны ─────────────────────────────────
REM (движок Electron при первом старте скачивает сам bat, дальше — офлайн)
if exist .portable goto portable

REM --- check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js LTS v20+ first:
  echo         https://nodejs.org/
  echo         Then close this console and re-run start-overlay.bat.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
if defined NODEVER echo Node.js: %NODEVER%
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
    echo   - If the native module "koffi" failed to install, you need the
    echo     C++ toolchain. Re-run: call "%~dp0install-tools-minimal.bat"
    echo     installs Node.js LTS only - enough for the overlay.
    echo   - If the Electron download timed out, re-run this script -
    echo     npm will resume; or set a mirror first:
    echo       set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
    pause
    exit /b 1
  )
)

if exist node_modules\electron\dist\electron.exe goto electronok

REM --- Electron self-heal: extract-zip in the postinstall on new Node
REM can silently unpack only 1 file and exit 0. If electron.exe is
REM missing, unpack the already downloaded zip via built-in tar.
echo [WARN] electron.exe is missing after npm ci - repairing install...
if not exist node_modules\electron\dist mkdir node_modules\electron\dist >nul 2>nul
set "ELZIP="
for /r "%LOCALAPPDATA%\electron\Cache" %%z in ("electron-v*.zip") do if not defined ELZIP set "ELZIP=%%z"
if not defined ELZIP goto noelectronzip
echo     unpacking "%ELZIP%" via tar...
tar -xf "%ELZIP%" -C node_modules\electron\dist
if errorlevel 1 goto noelectronzip
node -e "require('fs').writeFileSync('node_modules/electron/path.txt','electron.exe')"
if exist node_modules\electron\dist\electron.exe goto electronok

:noelectronzip
echo [ERROR] electron.exe could not be restored.
echo   Delete the cache and re-run this script:
echo     rd /s /q "%LOCALAPPDATA%\electron\Cache"
pause
exit /b 1

:electronok

REM --- build core + overlay (portable: dist уже собран, пропускаем) ---
if not exist .portable goto buildovl
if not exist "packages\core\dist\index.js" goto buildovl
if not exist "apps\overlay\dist\main.js" goto buildovl
echo Portable build: skipping compile (dist is already built).
goto startovl

:buildovl
echo.
echo Building core and overlay...
call npm run build -w @poe2-kit/core
if errorlevel 1 goto err
call npm run build -w @poe2-kit/overlay
if errorlevel 1 goto err

:startovl
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
REM Электрон пишет логи в UTF-8; через PowerShell-хост декодируем корректно
REM (chcp 65001 помогает не во всех консолях: conhost с растровым шрифтом
REM всё равно портит кириллицу, а PowerShell печатает через консольный API).
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; npm run start -w @poe2-kit/overlay"
set OVEXIT=%ERRORLEVEL%
if not "%OVEXIT%"=="0" (
  echo.
  echo [ERROR] Overlay exited with code %OVEXIT% right after start.
  echo   - Look for the reason in the lines above ^(electron output^).
  echo   - Full log: %%APPDATA%%\@poe2-kit\overlay\overlay.log
  echo   - Try launching from an open console: cmd /c start-overlay.bat
)
goto end

:err
echo.
echo [ERROR] Build failed. See the messages above.
pause

REM ══ PORTABLE-ветка (без Node.js) ════════════════════════════════════════════
:portable
echo Portable build: Node.js is not required.
if exist "node_modules\electron\dist\electron.exe" goto portstart
echo.
echo First run: downloading the Electron runtime (~110 MB, one time only).
echo (After this the overlay works offline.)
call :bootelectron
if errorlevel 1 (
  echo.
  echo [ERROR] Could not download Electron.
  echo   Check the internet connection and re-run this script.
  echo   Manual link: https://github.com/electron/electron/releases/download/v33.4.11/
  pause
  exit /b 1
)

:portstart
echo.
echo Starting the overlay...
echo.
echo HOW TO USE IN GAME:
echo   1. Launch Path of Exile 2.
echo   2. Hover over an item and press Ctrl+C (copies item text).
echo   3. Ctrl+F1  - price check of the item from clipboard.
echo   4. Ctrl+F3  - import build (PoB share-code / poe.ninja profile link).
echo   5. Ctrl+F2  - build shopping list; Ctrl+F4 - leveling hints.
echo   6. Ctrl+F5  - move the overlay; Ctrl+F6 - settings.
echo.
echo Full guide: README-FIRST.txt (in this folder).
"node_modules\electron\dist\electron.exe" "%~dp0apps\overlay"
set OVEXIT=%ERRORLEVEL%
if not "%OVEXIT%"=="0" (
  echo.
  echo [ERROR] Overlay exited with code %OVEXIT% right after start.
  echo   - Full log: %APPDATA%\@poe2-kit\overlay\overlay.log
  echo   - Try: %~dp0install-tools-minimal.bat ^(repair runtime^)
)
echo.
pause
exit /b %OVEXIT%

REM ── Одноразовая загрузка Electron: github.com → фолбэк npmmirror.com ────────
:bootelectron
set "ELVER=33.4.11"
set "ELDIR=node_modules\electron\dist"
if not exist "%ELDIR%" mkdir "%ELDIR%"
set "ELZIP=%TEMP%\electron-v%ELVER%-win32-x64.zip"
if exist "%ELZIP%" del "%ELZIP%"
echo   [1/3] downloading from github.com...
curl.exe -L --retry 3 --connect-timeout 20 -o "%ELZIP%" "https://github.com/electron/electron/releases/download/v%ELVER%/electron-v%ELVER%-win32-x64.zip"
if not errorlevel 1 goto bootunpack
echo   [1/3] github failed - trying the npmmirror fallback...
curl.exe -L --retry 3 --connect-timeout 20 -o "%ELZIP%" "https://npmmirror.com/mirrors/electron/v%ELVER%/electron-v%ELVER%-win32-x64.zip"
if errorlevel 1 exit /b 1
:bootunpack
echo   [2/3] unpacking...
tar -xf "%ELZIP%" -C "%ELDIR%"
if errorlevel 1 exit /b 1
if not exist "%ELDIR%\electron.exe" (
  echo   Downloaded file is not a valid Electron archive.
  exit /b 1
)
echo   [3/3] done - removing the temporary zip.
del "%ELZIP%"
exit /b 0

:end
echo.
pause
endlocal
