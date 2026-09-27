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
  public static IntPtr[] TopLevelWindows() { return new[] {new IntPtr(42)}; }
  public static IntPtr GetForegroundWindow() { return new IntPtr(42); }
  public static bool IsWindow(IntPtr hwnd) { return hwnd.ToInt64() == 42; }
  public static bool IsWindowVisible(IntPtr hwnd) { return true; }
  public static bool IsIconic(IntPtr hwnd) { return false; }
  public static bool IsWindowEnabled(IntPtr hwnd) { return true; }
  public static bool GetWindowRect(IntPtr hwnd, out RECT rect) {
    rect = new RECT { left = X, top = Y, right = X + 400, bottom = Y + 300 }; return true;
  }
  public static int GetWindowText(IntPtr hwnd, StringBuilder text, int count) { text.Append("Fixture Window"); return text.Length; }
  public static int GetClassName(IntPtr hwnd, StringBuilder text, int count) { text.Append("FixtureClass"); return text.Length; }
  public static uint GetWindowThreadProcessId(IntPtr hwnd, out uint owner) { owner = 4242; return 1; }
}
namespace System.Windows.Automation {
  public class AutomationElement {
    public class Info { public int NativeWindowHandle = 42; }
    public Info Current = new Info();
    public static AutomationElement FromHandle(IntPtr hwnd) { return new AutomationElement(); }
  }
}
'@
$names = @('Get-Prop','Get-ViewMode','Invoke-Safe','Has-WindowTarget','Test-TargetMatch','Get-NativeWindowList','Resolve-TargetWindow','Resolve-Element','Home-Point')
foreach ($name in $names) {
  $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if ($null -eq $definition) { throw "Missing backend function: $name" }
  . ([scriptblock]::Create($definition.Extent.Text))
}
function Get-FreshWindowRect {
  param($Element)
  return @{ x = [WindowsComputerUseNative]::X; y = [WindowsComputerUseNative]::Y }
}
function Assert-Equal { param($Actual, $Expected, [string]$Label)
  if ($Actual -ne $Expected) { throw "${Label}: expected $Expected; got $Actual" }
}
foreach ($target in @([pscustomobject]@{windowTitle='Fixture'}, [pscustomobject]@{processId=4242})) {
  $script:WindowCache = @{}
  [WindowsComputerUseNative]::X = 100
  [WindowsComputerUseNative]::Y = 200
  $null = Get-NativeWindowList -RecordObservation
  Assert-Equal $script:WindowCache['42'].x 100 'Observation stores initial position'
  [WindowsComputerUseNative]::X = 220
  [WindowsComputerUseNative]::Y = 280
  $element = Resolve-TargetWindow $target
  Assert-Equal $script:WindowCache['42'].x 100 'Target resolution preserves observed X'
  Assert-Equal $script:WindowCache['42'].y 200 'Target resolution preserves observed Y'
  $point = Home-Point -X 110 -Y 230 -Target $element
  Assert-Equal $point.x 230 'Homed X'
  Assert-Equal $point.y 310 'Homed Y'
  Assert-Equal $point.homed.dx 120 'Window X displacement'
  Assert-Equal $point.homed.dy 80 'Window Y displacement'
  $null = Get-NativeWindowList -RecordObservation
  Assert-Equal $script:WindowCache['42'].x 220 'Explicit re-observation updates cache'
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
Write-Output 'PASS title/PID resolution preserves homing, explicit observations refresh cache, and HWND ids validate viewMode (fake native API only)'
