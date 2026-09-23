@echo off
setlocal
cd /d "%~dp0"

REM --- Если порт 5173 уже занят — другой экземпляр уже работает, молча выходим.
netstat -an | findstr /r /c:":5173 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  exit /b 0
)

echo Starting PoE2 Kit web preview on http://0.0.0.0:5173 (LAN)
echo From the game PC (192.168.0.200) open: http://192.168.0.196:5173
echo.
npm run preview -w @poe2-kit/web -- --port 5173 --host 0.0.0.0
endlocal