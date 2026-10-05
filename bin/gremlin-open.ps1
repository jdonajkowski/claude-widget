# Shows a page, file or URL in Gremlin's built-in browser: gremlin-open <url-or-file>
# Works in sessions and terminal tabs started by Gremlin, which set GREMLIN_EXE.
# PowerShell runs this ahead of gremlin-open.cmd, so URLs with & or = reach Gremlin intact.
param([Parameter(Position = 0)][string]$Target)
if (-not $Target) { [Console]::Error.WriteLine('usage: gremlin-open <url-or-file>'); exit 2 }
if (-not $env:GREMLIN_EXE) { [Console]::Error.WriteLine('gremlin-open: only works inside Gremlin'); exit 1 }
$quote = { param($s) '"' + ($s -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
$argList = @()
if ($env:GREMLIN_APP) { $argList += & $quote $env:GREMLIN_APP }
$argList += & $quote "--open=$Target"
$psi = New-Object System.Diagnostics.ProcessStartInfo $env:GREMLIN_EXE, ($argList -join ' ')
$psi.UseShellExecute = $false
# The short-lived second instance only hands the target over; keep its Chromium log lines out of the session.
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.WorkingDirectory = (Get-Location).ProviderPath
[void][System.Diagnostics.Process]::Start($psi)
"Opened $Target in Gremlin's browser"
