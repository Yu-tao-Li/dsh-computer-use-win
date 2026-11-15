# Actual backend functions, fake window metadata and UIA objects; no desktop changes.
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'), [Text.Encoding]::UTF8)
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Backend source did not parse' }
Add-Type -TypeDefinition @'
using System;
using System.Text;
public static class WindowsComputerUseNative {
  public struct RECT { public int left, top, right, bottom; }
  public static int X = 100, Y = 200;
  public static bool Minimized;
  public static IntPtr[] TopLevelWindows() { return Minimized ? new[] {new IntPtr(42), new IntPtr(43)} : new[] {new IntPtr(42)}; }
  public static IntPtr GetForegroundWindow() { return new IntPtr(42); }
  public static bool IsWindow(IntPtr hwnd) { return hwnd.ToInt64() == 42; }
  public static bool IsWindowVisible(IntPtr hwnd) { return true; }
  public static bool IsIconic(IntPtr hwnd) { return hwnd.ToInt64() == 43; }
  public static bool IsWindowEnabled(IntPtr hwnd) { return true; }
  public static bool GetWindowRect(IntPtr hwnd, out RECT rect) {
    rect = new RECT { left = X, top = Y, right = X + 400, bottom = Y + 300 }; return true;
  }
  public static int GetWindowText(IntPtr hwnd, StringBuilder text, int count) { text.Append("Fixture Window"); return text.Length; }
  public static int GetClassName(IntPtr hwnd, StringBuilder text, int count) { text.Append("FixtureClass"); return text.Length; }
  public static uint GetWindowThreadProcessId(IntPtr hwnd, out uint owner) { owner = 4242; return 1; }
}
namespace Fixture {
  public class AutomationElement {
    public class Info { public int NativeWindowHandle = 42; }
    public Info Current = new Info();
    public static AutomationElement FromHandle(IntPtr hwnd) { return new AutomationElement(); }
  }
}
'@
$names = @('Get-Prop','Get-ViewMode','Invoke-Safe','Update-WindowCache','Has-WindowTarget','Test-TargetMatch','Get-NativeWindowList','Select-TargetWindow','Resolve-TargetWindow','Resolve-Element','Home-Point')
foreach ($name in $names) {
  $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if ($null -eq $definition) { throw "Missing backend function: $name" }
  # PS7 may preload the real UIAutomationClient type. Bind this native-window
  # contract explicitly to its deterministic fake rather than HWND 42 on user32.
  . ([scriptblock]::Create($definition.Extent.Text.Replace('System.Windows.Automation.AutomationElement','Fixture.AutomationElement')))
}
function Get-FreshWindowRect {
  param($Element)
  return @{ x = [WindowsComputerUseNative]::X; y = [WindowsComputerUseNative]::Y }
}
function Assert-Equal { param($Actual, $Expected, [string]$Label)
  if ($Actual -ne $Expected) { throw "${Label}: expected $Expected; got $Actual" }
}
foreach ($target in @([pscustomobject]@{windowTitle='Fixture'}, [pscustomobject]@{processId=4242})) {
  $script:WindowCache = @{};$script:WindowObservations=@{}
  [WindowsComputerUseNative]::X = 100
  [WindowsComputerUseNative]::Y = 200
  $null = Get-NativeWindowList -RecordObservation
  Assert-Equal $script:WindowCache['42'].x 100 'Observation stores initial position'
  [WindowsComputerUseNative]::X = 220
  [WindowsComputerUseNative]::Y = 280
  $element = Resolve-TargetWindow $target
  Assert-Equal $script:WindowCache['42'].x 100 'Target resolution preserves observed X'
  Assert-Equal $script:WindowCache['42'].y 200 'Target resolution preserves observed Y'
  $current = Home-Point -X 230 -Y 310 -Target $element
  Assert-Equal $current.x 230 'Current coordinates are not shifted again'
  Assert-Equal $current.y 310 'Current coordinates keep their Y'
  $token=$script:WindowCache['42'].token
  $point = Home-Point -X 110 -Y 230 -Target $element -ObservationToken $token
  Assert-Equal $point.x 230 'Homed X'
  Assert-Equal $point.y 310 'Homed Y'
  Assert-Equal $point.homed.dx 120 'Window X displacement'
  Assert-Equal $point.homed.dy 80 'Window Y displacement'
  $null = Get-NativeWindowList -RecordObservation
  Assert-Equal $script:WindowCache['42'].x 220 'Explicit re-observation updates cache'
  $point=Home-Point 110 230 $element $token
  Assert-Equal $point.x 230 'An immutable old observation stays usable after a new observation'
  $script:WindowObservations[$token].ts=0
  $stale=$false;try{Home-Point 110 230 $element $token | Out-Null}catch{if($_.Exception.Message -notmatch 'OBSERVATION_TOKEN_STALE'){throw};$stale=$true}
  Assert-Equal $stale $true 'Expired observation token is rejected'
}
$script:WindowCache = @{}
$null = Resolve-TargetWindow ([pscustomobject]@{processId=4242})
Assert-Equal $script:WindowCache.Count 0 'Resolution does not invent an observation'
foreach ($mode in @('control','raw','content')) {
  $null = Resolve-Element 'uia:hwnd:42:pid:4242' ([pscustomobject]@{viewMode=$mode})
}
$rejected = $false
try { $null = Resolve-Element 'uia:hwnd:42:pid:4242' ([pscustomobject]@{viewMode='invalid'}) }
catch { if ($_.Exception.Message -notmatch 'viewMode must be one of') { throw }; $rejected = $true }
Assert-Equal $rejected $true 'HWND ids validate viewMode'
# Issue #82: a minimized window is listed on request (list_windows asks by
# default), marked minimized, and sets no homing baseline at -32000,-32000.
[WindowsComputerUseNative]::Minimized = $true
$script:WindowCache = @{};$script:WindowObservations=@{}
$shown = @((Get-NativeWindowList -RecordObservation).ToArray())
Assert-Equal $shown.Count 1 'Shown windows only by default'
Assert-Equal $shown[0].Contains('minimized') $false 'A shown window carries no minimized flag'
$all = @((Get-NativeWindowList -RecordObservation -IncludeMinimized $true).ToArray())
Assert-Equal $all.Count 2 'Minimized window listed on request'
Assert-Equal $all[1].nativeWindowHandle 43 'Minimized window keeps its place'
Assert-Equal $all[1].minimized $true 'Minimized window marked'
Assert-Equal $all[1].isOffscreen $true 'Minimized window is offscreen'
Assert-Equal $script:WindowCache.ContainsKey('43') $false 'Minimized window sets no homing baseline'
Assert-Equal $all[1].Contains('observationToken') $false 'Minimized window gets no observation token'
Assert-Equal @((Get-NativeWindowList -IncludeInvisible $true).ToArray())[1].minimized $true 'Hidden-window listing marks minimized windows too'
Assert-Equal (Select-TargetWindow ([pscustomobject]@{processId=4242})).nativeWindowHandle 42 'A minimized twin does not make the shown window ambiguous'
[WindowsComputerUseNative]::Minimized = $false
Write-Output 'PASS title/PID resolution preserves homing, explicit observations refresh cache, HWND ids validate viewMode, minimized windows listed and marked without a homing baseline (fake native API only)'

