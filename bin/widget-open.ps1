# Shows a page, file or URL in Claude Widget's built-in browser: widget-open <url-or-file>
# Works in sessions and terminal tabs started by the widget, which set CLAUDE_WIDGET_EXE.
# PowerShell runs this ahead of widget-open.cmd, so URLs with & or = reach the widget intact.
param([Parameter(Position = 0)][string]$Target)
if (-not $Target) { [Console]::Error.WriteLine('usage: widget-open <url-or-file>'); exit 2 }
if (-not $env:CLAUDE_WIDGET_EXE) { [Console]::Error.WriteLine('widget-open: only works inside Claude Widget'); exit 1 }
$quote = { param($s) '"' + ($s -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
$argList = @()
if ($env:CLAUDE_WIDGET_APP) { $argList += & $quote $env:CLAUDE_WIDGET_APP }
$argList += & $quote "--open=$Target"
$psi = New-Object System.Diagnostics.ProcessStartInfo $env:CLAUDE_WIDGET_EXE, ($argList -join ' ')
$psi.UseShellExecute = $false
# The short-lived second instance only hands the target over; keep its Chromium log lines out of the session.
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.WorkingDirectory = (Get-Location).ProviderPath
[void][System.Diagnostics.Process]::Start($psi)
"Opened $Target in the widget's browser"
