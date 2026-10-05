@echo off
rem Shows a page, file or URL in Gremlin's built-in browser: gremlin-open <url-or-file>
rem Works in sessions and terminal tabs started by Gremlin, which set GREMLIN_EXE.
rem From PowerShell, gremlin-open.ps1 runs instead (cmd.exe splits URLs at & and =).
if "%~1"=="" (echo usage: gremlin-open ^<url-or-file^> 1>&2 & exit /b 2)
if not defined GREMLIN_EXE (echo gremlin-open: only works inside Gremlin 1>&2 & exit /b 1)
if defined GREMLIN_APP (
  start "" /b "%GREMLIN_EXE%" "%GREMLIN_APP%" "--open=%~1" >nul 2>&1
) else (
  start "" /b "%GREMLIN_EXE%" "--open=%~1" >nul 2>&1
)
echo Opened %~1 in Gremlin's browser
