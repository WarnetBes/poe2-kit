@echo off
setlocal
REM Консоль в UTF-8.
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   PoE2 Kit - MCP server (build + check)
echo ============================================
echo.

REM --- check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=* delims=" %%v in ('node -v') do set NODEVER=%%v
echo Node.js: %NODEVER%
echo.

REM --- install dependencies (first run only) ---
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm ci
  if errorlevel 1 (
    echo [ERROR] npm ci failed - see the messages above.
    pause
    exit /b 1
  )
)

REM --- build core + mcp (portable: dist уже собран, пропускаем) ---
if exist .portable (
  if exist "packages\core\dist\index.js" if exist "apps\mcp\dist\index.js" (
    echo Portable build: skipping compile (dist is already built).
    goto smoke
  )
)
echo Building core and mcp...
call npm run build -w @poe2-kit/core
if errorlevel 1 goto err
call npm run build -w @poe2-kit/mcp
if errorlevel 1 goto err

:smoke
REM --- smoke test ---
echo.
echo Smoke test...
node apps\mcp\dist\index.js --smoke
if errorlevel 1 (
  echo [ERROR] MCP smoke test failed.
  pause
  exit /b 1
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
echo  Note: overlay and MCP work at the same time
echo  (MCP has no ports, it is stdio).
echo ============================================
echo.
echo MCP tools: price check, build decode/price,
echo leveling plan, currency prices, items DB.
echo Prompt for the AI: apps\mcp\ASSISTANT_GUIDE.md
echo.
pause
exit /b 0

:err
echo.
echo [ERROR] Build failed. See the messages above.
pause
exit /b 1
