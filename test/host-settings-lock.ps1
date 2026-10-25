param([Parameter(Mandatory=$true)][string]$ConfigPath, [string]$ReleasePath)
$ErrorActionPreference = 'Stop'
$stream = [System.IO.File]::Open($ConfigPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
try {
  [Console]::Out.WriteLine('locked')
  [Console]::Out.Flush()
  if ($ReleasePath) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not [System.IO.File]::Exists($ReleasePath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 20 }
  } else { Start-Sleep -Milliseconds 1500 }
} finally { $stream.Dispose() }
