@echo off
rem Drives Gremlin's built-in browser: gremlin-browser help
rem From PowerShell, gremlin-browser.ps1 runs instead.
where node >nul 2>&1
if %errorlevel%==0 (
  node "%~dp0gremlin-browser.js" %*
  exit /b %errorlevel%
)
if not defined GREMLIN_EXE (echo gremlin-browser: only works inside Gremlin 1>&2 & exit /b 1)
set ELECTRON_RUN_AS_NODE=1
"%GREMLIN_EXE%" "%~dp0gremlin-browser.js" %*
exit /b %errorlevel%
