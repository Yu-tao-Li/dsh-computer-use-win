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
  $out = & $self -NoProfile -NonInteractive -File $PSCommandPath -Phase $Name -Cache $Cache 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Phase $Name failed ($LASTEXITCODE): $($out | Out-String)" }
  return (($out | Where-Object { "$_".StartsWith('{') } | Select-Object -Last 1) | ConvertFrom-Json)
}

if ($Phase -eq 'main') {
  $Cache = Join-Path ([IO.Path]::GetTempPath()) ('wcu-helper-load-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $Cache | Out-Null
  try {
    $first = Invoke-Phase 'load'
    if (-not $first.native) { throw 'The native helper did not compile and load' }
    if (-not $first.ocr) { throw "The OCR helper did not compile and load: $($first.ocrError)" }
    $dlls = @(Get-ChildItem -LiteralPath $Cache -Filter 'wcu-*.dll')
    $leftovers = @(Get-ChildItem -LiteralPath $Cache | Where-Object { $_.Name -match '\.\d+\.dll$' -or $_.Name -like '*.cs' })
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
    if ($first.wgc -and -not $second.wgc) { throw "The WGC helper did not load from the marked cache: $($second.wgcError)" }
    if ($second.compiled) { throw 'The second start recompiled instead of loading the cached helpers' }
    if ($isDesktop -and $second.ocrText -notmatch '54') { throw "OCR from the marked cache did not read the test image: '$($second.ocrText)'" }
    Write-Output ("PASS native, OCR{0} helpers load from the marked cache; OCR read '{1}'" -f $(if ($second.wgc) { ' and WGC' } else { " (WGC unavailable here: $($first.wgcError))" }), $second.ocrText)
  } finally {
    Remove-Item -LiteralPath $Cache -Recurse -Force -ErrorAction SilentlyContinue
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
foreach ($name in 'WcuCs', 'WcuOcrCs', 'WgcCs') {
  $assignment = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq "`$script:$name" }, $false)
  if ($null -eq $assignment) { throw "Missing helper source $name" }
  . ([scriptblock]::Create($assignment.Extent.Text))
}
foreach ($name in 'Write-BackendStage', 'Get-CsHash', 'Import-HelperAssembly', 'Load-Assemblies', 'Set-DpiAware', 'Get-OcrHelper', 'Get-WgcHelper') {
  $function = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if ($null -eq $function) { throw "Missing backend function $name" }
  . ([scriptblock]::Create($function.Extent.Text))
}
$before = @(Get-ChildItem -LiteralPath $Cache -Filter 'wcu-*.dll').Count
$result = [ordered]@{ native = $false; ocr = $false; wgc = $false; compiled = $false; ocrText = ''; ocrError = ''; wgcError = '' }
Load-Assemblies
$result.native = [bool]('WindowsComputerUseNative' -as [type])
try { Get-OcrHelper; $result.ocr = [bool]('WindowsComputerUseOcr' -as [type]) } catch { $result.ocrError = $_.Exception.Message }
try { Get-WgcHelper; $result.wgc = [bool]('WgcCapture' -as [type]) } catch { $result.wgcError = $_.Exception.Message }
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
  $raw = [WindowsComputerUseOcr]::Recognize($png)
  $text = ($raw -split "`r?`n" | Where-Object { $_ -like "TEXT`t*" } | Select-Object -First 1)
  $result.ocrText = if ($text) { $text.Substring(5) } else { '' }
}
$result | ConvertTo-Json -Compress
