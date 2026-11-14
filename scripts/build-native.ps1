# Run with Windows PowerShell 5.1; generated artifacts are used by that runtime.
param([switch]$Check)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Core') { throw 'Use Windows PowerShell 5.1 to build/check .NET Framework helpers.' }
. (Join-Path $PSScriptRoot 'native-loader.ps1')
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-uia.ps1'), [Text.Encoding]::UTF8)
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Backend source did not parse.' }
foreach ($name in @('$script:WcuCs','$script:WcuOcrCs')) {
  $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq $name},$true)
  Invoke-Expression $definition.Extent.Text
}
$sources=[ordered]@{
  native=$script:WcuCs
  ocr=$script:WcuOcrCs
  clipboard=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-clipboard.cs'),[Text.Encoding]::UTF8)
  takeover=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-takeover.cs'),[Text.Encoding]::UTF8)
}
$directory=Join-Path $PSScriptRoot 'native'
$manifestPath=Join-Path $directory 'manifest.json'
$pkg=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../package.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
if ($Check) {
  $manifest=[IO.File]::ReadAllText($manifestPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
  if ($manifest.version -ne $pkg.version) { throw 'Native manifest version is stale.' }
  foreach ($name in $sources.Keys) {
    if (-not (Import-PackagedHelper -Name $name -Source $sources[$name])) { throw ('Native artifact check failed: '+$name) }
  }
  @{passed=$true;version=$pkg.version;helpers=$sources.Keys;integrity=$true}|ConvertTo-Json -Compress
  return
}
[void][IO.Directory]::CreateDirectory($directory)
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('wcu-native-build-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($temporary)
$helpers=[ordered]@{}
foreach ($name in $sources.Keys) {
  $target=Join-Path $temporary ('wcu-'+$name+'-netfx.dll')
  if ($name -eq 'ocr') {
    $systemRoot=[Environment]::GetEnvironmentVariable('SystemRoot')
    $metadata=Join-Path $systemRoot 'System32/WinMetadata'
    $framework=[Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
    $references=@('Windows.Media.winmd','Windows.Storage.winmd','Windows.Graphics.winmd','Windows.Foundation.winmd','Windows.Globalization.winmd')|ForEach-Object { '/r:'+(Join-Path $metadata $_) }
    $references+=@('System.Runtime.dll','System.dll','System.Runtime.WindowsRuntime.dll')|ForEach-Object { '/r:'+(Join-Path $framework $_) }
    $cs=Join-Path $temporary 'ocr.cs';[IO.File]::WriteAllText($cs,$sources.ocr,[Text.Encoding]::UTF8)
    $messages=& (Join-Path $framework 'csc.exe') (@('/nologo','/target:library',('/out:'+$target))+$references+@($cs)) 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('OCR compilation failed: '+($messages|Out-String)) }
  } else {
    $refs=if($name -eq 'takeover'){@('System.Windows.Forms','System.Drawing','System.Web.Extensions','System.Core')}elseif($name -eq 'clipboard'){@('System.Windows.Forms','System.Drawing')}else{@('System')}
    Add-Type -TypeDefinition $sources[$name] -ReferencedAssemblies $refs -OutputAssembly $target
  }
  $file=[IO.Path]::GetFileName($target);[IO.File]::Copy($target,(Join-Path $directory $file),$true)
  $helpers[$name]=[ordered]@{file=$file;sourceHash=(Get-NativeSourceHash $sources[$name]);sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$manifest=[ordered]@{schemaVersion=1;version=$pkg.version;runtime='netfx-clr4';helpers=$helpers}
[IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 8)+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
@{passed=$true;version=$pkg.version;helpers=$sources.Keys;buildScratch=$temporary}|ConvertTo-Json -Compress
