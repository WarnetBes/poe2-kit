@echo off
setlocal
REM No587-ter: ASCII-only + CRLF required. LF-only batch files break
REM parenthesized if-blocks in cmd (silent, unpredictable branch skips).
REM All output is mirrored to %TEMP%\poe2k-startweb.log.
set "LOG=%TEMP%\poe2k-startweb.log"
echo ==== %DATE% %TIME% %COMPUTERNAME% ====> "%LOG%"

pushd "%~dp0" || (
  echo [ERROR] Cannot enter script directory: %~dp0>> "%LOG%"
  echo [ERROR] Cannot enter script directory: %~dp0
  pause
  exit /b 1
)
echo cwd=%CD%>> "%LOG%"

where node >nul 2>nul
if errorlevel 1 goto noNode
echo node: >> "%LOG%"
where node >> "%LOG%" 2>&1

netstat -an | findstr /r /c:":5173 .*LISTENING" >nul 2>nul
if not errorlevel 1 goto portBusy

if exist ".portable" (echo .portable: found>> "%LOG%") else (echo .portable: NOT found in %CD%>> "%LOG%")
if exist "apps\web\dist\index.html" (echo dist\index.html: found>> "%LOG%") else (echo dist\index.html: NOT found>> "%LOG%")

if exist ".portable" if exist "apps\web\dist\index.html" goto portable
goto preview

:portable
echo Starting PoE2 Kit web (portable static build) on http://0.0.0.0:5173 (LAN)
echo Open http://localhost:5173 on this PC, or http://%COMPUTERNAME%:5173 from another PC in LAN.
echo.
node apps\web\serve-dist.mjs >> "%LOG%" 2>&1
echo [web server stopped] code=%ERRORLEVEL% - full log: "%LOG%"
echo Send this file if this was not expected.
pause
endlocal
exit /b 0

:preview
echo Starting PoE2 Kit web preview on http://0.0.0.0:5173 (LAN)
echo Open http://localhost:5173 on this PC, or http://%COMPUTERNAME%:5173 from another PC in LAN.
echo.
npm run preview -w @poe2-kit/web -- --port 5173 --host 0.0.0.0 >> "%LOG%" 2>&1
echo [npm preview stopped] code=%ERRORLEVEL% - full log: "%LOG%"
echo Send this file if this was not expected.
pause
endlocal
exit /b 0

:noNode
echo [ERROR] Node.js not found>> "%LOG%"
echo [ERROR] Node.js not found. Web needs Node.js LTS v20+: https://nodejs.org/
echo Alternative: run web on the other PC, open http://192.168.0.199:5173
pause
exit /b 1

:portBusy
echo [WARN] port 5173 already LISTENING>> "%LOG%"
echo Port 5173 already listening - web is already running.
echo Open http://localhost:5173 in the browser.
echo If the page does not open, kill the zombie node: taskkill /f /im node.exe
pause
exit /b 0
