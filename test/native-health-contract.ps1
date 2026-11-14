# Input lease behavior is exercised across real processes in input-mutex.mjs.
function Enter-DesktopInput { return $null }
function Exit-DesktopInput { param($Lease) }
param([switch]$ExpectLegacyFailure)
$ErrorActionPreference = 'Stop'
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
public static class WindowsComputerUseNative {
  public static long Foreground = 42;
  public static bool Responsive = true;
  public static IntPtr GetForegroundWindow() { return new IntPtr(Foreground); }
  public static bool IsResponsive(IntPtr handle) { return Responsive; }
}
'@
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'), [Text.Encoding]::UTF8)
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Backend source did not parse' }
foreach ($name in @('Write-BackendStage','Get-Prop','Invoke-Safe','Get-ObservationWindow','Get-WindowResponsive','Get-FreshWindowRect','Update-WindowCache','Invoke-Action')) {
  $node = $ast.Find({param($item) $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq $name}, $true)
  if (-not $node) { throw "Missing function $name" }
  Invoke-Expression $node.Extent.Text
}
function Get-ScopeRoot { throw 'FORBIDDEN_UIA_PROVIDER' }
function Convert-ElementInfo { throw 'FORBIDDEN_UIA_PROVIDER' }
function Has-WindowTarget { return $false }
$script:WindowCache = @{}
$script:Missing = $false
function Get-NativeWindowList {
  param($IncludeInvisible, $MaxWindows)
  if ($script:Missing) { return @() }
  return @([ordered]@{ id='uia:hwnd:42:pid:4242'; source='win32'; depth=1; name='owned fixture'; className='Fixture'; controlType='Window'; nativeWindowHandle=42; processId=4242; boundingBox=@{x=10;y=20;width=100;height=80}; isEnabled=$true; isOffscreen=$false; hasKeyboardFocus=$true })
}
$Persistent = $true
$script:BackendStartupWatch = [System.Diagnostics.Stopwatch]::StartNew()
if ($ExpectLegacyFailure) {
  try { $null = Invoke-Action 'health'; throw 'Legacy health unexpectedly succeeded' }
  catch {
    if ($_.Exception.Message -ne 'FORBIDDEN_UIA_PROVIDER') { throw }
    @{ baselineFailureReproduced=$true; error=$_.Exception.Message; physicalInput=$false } | ConvertTo-Json -Compress
    exit 0
  }
}
function Assert-Equal($Actual, $Expected, $Label) { if ($Actual -cne $Expected) { throw "$Label : $Actual != $Expected" } }
$health = Invoke-Action 'health'
Assert-Equal $health.ok $true 'Backend available'
Assert-Equal $health.uiAutomationProviderChecked $false 'Provider deliberately not queried'
Assert-Equal $health.activeWindow.source 'win32' 'Native metadata source'
Assert-Equal $health.activeWindow.id 'uia:hwnd:42:pid:4242' 'Usable native owner id'
Assert-Equal $health.activeWindow.nativeWindowHandle 42 'Foreground handle'
Assert-Equal $health.targetResponsive $true 'Responsive target'
Assert-Equal $script:WindowCache['42'].x 10 'Coordinate baseline recorded'
[WindowsComputerUseNative]::Responsive = $false
$health = Invoke-Action 'health'
Assert-Equal $health.ok $true 'Hung target does not make backend unavailable'
Assert-Equal $health.targetResponsive $false 'Hung target is reported'
[WindowsComputerUseNative]::Foreground = 0
$health = Invoke-Action 'health'
Assert-Equal $health.activeWindow $null 'No foreground window'
Assert-Equal $health.targetResponsive $null 'Unknown responsiveness without target'
[WindowsComputerUseNative]::Foreground = 42; $script:Missing = $true
$health = Invoke-Action 'health'
Assert-Equal $health.activeWindow $null 'Window disappearance race'
$env:WCU_FAILSAFE='1'
Assert-Equal (Invoke-Action 'health' ([pscustomobject]@{_wcuCornerFailsafe=$false})).failsafe $false 'MCP explicitly disables the corner failsafe'
Assert-Equal (Invoke-Action 'health' ([pscustomobject]@{_wcuCornerFailsafe=$true})).failsafe $true 'Standalone opt-in reports its actual corner setting'
Write-Output 'PASS native health while UIA providers throw, hung/no foreground/disappeared targets and observation cache; fake native API only'
