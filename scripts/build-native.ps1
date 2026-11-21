# Run with Windows PowerShell 5.1; generated artifacts are used by that runtime.
param([switch]$Check)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Core') { throw 'Use Windows PowerShell 5.1 to build/check .NET Framework helpers.' }
. (Join-Path $PSScriptRoot 'native-loader.ps1')
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-uia.ps1'), [Text.Encoding]::UTF8)
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Backend source did not parse.' }
foreach ($name in @('WcuCs','WcuOcrCs')) {
  $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.VariablePath.UserPath -eq ('script:'+$name)},$true)
  $literal = $definition.Right.Expression
  if ($literal -isnot [Management.Automation.Language.StringConstantExpressionAst] -or [string]::IsNullOrWhiteSpace($literal.Value)) {
    throw "Expected literal C# source for $name"
  }
  Set-Variable -Scope Script -Name $name -Value $literal.Value
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
  $manifests = @($manifest.helpers.PSObject.Properties.Name)
  $dllNames = @([IO.Directory]::EnumerateFiles($directory,'*.dll') | ForEach-Object {[IO.Path]::GetFileName($_)})
  if (@(Compare-Object @($sources.Keys) $manifests).Count -or
      @(Compare-Object @($sources.Keys | ForEach-Object {"wcu-$_-netfx.dll"}) $dllNames).Count) { throw 'Unexpected native manifest entries or DLLs.' }
  foreach ($name in $sources.Keys) {
    if (-not (Import-PackagedHelper -Name $name -Source $sources[$name] -IgnoreDisable)) { throw ('Native artifact check failed: '+$name) }
  }
  @{passed=$true;version=$pkg.version;helpers=$sources.Keys;integrity=$true}|ConvertTo-Json -Compress
  return
}
[void][IO.Directory]::CreateDirectory($directory)
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('wcu-native-build-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($temporary)
$helpers=[ordered]@{}
try {
foreach ($name in $sources.Keys) {
  $target=Join-Path $temporary ('wcu-'+$name+'-netfx.dll')
  if ($name -eq 'ocr') {
    $systemRoot=[Environment]::GetEnvironmentVariable('SystemRoot')
    $metadata=Join-Path $systemRoot 'System32/WinMetadata'
    $framework=[Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
    $references=@('Windows.Media.winmd','Windows.Storage.winmd','Windows.Graphics.winmd','Windows.Foundation.winmd','Windows.Globalization.winmd')|ForEach-Object { '/r:'+(Join-Path $metadata $_) }
    $references+=@('System.Runtime.dll','System.dll','System.Runtime.WindowsRuntime.dll')|ForEach-Object { '/r:'+(Join-Path $framework $_) }
    $cs=Join-Path $temporary 'ocr.cs';[IO.File]::WriteAllText($cs,$sources.ocr,[Text.Encoding]::UTF8)
    $messages=& (Join-Path $framework 'csc.exe') (@('/nologo','/codepage:65001','/target:library',('/out:'+$target))+$references+@($cs)) 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('OCR compilation failed: '+($messages|Out-String)) }
  } else {
    $refs=if($name -eq 'takeover'){@('System.Windows.Forms','System.Drawing','System.Web.Extensions','System.Core')}elseif($name -eq 'clipboard'){@('System.Windows.Forms','System.Drawing')}else{@('System')}
    Add-Type -TypeDefinition $sources[$name] -ReferencedAssemblies $refs -OutputAssembly $target
  }
  $file=[IO.Path]::GetFileName($target)
  $helpers[$name]=[ordered]@{file=$file;sourceHash=(Get-NativeSourceHash $sources[$name]);sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$manifest=[ordered]@{schemaVersion=1;version=$pkg.version;runtime='netfx-clr4';helpers=$helpers}
$stagedManifest=Join-Path $temporary 'manifest.json'
$json = ($manifest | ConvertTo-Json -Depth 8).Replace(([string][char]13+[char]10),[string][char]10)
[IO.File]::WriteAllText($stagedManifest,$json+[char]10,[Text.UTF8Encoding]::new($false))
foreach ($name in $sources.Keys) {
  $file=$helpers[$name].file
  [IO.File]::Copy((Join-Path $temporary $file),(Join-Path $directory $file),$true)
}
[IO.File]::Copy($stagedManifest,$manifestPath,$true)
@{passed=$true;version=$pkg.version;helpers=$sources.Keys}|ConvertTo-Json -Compress
} finally {
  foreach ($name in $sources.Keys) { [IO.File]::Delete((Join-Path $temporary ('wcu-'+$name+'-netfx.dll'))) }
  [IO.File]::Delete((Join-Path $temporary 'manifest.json'))
  [IO.File]::Delete((Join-Path $temporary 'ocr.cs'))
  try { [IO.Directory]::Delete($temporary) } catch [IO.IOException] {}
}
