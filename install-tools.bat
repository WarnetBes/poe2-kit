@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

REM ============================================================
REM  install-tools.bat - install toolchain for PoE2 Kit on Windows
REM  Installs, if not already present:
REM    1) Node.js LTS  (v24, tested)
REM    2) C++ toolchain - VS Build Tools (C++ workload) + VC++ Redist
REM
REM  Installer sources, in order:
REM    - offline: <bat-dir>\downloads\  and  <bat-dir>\game-pc-tools\downloads\
REM         (node-vXX.msi, vs_BuildTools.exe, vc_redist.x64.exe)
REM    - fallback: downloaded from official URLs (requires internet).
REM  Node + VC++ Redist install silently. VS Build Tools downloads
REM  components on first run; full offline needs a layout (see README).
REM
REM  This script requests administrator rights (UAC) on its own.
REM ============================================================

echo.
echo ============================================
echo   PoE2 Kit - Install Tools
echo   Node.js + C++ Build Tools
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

REM ----------------------------------------------------------------
REM  2) C++ / VC++ Redist
REM ----------------------------------------------------------------
call :CHECK_VCREDIST
if errorlevel 1 goto :needvc
echo [OK] VC++ Runtime present.
goto :havevc
:needvc
echo [..] VC++ Runtime missing - installing...
call :INSTALL_VCREDIST
:havevc

REM ----------------------------------------------------------------
REM  3) VS Build Tools (C++ workload)
REM ----------------------------------------------------------------
if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\" goto :havevs
if exist "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\" goto :havevs
where cl >nul 2>nul
if not errorlevel 1 goto :havevs
echo [..] VS Build Tools with C++ workload not found - installing...
call :INSTALL_VSBUILDTOOLS
if errorlevel 1 goto :errait
goto :havevs
:havevs
echo [OK] VS Build Tools / MSVC compiler available.

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

:CHECK_VCREDIST
reg query "HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" /v Version >nul 2>nul
if not errorlevel 1 exit /b 0
reg query "HKLM\SOFTWARE\Wow6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" /v Version >nul 2>nul
if not errorlevel 1 exit /b 0
exit /b 1

:INSTALL_VCREDIST
set "vc="
if defined DLOAD if exist "%DLOAD%\vc_redist.x64.exe" set "vc=%DLOAD%\vc_redist.x64.exe"
if defined vc goto :vchavefile
set "vc=%TEMP%\vc_redist.x64.exe"
if exist "%vc%" goto :vchavefile
echo   Downloading VC++ Redist x64...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile '%vc%' -UseBasicParsing" >nul 2>nul
:vchavefile
if not exist "%vc%" (
  echo   [WARN] Cannot obtain vc_redist.x64.exe - skipping VC++ Redist.
  exit /b 0
)
echo   Installing VC++ Redist, quiet...
start "" /wait "%vc%" /install /quiet /norestart >nul 2>nul
exit /b 0

:INSTALL_VSBUILDTOOLS
set "vsb="
if defined DLOAD if exist "%DLOAD%\vs_BuildTools.exe" set "vsb=%DLOAD%\vs_BuildTools.exe"
if defined vsb goto :vshavefile
set "vsb=%TEMP%\vs_BuildTools.exe"
if exist "%vsb%" goto :vshavefile
echo   Downloading VS Build Tools bootstrap...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile '%vsb%' -UseBasicParsing" >nul 2>nul
:vshavefile
if not exist "%vsb%" (
  echo   [ERROR] Cannot obtain vs_BuildTools.exe.
  echo   Check internet access or put vs_BuildTools.exe into downloads\.
  exit /b 1
)
echo   Installing VS Build Tools with C++ workload.
echo   This downloads components and can take a while...
"%vsb%" --quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended
exit /b %errorlevel%

:errait
echo.
echo [ERROR] A required component failed to install.
echo   - Run install-tools.bat from an elevated prompt, right-click Run as administrator.
echo   - The C++ workload needs internet on first install.
echo   - Offline options are described in deploy/game-pc-tools/README.md.
pause
exit /b 1

:EOF
exit /b 0