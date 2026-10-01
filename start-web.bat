@echo off
setlocal
cd /d "%~dp0"

REM --- Если порт 5173 уже занят — другой экземпляр уже работает, молча выходим.
netstat -an | findstr /r /c:":5173 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  exit /b 0
)

REM --- Portable: раздаём готовую сборку apps\web\dist без vite.
if exist .portable (
  if exist "apps\web\dist\index.html" (
    echo Starting PoE2 Kit web (portable static build) on http://0.0.0.0:5173 (LAN)
    echo Open http://localhost:5173 on this PC, or http://%COMPUTERNAME%:5173 from another PC in LAN.
    echo.
    node apps\web\serve-dist.mjs
    endlocal
    exit /b 0
  )
)

echo Starting PoE2 Kit web preview on http://0.0.0.0:5173 (LAN)
echo Open http://localhost:5173 on this PC, or http://%COMPUTERNAME%:5173 from another PC in LAN.
echo.
npm run preview -w @poe2-kit/web -- --port 5173 --host 0.0.0.0
endlocal
