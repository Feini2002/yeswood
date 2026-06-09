@echo off
setlocal EnableExtensions
chcp 65001 >nul

cd /d "%~dp0"

set "PORT=4300"
set "APP_ENTRY=.\src\backend\server.mjs"

echo [dashboard] Intranet display mode launcher
echo [dashboard] Workspace: %CD%
echo [dashboard] Local URL: http://localhost:%PORT%
echo [dashboard] Steps: rebuild public/data snapshot ^> clear stale port ^> start server ^> health check ^> warm data ^> open browser
echo.

if not exist ".\scripts\launch-intranet-dashboard.ps1" (
  echo [dashboard] ERROR: .\scripts\launch-intranet-dashboard.ps1 was not found.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\launch-intranet-dashboard.ps1" -Port %PORT% -AppEntry "%APP_ENTRY%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [dashboard] Startup failed. See messages above or .tmp\intranet-dashboard-server.err.log
  pause
  exit /b %EXIT_CODE%
)

exit /b 0
