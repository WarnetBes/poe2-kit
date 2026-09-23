@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   PoE2 Kit - switch this copy to git auto-update
echo ============================================
echo.
echo This will:
echo   1. Install Git (if missing) via winget.
echo   2. Clone the repository with start-overlay.bat that does
echo      "git pull" automatically on every launch.
echo   3. Move node_modules from this copy to the new folder
echo      so dependencies do not reinstall.
echo.

REM --- git already installed? ---
set GITEXE=git
where git >nul 2>nul
if errorlevel 1 (
  echo Git not found - installing via winget...
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo [ERROR] winget failed. Install Git manually from https://git-scm.com
    echo         and run this script again.
    pause
    exit /b 1
  )
  set PATH=%PATH%;C:\Program Files\Git\cmd
  where git >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] git still not in PATH. Reopen this folder in a new terminal and retry.
    pause
    exit /b 1
  )
)

set REPO=https://git.sourcecraft.dev/volkovpartilaholin/poe2-kit.git
if exist poe2-kit-git (
  echo [ERROR] folder poe2-kit-git already exists here.
  pause
  exit /b 1
)

echo Cloning %REPO% ...
echo ^(if it asks for a login, enter your sourcecraft credentials; they will be cached^)
echo.
git clone %REPO% poe2-kit-git
if errorlevel 1 (
  echo.
  echo [ERROR] clone failed - check network / credentials and retry.
  pause
  exit /b 1
)

if exist node_modules (
  echo Moving node_modules ^(a minute or two, no reinstall needed^)...
  robocopy node_modules poe2-kit-git\node_modules /E /MOVE /NFL /NDL /NJH /NJS >nul
)
if exist package-lock.json del package-lock.json 2>nul

echo.
echo ============================================
echo  DONE.
echo  Run the overlay from now on:
echo    poe2-kit-git\start-overlay.bat
echo  Every launch it will "git pull" and show
echo  what is new automatically.
echo ============================================
pause
