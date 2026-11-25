# Shared, integrity-checked helper loader. The main Win32 interop assembly
# uses APIs shared by .NET Framework and modern .NET. The other packaged
# helpers target .NET Framework and still need a separate Core build.
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
  if ($PSVersionTable.PSEdition -eq 'Core' -and ($Name -cne 'native' -or $PSVersionTable.PSVersion -lt [version]'7.4')) { return $false }
  if (-not $IgnoreDisable -and $env:WCU_DISABLE_PRECOMPILED -eq '1') { return $false }
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

# Load a helper compiled into %TEMP%, compiling it first when no cached copy
# exists. The bytes are read rather than passed to Assembly.LoadFrom: .NET
# Framework refuses LoadFrom for an unsigned DLL it treats as coming from a
# remote or internet location (0x80131515), which left every tool failing with
# "Backend process exited" on some machines (#54). The compiler writes a
# file of its own and only a complete one is moved into place, because another
# backend may be reading the cache at the same time.
#
# TEMP is often an 8.3 short path. Windows PowerShell's FileSystemProvider
# rejects a short name that is longer than the name it stands for, such as
# C:\Users\LIHUA~1 for "Li Hua", with "An object at the specified path ...
# does not exist" (#78). Remove-Item met that on every OCR compile, so
# temporary files are handled with .NET calls only, never with Remove-Item,
# Get-ChildItem or Test-Path.
function Get-HelperCacheDir {
  $local = [Environment]::GetFolderPath('LocalApplicationData')
  $configured = [string]$env:TEMP
  if ($configured -and [IO.Directory]::Exists($configured)) {
    # Resolve a user's usual 8.3 TEMP spelling before deciding whether it is
    # a caller override. Cache file I/O itself still uses .NET paths.
    try { $configured = (Get-Item -LiteralPath $configured -ErrorAction Stop).FullName } catch {}
  }
  $default = Join-Path $local 'Temp'
  $userTemp = [Environment]::ExpandEnvironmentVariables([string][Environment]::GetEnvironmentVariable('TEMP','User'))
  if ($configured -and $configured.TrimEnd('\') -ne $default.TrimEnd('\') -and $configured -ne $userTemp) {
    if (-not [IO.Path]::IsPathRooted($configured)) { throw 'The configured TEMP path must be absolute.' }
    $dir = [IO.Path]::GetFullPath($configured)
  } else {
    $dir = Join-Path $local 'dsh-computer-use-win\native-cache'
    if (-not [IO.Directory]::Exists($dir)) {
      $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
      try {
        $acl=[Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true,$false)
        foreach($sid in @($identity.User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
          $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
        }
        if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($dir),$acl) }
        else { [void][IO.Directory]::CreateDirectory($dir,$acl) }
      } finally { $identity.Dispose() }
    }
  }
  [void][IO.Directory]::CreateDirectory($dir)
  Assert-PrivateHelperPath $dir -Directory
  return $dir
}

function Assert-PrivateHelperPath {
  param([string]$Path, [switch]$Directory)
  $attributes = [IO.File]::GetAttributes($Path)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -or
      ([bool]($attributes -band [IO.FileAttributes]::Directory) -ne [bool]$Directory)) {
    throw 'Native cache must contain ordinary files in a private directory.'
  }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  try { $trusted = @($identity.User.Value,$identity.Owner.Value,'S-1-5-18','S-1-5-32-544') }
  finally { $identity.Dispose() }
  $item = if ($Directory) { [IO.DirectoryInfo]::new($Path) } else { [IO.FileInfo]::new($Path) }
  $sections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
  $acl = if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::GetAccessControl($item,$sections) } else { $item.GetAccessControl($sections) }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) {
    throw 'Native cache ownership does not match the Windows account.'
  }
  $writeRights = [Security.AccessControl.FileSystemRights]'WriteData, AppendData, DeleteSubdirectoriesAndFiles, Delete, ChangePermissions, TakeOwnership'
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
        ($rule.FileSystemRights -band $writeRights) -and $rule.IdentityReference.Value -notin $trusted) {
      throw 'Native cache grants write access to another account.'
    }
  }
}

function Get-HelperDigest {
  param([byte[]]$Bytes)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

# A compile that failed or was cut off leaves <helper>.<pid>.<guid>.dll and
# its .cs source behind (one pair per OCR call on the machines of #78). Those
# an hour old are removed before a helper is compiled.
function Remove-StaleHelperParts {
  param([string]$Directory)
  $cutoff = [DateTime]::UtcNow.AddHours(-1)
  try {
    foreach ($file in [System.IO.Directory]::EnumerateFiles($Directory, 'wcu-*.dll*')) {
      if ([System.IO.Path]::GetFileName($file) -cmatch '^wcu-(native|ocr|clipboard|wgc|takeover)-[a-z0-9-]+\.\d+\.[0-9a-f]{32}\.dll(\.cs)?$' -and [System.IO.File]::GetLastWriteTimeUtc($file) -lt $cutoff) { [IO.File]::Delete($file) }
    }
  } catch { }
}

function Import-HelperAssembly {
  param([string]$Path, [scriptblock]$Compile)
  $directory = [IO.Path]::GetDirectoryName($Path)
  Assert-PrivateHelperPath $directory -Directory
  $digestFile = $Path + '.sha256'
  $mutex = [Threading.Mutex]::new($false, ('Local\DSH-WCU-Helper-' + (Get-NativeSourceHash $Path.ToUpperInvariant())))
  $owned = $false
  $partial = $Path -replace '\.dll$', (".$PID." + [Guid]::NewGuid().ToString('N') + '.dll')
  try {
    try { $owned = $mutex.WaitOne(20000) } catch [Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { throw 'Timed out waiting for the native helper cache.' }
    if ([IO.File]::Exists($Path)) { Assert-PrivateHelperPath $Path }
    if ([IO.File]::Exists($digestFile)) { Assert-PrivateHelperPath $digestFile }
    if ([IO.File]::Exists($Path) -and [IO.File]::Exists($digestFile)) {
      $bytes = [IO.File]::ReadAllBytes($Path)
      if ((Get-HelperDigest $bytes) -ceq [IO.File]::ReadAllText($digestFile)) {
        [void][Reflection.Assembly]::Load($bytes)
        return
      }
    }
    Remove-StaleHelperParts $directory
    & $Compile $partial
    $bytes = [IO.File]::ReadAllBytes($partial)
    [IO.File]::WriteAllText("$partial.sha256",(Get-HelperDigest $bytes))
    if ([IO.File]::Exists($Path)) { [IO.File]::Replace($partial,$Path,[NullString]::Value) }
    else { [IO.File]::Move($partial,$Path) }
    if ([IO.File]::Exists($digestFile)) { [IO.File]::Replace("$partial.sha256",$digestFile,[NullString]::Value) }
    else { [IO.File]::Move("$partial.sha256",$digestFile) }
    [void][Reflection.Assembly]::Load($bytes)
  } finally {
    foreach ($file in @($partial,"$partial.cs","$partial.sha256")) {
      try { [IO.File]::Delete($file) } catch {}
    }
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}
