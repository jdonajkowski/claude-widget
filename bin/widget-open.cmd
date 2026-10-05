@echo off
rem Shows a page, file or URL in Claude Widget's built-in browser: widget-open <url-or-file>
rem Works in sessions and terminal tabs started by the widget, which set CLAUDE_WIDGET_EXE.
rem From PowerShell, widget-open.ps1 runs instead (cmd.exe splits URLs at & and =).
if "%~1"=="" (echo usage: widget-open ^<url-or-file^> 1>&2 & exit /b 2)
if not defined CLAUDE_WIDGET_EXE (echo widget-open: only works inside Claude Widget 1>&2 & exit /b 1)
if defined CLAUDE_WIDGET_APP (
  start "" /b "%CLAUDE_WIDGET_EXE%" "%CLAUDE_WIDGET_APP%" "--open=%~1" >nul 2>&1
) else (
  start "" /b "%CLAUDE_WIDGET_EXE%" "--open=%~1" >nul 2>&1
)
echo Opened %~1 in the widget's browser
