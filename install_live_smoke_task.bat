@echo off
REM Installs the daily Task Scheduler job: live-smoke against live APIs (P2 #19).
REM Runs as the current user daily at 06:00 local time.
REM Worker script: run_live_smoke_daily.bat (same directory).
setlocal
cd /d "%~dp0"

set "TASK=poe2-kit-live-smoke"
set "TASKPATH=%~dp0run_live_smoke_daily.bat"

schtasks /create /f /tn "%TASK%" /tr "\"%TASKPATH%\"" /sc daily /st 06:00
if errorlevel 1 (
  echo ERROR: failed to create task %TASK%.
  exit /b 1
)

echo.
echo Task Scheduler job created: %TASK%
echo   Daily at 06:00, user: %USERNAME%
echo.
echo Useful commands:
echo   Run now:       schtasks /run /tn "%TASK%"
echo   Status/next:   schtasks /query /tn "%TASK%" /v /fo LIST
echo   Delete:        schtasks /delete /tn "%TASK%" /f
echo   Logs:          %~dp0logs
endlocal