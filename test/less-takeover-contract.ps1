# Shipped less-takeover decisions on fake window, pointer and foreground APIs: no physical input.
$ErrorActionPreference='Stop'
$tokens=$null; $parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors | Out-String)}
foreach($name in @('Get-Prop','Invoke-Safe','Convert-Rect','Get-WindowProcessId','Get-RootWindow','Get-RootWindowAt','Get-WorkWindow','Resolve-InputWindow','Start-Input','Assert-PointOnTarget','Complete-Input','Assert-InFront','Invoke-Guarded')) {
  $f=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if($null -eq $f){throw "missing function $name"}
  . ([scriptblock]::Create($f.Extent.Text))
}
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic;
public static class WindowsComputerUseNative {
 public struct POINT {public int x,y;}
 public static long Front, AtPoint; public static int CursorX, CursorY, Gives, Sets; public static bool Menu, RefuseGive;
 public static Dictionary<long,uint> Pids=new Dictionary<long,uint>(); public static List<long> Popups=new List<long>();
 public static void Reset(){Front=AtPoint=0;CursorX=CursorY=Gives=Sets=0;Menu=RefuseGive=false;Pids.Clear();Popups.Clear();}
 public static IntPtr GetForegroundWindow(){return new IntPtr(Front);}
 public static bool GetCursorPos(ref POINT p){p.x=CursorX;p.y=CursorY;return true;}
 public static bool SetCursorPos(int x,int y){CursorX=x;CursorY=y;Sets++;return true;}
 public static uint GetWindowThreadProcessId(IntPtr h,out uint pid){pid=Pids.ContainsKey(h.ToInt64())?Pids[h.ToInt64()]:0;return pid;}
 public static IntPtr GetAncestor(IntPtr h,uint flags){return h;}
 public static IntPtr WindowFromPoint(POINT p){return new IntPtr(AtPoint);}
 public static bool IsWindow(IntPtr h){return Pids.ContainsKey(h.ToInt64());}
 public static bool IsWindowVisible(IntPtr h){return Pids.ContainsKey(h.ToInt64());}
 public static bool InMenuMode(IntPtr h){return Menu;}
 public static long[] VisiblePopups(uint pid){return Popups.ToArray();}
 public static bool GiveForeground(IntPtr h){Gives++;if(RefuseGive)return false;Front=h.ToInt64();return true;}
 public static IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,IntPtr l,uint f,uint t,out UIntPtr r){r=UIntPtr.Zero;return new IntPtr(1);}
 public static int GetWindowText(IntPtr h,System.Text.StringBuilder s,int n){s.Append("Notification");return 12;}
 public static int GetClassName(IntPtr h,System.Text.StringBuilder s,int n){s.Append("ToastClass");return 10;}
}
'@
$N=[WindowsComputerUseNative]
function Has-WindowTarget {param($InputObject) return $null -ne (Get-Prop $InputObject 'nativeWindowHandle' $null)}
function Get-ObservationWindow {param($InputObject,$Scope) return @{nativeWindowHandle=[int64](Get-Prop $InputObject 'nativeWindowHandle' 0)}}
function Set-WindowForeground {param($Element) if($script:FailActivate){return $false}; $N::Front=[int64]$Element.nativeWindowHandle; return $true}
function Assert-Equal {param($Actual,$Expected,$What) if($Actual -ne $Expected){throw "$What`: expected '$Expected', actual '$Actual'"}}
function Expect-Error {param([scriptblock]$Body,[string]$Pattern) $hit=$false;try{& $Body}catch{$hit=$true;if($_.Exception.Message -notmatch $Pattern){throw}};if(-not $hit){throw "Expected failure $Pattern"}}
# The user works in window 100 (process 1); DSH's target is window 200 (process 2).
function Scene {$N::Reset();$N::Pids[100]=1;$N::Pids[200]=2;$N::Front=100;$N::CursorX=500;$N::CursorY=600;$script:FailActivate=$false;$script:WcuSeries='["s",1]';$script:InputWindow=@{series=$null;hwnd=[int64]0;at=0}}
$target=[pscustomobject]@{nativeWindowHandle=200}
$checks=@()

# 1. A click: the target comes forward, then the pointer and the foreground go back.
Scene
$state=Start-Input -InputObject $target -Hwnd 200
Assert-Equal $N::Front 200 'target in front for the input'
$N::CursorX=40;$N::CursorY=50;$state.moved=@{x=40;y=50}
$result=[ordered]@{};Complete-Input $state $result
Assert-Equal $result.foreground 'returned' 'foreground'; Assert-Equal $N::Front 100 'user window back in front'
Assert-Equal $result.pointer 'returned' 'pointer'; Assert-Equal "$($N::CursorX),$($N::CursorY)" '500,600' 'pointer back where the user left it'
Assert-Equal $script:InputWindow.hwnd 200 'input window remembered'; $checks+='borrow and give back'

# 2. The user moved the pointer meanwhile: it stays where they put it.
Scene
$state=Start-Input -InputObject $target -Hwnd 200;$state.moved=@{x=40;y=50};$N::CursorX=900;$N::CursorY=10
$result=[ordered]@{};Complete-Input $state $result
Assert-Equal $result.pointer 'left where the user moved it' 'pointer'; Assert-Equal "$($N::CursorX),$($N::CursorY)" '900,10' 'pointer untouched'; $checks+='user pointer wins'

# 3. activate:true keeps the target in front.
Scene
$state=Start-Input -InputObject ([pscustomobject]@{nativeWindowHandle=200;activate=$true}) -Hwnd 200
$result=[ordered]@{};Complete-Input $state $result
Assert-Equal $result.foreground 'kept in front (activate:true)' 'foreground'; Assert-Equal $N::Front 200 'target stays'; Assert-Equal $N::Gives 0 'no switch'; $checks+='activate keeps'

