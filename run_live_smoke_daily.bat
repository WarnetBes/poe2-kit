@echo off
REM Daily live-smoke against LIVE PoE2 APIs (P2 #19, local Task Scheduler).
REM Runs via Task Scheduler (see install_live_smoke_task.bat) or manually.
REM What it does: builds core (fresh dist) -> runs packages/core/live-smoke.mjs
REM (poe2scout / trade2 / poe.ninja) with a FRESH HTTP cache.
REM Logs:     <root>\logs\live-smoke-YYYYMMDD_HHMM.log
REM Status:   <root>\logs\live-smoke-LAST.txt  ("OK" or "FAIL_<rc>")
REM Exit:     0 = all live APIs OK, schema NOT broken; 1 = provider/schema/network/build failed.
setlocal
cd /d "%~dp0"

if not exist logs mkdir logs

REM --- Date/time stamp (locale-independent) ---
for /f "delims=" %%D in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmm"') do set "STAMP=%%D"
set "LOG=logs\live-smoke-%STAMP%.log"

echo [%date% %time%] live-smoke: build core + run against live APIs > "%LOG%"

REM --- Fresh dist (live-smoke imports from packages/core/dist) ---
call npm run build -w @poe2-kit/core >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] LIVE-SMOKE FAIL: core build failed >> "%LOG%"
  echo BUILD_FAIL > logs\live-smoke-LAST.txt
  echo LIVE-SMOKE FAIL: core build failed. See "%LOG%"
  exit /b 1
)

REM --- Fresh HTTP cache: remove any previous cached API responses so every
REM --- run actually hits the LIVE APIs (otherwise the disk TTL-cache would
REM --- return yesterday's responses and the stat-id regression would be missed) ---
set "POE2_KIT_CACHE_DIR=%TEMP%\poe2k-live-cache"
if exist "%POE2_KIT_CACHE_DIR%" rmdir /s /q "%POE2_KIT_CACHE_DIR%"

node packages/core/live-smoke.mjs >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"

REM --- Data freshness pipeline (No. 208): refresh trade_stats + report on
REM --- the staleness of all offline datasets. Does not block the smoke result. ---
echo [%date% %time%] refresh-data: >> "%LOG%"
node scripts/refresh-data.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] refresh-data: STALE/FAILED ^(see above^) >> "%LOG%"
) else (
  echo [%date% %time%] refresh-data: OK >> "%LOG%"
)

echo [%date% %time%] exit=%RC% >> "%LOG%"
if %RC%==0 ( echo OK > logs\live-smoke-LAST.txt ) else ( echo FAIL_%RC% > logs\live-smoke-LAST.txt )

echo.
if %RC%==0 (
  echo LIVE-SMOKE: OK. See "%LOG%"
) else (
  echo LIVE-SMOKE: FAIL rc=%RC% - live APIs/schema changed or network down. See "%LOG%"
)
endlocal & exit /b %RC%