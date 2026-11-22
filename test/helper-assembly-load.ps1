# #54: the helpers compiled into %TEMP% must load even when .NET Framework
# treats the cached DLL as remote. On the reporter's machine Assembly.LoadFrom
# refused every such DLL (0x80131515); an Internet-zone mark makes a stock
# machine refuse it the same way. Each phase runs in a fresh process, because
# loaded types cannot be unloaded. No desktop input or windows.
param([string]$Phase = 'main', [string]$Cache = '')
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'), [Text.Encoding]::UTF8)
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Backend source did not parse' }
$isDesktop = $PSVersionTable.PSEdition -ne 'Core'
$self = (Get-Process -Id $PID).Path

function Invoke-Phase([string]$Name) {
  # Windows PowerShell turns each stderr line of a native child into an error
  # record, and 'Stop' would throw on the first one (CI sets WCU_BACKEND_TRACE,
  # so the backend prints its startup stages there). Judge by the exit code.
  $ErrorActionPreference = 'Continue'
  $out = & $self -NoProfile -NonInteractive -File $PSCommandPath -Phase $Name -Cache $Cache 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Phase $Name failed ($LASTEXITCODE): $($out | Out-String)" }
  return (($out | Where-Object { "$_".StartsWith('{') } | Select-Object -Last 1) | ConvertFrom-Json)
}

if ($Phase -eq 'main') {
  $Cache = Join-Path ([IO.Path]::GetTempPath()) ('wcu-helper-load-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $Cache | Out-Null
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true,$false)
  foreach($owner in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
  }
  if ($isDesktop) { [IO.Directory]::SetAccessControl($Cache,$acl) }
  else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Cache),$acl) }
  try {
    $created = Invoke-Phase 'cache-dir'
    if (-not $created.private) { throw "The first start did not create a private native cache: $($created | ConvertTo-Json -Compress)" }
    Write-Output 'PASS a first start with the usual TEMP creates the native cache under LocalApplicationData, private to the user and SYSTEM'
    $failure = Invoke-Phase 'compile-failure'
    if (-not $failure.cleaned) { throw 'A failed compilation left its private partial DLL' }
    Write-Output 'PASS failed compilation reports the original error and removes only its private partial DLL'
    $first = Invoke-Phase 'load'
    if (-not $first.native) { throw 'The native helper did not compile and load' }
    if (-not $first.ocr) { throw "The OCR helper did not compile and load: $($first.ocrError)" }
    $dlls = @(Get-ChildItem -LiteralPath $Cache -Filter 'wcu-*.dll')
    $leftovers = @(Get-ChildItem -LiteralPath $Cache | Where-Object { $_.Name -match '\.(?:\d+\.)?[0-9a-f]{32}\.dll$|\.\d+\.dll$' -or $_.Name -like '*.cs' })
    if ($leftovers.Count) { throw "Compilation left partial files: $($leftovers.Name -join ', ')" }
    if ($dlls.Count -lt 2) { throw "Expected cached helpers, found: $($dlls.Name -join ', ')" }
    foreach ($dll in $dlls) {
      Set-Content -LiteralPath $dll.FullName -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3" -Encoding Ascii
    }
    $refused = Invoke-Phase 'loadfrom'
    if ($isDesktop) {
      # Prove the fixture reproduces the reported refusal before trusting a pass.
      foreach ($entry in $refused.results) {
        if ($entry.hresult -ne '0x80131515') { throw "LoadFrom was expected to refuse $($entry.name) with 0x80131515, got $($entry.hresult)" }
      }
      Write-Output "PASS Assembly.LoadFrom refuses all $($refused.results.Count) Internet-zone helpers with 0x80131515, as on the #54 machine"
    } else {
      Write-Output "INFO PowerShell 7 has no LoadFrom zone check; checking the load path only"
    }
    $second = Invoke-Phase 'load'
    if (-not $second.native) { throw 'The native helper did not load from the marked cache' }
    if (-not $second.ocr) { throw "The OCR helper did not load from the marked cache: $($second.ocrError)" }
    if ($second.compiled) { throw 'The second start recompiled instead of loading the cached helpers' }
    if ($isDesktop -and $second.ocrText -notmatch '54') { throw "OCR from the marked cache did not read the test image: '$($second.ocrText)'" }
    Write-Output ("PASS native and OCR helpers load from the marked cache; OCR read '{0}'" -f $second.ocrText)
  } finally {
    $cacheFull = [IO.Path]::GetFullPath($Cache)
    $tempFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($cacheFull) -ne $tempFull -or [IO.Path]::GetFileName($cacheFull) -notlike 'wcu-helper-load-*') { throw 'Refusing cleanup outside the task cache' }
    Remove-Item -LiteralPath $cacheFull -Recurse -Force -ErrorAction SilentlyContinue
  }
  exit 0
}

$env:TEMP = $Cache; $env:TMP = $Cache
if ($Phase -eq 'loadfrom') {
  $results = foreach ($dll in Get-ChildItem -LiteralPath $Cache -Filter 'wcu-*.dll') {
    $hresult = 'loaded'
    try { [void][System.Reflection.Assembly]::LoadFrom($dll.FullName) }
    catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; $hresult = '0x{0:X8}' -f $e.HResult }
    [ordered]@{ name = $dll.Name; hresult = $hresult }
  }
  [ordered]@{ results = @($results) } | ConvertTo-Json -Depth 4 -Compress
  exit 0
}

