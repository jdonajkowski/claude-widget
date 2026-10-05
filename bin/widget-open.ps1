# Old name of gremlin-open (the app was called Claude Widget), kept so existing instructions keep working.
& (Join-Path $PSScriptRoot 'gremlin-open.ps1') @args
exit $LASTEXITCODE
