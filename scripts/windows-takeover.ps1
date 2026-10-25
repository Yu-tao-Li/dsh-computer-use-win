param([Parameter(Mandatory=$true)][string]$CancelEvent, [switch]$TestMode)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-takeover.cs'), [Text.Encoding]::UTF8)
  if ($PSVersionTable.PSEdition -eq 'Core') {
    $references = @(Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll' | ForEach-Object { $_.FullName })
    $references += [System.Windows.Forms.Form].Assembly.Location
    $references += [System.Drawing.Graphics].Assembly.Location
    $references += [System.Reflection.Assembly]::Load('System.Windows.Forms.Primitives').Location
    $references += [System.Reflection.Assembly]::Load('Microsoft.Win32.SystemEvents').Location
    # .NET 10 splits Windows Forms / drawing contracts into these assemblies.
    $references += @(Get-ChildItem -LiteralPath $PSHOME -Filter 'System.Private.Windows*.dll' | ForEach-Object { $_.FullName })
    Add-Type -TypeDefinition ("#define WCU_CORE`n" + $source) -ReferencedAssemblies $references
  } else {
    Add-Type -AssemblyName System.Web.Extensions
    Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
  }
  [DshTakeover.Host]::Run($CancelEvent, [bool]$TestMode)
} catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
}
