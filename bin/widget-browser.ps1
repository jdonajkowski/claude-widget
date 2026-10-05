# Drives Claude Widget's built-in browser: widget-browser help
# Runs on Node when it is on PATH, otherwise on the widget's own runtime.
# Tip: Windows PowerShell 5.1 drops double quotes inside arguments to programs, so for JavaScript with
# double quotes use single quotes in the code, `eval --file script.js`, or pipe it: '...' | widget-browser eval -
$script = Join-Path $PSScriptRoot 'widget-browser.js'
$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($node) {
  $input | & $node.Source $script @args
} else {
  if (-not $env:CLAUDE_WIDGET_EXE) { [Console]::Error.WriteLine('widget-browser: only works inside Claude Widget'); exit 1 }
  $env:ELECTRON_RUN_AS_NODE = '1'
  # Piping makes PowerShell wait for the (GUI-type) widget executable and pass its output on.
  $input | & $env:CLAUDE_WIDGET_EXE $script @args | ForEach-Object { $_ }
  Remove-Item Env:ELECTRON_RUN_AS_NODE
}
exit $LASTEXITCODE