# Issue #82: bringing a minimized window forward restores it first, with
# ShowWindow and then the Restore command of its system menu; a window that
# stays minimized is not reported as activated. The shipped function runs on
# its own fake type, since WindowsComputerUseNative above is fixed.
Add-Type -TypeDefinition @'
using System;
public static class RestoreFixture {
  public static bool Iconic, ObeyShow, ObeyRestore;
  public static int ShowCalls, RestorePosts, ForegroundCalls;
  public static bool IsIconic(IntPtr hwnd) { return Iconic; }
  public static bool ShowWindow(IntPtr hwnd, int command) { ShowCalls++; if (command == 9 && ObeyShow) Iconic = false; return true; }
  public static bool PostMessageW(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam) {
    if (message == 0x0112 && wParam.ToInt64() == 0xF120) { RestorePosts++; if (ObeyRestore) Iconic = false; }
    return true;
  }
  public static bool GiveForeground(IntPtr hwnd) { ForegroundCalls++; return true; }
  public static void ThrowIfCancelled() {}
  public static void Reset(bool iconic, bool obeyShow, bool obeyRestore) {
    Iconic = iconic; ObeyShow = obeyShow; ObeyRestore = obeyRestore; ShowCalls = RestorePosts = ForegroundCalls = 0;
  }
}
'@
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Set-WindowForeground' }, $true)
if ($null -eq $definition) { throw 'Missing backend function: Set-WindowForeground' }
. ([scriptblock]::Create($definition.Extent.Text.Replace('[WindowsComputerUseNative]', '[RestoreFixture]')))
function Assert-NativeInputTarget { param($Hwnd) }
function Start-Sleep { param($Milliseconds) }
$window = @{ nativeWindowHandle = 42 }
[RestoreFixture]::Reset($false, $true, $true)
Assert-Equal (Set-WindowForeground $window) $true 'A shown window comes forward'
Assert-Equal ([RestoreFixture]::ShowCalls) 0 'A window that is not minimized is not restored (SW_RESTORE would un-maximize it)'
[RestoreFixture]::Reset($true, $true, $false)
Assert-Equal (Set-WindowForeground $window) $true 'ShowWindow restores a minimized window'
Assert-Equal ([RestoreFixture]::RestorePosts) 0 'No system-menu Restore after ShowWindow worked'
[RestoreFixture]::Reset($true, $false, $true)
Assert-Equal (Set-WindowForeground $window) $true 'The system-menu Restore restores a window that ignores ShowWindow'
Assert-Equal ([RestoreFixture]::RestorePosts) 1 'System-menu Restore posted once'
[RestoreFixture]::Reset($true, $false, $false)
Assert-Equal (Set-WindowForeground $window) $false 'A window left minimized is not reported as activated'
Assert-Equal ([RestoreFixture]::ForegroundCalls) 0 'No foreground switch to a window left minimized'
Write-Output 'PASS minimized windows are restored by ShowWindow, else by the system-menu Restore, else reported as not activated (fake native API only)'
