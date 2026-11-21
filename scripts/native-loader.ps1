# Shared, integrity-checked .NET Framework helper loader. Core uses source.
function Get-NativeSourceHash {
  param([string]$Source)
  $Source = $Source.Replace("`r`n", "`n").Replace("`r", "`n")
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Source))).Replace('-', '').Substring(0,16)).ToLowerInvariant() }
  finally { $sha.Dispose() }
}
$script:CachedNativeManifestKey = $null
$script:CachedNativeManifest = $null
function Import-PackagedHelper {
  param([string]$Name, [string]$Source, [string]$Root = $PSScriptRoot, [switch]$IgnoreDisable)
  if ($PSVersionTable.PSEdition -eq 'Core' -or (-not $IgnoreDisable -and $env:WCU_DISABLE_PRECOMPILED -eq '1')) { return $false }
  try {
    $manifestPath = Join-Path $Root 'native/manifest.json'
    if (-not [IO.File]::Exists($manifestPath)) { return $false }
    foreach ($item in @((Join-Path $Root 'native'),$manifestPath)) {
      if ([IO.File]::GetAttributes($item) -band [IO.FileAttributes]::ReparsePoint) { throw 'Native helper path is a reparse point.' }
    }
    $manifestKey = "$manifestPath|$(([IO.File]::GetLastWriteTimeUtc($manifestPath)).Ticks)"
    if ($script:CachedNativeManifestKey -cne $manifestKey -or $null -eq $script:CachedNativeManifest) {
      $script:CachedNativeManifest = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
      $script:CachedNativeManifestKey = $manifestKey
    }
    $manifest = $script:CachedNativeManifest
    if ($manifest.schemaVersion -ne 1 -or $manifest.runtime -ne 'netfx-clr4') { throw 'Unsupported native manifest or runtime.' }
    $entry = $manifest.helpers.$Name
    if ($null -eq $entry -or $entry.sourceHash -cne (Get-NativeSourceHash $Source)) { throw 'Helper source changed; rebuild native artifacts.' }
    if ($Name -cnotmatch '^(native|ocr|clipboard|takeover)$' -or $entry.file -cne "wcu-$Name-netfx.dll") { throw 'Invalid helper filename.' }
    $file = Join-Path (Join-Path $Root 'native') $entry.file
    if ([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) { throw 'Native helper DLL is a reparse point.' }
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
