@echo off
setlocal EnableExtensions
chcp 65001 >nul

cd /d "%~dp0"

set "SNAPSHOT_DIR=%CD%\.runtime\intranet-dashboard"

if exist "%SNAPSHOT_DIR%" (
  echo [dashboard] Removing %SNAPSHOT_DIR%
  rmdir /S /Q "%SNAPSHOT_DIR%"
  echo [dashboard] Snapshot removed.
) else (
  echo [dashboard] No intranet snapshot found.
)

rmdir "%CD%\.runtime" >nul 2>nul
pause
