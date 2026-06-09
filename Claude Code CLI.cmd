@echo off
setlocal

set "CLAUDE_EXE=%USERPROFILE%\.local\bin\claude.exe"
if not exist "%CLAUDE_EXE%" for /f "delims=" %%I in ('where claude 2^>nul') do if not defined CLAUDE_EXE_FROM_PATH set "CLAUDE_EXE_FROM_PATH=%%I"
if defined CLAUDE_EXE_FROM_PATH set "CLAUDE_EXE=%CLAUDE_EXE_FROM_PATH%"

for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ANTHROPIC_AUTH_TOKEN 2^>nul') do set "ANTHROPIC_AUTH_TOKEN=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ANTHROPIC_API_KEY 2^>nul') do set "ANTHROPIC_API_KEY=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ANTHROPIC_BASE_URL 2^>nul') do set "ANTHROPIC_BASE_URL=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ANTHROPIC_MODEL 2^>nul') do set "ANTHROPIC_MODEL=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ANTHROPIC_SMALL_FAST_MODEL 2^>nul') do set "ANTHROPIC_SMALL_FAST_MODEL=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ANTHROPIC_DEFAULT_OPUS_MODEL 2^>nul') do set "ANTHROPIC_DEFAULT_OPUS_MODEL=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ANTHROPIC_DEFAULT_SONNET_MODEL 2^>nul') do set "ANTHROPIC_DEFAULT_SONNET_MODEL=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ANTHROPIC_DEFAULT_HAIKU_MODEL 2^>nul') do set "ANTHROPIC_DEFAULT_HAIKU_MODEL=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v CLAUDE_CODE_SUBAGENT_MODEL 2^>nul') do set "CLAUDE_CODE_SUBAGENT_MODEL=%%B"
for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v CLAUDE_CODE_EFFORT_LEVEL 2^>nul') do set "CLAUDE_CODE_EFFORT_LEVEL=%%B"

if not defined ANTHROPIC_API_KEY if defined ANTHROPIC_AUTH_TOKEN set "ANTHROPIC_API_KEY=%ANTHROPIC_AUTH_TOKEN%"
if not defined ANTHROPIC_AUTH_TOKEN if defined ANTHROPIC_API_KEY set "ANTHROPIC_AUTH_TOKEN=%ANTHROPIC_API_KEY%"
if not defined ANTHROPIC_BASE_URL set "ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic"
if not defined ANTHROPIC_MODEL set "ANTHROPIC_MODEL=deepseek-v4-pro[1m]"
if not defined ANTHROPIC_SMALL_FAST_MODEL set "ANTHROPIC_SMALL_FAST_MODEL=deepseek-v4-flash"
if not defined ANTHROPIC_DEFAULT_OPUS_MODEL set "ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro[1m]"
if not defined ANTHROPIC_DEFAULT_SONNET_MODEL set "ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro[1m]"
if not defined ANTHROPIC_DEFAULT_HAIKU_MODEL set "ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash"
if not defined CLAUDE_CODE_SUBAGENT_MODEL if defined ANTHROPIC_SMALL_FAST_MODEL set "CLAUDE_CODE_SUBAGENT_MODEL=%ANTHROPIC_SMALL_FAST_MODEL%"
if not defined CLAUDE_CODE_SUBAGENT_MODEL set "CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash"
if not defined CLAUDE_CODE_EFFORT_LEVEL set "CLAUDE_CODE_EFFORT_LEVEL=max"

if not exist "%CLAUDE_EXE%" (
  echo Claude Code CLI was not found at:
  echo %CLAUDE_EXE%
  echo.
  echo Please install Claude Code first.
  pause
  exit /b 1
)

set "LAUNCH_DIR=%~dp0"
cd /d "%LAUNCH_DIR%"
"%CLAUDE_EXE%" %*
set "CLAUDE_EXIT_CODE=%ERRORLEVEL%"

if not "%CLAUDE_EXIT_CODE%"=="0" (
  echo.
  echo Claude Code exited with code %CLAUDE_EXIT_CODE%.
  echo If this window opened from Explorer, review the Claude Code error above.
  pause
)

exit /b %CLAUDE_EXIT_CODE%