# Phase 'load': the backend's own definitions, run as the backend runs them.
$script:BackendStartupWatch = [System.Diagnostics.Stopwatch]::StartNew()
foreach ($name in 'WcuCs', 'WcuOcrCs') {
  $assignment = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq "`$script:$name" }, $false)
  if ($null -eq $assignment) { throw "Missing helper source $name" }
  . ([scriptblock]::Create($assignment.Extent.Text))
}
foreach ($name in 'Write-BackendStage', 'Get-CsHash', 'Get-HelperCacheDir', 'Assert-PrivateHelperPath', 'Get-HelperDigest', 'Remove-TempFile', 'Remove-StaleHelperParts', 'Import-HelperAssembly', 'Load-Assemblies', 'Set-DpiAware', 'Get-OcrHelper') {
  $function = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if ($null -eq $function) { throw "Missing backend function $name" }
  . ([scriptblock]::Create($function.Extent.Text))
}
if ($Phase -eq 'cache-dir') {
  # With the usual TEMP the backend keeps its helpers in
  # LocalApplicationData\dsh-computer-use-win\native-cache, created private on
  # the first start. PowerShell 7 creates it through FileSystemAclExtensions;
  # 0.6.2 passed that call its arguments in the wrong order, so a first start
  # under pwsh failed at native-load-start. The suites set their own TEMP and
  # never reached this branch, so LocalApplicationData points into the cache.
  $local = Join-Path $Cache 'local'
  [void][IO.Directory]::CreateDirectory((Join-Path $local 'Temp'))
  $local = (Get-Item -LiteralPath $local).FullName
  $definition = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-HelperCacheDir' }, $true).Extent.Text
  $redirected = $definition.Replace("[Environment]::GetFolderPath('LocalApplicationData')", "'" + $local.Replace("'", "''") + "'")
  if ($redirected -eq $definition) { throw 'Get-HelperCacheDir no longer reads LocalApplicationData' }
  . ([scriptblock]::Create($redirected))
  $env:TEMP = Join-Path $local 'Temp'; $env:TMP = $env:TEMP
  $expected = Join-Path $local 'dsh-computer-use-win\native-cache'
  $dir = Get-HelperCacheDir
  $item = [IO.DirectoryInfo]::new($expected)
  $sections = [Security.AccessControl.AccessControlSections]::Access
  $acl = if ($isDesktop) { $item.GetAccessControl($sections) } else { [IO.FileSystemAclExtensions]::GetAccessControl($item, $sections) }
  $sids = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $private = $dir -eq $expected -and $item.Exists -and $acl.AreAccessRulesProtected -and $sids -contains $user -and -not @($sids | Where-Object { $_ -ne $user -and $_ -ne 'S-1-5-18' }).Count
  [ordered]@{ private = [bool]$private; dir = $dir; sids = $sids; protected = $acl.AreAccessRulesProtected } | ConvertTo-Json -Compress
  exit 0
}
if ($Phase -eq 'compile-failure') {
  $failedDll = Join-Path $Cache 'wcu-failure.dll'
  $script:FailurePartial = $null
  $failed = $false
  try {
    Import-HelperAssembly -Path $failedDll -Compile {
      param($out)
      $script:FailurePartial = $out
      [IO.File]::WriteAllText($out, 'deliberately incomplete fixture assembly')
      throw 'fixture compile failed'
    }
  } catch {
    if ($_.Exception.Message -notmatch 'fixture compile failed') { throw }
    $failed = $true
  }
  if (-not $failed -or -not $script:FailurePartial) { throw 'The compiler failure fixture did not execute' }
  if ((Test-Path -LiteralPath $failedDll) -or (Test-Path -LiteralPath $script:FailurePartial)) { throw 'A failed compilation was published or leaked its private file' }
  [ordered]@{ cleaned = $true } | ConvertTo-Json -Compress
  exit 0
}
$before = @(Get-ChildItem -LiteralPath $Cache -Filter 'wcu-*.dll').Count
$result = [ordered]@{ native = $false; ocr = $false; compiled = $false; ocrText = ''; ocrError = '' }
Load-Assemblies
$result.native = [bool]('WindowsComputerUseNative' -as [type])
try { Get-OcrHelper; $result.ocr = [bool]('WindowsComputerUseOcr' -as [type]) } catch { $result.ocrError = $_.Exception.Message }
$result.compiled = @(Get-ChildItem -LiteralPath $Cache -Filter 'wcu-*.dll').Count -gt $before
if ($result.ocr -and $isDesktop) {
  $png = Join-Path $Cache 'ocr-54.png'
  $bitmap = New-Object System.Drawing.Bitmap 520, 120
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $font = New-Object System.Drawing.Font 'Arial', 40
    $graphics.DrawString('Issue 54 loads', $font, [System.Drawing.Brushes]::Black, 10, 25)
    $font.Dispose()
  } finally { $graphics.Dispose() }
  $bitmap.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); $bitmap.Dispose()
  $raw = [WindowsComputerUseOcr]::Recognize($png, '')
  # The helper writes one LINE row per recognized line: LINE<tab>text<tab>words.
  $result.ocrText = (@($raw -split "`r?`n" | Where-Object { $_ -like "LINE`t*" } | ForEach-Object { ($_ -split "`t")[1] }) -join ' ')
}
$result | ConvertTo-Json -Compress
