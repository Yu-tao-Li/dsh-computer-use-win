# Exercise the actual backend function bodies with a fake native API.
# No user32 calls, clipboard access, or physical mouse/keyboard input.
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Backend PowerShell source did not parse.' }
$names = @('Get-ButtonFlags', 'Click-At', 'Move-ToPoint', 'Type-Text')
foreach ($name in $names) {
  $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if ($null -eq $function) { throw "Missing function: $name" }
  Invoke-Expression $function.Extent.Text
}
Add-Type -TypeDefinition @'
public static class WindowsComputerUseNative {
  public struct POINT { public int x, y; }
  public static bool MoveOk = true, CursorOk = true;
  public static uint PressResult = 1, ReleaseResult = 1;
  public static int Calls;
  public const int MOUSEEVENTF_LEFTDOWN = 2, MOUSEEVENTF_LEFTUP = 4;
  public const int MOUSEEVENTF_RIGHTDOWN = 8, MOUSEEVENTF_RIGHTUP = 16;
  public const int MOUSEEVENTF_MIDDLEDOWN = 32, MOUSEEVENTF_MIDDLEUP = 64;
  public static bool SetCursorPos(int x, int y) { return MoveOk; }
  public static bool GetCursorPos(ref POINT point) { return CursorOk; }
  public static uint SendMouseEvent(int x, int y, uint flags, int data) {
    Calls++; return flags == MOUSEEVENTF_LEFTDOWN ? PressResult : ReleaseResult;
  }
}
'@
$script:FailDelay = $false
function Start-Sleep { param([int]$Milliseconds) if ($script:FailDelay -and $Milliseconds -eq 30) { throw 'SIMULATED_DELAY_FAILURE' } }
function Assert-Error { param([scriptblock]$Body, [string]$Pattern)
  $caught = $false
  try { & $Body } catch { $caught = $true; if ($_.Exception.Message -notmatch $Pattern) { throw } }
  if (-not $caught) { throw "Expected error: $Pattern" }
}
[WindowsComputerUseNative]::MoveOk = $false
Assert-Error { Move-ToPoint 1 2 } 'COMPUTER_USE_INPUT_UNAVAILABLE'
Assert-Error { Click-At 1 2 } 'COMPUTER_USE_INPUT_UNAVAILABLE'
if ([WindowsComputerUseNative]::Calls -ne 0) { throw 'Mouse input was sent after positioning failed.' }
Assert-Error { Type-Text 'test' } 'COMPUTER_USE_INPUT_UNAVAILABLE'
[WindowsComputerUseNative]::MoveOk = $true
[WindowsComputerUseNative]::CursorOk = $false
Assert-Error { Type-Text 'test' } 'COMPUTER_USE_INPUT_UNAVAILABLE'
[WindowsComputerUseNative]::CursorOk = $true
[WindowsComputerUseNative]::PressResult = 0
Assert-Error { Click-At 1 2 } 'Windows rejected mouse input'
[WindowsComputerUseNative]::PressResult = 1
[WindowsComputerUseNative]::ReleaseResult = 0
Assert-Error { Click-At 1 2 } 'Windows rejected mouse release'
[WindowsComputerUseNative]::ReleaseResult = 1
[WindowsComputerUseNative]::Calls = 0
$script:FailDelay = $true
Assert-Error { Click-At 1 2 } 'SIMULATED_DELAY_FAILURE'
if ([WindowsComputerUseNative]::Calls -ne 2) { throw 'Mouse release was not attempted during exception cleanup.' }
$script:FailDelay = $false
[WindowsComputerUseNative]::Calls = 0
Click-At 1 2
if ([WindowsComputerUseNative]::Calls -ne 2) { throw 'Expected one successful press and release.' }
Write-Output 'PASS positioning, input-desktop, press/release failures and finally cleanup; fake native API only'