# 4. A menu, or a list or dialog the action opened, keeps the target in front.
Scene
$state=Start-Input -InputObject $target -Hwnd 200;$N::Menu=$true
$result=[ordered]@{};Complete-Input $state $result
Assert-Equal $N::Front 200 'menu keeps the target'; Assert-Equal $N::Gives 0 'no switch with a menu open'
Scene
$N::Popups.Add(300)
$state=Start-Input -InputObject $target -Hwnd 200;$N::Popups.Add(301)
$result=[ordered]@{};Complete-Input $state $result
Assert-Equal $N::Front 200 'new popup keeps the target'
Scene
$N::Popups.Add(300)
$state=Start-Input -InputObject $target -Hwnd 200
$result=[ordered]@{};Complete-Input $state $result
Assert-Equal $result.foreground 'returned' 'a popup that was there before does not count'; $checks+='menus and new popups keep'

# 5. The user switched to another app meanwhile: left alone.
Scene
$N::Pids[400]=3
$state=Start-Input -InputObject $target -Hwnd 200;$N::Front=400
$result=[ordered]@{};Complete-Input $state $result
Assert-Equal $result.foreground 'left: another window is in front now' 'foreground'; Assert-Equal $N::Front 400 'user choice kept'; $checks+='user switch wins'

# 6. Nothing borrowed when the target was already in front, or Windows refuses.
Scene
$N::Front=200
$state=Start-Input -InputObject $target -Hwnd 200
$result=[ordered]@{};Complete-Input $state $result
Assert-Equal $result.Contains('foreground') $false 'no foreground report'; Assert-Equal $N::Gives 0 'no switch'
Scene
$state=Start-Input -InputObject $target -Hwnd 200;$N::RefuseGive=$true
$result=[ordered]@{};Complete-Input $state $result
Assert-Equal $result.foreground 'kept in front: Windows refused to switch back' 'refused'
Scene
$script:FailActivate=$true
Expect-Error {Start-Input -InputObject $target -Hwnd 200} 'could not be brought to the foreground'; $checks+='no borrow / refused'

# 7. Input without a target follows the window DSH used last in this series.
Scene
Assert-Equal (Resolve-InputWindow ([pscustomobject]@{})) 100 'no history: the window in front'
$script:InputWindow=@{series='["s",1]';hwnd=[int64]200;at=0}
Assert-Equal (Resolve-InputWindow ([pscustomobject]@{})) 200 'same series: the last input window'
$script:WcuSeries='["s",2]'
Assert-Equal (Resolve-InputWindow ([pscustomobject]@{})) 100 'next turn: the window in front'
$script:WcuSeries=$null;$script:InputWindow=@{series=$null;hwnd=[int64]200;at=[DateTimeOffset]::Now.ToUnixTimeMilliseconds()}
Assert-Equal (Resolve-InputWindow ([pscustomobject]@{})) 200 'no host series: recent input window'
$script:InputWindow.at=0
Assert-Equal (Resolve-InputWindow ([pscustomobject]@{})) 100 'no host series: stale after two minutes'
$script:WcuSeries='["s",1]';$script:InputWindow=@{series='["s",1]';hwnd=[int64]250;at=0}
Assert-Equal (Resolve-InputWindow ([pscustomobject]@{})) 100 'closed window: the window in front'; $checks+='targetless input follows DSH'

# 8. The point must show the target or a window of its process.
Scene
$N::AtPoint=200; Assert-PointOnTarget 10 10 200
$N::Pids[210]=2;$N::AtPoint=210; Assert-PointOnTarget 10 10 200
$N::Pids[500]=4;$N::AtPoint=500; Expect-Error {Assert-PointOnTarget 10 10 200} 'POINT_COVERED'; $checks+='covered point refused'

# 9. Keys never go to a window that took the foreground in between.
Scene
$state=Start-Input -InputObject $target -Hwnd 200; Assert-InFront $state
$N::Pids[400]=3;$N::Front=400; Expect-Error {Assert-InFront $state} 'no longer in front'; $checks+='keys fail closed'

# 10. A UIA provider that brings its app forward or moves the pointer to do a
# background action gives both back; an opened list keeps the app in front.
$element=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=2;BoundingRectangle=[pscustomobject]@{IsEmpty=$false;X=30;Y=40;Width=20;Height=20}}}
Scene
$value=Invoke-Guarded { $N::Front=200;$N::CursorX=40;$N::CursorY=50;'Invoke' } $element
Assert-Equal $value 'Invoke' 'pattern result'; Assert-Equal $N::Front 100 'foreground given back'; Assert-Equal "$($N::CursorX),$($N::CursorY)" '500,600' 'pointer given back'
Assert-Equal $script:BackgroundReport.foreground 'returned (the app had come forward)' 'report'
Scene
Invoke-Guarded { $N::Front=200;$N::Popups.Add(301);'ExpandCollapse' } $element | Out-Null
Assert-Equal $N::Front 200 'an opened list keeps the app in front'
Scene
Invoke-Guarded { $N::CursorX=900;$N::CursorY=900;'Invoke' } $element | Out-Null
Assert-Equal "$($N::CursorX),$($N::CursorY)" '900,900' 'a pointer the user moved elsewhere is left alone'
Scene
Invoke-Guarded { 'Toggle' } $element | Out-Null
Assert-Equal $N::Gives 0 'nothing to give back'; $checks+='UIA guard'
Write-Output ('PASS less takeover: '+($checks -join ', ')+' (fake APIs only)')
