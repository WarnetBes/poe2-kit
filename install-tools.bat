@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

REM ============================================================
REM  install-tools.bat - install toolchain for PoE2 Kit on Windows
REM  Installs, if not already present:
REM    1) Node.js LTS  (v24, tested)
REM
REM  Installer sources, in order:
REM    - offline: <bat-dir>\downloads\  and  <bat-dir>\game-pc-tools\downloads\
REM         (node-vXX.msi)
REM    - fallback: downloaded from official URLs (requires internet).
REM  Node installs silently.
REM
REM  This script requests administrator rights (UAC) on its own.
REM ============================================================

echo.
echo ============================================
echo   PoE2 Kit - Install Tools
echo   Node.js
echo ============================================
echo.

REM ---- Elevate to administrator if needed; the elevated copy re-runs this
REM ---- script from the top and does the real installs.
net session >nul 2>nul
if %errorlevel% == 0 goto :foundadmin
echo Requesting administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs -Wait"
echo If you cancelled the UAC prompt, the toolchain was NOT installed.
echo Re-run this script and accept UAC, or run install-tools.bat as admin.
goto :eof

:foundadmin
set "BATPATH=%~dp0"
set "DLOAD="

REM ---- Locate an offline-installer folder, if any ----
if exist "%BATPATH%downloads\node-v24.21.0-x64.msi" set "DLOAD=%BATPATH%downloads"
if not defined DLOAD if exist "%BATPATH%game-pc-tools\downloads\node-v24.21.0-x64.msi" set "DLOAD=%BATPATH%game-pc-tools\downloads"
if not defined DLOAD if exist "%BATPATH%..\deploy\game-pc-tools\downloads\node-v24.21.0-x64.msi" set "DLOAD=%BATPATH%..\deploy\game-pc-tools\downloads"
if defined DLOAD echo Offline installers found in: %DLOAD%

REM ----------------------------------------------------------------
REM  1) Node.js
REM ----------------------------------------------------------------
set "NODEVER="
where node >nul 2>nul
if not errorlevel 1 for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODEVER=%%v"
if defined NODEVER goto :hasnode
echo [..] Node.js not found - installing...
call :INSTALL_NODE
if errorlevel 1 goto :errait
:hasnode
for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODEVER=%%v"
if defined NODEVER echo [OK] Node.js: %NODEVER%

echo.
echo ============================================
echo   Toolchain ready. Run start-overlay.bat
echo ============================================
echo.
exit /b 0

REM ============================================================
REM  Subroutines
REM ============================================================

:INSTALL_NODE
set "msi="
if defined DLOAD if exist "%DLOAD%\node-v24.21.0-x64.msi" set "msi=%DLOAD%\node-v24.21.0-x64.msi"
if defined msi goto :nodehavefile
set "msi=%TEMP%\node-v24.21.0-x64.msi"
if exist "%msi%" goto :nodehavefile
echo   Downloading Node.js LTS v24.21.0...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-x64.msi' -OutFile '%msi%' -UseBasicParsing" >nul 2>nul
:nodehavefile
if not exist "%msi%" (
  echo   [ERROR] Cannot obtain Node.js installer.
  echo   Check internet access or put node-v24.21.0-x64.msi into downloads\.
  exit /b 1
)
echo   Installing Node.js LTS, quiet MSI...
start "" /wait msiexec /i "%msi%" /qn /norestart ADDLOCAL=ALL >nul 2>nul
exit /b %errorlevel%

:errait
echo.
echo [ERROR] A required component failed to install.
echo   - Run install-tools.bat from an elevated prompt, right-click Run as administrator.
pause
exit /b 1

:EOF
exit /b 0