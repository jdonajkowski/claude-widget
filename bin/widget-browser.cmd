@echo off
rem Old name of gremlin-browser (the app was called Claude Widget), kept so existing instructions keep working.
call "%~dp0gremlin-browser.cmd" %*
exit /b %errorlevel%
