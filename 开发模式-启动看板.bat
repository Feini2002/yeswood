@echo off
setlocal EnableExtensions
chcp 65001 >nul

cd /d "%~dp0"

set "PORT=4200"
set "APP_ENTRY=.\src\backend\server.mjs"

echo [dashboard] Development mode launcher
echo [dashboard] Workspace: %CD%
echo [dashboard] URL: http://localhost:%PORT%
echo [dashboard] Steps: clear stale port ^> start server ^> health check ^> open browser ^> warm data
echo.

if not exist ".\scripts\launch-dev-dashboard.ps1" (
  echo [dashboard] ERROR: .\scripts\launch-dev-dashboard.ps1 was not found.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\launch-dev-dashboard.ps1" -Port %PORT% -AppEntry "%APP_ENTRY%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [dashboard] Startup failed. See messages above or .tmp\dashboard-server.err.log
  pause
  exit /b %EXIT_CODE%
)

exit /b 0
