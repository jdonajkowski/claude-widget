# Old name of gremlin-browser (the app was called Claude Widget), kept so existing instructions keep working.
$input | & (Join-Path $PSScriptRoot 'gremlin-browser.ps1') @args
exit $LASTEXITCODE
