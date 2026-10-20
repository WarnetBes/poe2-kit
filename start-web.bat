@echo off
setlocal
cd /d "%~dp0"

REM --- Node обязателен для веба (overlay работает без него, веб — нет).
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Web needs Node.js LTS v20+:
  echo         https://nodejs.org/
  echo.
  echo Alternative right now: on the other PC the web already runs,
  echo open http://192.168.0.199:5173 from this PC.
  echo.
  pause
  exit /b 1
)

REM --- Если порт 5173 уже занят — другой экземпляр уже работает.
netstat -an | findstr /r /c:":5173 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Port 5173 already listening - web is already running.
  echo Open http://localhost:5173 in the browser.
  pause
  exit /b 0
)

REM --- Portable: раздаём готовую сборку apps\web\dist без vite.
if exist .portable (
  if exist "apps\web\dist\index.html" (
    echo Starting PoE2 Kit web (portable static build) on http://0.0.0.0:5173 (LAN)
    echo Open http://localhost:5173 on this PC, or http://%COMPUTERNAME%:5173 from another PC in LAN.
    echo.
    node apps\web\serve-dist.mjs
    echo.
    echo [web server stopped] If this was not expected - read the error above.
    pause
    endlocal
    exit /b 0
  )
)

echo Starting PoE2 Kit web preview on http://0.0.0.0:5173 (LAN)
echo Open http://localhost:5173 on this PC, or http://%COMPUTERNAME%:5173 from another PC in LAN.
echo.
npm run preview -w @poe2-kit/web -- --port 5173 --host 0.0.0.0
endlocal
