param([Parameter(Mandatory=$true)][string]$CancelEvent, [switch]$TestMode)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-takeover.cs'), [Text.Encoding]::UTF8)
  $loader = Join-Path $PSScriptRoot 'native-loader.ps1'
  if ([IO.File]::Exists($loader)) { . $loader }
  $precompiled = (Get-Command Import-PackagedHelper -ErrorAction SilentlyContinue) -and (Import-PackagedHelper -Name takeover -Source $source)
  if ($precompiled) {
    # The packaged DLL was checked against this source and its SHA-256.
  } elseif ($PSVersionTable.PSEdition -eq 'Core') {
    $coreSource = "#define WCU_CORE`n" + $source
    $compile = {
      param([string]$out)
      $references = @(Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll' | ForEach-Object { $_.FullName })
      $references += [System.Windows.Forms.Form].Assembly.Location
      $references += [System.Drawing.Graphics].Assembly.Location
      $references += [System.Reflection.Assembly]::Load('System.Windows.Forms.Primitives').Location
      $references += [System.Reflection.Assembly]::Load('Microsoft.Win32.SystemEvents').Location
      # .NET 10 splits Windows Forms / drawing contracts into these assemblies.
      $references += @(Get-ChildItem -LiteralPath $PSHOME -Filter 'System.Private.Windows*.dll' | ForEach-Object { $_.FullName })
      $options = @{TypeDefinition=$coreSource;ReferencedAssemblies=$references}
      if ($out) { $options.OutputAssembly = $out }
      Add-Type @options
    }
    if (Get-Command Import-HelperAssembly -ErrorAction SilentlyContinue) {
      $runtime = [Environment]::Version
      $file = 'wcu-takeover-core-clr{0}-{1}-{2}.dll' -f $runtime.Major,$runtime.Minor,(Get-NativeSourceHash $coreSource)
      Import-HelperAssembly -Path (Join-Path (Get-HelperCacheDir) $file) -Compile $compile
    } else {
      & $compile
    }
  } else {
    Add-Type -AssemblyName System.Web.Extensions
    Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions,System.Core
  }
  [DshTakeover.Host]::Run($CancelEvent, [bool]$TestMode)
} catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
}
