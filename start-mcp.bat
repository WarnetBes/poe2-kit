@echo off
REM PoE2 Kit - MCP server launcher (build + check + SELF-LOGGING)
REM Log is written next to this file: start-mcp-log.txt
setlocal EnableExtensions
set "LOG=%~dp0start-mcp-log.txt"

call :main > "%LOG%" 2>&1
set "EC=%ERRORLEVEL%"

type "%LOG%"
echo.
echo ============================================
if "%EC%"=="0" (echo  DONE. See config snippets above.) else (echo  EXIT CODE %EC% - see log: "%LOG%")
echo ============================================
pause
endlocal & exit /b %EC%

:main
chcp 65001 >nul
echo PoE2 Kit - MCP server check
echo Started: %DATE% %TIME%
echo Bat dir: "%~dp0"
echo.

REM UNC guard: cmd cannot cd to UNC; pushd maps it to a temp drive.
pushd "%~dp0" 2>nul
if errorlevel 1 (
  echo [ERROR] pushd failed - cannot map "%~dp0"
  exit /b 1
)
echo Pushd OK, cwd: "%CD%"
echo.

echo --- Node.js check ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install the LTS version from https://nodejs.org
  popd
  exit /b 2
)
for /f "tokens=* delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo Node.js: %NODEVER%
echo.

if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm ci
  if errorlevel 1 (
    echo [ERROR] npm ci failed - see above.
    popd
    exit /b 3
  )
)

if exist .portable (
  if exist "packages\core\dist\index.js" if exist "apps\mcp\dist\index.js" (
    echo Portable build: skipping compile - dist is already built.
    goto smoke
  )
)
echo Building core and mcp...
call npm run build -w @poe2-kit/core
if errorlevel 1 goto err
call npm run build -w @poe2-kit/mcp
if errorlevel 1 goto err

:smoke
echo.
echo Smoke test...
node apps\mcp\dist\index.js --smoke
if errorlevel 1 (
  echo [ERROR] MCP smoke test failed - see above.
  popd
  exit /b 4
)
echo.
echo ============================================
echo  MCP server is ready. It runs over stdio -
echo  a client (OpenCode, Claude Desktop, ...) starts it itself.
echo.
echo  Register it like this:
echo    command: node
echo    args:    "F:\OpenCodeProjects\poe2-kit\apps\mcp\dist\index.js"
echo.
echo  OpenCode - add to opencode.json (on this PC):
echo    "mcp": { "poe2-kit": {
echo      "command": "node",
echo      "args": ["F:\\OpenCodeProjects\\poe2-kit\\apps\\mcp\\dist\\index.js"],
echo      "enabled": true } }
echo.
echo  Claude Desktop - claude_desktop_config.json:
echo    "mcpServers": { "poe2-kit": {
echo      "command": "node",
echo      "args": ["F:\\OpenCodeProjects\\poe2-kit\\apps\\mcp\\dist\\index.js"] } }
echo.
echo  Note: overlay and MCP work at the same time (MCP is stdio, no ports).
echo ============================================
echo.
echo MCP tools: price check, build decode/price, leveling plan,
echo currency prices, items DB, sources library, overlay state/gaps.
echo Prompt for the AI: apps\mcp\ASSISTANT_GUIDE.md
popd
exit /b 0

:err
echo.
echo [ERROR] Build failed - see above.
popd
exit /b 5
