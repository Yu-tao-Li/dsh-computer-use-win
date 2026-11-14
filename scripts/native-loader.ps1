# Shared, integrity-checked .NET Framework helper loader. Core uses source.
function Get-NativeSourceHash {
  param([string]$Source)
  $Source = $Source.Replace("`r`n", "`n").Replace("`r", "`n")
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Source))).Replace('-', '').Substring(0,16)).ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Import-PackagedHelper {
  param([string]$Name, [string]$Source, [string]$Root = $PSScriptRoot)
  if ($PSVersionTable.PSEdition -eq 'Core' -or $env:WCU_DISABLE_PRECOMPILED -eq '1') { return $false }
  try {
    $manifestPath = Join-Path $Root 'native/manifest.json'
    if (-not [IO.File]::Exists($manifestPath)) { return $false }
    $manifest = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($manifest.runtime -ne 'netfx-clr4') { throw 'Unsupported native runtime.' }
    $entry = $manifest.helpers.$Name
    if ($null -eq $entry -or $entry.sourceHash -cne (Get-NativeSourceHash $Source)) { throw 'Helper source changed; rebuild native artifacts.' }
    if ($entry.file -cnotmatch '^wcu-(native|ocr|clipboard|takeover)-netfx\.dll$') { throw 'Invalid helper filename.' }
    $file = Join-Path (Join-Path $Root 'native') $entry.file
    $bytes = [IO.File]::ReadAllBytes($file)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($actual -cne $entry.sha256) { throw 'Helper binary integrity check failed.' }
    [void][Reflection.Assembly]::Load($bytes)
    if ($env:WCU_BACKEND_TRACE -eq '1') { [Console]::Error.WriteLine('precompiled=' + $Name) }
    return $true
  } catch {
    [Console]::Error.WriteLine('Precompiled ' + $Name + ' unavailable: ' + $_.Exception.Message + ' Falling back to source.')
    return $false
  }
}
