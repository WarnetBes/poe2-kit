@echo off
rem PoE2 Kit web - запуск на игровом ПК (сервер без зависимостей)
rem Требуется Node.js. Если нет: winget install OpenJS.NodeJS.LTS
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установи: winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)
echo Запуск poe2-kit web на http://localhost:4173 ...
start "" http://localhost:4173
node server.mjs 4173
pause
