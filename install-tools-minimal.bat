@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

echo ============================================
echo   PoE2 Kit - Quick Install (Minimal)
echo   Node.js only (skip VS Build Tools)
echo ============================================
echo.

REM ---- Elevate to administrator if needed ----
net session >nul 2>nul
if %errorlevel% == 0 goto :foundadmin
echo Requesting administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs -Wait"
echo If you cancelled the UAC prompt, the toolchain was NOT installed.
goto :eof

:foundadmin
set "BATPATH=%~dp0"
set "DLOAD="

REM ---- Locate offline-installer folder ----
if exist "%BATPATH%downloads\node-v24.21.0-x64.msi" set "DLOAD=%BATPATH%downloads"
if not defined DLOAD if exist "%BATPATH%game-pc-tools\downloads\node-v24.21.0-x64.msi" set "DLOAD=%BATPATH%game-pc-tools\downloads"
if not defined DLOAD if exist "%BATPATH%..\deploy\game-pc-tools\downloads\node-v24.21.0-x64.msi" set "DLOAD=%BATPATH%..\deploy\game-pc-tools\downloads"
if defined DLOAD echo Offline installers found in: %DLOAD%

REM ----------------------------------------------------------------
REM  1) Node.js
REM ----------------------------------------------------------------
echo [1/3] Checking Node.js...
where node >nul 2>nul
if %errorlevel% == 0 (
    for /f "tokens=*" %%i in ('node --version') do set "NODE_VER=%%i"
    echo [OK] Node.js: %NODE_VER%
) else (
    echo [..] Node.js not found - installing...
    if defined DLOAD (
        echo   Using offline installer: %DLOAD%\node-v24.21.0-x64.msi
        msiexec /i "%DLOAD%\node-v24.21.0-x64.msi" /qn /norestart
    ) else (
        echo   Downloading Node.js LTS from official site...
        powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-x64.msi' -OutFile '%TEMP%\node-v24.21.0-x64.msi'"
        msiexec /i "%TEMP%\node-v24.21.0-x64.msi" /qn /norestart
    )
    echo [OK] Node.js installed.
)

REM ----------------------------------------------------------------
REM  2) VC++ Runtime (check only, no install if present)
REM ----------------------------------------------------------------
echo [2/3] Checking VC++ Runtime...
if exist "%SystemRoot%\System32\msvcp140.dll" (
    echo [OK] VC++ Runtime present.
) else (
    echo [..] VC++ Runtime not found - installing...
    if defined DLOAD (
        echo   Using offline installer: %DLOAD%\vc_redist.x64.exe
        "%DLOAD%\vc_redist.x64.exe" /quiet /norestart
    ) else (
        echo   Downloading VC++ Runtime from official site...
        powershell -Command "Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile '%TEMP%\vc_redist.x64.exe'"
        "%TEMP%\vc_redist.x64.exe" /quiet /norestart
    )
    echo [OK] VC++ Runtime installed.
)

REM ----------------------------------------------------------------
REM  3) VS Build Tools (SKIP - not needed for overlay)
REM ----------------------------------------------------------------
echo [3/3] VS Build Tools: SKIPPED (not needed for overlay)
echo.
echo ============================================
echo   Installation complete!
echo   Run: start-overlay.bat
echo ============================================
echo.
pause
