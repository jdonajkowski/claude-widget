@echo off
rem Drives Claude Widget's built-in browser: widget-browser help
rem From PowerShell, widget-browser.ps1 runs instead.
where node >nul 2>&1
if %errorlevel%==0 (
  node "%~dp0widget-browser.js" %*
  exit /b %errorlevel%
)
if not defined CLAUDE_WIDGET_EXE (echo widget-browser: only works inside Claude Widget 1>&2 & exit /b 1)
set ELECTRON_RUN_AS_NODE=1
"%CLAUDE_WIDGET_EXE%" "%~dp0widget-browser.js" %*
exit /b %errorlevel%
