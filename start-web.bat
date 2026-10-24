@echo off
setlocal
REM №587-bis: diagnostics — window closing instantly = falling into a branch without pause.
REM Now every output goes to a log (%TEMP%\poe2k-startweb.log) and there's a pause at every exit.
set "LOG=%TEMP%\poe2k-startweb.log"
echo ==== %DATE% %TIME% %COMPUTERNAME% ====> "%LOG%"

REM №587: pushd instead of cd /d — cd cannot make a UNC path the current directory,
REM pushd maps it to a temporary drive letter on its own.
pushd "%~dp0" || (
  echo [ERROR] Cannot enter script directory: %~dp0>> "%LOG%"
  echo [ERROR] Cannot enter script directory: %~dp0
  pause
  exit /b 1
)
echo cwd=%CD%>> "%LOG%"

REM --- Node is mandatory for the web (overlay runs without it, the web does not).
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found>> "%LOG%"
  echo [ERROR] Node.js not found. Web needs Node.js LTS v20+: https://nodejs.org/
  echo Alternative: on the other PC the web already runs, open http://192.168.0.199:5173
  pause
  exit /b 1
)
echo node: >> "%LOG%"
where node >> "%LOG%" 2>&1

REM --- If port 5173 is already taken — a web is already running.
netstat -an | findstr /r /c:":5173 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo [WARN] port 5173 already LISTENING — an old instance is running>> "%LOG%"
  echo Port 5173 already listening - web is already running.
  echo Open http://localhost:5173 in the browser.
  echo If the page does not open — kill the zombie: taskkill /f /im node.exe (restart the overlay afterwards)
  pause
  exit /b 0
)

REM --- Portable: serve the prebuilt apps\web\dist without vite.
if exist ".portable" (
  echo .portable: found>> "%LOG%"
) else (
  echo .portable: NOT found in %CD%>> "%LOG%"
)
if exist "apps\web\dist\index.html" (
  echo dist\index.html: found>> "%LOG%"
) else (
  echo dist\index.html: NOT found>> "%LOG%"
)
if exist .portable (
  if exist "apps\web\dist\index.html" (
    echo Starting PoE2 Kit web (portable static build) on http://0.0.0.0:5173 (LAN)
    echo Open http://localhost:5173 on this PC, or http://%COMPUTERNAME%:5173 from another PC in LAN.
    echo.
    node apps\web\serve-dist.mjs >> "%LOG%" 2>&1
    echo [web server stopped] code=%ERRORLEVEL% — details in the log: "%LOG%"
    echo If this was not expected — send the file "%LOG%".
    pause
    endlocal
    exit /b 0
  )
)

echo Starting PoE2 Kit web preview on http://0.0.0.0:5173 (LAN)
echo Open http://localhost:5173 on this PC, or http://%COMPUTERNAME%:5173 from another PC in LAN.
echo.
npm run preview -w @poe2-kit/web -- --port 5173 --host 0.0.0.0 >> "%LOG%" 2>&1
echo [npm preview stopped] code=%ERRORLEVEL% — details in the log: "%LOG%"
echo If this was not expected — send the file "%LOG%".
pause
endlocal
