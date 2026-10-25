$ErrorActionPreference = 'Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Backend source did not parse'}
foreach($name in @('Get-Prop','Get-ButtonFlags','Move-ToPoint','Test-Failsafe','Post-BackgroundText','Invoke-Action','Click-At')){
  $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  . ([scriptblock]::Create($node.Extent.Text))
}
Add-Type -TypeDefinition @'
using System;
public static class WindowsComputerUseNative {
 public static bool Cancelled; public static int Moves,CancelAfterMove,Presses,Releases,Characters;
 public const uint WM_CHAR=0x102;
 public static void Reset(){Cancelled=false;Moves=CancelAfterMove=Presses=Releases=Characters=0;}
 public static void ThrowIfCancelled(){if(Cancelled)throw new OperationCanceledException("COMPUTER_USE_STOPPED_BY_USER");}
 public static void SetStopListener(int id){}
 public static bool SetCursorPos(int x,int y){Moves++;if(CancelAfterMove>0&&Moves>=CancelAfterMove)Cancelled=true;return true;}
 public static uint SendMouseEvent(int x,int y,uint flags,int value){if(flags==2)Presses++;if(flags==4)Releases++;return 1;}
 public static bool PostMessageW(IntPtr hwnd,uint message,IntPtr wparam,IntPtr lparam){Characters++;if(Characters==2)Cancelled=true;return true;}
}
public class FixtureElement {public static int FocusCalls;public void SetFocus(){FocusCalls++;}}
'@
$env:WCU_CANCEL_EVENT='fixture-cancellation';$env:WCU_FAILSAFE='0'
function Start-Sleep {param([int]$Milliseconds) if($script:CancelDuringPress -and $Milliseconds -eq 30){[WindowsComputerUseNative]::Cancelled=$true}}
function Has-WindowTarget {param($InputObject) return $false}
function Assert-TargetIsForeground {param($InputObject)}
function Activate-TargetIfRequested {param($InputObject)}
function Resolve-Element {param($ElementId,$InputObject) [WindowsComputerUseNative]::Cancelled=$true;return (New-Object FixtureElement)}
# Borrowing and giving back the foreground has its own contract test
# (less-takeover-contract.ps1); here it is a no-op.
function Get-RootWindowAt {param([int]$X,[int]$Y) return [int64]0}
function Get-ElementWindow {param($Element) return [int64]0}
function Start-Input {param($InputObject,[long]$Hwnd,[switch]$NoActivate) return @{moved=$null}}
function Complete-Input {param($State,$Result)}
function Expect-Cancel {param([scriptblock]$Body) $caught=$false;try{& $Body}catch{$caught=$true;if($_.Exception.Message -notmatch 'COMPUTER_USE_STOPPED_BY_USER'){throw}};if(-not $caught){throw 'Expected cooperative cancellation'}}
[WindowsComputerUseNative]::Reset();[WindowsComputerUseNative]::CancelAfterMove=3
Expect-Cancel {Invoke-Action drag ([pscustomobject]@{path=@(@{x=1;y=1},@{x=2;y=2},@{x=3;y=3},@{x=4;y=4})})}
if([WindowsComputerUseNative]::Moves -ne 3 -or [WindowsComputerUseNative]::Presses -ne 1 -or [WindowsComputerUseNative]::Releases -ne 1){throw 'Drag continued or did not release its held button'}
[WindowsComputerUseNative]::Reset();$script:CancelDuringPress=$true
Expect-Cancel {Click-At 10 10 left 2}
if([WindowsComputerUseNative]::Presses -ne 1 -or [WindowsComputerUseNative]::Releases -ne 1){throw 'Click cancellation lost key-up cleanup or started another click'}
$script:CancelDuringPress=$false;[WindowsComputerUseNative]::Reset()
Expect-Cancel {Post-BackgroundText 42 'abcdef'}
if([WindowsComputerUseNative]::Characters -ne 2){throw 'Background text continued after cancellation'}
[WindowsComputerUseNative]::Reset()
Expect-Cancel {Invoke-Action focus ([pscustomobject]@{elementId='fixture'})}
if([FixtureElement]::FocusCalls -ne 0){throw 'A resolved element was focused after cancellation'}
Write-Output 'PASS interrupted drag/button release, double-click cleanup, background typing, and cancellation after resolution; fake native input only'
