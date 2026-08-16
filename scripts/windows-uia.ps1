param(
  [Parameter(Mandatory = $false)]
  [string]$Action,
  [switch]$Persistent
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ============================================================================
# Win Computer Use — Windows desktop engine for the computer-use-win MCP server
#
# Modes:
#   -One-shot:  windows-uia.ps1 -Action <name>        (args: JSON on stdin)
#   -Persistent: windows-uia.ps1 -Persistent          (args: JSON lines on stdin,
#                one JSON line response per line on stdout; keeps the process
#                alive so repeated actions skip PowerShell startup, assembly
#                loading and C# compilation)
# ============================================================================

function Write-JsonLine {
  param([object]$Value)
  $Value | ConvertTo-Json -Depth 50 -Compress
}

function Get-InputObject {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return [pscustomobject]@{}
  }
  return $raw | ConvertFrom-Json
}

function Get-Prop {
  param([object]$Object, [string]$Name, [object]$Default = $null)
  if ($null -eq $Object) { return $Default }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) { return $Default }
  if ($null -eq $prop.Value) { return $Default }
  return $prop.Value
}

function Get-ViewMode {
  param([object]$InputObject, [string]$Default = "control")
  $mode = ("" + (Get-Prop $InputObject "viewMode" $Default)).Trim().ToLowerInvariant()
  switch ($mode) {
      "raw" { return "raw" }
      "control" { return "control" }
      "content" { return "content" }
      default { throw "viewMode must be one of: raw, control, content." }
  }
}

function Get-DetailLevel {
  param([object]$InputObject, [string]$Default = "compact")
  $level = ("" + (Get-Prop $InputObject "detailLevel" $Default)).Trim().ToLowerInvariant()
  switch ($level) {
      "compact" { return "compact" }
      "full" { return "full" }
      default { throw "detailLevel must be one of: compact, full." }
  }
}

function Get-ViewCondition {
  param([string]$ViewMode = "control", [bool]$IncludeOffscreen = $false)
  $condition = switch ($ViewMode) {
      "raw" { [System.Windows.Automation.Automation]::RawViewCondition }
      "content" { [System.Windows.Automation.Automation]::ContentViewCondition }
      default { [System.Windows.Automation.Automation]::ControlViewCondition }
  }
  if ($null -eq $condition) {
    $condition = [System.Windows.Automation.Condition]::TrueCondition
  }
  if (-not $IncludeOffscreen) {
    $visible = New-Object System.Windows.Automation.PropertyCondition -ArgumentList ([System.Windows.Automation.AutomationElement]::IsOffscreenProperty), $false
    $condition = New-Object System.Windows.Automation.AndCondition -ArgumentList $condition, $visible
  }
  return $condition
}

# ----------------------------------------------------------------------------
# Native P/Invoke surface. Compiled once to a cached DLL (keyed by a hash of
# this source) so restarted processes skip the ~hundreds-of-ms C# compile.
# ----------------------------------------------------------------------------
$script:WcuCs = @'
using System;
using System.Runtime.InteropServices;

public static class WindowsComputerUseNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  public const int MOUSEEVENTF_MOVE = 0x0001;
  public const int MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const int MOUSEEVENTF_LEFTUP = 0x0004;
  public const int MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const int MOUSEEVENTF_RIGHTUP = 0x0010;
  public const int MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  public const int MOUSEEVENTF_MIDDLEUP = 0x0040;
  public const int MOUSEEVENTF_WHEEL = 0x0800;
  public const int MOUSEEVENTF_HWHEEL = 0x01000;

  // SM_XVIRTUALSCREEN / SM_YVIRTUALSCREEN / SM_CXVIRTUALSCREEN / SM_CYVIRTUALSCREEN
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION U;
  }
  [DllImport("user32.dll")]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  // Send a button or wheel event at the CURRENT pointer position. Movement is
  // done with SetCursorPos (raw screen coords, matching the UIA/screenshot
  // space), not with MOUSEEVENTF_ABSOLUTE: on multi-monitor / high-DPI setups
  // the ABSOLUTE 0..65535 normalization against SM_CXVIRTUALSCREEN silently
  // mis-maps (observed: X exactly halved), so we never position via SendInput.
  public static uint SendMouseEvent(int x, int y, uint flags, int data) {
    MOUSEINPUT mi = new MOUSEINPUT();
    mi.dx = 0; mi.dy = 0; mi.mouseData = (uint)data;
    mi.dwFlags = flags; // button/wheel only; caller positioned via SetCursorPos
    mi.time = 0; mi.dwExtraInfo = new IntPtr(0);
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = 0; // INPUT_MOUSE
    inputs[0].U.mi = mi;
    return SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public const uint KEYEVENTF_UNICODE = 0x0004;

  // Synthesize the text as Unicode key events (KEYEVENTF_UNICODE). No clipboard
  // is touched, so this also works on password fields and other controls that
  // reject paste. The target control must be foreground + focused. Returns
  // false if any input event was dropped (queue full).
  public static bool SendUnicodeText(string text) {
    if (string.IsNullOrEmpty(text)) return true;
    var chars = text.ToCharArray();
    var inputs = new INPUT[chars.Length * 2];
    int n = 0;
    foreach (char ch in chars) {
      // press
      inputs[n].type = 1; // INPUT_KEYBOARD
      inputs[n].U.ki.wVk = 0;
      inputs[n].U.ki.wScan = ch;
      inputs[n].U.ki.dwFlags = KEYEVENTF_UNICODE;
      inputs[n].U.ki.time = 0;
      inputs[n].U.ki.dwExtraInfo = new IntPtr(0);
      n++;
      // release
      inputs[n].type = 1;
      inputs[n].U.ki.wVk = 0;
      inputs[n].U.ki.wScan = 0;
      inputs[n].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      inputs[n].U.ki.time = 0;
      inputs[n].U.ki.dwExtraInfo = new IntPtr(0);
      n++;
    }
    int sent = 0;
    int size = Marshal.SizeOf(typeof(INPUT));
    while (sent < n) {
      int chunk = Math.Min(64, n - sent);
      var slice = new INPUT[chunk];
      Array.Copy(inputs, sent, slice, 0, chunk);
      uint ok = SendInput((uint)chunk, slice, size);
      if (ok != (uint)chunk) return false;
      sent += chunk;
    }
    return true;
  }

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  public const byte VK_MENU = 0x12;
  public const uint KEYEVENTF_KEYUP = 0x0002;

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll")]
  public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int left; public int top; public int right; public int bottom; }

  // DWMWA_EXTENDED_FRAME_BOUNDS = 9: the real window rect without the invisible
  // drop-shadow margin DWM adds to GetWindowRect.
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);

  // PW_RENDERFULLCONTENT = 2: asks DirectComposition-backed windows to render.
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint nFlags);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int x; public int y; }
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT p);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOZORDER = 0x0004;
  public const uint SWP_NOACTIVATE = 0x0010;

  // ---- background (message-queue) input path ----
  // PostMessage delivers to the target window's message queue WITHOUT touching
  // the system input queue: the user's foreground stays untouched. Classic
  // Win32/Edit controls honor these; Chromium/Electron/UWP content often drops
  // them (that is the documented 'background_unavailable' case).
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool PostMessageW(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

  [DllImport("user32.dll")]
  public static extern short VkKeyScanW(char ch);

  // WM_* message ids
  public const uint WM_MOUSEMOVE = 0x0200;
  public const uint WM_LBUTTONDOWN = 0x0201;
  public const uint WM_LBUTTONUP = 0x0202;
  public const uint WM_LBUTTONDBLCLK = 0x0203;
  public const uint WM_RBUTTONDOWN = 0x0204;
  public const uint WM_RBUTTONUP = 0x0205;
  public const uint WM_MBUTTONDOWN = 0x0207;
  public const uint WM_MBUTTONUP = 0x0208;
  public const uint WM_CHAR = 0x0102;
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint WM_CLOSE = 0x0010;
  // MK_* mouse key state words (wParam for mouse messages)
  public const int MK_LBUTTON = 0x0001;
  public const int MK_RBUTTON = 0x0002;
  public const int MK_MBUTTON = 0x0010;

  // Pack client-area x/y into the LPARAM for mouse messages.
  public static IntPtr MakeLParam(int x, int y) {
    return new IntPtr((y & 0xFFFF) << 16 | (x & 0xFFFF));
  }
}
'@

function Get-CsHash {
  param([string]$Source)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Source))
  return ([BitConverter]::ToString($bytes).Replace("-", "").Substring(0, 16)).ToLowerInvariant()
}

function Load-Assemblies {
  # DPI awareness MUST be set before any GDI+/WinForms assembly is loaded:
  # loading System.Windows.Forms/System.Drawing initializes GDI, which locks
  # the process DPI context (and GetSystemMetrics then returns virtualized
  # 150%-scaled values like 3414x960 instead of physical 5120x1440).
  if (-not ("WindowsComputerUseNative" -as [type])) {
    $dll = Join-Path $env:TEMP ("wcu-native-" + (Get-CsHash -Source $script:WcuCs) + ".dll")
    if (-not (Test-Path $dll)) {
      Add-Type -TypeDefinition $script:WcuCs -OutputAssembly $dll
    }
    [void][System.Reflection.Assembly]::LoadFrom($dll)
  }
  Set-DpiAware

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName WindowsBase
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
}

function Set-DpiAware {
  # Per-Monitor V2 (context value -4); fall back to system-aware. Must run
  # before any screen/UIA work so coordinates and pixels are physical.
  $ok = [WindowsComputerUseNative]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
  if ($ok -ne [IntPtr]::Zero) {
    [void][WindowsComputerUseNative]::SetProcessDPIAware()
  }
}

function Invoke-Safe {
  param([scriptblock]$Block, [object]$Default = $null)
  try {
    return & $Block
  } catch {
    return $Default
  }
}

function Get-ControlTypeName {
  param([object]$ControlType)
  if ($null -eq $ControlType) { return $null }
  $name = Invoke-Safe { $ControlType.ProgrammaticName } $null
  if ($null -eq $name) { return $null }
  return ($name -replace "^ControlType\.", "")
}

function Convert-Rect {
  param([object]$Rect)
  if ($null -eq $Rect) { return $null }
  $empty = Invoke-Safe { $Rect.IsEmpty } $true
  if ($empty) { return $null }
  $x = [int][Math]::Round($Rect.X)
  $y = [int][Math]::Round($Rect.Y)
  $width = [int][Math]::Round($Rect.Width)
  $height = [int][Math]::Round($Rect.Height)
  return [ordered]@{
    x = $x
    y = $y
    width = $width
    height = $height
    centerX = [int]($x + ($width / 2))
    centerY = [int]($y + ($height / 2))
  }
}

function Get-Patterns {
  param([System.Windows.Automation.AutomationElement]$Element)
  $items = New-Object System.Collections.Generic.List[string]
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern) } $false) { $items.Add("Invoke") }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) } $false) { $items.Add("Value") }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern) } $false) { $items.Add("Toggle") }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern) } $false) { $items.Add("SelectionItem") }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern) } $false) { $items.Add("ExpandCollapse") }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$pattern) } $false) { $items.Add("ScrollItem") }
  return ,([string[]]$items.ToArray())
}

function Get-ValueText {
  param([System.Windows.Automation.AutomationElement]$Element)
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) } $false) {
    return Invoke-Safe { $pattern.Current.Value } $null
  }
  return $null
}

function Convert-ElementInfo {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [string]$Id = $null,
    [int]$Depth = 0,
    [string]$DetailLevel = "full"
  )

  $rect = Convert-Rect (Invoke-Safe { $Element.Current.BoundingRectangle } $null)
  $processId = Invoke-Safe { $Element.Current.ProcessId } $null
  $nativeHwnd = Invoke-Safe { $Element.Current.NativeWindowHandle } $null
  # RuntimeId is stable for the life of the owning process (survives UI
  # re-layouts that shift tree paths), so prefer a runtimeId-based id.
  $rtArr = Invoke-Safe { @($Element.GetRuntimeId()) } $null
  $rtStr = $null
  if ($null -ne $rtArr -and $rtArr.Count -ge 2) { $rtStr = ($rtArr | ForEach-Object { [int]$_ }) -join "-" }
  $info = [ordered]@{
    id = if ($null -ne $rtStr) { "uia:rt:$rtStr" } else { $Id }
    depth = $Depth
    name = Invoke-Safe { $Element.Current.Name } ""
    automationId = Invoke-Safe { $Element.Current.AutomationId } ""
    className = Invoke-Safe { $Element.Current.ClassName } ""
    controlType = Get-ControlTypeName (Invoke-Safe { $Element.Current.ControlType } $null)
    boundingBox = $rect
    isEnabled = Invoke-Safe { $Element.Current.IsEnabled } $null
    isOffscreen = Invoke-Safe { $Element.Current.IsOffscreen } $null
    hasKeyboardFocus = Invoke-Safe { $Element.Current.HasKeyboardFocus } $null
  }
  if ($DetailLevel -eq "full") {
    $value = Get-ValueText $Element
    $patterns = [string[]](Get-Patterns $Element)
    $info["localizedControlType"] = Invoke-Safe { $Element.Current.LocalizedControlType } ""
    $info["processId"] = $processId
    $info["nativeWindowHandle"] = $nativeHwnd
    $info["runtimeId"] = if ($null -ne $rtStr) { $rtStr } else { $null }
    $info["value"] = $value
    $info["patterns"] = $patterns
  } else {
    if ($Depth -le 1 -and $null -ne $processId) { $info["processId"] = $processId }
    if ($null -ne $nativeHwnd -and [int64]$nativeHwnd -ne 0) { $info["nativeWindowHandle"] = $nativeHwnd }
  }
  return $info
}

# ============================================================================
# Window targeting
# ============================================================================

function Has-WindowTarget {
  param([object]$InputObject)
  if ($null -eq $InputObject) { return $false }
  $title = [string](Get-Prop $InputObject "windowTitle" "")
  $processId = Get-Prop $InputObject "processId" $null
  $hwnd = Get-Prop $InputObject "nativeWindowHandle" $null
  return (-not [string]::IsNullOrWhiteSpace($title)) -or ($null -ne $processId) -or ($null -ne $hwnd)
}

function Test-TargetMatch {
  param([object]$Info, [object]$InputObject)
  $title = [string](Get-Prop $InputObject "windowTitle" "")
  $processId = Get-Prop $InputObject "processId" $null
  $hwnd = Get-Prop $InputObject "nativeWindowHandle" $null

  if (-not [string]::IsNullOrWhiteSpace($title)) {
    $name = "" + $Info.name
    if ($name.IndexOf($title, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
  }
  if ($null -ne $processId -and [int]$Info.processId -ne [int]$processId) { return $false }
  if ($null -ne $hwnd -and [int64]$Info.nativeWindowHandle -ne [int64]$hwnd) { return $false }
  return $true
}

function Set-WindowForeground {
  param([System.Windows.Automation.AutomationElement]$Element)
  $hwnd = Invoke-Safe { $Element.Current.NativeWindowHandle } 0
  if (-not ($hwnd -and $hwnd -ne 0)) { return $false }
  $ptr = [IntPtr]([int64]$hwnd)

  # Beat the Windows foreground lock: a background process is normally
  # silently refused by SetForegroundWindow. Attaching our input thread to
  # the current foreground window's thread and tapping the Alt key releases
  # the lock long enough to switch (classic AutoHotkey trick).
  $fgPtr = [WindowsComputerUseNative]::GetForegroundWindow()
  $fgThread = [uint32]0
  $tgtThread = [uint32]0
  [void][WindowsComputerUseNative]::GetWindowThreadProcessId($fgPtr, [ref]$fgThread)
  [void][WindowsComputerUseNative]::GetWindowThreadProcessId($ptr, [ref]$tgtThread)
  $attached = $false
  if ($fgThread -ne $tgtThread -and $fgThread -ne 0) {
    $attached = [WindowsComputerUseNative]::AttachThreadInput($tgtThread, $fgThread, $true)
  }
  try {
    [void][WindowsComputerUseNative]::keybd_event([WindowsComputerUseNative]::VK_MENU, 0, 0, [UIntPtr]::Zero)
    [void][WindowsComputerUseNative]::keybd_event([WindowsComputerUseNative]::VK_MENU, 0, [WindowsComputerUseNative]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [WindowsComputerUseNative]::ShowWindow($ptr, 9) | Out-Null
    Start-Sleep -Milliseconds 80
    [WindowsComputerUseNative]::SetForegroundWindow($ptr) | Out-Null
    Start-Sleep -Milliseconds 120
  } finally {
    if ($attached) { [void][WindowsComputerUseNative]::AttachThreadInput($tgtThread, $fgThread, $false) }
  }

  # Verify the switch actually happened; report it so callers can react.
  $nowFg = [WindowsComputerUseNative]::GetForegroundWindow()
  return ($nowFg -eq $ptr)
}

function Activate-TargetIfRequested {
  param([object]$InputObject)
  if ((Has-WindowTarget $InputObject) -and [bool](Get-Prop $InputObject "activate" $false)) {
    $target = Resolve-TargetWindow $InputObject
    $ok = Set-WindowForeground $target
    if (-not $ok) {
      $title = [string](Get-Prop $InputObject "windowTitle" "")
      throw "Failed to bring the target window ('$title') to the foreground (Windows foreground lock). Input was NOT sent. Try again, or pass a different window target."
    }
  }
}

function Assert-TargetIsForeground {
  # Fail-closed guard for input actions: if a specific window was requested,
  # make sure it is ACTUALLY the foreground window before we let keystrokes
  # or clicks out. Otherwise a silent background activation would have typed
  # into the wrong (possibly the user's) window.
  param([object]$InputObject)
  if (-not (Has-WindowTarget $InputObject)) { return }
  $target = Resolve-TargetWindow $InputObject
  $hwnd = Invoke-Safe { $target.Current.NativeWindowHandle } 0
  $fg = [WindowsComputerUseNative]::GetForegroundWindow()
  if (-not ($hwnd -and $hwnd -ne 0) -or ($fg -ne [IntPtr]([int64]$hwnd))) {
    $title = [string](Get-Prop $InputObject "windowTitle" "")
    throw "Target window ('$title') is not the foreground window, so no input was sent. Re-run with activate: true, or call activate_window first."
  }
}

function Get-BestTextControl {
  # Pick the most likely text-input control inside a window: the largest
  # (by bounding-box area) enabled Edit or Document control.
  param([System.Windows.Automation.AutomationElement]$Window)
  $cands = New-Object System.Collections.Generic.List[object]
  try {
    $cond1 = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty), ([System.Windows.Automation.ControlType]::Edit)
    $cond2 = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty), ([System.Windows.Automation.ControlType]::Document)
    $orCond = New-Object System.Windows.Automation.OrCondition ($cond1, $cond2)
    $enabledCond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::IsEnabledProperty), $true
    $cond = New-Object System.Windows.Automation.AndCondition ($orCond, $enabledCond)
    $coll = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    for ($i = 0; $i -lt $coll.Count; $i++) {
      $el = $coll.Item($i)
      $rect = Convert-Rect (Invoke-Safe { $el.Current.BoundingRectangle } $null)
      $area = 0
      if ($null -ne $rect) { $area = [int64]$rect.width * [int64]$rect.height }
      $cands.Add([pscustomobject]@{ el = $el; area = $area })
    }
  } catch {
    return $null
  }
  if ($cands.Count -eq 0) { return $null }
  return ($cands | Sort-Object area -Descending | Select-Object -First 1).el
}

function Focus-TextControl {
  # Set keyboard focus on the window's main text control. Returns the
  # control type name when focus was set, else $null.
  param([System.Windows.Automation.AutomationElement]$Window)
  $el = Get-BestTextControl $Window
  if ($null -eq $el) { return $null }
  $ok = Invoke-Safe { $el.SetFocus(); $true } $false
  if (-not $ok) { return $null }
  Start-Sleep -Milliseconds 80
  $focused = Invoke-Safe { [bool]$el.Current.HasKeyboardFocus } $false
  if (-not $focused) { return $null }
  return (Get-ControlTypeName (Invoke-Safe { $el.Current.ControlType } $null))
}

# ============================================================================
# Homing: remember window rects when observed, compensate coordinates when
# the window moved between observation and action (desktop-touch-mcp Tier 1).
# ============================================================================

$script:WindowCache = @{}   # hwnd -> @{ x=..; y=..; ts=.. }
$script:OcrAwait = $null    # WinRT AsTask helper (filled lazily by Get-OcrEngine)

function Get-FreshWindowRect {
  param([System.Windows.Automation.AutomationElement]$Element)
  return Convert-Rect (Invoke-Safe { $Element.Current.BoundingRectangle } $null)
}

function Update-WindowCache {
  param([System.Windows.Automation.AutomationElement]$Element)
  $hwnd = Invoke-Safe { [int64]$Element.Current.NativeWindowHandle } 0
  if (-not ($hwnd -and $hwnd -ne 0)) { return }
  $rect = Get-FreshWindowRect $Element
  if ($null -eq $rect) { return }
  $script:WindowCache[[string]$hwnd] = @{ x = $rect.x; y = $rect.y; ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
}

function Home-Point {
  # If the target window was observed before and has since moved, shift the
  # given screen point by (dx, dy). Returns @{ x=..; y=..; homed=$null or @{dx=..;dy=..} }.
  param([int]$X, [int]$Y, [System.Windows.Automation.AutomationElement]$Target)
  $result = [ordered]@{ x = $X; y = $Y; homed = $null }
  $hwnd = Invoke-Safe { [int64]$Target.Current.NativeWindowHandle } 0
  if (-not ($hwnd -and $hwnd -ne 0)) { return $result }
  $key = [string]$hwnd
  $cached = $script:WindowCache[$key]
  if ($null -eq $cached) { return $result }
  $now = Get-FreshWindowRect $Target
  if ($null -eq $now) { return $result }
  $dx = $now.x - [int]$cached.x
  $dy = $now.y - [int]$cached.y
  if ($dx -ne 0 -or $dy -ne 0) {
    $result.x = $X + $dx
    $result.y = $Y + $dy
    $result.homed = [ordered]@{ dx = $dx; dy = $dy }
  }
  return $result
}

# ----------------------------------------------------------------------------
# Window identity guard: when the caller targets a window BY TITLE, remember
# which HWND/PID that title referred to at observation time. If the title now
# resolves to a different HWND/PID (app restarted, window recreated), acting
# on the new window with stale coordinates/focus would be a silent miss or —
# worse — a hit on the wrong app. Fail closed with an identity_changed error.
# ----------------------------------------------------------------------------
$script:WindowIdentity = @{}   # lowercased title -> @{ hwnd=; pid=; ts= }

function Update-WindowIdentity {
  param([object]$InputObject, [System.Windows.Automation.AutomationElement]$Target)
  $title = [string](Get-Prop $InputObject "windowTitle" "")
  if ([string]::IsNullOrWhiteSpace($title) -or $null -eq $Target) { return }
  $hwnd = Invoke-Safe { [int64]$Target.Current.NativeWindowHandle } 0
  $procId = Invoke-Safe { [int]$Target.Current.ProcessId } 0
  $script:WindowIdentity[$title.Trim().ToLowerInvariant()] = @{ hwnd = $hwnd; pid = $procId; ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
}

function Assert-WindowIdentity {
  param([object]$InputObject, [System.Windows.Automation.AutomationElement]$Target)
  $title = [string](Get-Prop $InputObject "windowTitle" "")
  if ([string]::IsNullOrWhiteSpace($title) -or $null -eq $Target) { return }
  $key = $title.Trim().ToLowerInvariant()
  $hwnd = Invoke-Safe { [int64]$Target.Current.NativeWindowHandle } 0
  $procId = Invoke-Safe { [int]$Target.Current.ProcessId } 0
  $cached = $script:WindowIdentity[$key]
  if ($null -eq $cached) {
    # First sighting of this title: baseline it, no check.
    $script:WindowIdentity[$key] = @{ hwnd = $hwnd; pid = $procId; ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
    return
  }
  $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  if (($now - [int64]$cached.ts) -gt 300000) {
    # Stale baseline (older than 5 min): silently re-baseline rather than
    # failing on a long-ago observation.
    $script:WindowIdentity[$key] = @{ hwnd = $hwnd; pid = $procId; ts = $now }
    return
  }
  if ($hwnd -ne [int64]$cached.hwnd -or $procId -ne [int]$cached.pid) {
    throw "identity_changed: the window titled '$title' is a different window than when last observed (HWND $([int64]$cached.hwnd) -> $hwnd, PID $([int]$cached.pid) -> $procId). The app may have restarted or the window was recreated. Re-observe with snapshot before acting."
  }
  $script:WindowIdentity[$key] = @{ hwnd = $hwnd; pid = $procId; ts = $now }
}

# ============================================================================
# Emergency-stop failsafe: parking the physical cursor in the top-left corner
# of the virtual screen for ~500ms refuses further input actions (the user's
# panic brake). Config: WCU_FAILSAFE=0 disables; WCU_FAILSAFE_CORNER="x,y"
# moves the corner; WCU_FAILSAFE_RADIUS (default 12) and WCU_FAILSAFE_HOLD_MS
# (default 500) tune it.
# ============================================================================

$script:FailsafeFirstSeen = 0

function Test-Failsafe {
  # Returns $true when an input action is ALLOWED. Throws when the failsafe
  # is engaged (cursor parked in the corner beyond the hold time).
  if ([string]$env:WCU_FAILSAFE -eq '0') { return $true }
  $radius = 12
  if ("$env:WCU_FAILSAFE_RADIUS" -match '^\d+$') { $radius = [int]$env:WCU_FAILSAFE_RADIUS }
  $holdMs = 500
  if ("$env:WCU_FAILSAFE_HOLD_MS" -match '^\d+$') { $holdMs = [int]$env:WCU_FAILSAFE_HOLD_MS }

  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $cx = $vs.Left
  $cy = $vs.Top
  if ("$env:WCU_FAILSAFE_CORNER" -match '^(-?\d+)\s*,\s*(-?\d+)$') { $cx = [int]$Matches[1]; $cy = [int]$Matches[2] }

  $p = New-Object WindowsComputerUseNative+POINT
  [void][WindowsComputerUseNative]::GetCursorPos([ref]$p)
  $inCorner = [Math]::Abs($p.x - $cx) -le $radius -and [Math]::Abs($p.y - $cy) -le $radius
  if (-not $inCorner) { $script:FailsafeFirstSeen = 0; return $true }
  $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  if ($script:FailsafeFirstSeen -eq 0) { $script:FailsafeFirstSeen = $now; return $true }
  if (($now - $script:FailsafeFirstSeen) -ge $holdMs) {
    throw "EMERGENCY STOP: the mouse is parked in the failsafe corner ($cx,$cy) and input is refused. Move the mouse away to resume."
  }
  return $true
}

# ============================================================================
# Background (PostMessage) input: no system input queue, no foreground steal.
# ============================================================================

function Resolve-TargetHwnd {
  param([object]$InputObject)
  $hwnd = Get-Prop $InputObject "nativeWindowHandle" $null
  if ($null -ne $hwnd) { return [int64]$hwnd }
  $target = Resolve-TargetWindow $InputObject
  return Invoke-Safe { [int64]$target.Current.NativeWindowHandle } 0
}

function Post-BackgroundClick {
  # Post a button press/release at screen coords into the target window's
  # message queue (converted to client coords). Returns $true when the
  # messages were queued. The app may still ignore them (Chromium/Electron/
  # UWP) — callers must label the result as unverified.
  param([long]$Hwnd, [int]$X, [int]$Y, [string]$Button, [int]$Count)
  $ptr = [IntPtr]$Hwnd
  $pt = New-Object WindowsComputerUseNative+POINT
  $pt.x = $X
  $pt.y = $Y
  if (-not [WindowsComputerUseNative]::ScreenToClient($ptr, [ref]$pt)) { return $false }
  $dbl = [uint32]0
  switch ($Button) {
      "right" { $down = [WindowsComputerUseNative]::WM_RBUTTONDOWN; $up = [WindowsComputerUseNative]::WM_RBUTTONUP; $mk = [WindowsComputerUseNative]::MK_RBUTTON }
      "middle" { $down = [WindowsComputerUseNative]::WM_MBUTTONDOWN; $up = [WindowsComputerUseNative]::WM_MBUTTONUP; $mk = [WindowsComputerUseNative]::MK_MBUTTON }
      default {
        $down = [WindowsComputerUseNative]::WM_LBUTTONDOWN
        $up = [WindowsComputerUseNative]::WM_LBUTTONUP
        $mk = [WindowsComputerUseNative]::MK_LBUTTON
        $dbl = [WindowsComputerUseNative]::WM_LBUTTONDBLCLK
      }
  }
  $lp = [WindowsComputerUseNative]::MakeLParam($pt.x, $pt.y)
  $ok = [WindowsComputerUseNative]::PostMessageW($ptr, $down, [IntPtr]$mk, $lp)
  Start-Sleep -Milliseconds 30
  $ok = [WindowsComputerUseNative]::PostMessageW($ptr, $up, [IntPtr]0, $lp) -and $ok
  if ($Count -ge 2 -and $dbl -ne 0) {
    # A real double-click: the double-click message carries the click, so a
    # second up completes it.
    Start-Sleep -Milliseconds 30
    $ok = [WindowsComputerUseNative]::PostMessageW($ptr, $dbl, [IntPtr]$mk, $lp) -and $ok
    Start-Sleep -Milliseconds 30
    $ok = [WindowsComputerUseNative]::PostMessageW($ptr, $up, [IntPtr]0, $lp) -and $ok
  }
  Start-Sleep -Milliseconds 40
  return $ok
}

function Post-BackgroundText {
  # Post WM_CHAR per UTF-16 code unit into the target window. No clipboard,
  # no foreground, no system input queue. Works on controls that accept char
  # input (Edit, RichEdit, most Win32 dialogs).
  param([long]$Hwnd, [string]$Text)
  $ptr = [IntPtr]$Hwnd
  $allOk = $true
  foreach ($ch in $Text.ToCharArray()) {
    $ok = [WindowsComputerUseNative]::PostMessageW($ptr, [WindowsComputerUseNative]::WM_CHAR, [IntPtr][int][char]$ch, [IntPtr]1)
    if (-not $ok) { $allOk = $false }
    Start-Sleep -Milliseconds 5
  }
  return $allOk
}

# ============================================================================
# OCR (Windows.Media.Ocr via a compiled C# WinRT helper): the fallback for
# UIA-blind apps (games, self-drawn Tk/Qt, RDP, canvases). Word boxes come
# back in the image's pixel coords; the caller maps them to screen coords.
#
# PowerShell 5.1 cannot resolve WinRT type literals reliably on recent
# builds, so the WinRT calls live in a small C# helper compiled against
# Windows.winmd and cached in TEMP (same pattern as the main native DLL).
# ============================================================================

$script:WcuOcrCs = @'
using System;
using System.Text;
using System.Threading.Tasks;
using Windows.Media.Ocr;
using Windows.Storage;
using Windows.Graphics.Imaging;
using Windows.Foundation;

public static class WindowsComputerUseOcr {
  private static T WaitOp<T>(IAsyncOperation<T> op) {
    var tcs = new TaskCompletionSource<T>();
    op.Completed = (o, s) => {
      try {
        if (s == AsyncStatus.Completed) tcs.SetResult(o.GetResults());
        else if (s == AsyncStatus.Canceled) tcs.SetCanceled();
        else tcs.SetException(new Exception("OCR async operation failed (status: " + s + ")."));
      } catch (Exception ex) { tcs.TrySetException(ex); }
    };
    return tcs.Task.GetAwaiter().GetResult();
  }

  // Returns tab-separated lines:
  //   LANG\t<language tag>
  //   TEXT\t<full text, newlines as \n>
  //   LINE\t<line text>\t<word>@x,y,w,h;<word>@x,y,w,h;...
  public static string Recognize(string pngPath) {
    try {
      StorageFile file = WaitOp(StorageFile.GetFileFromPathAsync(pngPath));
      var stream = WaitOp(file.OpenAsync(FileAccessMode.Read));
      var decoder = WaitOp(BitmapDecoder.CreateAsync(stream));
      var bitmap = WaitOp(decoder.GetSoftwareBitmapAsync());
      OcrEngine engine = OcrEngine.TryCreateFromUserProfileLanguages();
      if (engine == null) throw new Exception("No OCR engine available (no OCR language installed for this system).");
      OcrResult result = WaitOp(engine.RecognizeAsync(bitmap));
      var sb = new StringBuilder();
      sb.Append("TEXT\t").AppendLine(result.Text.Replace("\r", "").Replace("\n", "\\n"));
      foreach (OcrLine line in result.Lines) {
        var ws = new StringBuilder();
        foreach (OcrWord word in line.Words) {
          var r = word.BoundingRect;
          ws.Append(word.Text.Replace("\t", " ")).Append('@')
            .Append((int)Math.Round(r.Left)).Append(',')
            .Append((int)Math.Round(r.Top)).Append(',')
            .Append((int)Math.Round(r.Width)).Append(',')
            .Append((int)Math.Round(r.Height)).Append(';');
        }
        sb.Append("LINE\t").Append(line.Text.Replace("\r", "").Replace("\n", "\\n")).Append('\t').AppendLine(ws.ToString());
      }
      return sb.ToString();
    } catch (Exception ex) {
      throw new Exception("OCR failed: " + ex.Message, ex);
    }
  }
}
'@

function Get-OcrHelper {
  # Compile (once, cached) and load the C# WinRT OCR helper.
  if ("WindowsComputerUseOcr" -as [type]) { return }
  $dll = Join-Path $env:TEMP ("wcu-ocr-" + (Get-CsHash -Source $script:WcuOcrCs) + ".dll")
  if (-not (Test-Path $dll)) {
    $wd = "C:\Windows\System32\WinMetadata"
    # Only the winmds the C# code touches (plus the framework facades csc
    # needs for WinRT binding). Keeping the set small also keeps the command
    # line short.
    $need = @("Windows.Media.winmd", "Windows.Storage.winmd", "Windows.Graphics.winmd", "Windows.Foundation.winmd")
    $winmdRefs = @()
    foreach ($n in $need) {
      $p = Join-Path $wd $n
      if (-not (Test-Path $p)) {
        throw "OCR unavailable: $n not found in $wd (requires Windows 10+)."
      }
      $winmdRefs += $p
    }
    # Add-Type pre-validates references with Assembly.Load, which cannot load
    # winmd files — so invoke csc.exe directly.
    $fw = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
    if (-not (Test-Path $fw)) { $fw = "C:\Windows\Microsoft.NET\Framework\v4.0.30319" }
    $csc = Join-Path $fw "csc.exe"
    if (-not (Test-Path $csc)) { throw "OCR unavailable: csc.exe not found at $fw." }
    $src = "$dll.cs"
    [System.IO.File]::WriteAllText($src, $script:WcuOcrCs)
    # Each /r must be its own argument (PowerShell would otherwise hand the
    # whole joined string to csc as one file name).
    $refArgs = ($winmdRefs + @((Join-Path $fw "System.Runtime.dll"), (Join-Path $fw "System.dll"), (Join-Path $fw "System.Runtime.WindowsRuntime.dll"))) | ForEach-Object { "/r:$_" }
    $cscArgList = @("/nologo", "/target:library", "/out:$dll") + $refArgs + @($src)
    $out = & $csc @cscArgList 2>&1
    if ($LASTEXITCODE -ne 0) {
      $msg = (($out | Out-String).Trim())
      throw "OCR helper compile failed: " + $msg.Substring(0, [Math]::Min(300, $msg.Length))
    }
  }
  [void][System.Reflection.Assembly]::LoadFrom($dll)
}

function Invoke-Ocr {
  # OCR a PNG file; word boxes come back in the image's pixel coordinates.
  param([string]$PngPath)
  Get-OcrHelper
  $raw = [WindowsComputerUseOcr]::Recognize($PngPath)
  $linesOut = @()
  $fullText = ""
  $lang = ""
  foreach ($line in ($raw -split "`r?`n")) {
    if ($line -match '^LANG\t(.*)$') { $lang = $Matches[1]; continue }
    if ($line -match '^TEXT\t(.*)$') { $fullText = $Matches[1]; continue }
    if ($line -match '^LINE\t(.*)\t(.*)$') {
      $lineText = $Matches[1]
      $words = @()
      foreach ($w in ($Matches[2] -split ';')) {
        if ($w -eq '') { continue }
        $at = $w.LastIndexOf('@')
        if ($at -lt 0) { continue }
        $wtext = $w.Substring(0, $at)
        $coords = $w.Substring($at + 1) -split ','
        if ($coords.Count -lt 4) { continue }
        $words += [ordered]@{ text = $wtext; x = [int]$coords[0]; y = [int]$coords[1]; width = [int]$coords[2]; height = [int]$coords[3] }
      }
      $linesOut += [ordered]@{ text = $lineText; words = $words }
    }
  }
  return [ordered]@{ text = $fullText.Replace("\\n", "`n"); lines = $linesOut; language = $lang }
}

# ============================================================================
# WGC window capture (Windows.Graphics.Capture): the fallback for surfaces
# that PrintWindow renders pitch black (UWP / WinUI / DirectComposition).
# Compiled to a cached DLL like the OCR helper; runs a short-lived STA pump
# thread to receive the WinRT FrameArrived event, grabs one frame, saves a PNG.
# ============================================================================
$script:WgcCs = @'
using System;
using System.Threading;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using Windows.Foundation;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;

public static class WgcCapture {
  const uint QS_ALLINPUT = 0x04FF;
  const uint WM_DESTROY = 0x0002;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct WNDCLASSEX {
    public uint cbSize; public uint style; public IntPtr lpfnWndProc;
    public int cbClsExtra; public int cbWndExtra; public IntPtr hInstance;
    public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground;
    public String lpszMenuName; public String lpszClassName; public IntPtr hIconSm;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int ptX; public int ptY; }

  [DllImport("user32.dll")] static extern bool RegisterClassEx(ref WNDCLASSEX wc);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr hInst, IntPtr param);
  [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int MsgWaitForMultipleObjects(int count, WaitHandle[] handles, bool wake, uint ms, uint flags);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern void PostQuitMessage(int code);

  delegate IntPtr WindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  static IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam) {
    if (msg == WM_DESTROY) { PostQuitMessage(0); return IntPtr.Zero; }
    return DefWindowProc(hwnd, msg, wParam, lParam);
  }

  // Capture one frame of the window to a PNG. Returns the PNG path on success,
  // null on timeout / no frame, throws on setup failure.
  public static string CaptureWindow(uint hwnd, int width, int height, string outPng, int timeoutMs) {
    ManualResetEvent done = new ManualResetEvent(false);
    Exception[] error = new Exception[1];
    bool[] got = new bool[1];

    Thread pump = new Thread(delegate () {
      try {
        WNDCLASSEX wc = new WNDCLASSEX();
        wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
        wc.lpfnWndProc = new WindowProc(WndProc);
        wc.lpszClassName = "WgcCapturePump" + Guid.NewGuid().ToString("N");
        RegisterClassEx(ref wc);
        CreateWindowEx(0, wc.lpszClassName, "wgc", 0, -32000, -32000, 1, 1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);

        GraphicsCaptureItem item = GraphicsCaptureItem.CreateFromWindowId(hwnd);
        SizeInt32 size;
        item.TryGetClosestSize((uint)width, out size);

        IDirect3DDevice device = null;
        Direct3D11FeatureLevel fl;
        Direct3D11CreateDevice(IntPtr.Zero, Direct3D11DriverType.Hardware, null, out device, out fl);

        GraphicsCaptureSession session = GraphicsCaptureSession.CreateAsync(item).GetAwaiter().GetResult();
        Direct3D11CaptureFramePool pool = Direct3D11CaptureFramePool.Create(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
        session.IsBorderRequired = false;
        try { session.IsCursorCaptureEnabled = true; } catch { }
        session.StartCapture(pool);

        pool.FrameArrived += delegate (Direct3D11CaptureFramePool sender, object args) {
          Direct3D11CaptureFrame frame = null;
          pool.TryGetNextFrame(out frame);
          try {
            if (frame != null) {
              IDirect3DSurface surface = frame.Surface;
              SoftwareBitmap bitmap = surface.AsSoftwareBitmap();
              int w = (int)bitmap.PixelWidth;
              int h = (int)bitmap.PixelHeight;
              int len = w * h * 4;
              PixelDataProvider provider = new PixelDataProvider();
              IntPtr head;
              bitmap.GetPixelData((uint)len, provider, out head);
              byte[] data = new byte[len];
              Marshal.Copy(head, data, 0, len);
              Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
              BitmapData bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
              Marshal.Copy(data, 0, bd.Scan0, len);
              bmp.UnlockBits(bd);
              bmp.Save(outPng, ImageFormat.Png);
              got[0] = true;
            }
          } catch (Exception ex) {
            error[0] = ex;
          } finally {
            done.Set();
            PostQuitMessage(got[0] ? 0 : 1);
          }
        };

        // Pump until the frame event or the timeout.
        bool finished = false;
        while (!finished) {
          int wait = MsgWaitForMultipleObjects(1, new WaitHandle[] { done }, false, 400, QS_ALLINPUT);
          if (wait == 0) { finished = true; break; }          // frame event
          if (wait == 0x102) { finished = true; break; }        // timeout slice
          MSG msg;
          while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
        }
        try { session.Dispose(); pool.Dispose(); device.Dispose(); } catch { }
      } catch (Exception ex) {
        error[0] = ex;
        done.Set();
      }
    });
    pump.IsBackground = true;
    pump.SetApartmentState(ApartmentState.STA);
    pump.Start();

    if (!done.WaitOne(timeoutMs)) {
      return null; // timeout: no frame arrived
    }
    if (error[0] != null) throw new Exception("WGC capture failed: " + error[0].Message, error[0]);
    return got[0] ? outPng : null;
  }
}
'@

function Get-WgcHelper {
  if ("WgcCapture" -as [type]) { return }
  if ($script:WgcCompileFailed) { throw "WGC helper previously failed to compile (missing .NET Core reference pack); WGC capture is disabled on this machine." }
  $dll = Join-Path $env:TEMP ("wcu-wgc-" + (Get-CsHash -Source $script:WgcCs) + ".dll")
  if (-not (Test-Path $dll)) {
    $wd = "C:\Windows\System32\WinMetadata"
    # Reference whichever graphics winmds exist: older Windows ships separate
    # Windows.Graphics.{DirectX,Direct3D11,Imaging,Capture}.winmd; Windows 11
    # 24H2+ consolidates them into Windows.Graphics.winmd.
    $cands = @("Windows.Graphics.Capture.winmd","Windows.Graphics.DirectX.Direct3D11.winmd","Windows.Graphics.DirectX.winmd","Windows.Graphics.Imaging.winmd","Windows.Graphics.winmd","Windows.Foundation.winmd")
    $need = @()
    foreach ($c in $cands) { if (Test-Path (Join-Path $wd $c)) { $need += (Join-Path $wd $c) } }
    if ($need.Count -lt 2) { throw "WGC unavailable: not enough WinRT graphics winmd found in $wd (requires Windows 10 1903+)." }
    $fw = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
    $csc = Join-Path $fw "csc.exe"
    if (-not (Test-Path $csc)) { throw "WGC unavailable: csc.exe not found." }
    $src = "$dll.cs"
    [System.IO.File]::WriteAllText($src, $script:WgcCs)
    $refArgs = $need | ForEach-Object { "/r:" + $_ }
    $refArgs += @("/r:System.dll", "/r:System.Drawing.dll", "/r:System.Runtime.WindowsRuntime.dll")
    # The consolidated WinRT winmds reference the .NET Core System.Runtime
    # facade (4.0.0.0, token b03f5f7f11d50a3f); the .NET Framework csc needs a
    # matching reference from the .NET Core REFERENCE pack (the shared runtime's
    # implementation assemblies pull in the non-referenceable
    # System.Private.CoreLib, so only the Microsoft.NETCore.App.Ref pack works).
    # If the ref pack is absent the compile fails and the capture chain degrades
    # to the screen-region fallback (handled by the caller's Invoke-Safe).
    $refPack = "C:\Program Files\dotnet\packs\Microsoft.NETCore.App.Ref"
    if (Test-Path $refPack) {
      $coreRef = Get-ChildItem $refPack -Recurse -Filter "System.Runtime.dll" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
      if ($coreRef) { $refArgs += ("/r:" + $coreRef) }
    }
    $cscArgs = @("/nologo", "/target:library", "/out:$dll") + $refArgs + @($src)
    $out = & $csc $cscArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
      $msg = (($out | Out-String).Trim())
      $script:WgcCompileFailed = $true
      throw "WGC helper compile failed: " + $msg.Substring(0, [Math]::Min(300, $msg.Length))
    }
  }
  [void][System.Reflection.Assembly]::LoadFrom($dll)
}

function Invoke-WgcCapture {
  # Capture one frame of the window via Windows.Graphics.Capture. Returns the
  # PNG path on success, $null on timeout / no frame, throws on setup failure.
  param([long]$Hwnd, [int]$Width, [int]$Height, [string]$OutPng, [int]$TimeoutMs = 4000)
  Get-WgcHelper
  return [WgcCapture]::CaptureWindow([uint32]$Hwnd, [int]$Width, [int]$Height, $OutPng, [int]$TimeoutMs)
}

function Resolve-TargetWindow {
  param([object]$InputObject)
  if (-not (Has-WindowTarget $InputObject)) { return $null }

  $hwnd = Get-Prop $InputObject "nativeWindowHandle" $null
  if ($null -ne $hwnd) {
    $element = Invoke-Safe { [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]$hwnd)) } $null
    if ($null -eq $element) { throw "No UI Automation window found for nativeWindowHandle '$hwnd'." }
    return $element
  }

  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $children = Get-Children -Element $root -ViewMode "control" -IncludeOffscreen $true
  $fallback = $null
  for ($i = 0; $i -lt $children.Count; $i++) {
    $el = $children.Item($i)
    $info = Convert-ElementInfo -Element $el -Id "uia:root.$i" -Depth 1
    if (Test-TargetMatch -Info $info -InputObject $InputObject) {
      if (-not $info.isOffscreen) { return $el }
      if ($null -eq $fallback) { $fallback = $el }
    }
  }
  if ($null -ne $fallback) { return $fallback }
  throw "No top-level window matched the requested target."
}

function Get-ScopeRoot {
  param([string]$Scope, [object]$InputObject = $null)
  if ($Scope -eq "desktop") {
    return [System.Windows.Automation.AutomationElement]::RootElement
  }

  $target = Resolve-TargetWindow $InputObject
  if ($null -ne $target) {
    if ([bool](Get-Prop $InputObject "activate" $false)) {
      [void](Set-WindowForeground $target)
    }
    return $target
  }

  $hwnd = [WindowsComputerUseNative]::GetForegroundWindow()
  if ($hwnd -ne [IntPtr]::Zero) {
    $element = Invoke-Safe { [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) } $null
    if ($null -ne $element) { return $element }
  }
  return [System.Windows.Automation.AutomationElement]::RootElement
}

# ============================================================================
# Tree + element resolution
# ============================================================================

function Get-Children {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [string]$ViewMode = "control",
    [bool]$IncludeOffscreen = $false
  )
  $items = New-Object "System.Collections.Generic.List[System.Windows.Automation.AutomationElement]"
  try {
    $condition = Get-ViewCondition -ViewMode $ViewMode -IncludeOffscreen $IncludeOffscreen
    $collection = $Element.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
  } catch {
    return ,$items
  }
  if ($null -eq $collection) { return ,$items }
  for ($i = 0; $i -lt $collection.Count; $i++) {
    $items.Add($collection.Item($i))
  }
  return ,$items
}

function Convert-Tree {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [string]$Path,
    [int]$Depth,
    [int]$MaxDepth,
    [ref]$Count,
    [int]$MaxNodes,
    [string]$ViewMode = "control",
    [bool]$IncludeOffscreen = $false,
    [string]$DetailLevel = "compact"
  )

  if ($Count.Value -ge $MaxNodes) { return $null }
  $id = "uia:$Path"
  $info = Convert-ElementInfo -Element $Element -Id $id -Depth $Depth -DetailLevel $DetailLevel
  $Count.Value = $Count.Value + 1
  $childrenOut = New-Object System.Collections.Generic.List[object]

  if ($Depth -lt $MaxDepth) {
    $children = Get-Children -Element $Element -ViewMode $ViewMode -IncludeOffscreen $IncludeOffscreen
    if ($null -ne $children) {
      for ($i = 0; $i -lt $children.Count; $i++) {
        if ($Count.Value -ge $MaxNodes) { break }
        $childPath = "$Path.$i"
        $child = Convert-Tree -Element $children.Item($i) -Path $childPath -Depth ($Depth + 1) -MaxDepth $MaxDepth -Count $Count -MaxNodes $MaxNodes -ViewMode $ViewMode -IncludeOffscreen $IncludeOffscreen -DetailLevel $DetailLevel
        if ($null -ne $child) { $childrenOut.Add($child) }
      }
    }
  }
  $info["children"] = @($childrenOut.ToArray())
  return $info
}

function Resolve-Element {
  param([string]$ElementId, [object]$InputObject = $null)
  if ([string]::IsNullOrWhiteSpace($ElementId)) {
    throw "elementId is required."
  }

  # Preferred form: uia:rt:<n>-<n>-... resolved by RuntimeId (stable for the
  # life of the owning process, immune to UI re-layouts).
  if ($ElementId -match '^uia:rt:(.+)$') {
    $rtParts = $Matches[1] -split '-'
    if ($rtParts.Count -lt 2) { throw "Malformed runtime element id '$ElementId'." }
    $rtArr = New-Object 'int[]' $rtParts.Count
    for ($i = 0; $i -lt $rtParts.Count; $i++) { $rtArr[$i] = [int]$rtParts[$i] }
    # Search the target window first, then the whole desktop as a fallback.
    $roots = @()
    if (Has-WindowTarget $InputObject) {
      $t = Invoke-Safe { Resolve-TargetWindow $InputObject } $null
      if ($null -ne $t) { $roots += $t }
    }
    $active = Invoke-Safe { Get-ScopeRoot "active_window" $InputObject } $null
    if ($null -ne $active -and $roots -notcontains $active) { $roots += $active }
    $rootEl = [System.Windows.Automation.AutomationElement]::RootElement
    if ($roots -notcontains $rootEl) { $roots += $rootEl }
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::RuntimeIdProperty, $rtArr)
    foreach ($root in $roots) {
      $found = Invoke-Safe { $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond) } $null
      if ($null -ne $found) { return $found }
    }
    throw "Element '$ElementId' no longer exists (stale — the control was removed or its app restarted). Re-run snapshot/tree to get fresh ids."
  }

  # Legacy form: uia:<active|root>.<index>.<index>... resolved by tree path.
  if ($ElementId -match '^uia:(active|root)(\.\d+)*$') {
    $path = $ElementId.Substring(4)
    $parts = $path.Split(".")
    $scopeName = $parts[0]
    $viewMode = Get-ViewMode $InputObject "control"
    $includeOffscreen = [bool](Get-Prop $InputObject "includeOffscreen" $false)
    $element = if ($scopeName -eq "root") {
      [System.Windows.Automation.AutomationElement]::RootElement
    } else {
      Get-ScopeRoot "active_window" $InputObject
    }
    for ($i = 1; $i -lt $parts.Length; $i++) {
      $index = [int]$parts[$i]
      $children = Get-Children -Element $element -ViewMode $viewMode -IncludeOffscreen $includeOffscreen
      if ($null -eq $children -or $index -lt 0 -or $index -ge $children.Count) {
        throw "Element path '$ElementId' is stale or out of range at segment $i."
      }
      $element = $children.Item($index)
    }
    return $element
  }

  throw "Unsupported element id '$ElementId'. Use an id from windows_computer_use_snapshot or windows_computer_use_accessibility_tree."
}

function Get-PointFromArgs {
  param([object]$InputObject)
  $elementId = Get-Prop $InputObject "elementId" $null
  if ($null -ne $elementId) {
    $el = Resolve-Element $elementId $InputObject
    $rect = Convert-Rect (Invoke-Safe { $el.Current.BoundingRectangle } $null)
    if ($null -eq $rect) { throw "Element '$elementId' has no clickable bounding box." }
    return [ordered]@{ x = $rect.centerX; y = $rect.centerY; element = $el; elementId = $elementId }
  }

  $x = Get-Prop $InputObject "x" $null
  $y = Get-Prop $InputObject "y" $null
  if ($null -eq $x -or $null -eq $y) {
    throw "Provide either elementId or x and y."
  }
  return [ordered]@{ x = [int]$x; y = [int]$y; element = $null; elementId = $null }
}

# ============================================================================
# Search
# ============================================================================

function Element-Matches {
  param([object]$Info, [string]$Query, [string]$ControlType)
  if (-not [string]::IsNullOrWhiteSpace($ControlType)) {
    if (($Info.controlType + "") -notlike "*$ControlType*") { return $false }
  }
  if ([string]::IsNullOrWhiteSpace($Query)) { return $true }
  $haystack = @(
    $Info.name,
    $Info.automationId,
    $Info.className,
    $Info.controlType,
    $Info.localizedControlType,
    $Info.value
  ) -join "`n"
  return $haystack.IndexOf($Query, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Search-Tree {
  param([object]$Node, [string]$Query, [string]$ControlType, [int]$MaxResults, [System.Collections.Generic.List[object]]$Results)
  if ($null -eq $Node -or $Results.Count -ge $MaxResults) { return }
  if (Element-Matches -Info $Node -Query $Query -ControlType $ControlType) {
    $copy = [ordered]@{}
    foreach ($prop in $Node.Keys) {
      if ($prop -ne "children") { $copy[$prop] = $Node[$prop] }
    }
    $Results.Add($copy)
  }
  foreach ($child in @($Node.children)) {
    if ($Results.Count -ge $MaxResults) { break }
    Search-Tree -Node $child -Query $Query -ControlType $ControlType -MaxResults $MaxResults -Results $Results
  }
}

# ============================================================================
# Input (modern SendInput path)
# ============================================================================

function Get-ButtonFlags {
  param([string]$Button)
  switch ($Button) {
      "right" { return @([uint32]0x0008, [uint32]0x0010) }
      "middle" { return @([uint32]0x0020, [uint32]0x0040) }
      default { return @([uint32]0x0002, [uint32]0x0004) }
  }
}

function Click-At {
  param([int]$X, [int]$Y, [string]$Button = "left", [int]$Count = 1)
  $flags = Get-ButtonFlags $Button
  [void][WindowsComputerUseNative]::SetCursorPos($X, $Y)
  Start-Sleep -Milliseconds 40
  for ($i = 0; $i -lt $Count; $i++) {
    [void][WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32]$flags[0], 0)
    Start-Sleep -Milliseconds 30
    [void][WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32]$flags[1], 0)
    Start-Sleep -Milliseconds 60
  }
}

function Move-ToPoint {
  param([int]$X, [int]$Y)
  [void][WindowsComputerUseNative]::SetCursorPos($X, $Y)
}

function Type-Text {
  param([string]$Text, [bool]$RestoreClipboard = $true)
  $hadText = $false
  $oldText = $null
  try {
    $hadText = [System.Windows.Forms.Clipboard]::ContainsText()
    if ($hadText) { $oldText = [System.Windows.Forms.Clipboard]::GetText() }
  } catch {
    $hadText = $false
  }

  [System.Windows.Forms.Clipboard]::SetText($Text)
  Start-Sleep -Milliseconds 50
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 80

  if ($RestoreClipboard) {
    try {
      if ($hadText) {
        [System.Windows.Forms.Clipboard]::SetText($oldText)
      } else {
        [System.Windows.Forms.Clipboard]::Clear()
      }
    } catch { }
  }
}

function Convert-KeyChord {
  param([object[]]$Keys)
  $mod = ""
  $main = $null
  foreach ($keyRaw in $Keys) {
    $key = ("" + $keyRaw).Trim()
    switch -Regex ($key.ToLowerInvariant()) {
        "^(ctrl|control)$" { $mod += "^"; continue }
        "^(alt|option)$" { $mod += "%"; continue }
        "^shift$" { $mod += "+"; continue }
        "^(cmd|meta|win|windows)$" { throw "The Windows key is blocked by design (it would open system dialogs such as Win+R / Win+L). Use a different key combination." }
        default { $main = $key }
    }
  }
  if ([string]::IsNullOrWhiteSpace($main)) { throw "A non-modifier key is required." }
  $special = @{
    "enter" = "{ENTER}"; "return" = "{ENTER}"; "tab" = "{TAB}"; "esc" = "{ESC}"; "escape" = "{ESC}"
    "backspace" = "{BACKSPACE}"; "delete" = "{DELETE}"; "del" = "{DELETE}"; "home" = "{HOME}"
    "end" = "{END}"; "pageup" = "{PGUP}"; "pagedown" = "{PGDN}"; "up" = "{UP}"; "down" = "{DOWN}"
    "left" = "{LEFT}"; "right" = "{RIGHT}"; "space" = " "; "insert" = "{INSERT}"
    "f1" = "{F1}"; "f2" = "{F2}"; "f3" = "{F3}"; "f4" = "{F4}"; "f5" = "{F5}"; "f6" = "{F6}"
    "f7" = "{F7}"; "f8" = "{F8}"; "f9" = "{F9}"; "f10" = "{F10}"; "f11" = "{F11}"; "f12" = "{F12}"
  }
  $lower = $main.ToLowerInvariant()
  $encoded = if ($special.ContainsKey($lower)) {
    $special[$lower]
  } elseif ($main.Length -eq 1) {
    $main.ToLowerInvariant()
  } else {
    "{" + $main.ToUpperInvariant() + "}"
  }
  return $mod + $encoded
}

function Invoke-ElementPattern {
  param([System.Windows.Automation.AutomationElement]$Element)
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern) } $false) {
    $pattern.Invoke()
    return "Invoke"
  }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern) } $false) {
    $pattern.Toggle()
    return "Toggle"
  }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern) } $false) {
    $pattern.Select()
    return "SelectionItem"
  }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern) } $false) {
    $state = Invoke-Safe { $pattern.Current.ExpandCollapseState } $null
    if ($state -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) {
      $pattern.Expand()
    } else {
      $pattern.Collapse()
    }
    return "ExpandCollapse"
  }
  return $null
}

function Set-ElementValue {
  param([System.Windows.Automation.AutomationElement]$Element, [string]$Value)
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) } $false) {
    $pattern.SetValue($Value)
    return "ValuePattern"
  }
  return $null
}

# ============================================================================
# Screenshot: window-crop (PrintWindow -> screen-region fallback) + downscale
# ============================================================================

function Get-ExtendedFrameBounds {
  param([long]$Hwnd)
  if (-not ($Hwnd -and $Hwnd -ne 0)) { return $null }
  $r = New-Object WindowsComputerUseNative+RECT
  $hr = Invoke-Safe { [WindowsComputerUseNative]::DwmGetWindowAttribute([IntPtr]$Hwnd, 9, [ref]$r, 16) } 0
  if ($hr -ne 0) { return $null }
  $w = $r.right - $r.left
  $h = $r.bottom - $r.top
  if ($w -le 0 -or $h -le 0) { return $null }
  return [ordered]@{ x = $r.left; y = $r.top; width = $w; height = $h }
}

function Try-PrintWindowCapture {
  # PrintWindow renders the window's own surface even when it is not the
  # foreground window. DirectComposition-backed surfaces (UWP/WinUI) can come
  # back pitch black — detect that and report failure so the caller falls
  # back to a screen-region capture.
  param([long]$Hwnd, [int]$Width, [int]$Height)
  if ($Width -le 0 -or $Height -le 0) { return $null }
  $bmp = New-Object System.Drawing.Bitmap $Width, $Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $hdc = $g.GetHdc()
    try {
      $ok = [WindowsComputerUseNative]::PrintWindow([IntPtr]$Hwnd, $hdc, 2)
    } finally {
      $g.ReleaseHdc($hdc)
    }
    if (-not $ok) { return $null }
    $allDark = $true
    for ($i = 0; $i -lt $Width; $i += 24) {
      for ($j = 0; $j -lt $Height; $j += 24) {
        $px = $bmp.GetPixel($i, $j)
        if ($px.R -gt 10 -or $px.G -gt 10 -or $px.B -gt 10) { $allDark = $false; break }
      }
      if (-not $allDark) { break }
    }
    if ($allDark) { return $null }
    return $bmp
  } finally {
    $g.Dispose()
  }
}

function Capture-Screenshot {
  param([object]$WindowElement = $null, [int]$MaxWidth = 1600)
  # GC: drop our own screenshot PNGs older than 30 minutes.
  $cutoff = [DateTimeOffset]::Now.AddMinutes(-30).UtcDateTime
  Get-ChildItem -Path $env:TEMP -Filter "windows-computer-use-*.png" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = $null
  $method = "screen"
  $occludedPossible = $false
  $windowCaptureFailed = $false
  $bx = $vs.Left; $by = $vs.Top; $bw = $vs.Width; $bh = $vs.Height

  if ($null -ne $WindowElement) {
    $hwnd = Invoke-Safe { [int64]$WindowElement.Current.NativeWindowHandle } 0
    $rect = $null
    if ($hwnd -and $hwnd -ne 0) { $rect = Get-ExtendedFrameBounds -Hwnd $hwnd }
    if ($null -eq $rect) { $rect = Convert-Rect (Invoke-Safe { $WindowElement.Current.BoundingRectangle } $null) }

    if ($null -ne $rect -and $hwnd -and $hwnd -ne 0) {
      $bmp = Invoke-Safe { Try-PrintWindowCapture -Hwnd $hwnd -Width $rect.width -Height $rect.height } $null
      if ($null -ne $bmp) {
        $method = "printwindow"
        $bx = $rect.x; $by = $rect.y; $bw = $rect.width; $bh = $rect.height
      } else {
        # PrintWindow came back black/failed (UWP/WinUI/DirectComposition).
        # Try Windows.Graphics.Capture: it reads the window's composited
        # frame from DWM, so it works even when the window is occluded.
        $wgcPng = Join-Path $env:TEMP ("wcu-wgc-" + [Guid]::NewGuid().ToString("N") + ".png")
        $wgc = Invoke-Safe { Invoke-WgcCapture -Hwnd $hwnd -Width $rect.width -Height $rect.height -OutPng $wgcPng -TimeoutMs 4000 } $null
        if ($null -ne $wgc -and (Test-Path $wgcPng)) {
          try {
            $src = New-Object System.Drawing.Bitmap($wgcPng)
            $dst = New-Object System.Drawing.Bitmap($src.Width, $src.Height)
            $g = [System.Drawing.Graphics]::FromImage($dst)
            try { $g.DrawImage($src, 0, 0) } finally { $g.Dispose() }
            $src.Dispose()
            $bmp = $dst
            $method = "wgc"
            $bx = $rect.x; $by = $rect.y; $bw = $rect.width; $bh = $rect.height
          } catch {
            $bmp = $null
          }
          Remove-Item $wgcPng -Force -ErrorAction SilentlyContinue
        }
        if ($null -eq $bmp) {
          # Last resort: the on-screen part of the window rect. This may show
          # whatever is covering the window — flagged, not hidden.
          $cx = [Math]::Max($rect.x, $vs.Left); $cy = [Math]::Max($rect.y, $vs.Top)
          $cx2 = [Math]::Min($rect.x + $rect.width, $vs.Left + $vs.Width)
          $cy2 = [Math]::Min($rect.y + $rect.height, $vs.Top + $vs.Height)
          if ($cx2 -gt $cx -and $cy2 -gt $cy) {
            $tmp = New-Object System.Drawing.Bitmap ($cx2 - $cx), ($cy2 - $cy)
            $g = [System.Drawing.Graphics]::FromImage($tmp)
            try { $g.CopyFromScreen($cx, $cy, 0, 0, $tmp.Size) } finally { $g.Dispose() }
            $bmp = $tmp
            $method = "screen-region"
            $occludedPossible = $true
            $bx = $cx; $by = $cy; $bw = $cx2 - $cx; $bh = $cy2 - $cy
          } else {
            $windowCaptureFailed = $true
          }
        }
      }
    } else {
      $windowCaptureFailed = $true
    }
  }

  if ($null -eq $bmp) {
    if ($windowCaptureFailed) {
      # Target window has no capturable surface (minimized/hidden): capture
      # the whole screen but say so explicitly instead of pretending.
      $windowCaptureFailed = $true
    }
    $bmp = New-Object System.Drawing.Bitmap $bw, $bh
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($bx, $by, 0, 0, $bmp.Size) } finally { $g.Dispose() }
  }

  $scale = 1.0
  if ($MaxWidth -gt 0 -and $bmp.Width -gt $MaxWidth) {
    $scale = [double]$MaxWidth / [double]$bmp.Width
    $nw = [int]$MaxWidth
    $nh = [int]($bmp.Height * $scale)
    if ($nh -lt 1) { $nh = 1 }
    $small = New-Object System.Drawing.Bitmap $nw, $nh
    $g2 = [System.Drawing.Graphics]::FromImage($small)
    try {
      $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g2.DrawImage($bmp, 0, 0, $nw, $nh)
    } finally { $g2.Dispose() }
    $bmp.Dispose()
    $bmp = $small
  }

  $file = Join-Path $env:TEMP ("windows-computer-use-" + [Guid]::NewGuid().ToString("N") + ".png")
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $bytes = [System.IO.File]::ReadAllBytes($file)

  $meta = [ordered]@{
    path = $file
    mimeType = "image/png"
    bytes = $bytes.Length
    method = $method
    bounds = [ordered]@{ x = $bx; y = $by; width = $bw; height = $bh }
  }
  if ($occludedPossible) { $meta["occludedPossible"] = $true }
  if ($windowCaptureFailed) { $meta["windowCaptureFailed"] = $true }
  if ($scale -ne 1.0) {
    $meta["imageScale"] = [Math]::Round($scale, 4)
    $meta["origin"] = [ordered]@{ x = $bx; y = $by }
  }
  $meta["base64"] = [Convert]::ToBase64String($bytes)
  return $meta
}

function Get-TreeResult {
  param([string]$Scope, [int]$MaxDepth, [int]$MaxNodes, [object]$InputObject = $null)
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $viewMode = Get-ViewMode $InputObject "control"
  $includeOffscreen = [bool](Get-Prop $InputObject "includeOffscreen" $false)
  $detailLevel = Get-DetailLevel $InputObject "compact"
  $root = Get-ScopeRoot $Scope $InputObject
  Update-WindowCache $root
  Update-WindowIdentity $InputObject $root
  $prefix = if ($Scope -eq "desktop") { "root" } else { "active" }
  $count = 0
  $tree = Convert-Tree -Element $root -Path $prefix -Depth 0 -MaxDepth $MaxDepth -Count ([ref]$count) -MaxNodes $MaxNodes -ViewMode $viewMode -IncludeOffscreen $includeOffscreen -DetailLevel $detailLevel
  $stopwatch.Stop()
  return [ordered]@{
    ok = $true
    scope = $Scope
    viewMode = $viewMode
    includeOffscreen = $includeOffscreen
    detailLevel = $detailLevel
    nodeCount = $count
    truncated = ($count -ge $MaxNodes)
    durationMs = [int]$stopwatch.ElapsedMilliseconds
    tree = $tree
  }
}

# ============================================================================
# Action dispatch (shared by one-shot and persistent modes)
# ============================================================================

function Invoke-Action {
  param([string]$Action, [object]$inputObject = $null)

  switch ($Action) {
    "health" {
      $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $active = Get-ScopeRoot "active_window"
      Update-WindowCache $active
      return ([ordered]@{
        ok = $true
        platform = "Windows"
        powershell = $PSVersionTable.PSVersion.ToString()
        mode = if ($Persistent) { "persistent" } else { "oneshot" }
        uiAutomation = $true
        screenshot = $true
        sendInput = $true
        postmessage = $true
        ocr = "lazy"
        homing = $true
        failsafe = ([string]$env:WCU_FAILSAFE -ne '0')
        activeWindow = Convert-ElementInfo -Element $active -Id "uia:active" -Depth 0
        virtualScreen = [ordered]@{ x = $screen.Left; y = $screen.Top; width = $screen.Width; height = $screen.Height }
      })
    }
    "snapshot" {
      $scope = Get-Prop $inputObject "scope" "active_window"
      $includeScreenshot = [bool](Get-Prop $inputObject "includeScreenshot" $true)
      $captureWindow = [bool](Get-Prop $inputObject "captureWindow" $false)
      $maxWidth = [int](Get-Prop $inputObject "maxWidth" 1600)
      $maxDepth = [int](Get-Prop $inputObject "maxDepth" 5)
      $maxNodes = [int](Get-Prop $inputObject "maxNodes" 250)
      $treeResult = Get-TreeResult -Scope $scope -MaxDepth $maxDepth -MaxNodes $maxNodes -InputObject $inputObject
      if ($includeScreenshot) {
        $winEl = $null
        if ($captureWindow) {
          $winEl = Invoke-Safe { Resolve-TargetWindow $inputObject } $null
          if ($null -eq $winEl -and $scope -ne "desktop") { $winEl = Invoke-Safe { Get-ScopeRoot $scope $inputObject } $null }
        }
        $treeResult.screenshot = Capture-Screenshot -WindowElement $winEl -MaxWidth $maxWidth
      }
      return $treeResult
    }
    "tree" {
      $scope = Get-Prop $inputObject "scope" "active_window"
      $maxDepth = [int](Get-Prop $inputObject "maxDepth" 6)
      $maxNodes = [int](Get-Prop $inputObject "maxNodes" 500)
      return (Get-TreeResult -Scope $scope -MaxDepth $maxDepth -MaxNodes $maxNodes -InputObject $inputObject)
    }
    "list_windows" {
      $includeInvisible = [bool](Get-Prop $inputObject "includeInvisible" $false)
      $maxWindows = [int](Get-Prop $inputObject "maxWindows" 50)
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $children = Get-Children -Element $root -ViewMode "control" -IncludeOffscreen $true
      $windows = New-Object System.Collections.Generic.List[object]
      for ($i = 0; $i -lt $children.Count; $i++) {
        if ($windows.Count -ge $maxWindows) { break }
        $el = $children.Item($i)
        $info = Convert-ElementInfo -Element $el -Id "uia:root.$i" -Depth 1
        Update-WindowCache $el
        if (-not $includeInvisible -and $info.isOffscreen) { continue }
        $windows.Add($info)
      }
      return ([ordered]@{ ok = $true; windows = @($windows.ToArray()) })
    }
    "find" {
      $query = Get-Prop $inputObject "query" ""
      $scope = Get-Prop $inputObject "scope" "active_window"
      $controlType = Get-Prop $inputObject "controlType" ""
      $maxDepth = [int](Get-Prop $inputObject "maxDepth" 8)
      $maxNodes = [int](Get-Prop $inputObject "maxNodes" 1200)
      $maxResults = [int](Get-Prop $inputObject "maxResults" 25)
      $findInput = [pscustomobject]@{
        viewMode = Get-ViewMode $inputObject "control"
        includeOffscreen = [bool](Get-Prop $inputObject "includeOffscreen" $false)
        detailLevel = "full"
        windowTitle = Get-Prop $inputObject "windowTitle" $null
        processId = Get-Prop $inputObject "processId" $null
        nativeWindowHandle = Get-Prop $inputObject "nativeWindowHandle" $null
        activate = [bool](Get-Prop $inputObject "activate" $false)
      }
      $treeResult = Get-TreeResult -Scope $scope -MaxDepth $maxDepth -MaxNodes $maxNodes -InputObject $findInput
      $results = New-Object System.Collections.Generic.List[object]
      Search-Tree -Node $treeResult.tree -Query $query -ControlType $controlType -MaxResults $maxResults -Results $results
      $out = [ordered]@{ ok = $true; query = $query; results = @($results.ToArray()); scannedNodes = $treeResult.nodeCount; truncated = $treeResult.truncated }
      if ($results.Count -eq 0 -and $treeResult.nodeCount -lt 10) {
        $out["hint"] = "UIA tree is sparse (fewer than 10 nodes): this app may not expose an accessibility tree (game / self-drawn Tk / Qt / canvas / RDP). Use the ocr tool to locate text by pixels."
      }
      return $out
    }
    "element_info" {
      $elementId = Get-Prop $inputObject "elementId" $null
      if ($null -ne $elementId) {
        $el = Resolve-Element $elementId $inputObject
        return ([ordered]@{ ok = $true; element = (Convert-ElementInfo -Element $el -Id $elementId -Depth 0) })
      } else {
        $x = [int](Get-Prop $inputObject "x" 0)
        $y = [int](Get-Prop $inputObject "y" 0)
        $point = New-Object System.Windows.Point($x, $y)
        $el = [System.Windows.Automation.AutomationElement]::FromPoint($point)
        return ([ordered]@{ ok = $true; point = [ordered]@{ x = $x; y = $y }; element = (Convert-ElementInfo -Element $el -Id $null -Depth 0) })
      }
    }
    "click" {
      [void](Test-Failsafe)
      $point = Get-PointFromArgs $inputObject
      $button = Get-Prop $inputObject "button" "left"
      $dispatch = [string](Get-Prop $inputObject "dispatch" "auto")
      $result = [ordered]@{ ok = $true; action = "click"; x = $point.x; y = $point.y; button = $button; elementId = $point.elementId }

      # Homing: if this window was observed before and moved, compensate.
      if ((Has-WindowTarget $inputObject) -and ($null -eq $point.elementId)) {
        $target = Resolve-TargetWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X $point.x -Y $point.y -Target $target
        $point.x = $homed.x
        $point.y = $homed.y
        if ($null -ne $homed.homed) { $result["homed"] = $homed.homed }
      }

      # Dispatch layering (cua-style): element clicks try the UIA pattern
      # first (background, verified semantic action); raw coordinates need
      # the system input queue (foreground SendInput) unless the caller
      # explicitly asks for background PostMessage.
      $useBackground = ($dispatch -eq "background") -or (($dispatch -eq "auto") -and ($null -ne $point.elementId))
      if ($useBackground) {
        if ($null -ne $point.elementId) {
          $patternMethod = Invoke-ElementPattern $point.element
          if ($null -ne $patternMethod) {
            $result["method"] = "background:$patternMethod"
            return $result
          }
        }
        $hwnd = 0
        if ($null -ne $point.element) { $hwnd = Invoke-Safe { [int64]$point.element.Current.NativeWindowHandle } 0 }
        if (-not ($hwnd -and $hwnd -ne 0)) { $hwnd = Resolve-TargetHwnd $inputObject }
        if (-not ($hwnd -and $hwnd -ne 0)) {
          throw "background_unavailable: no window handle to post to. Retry with dispatch:'foreground'."
        }
        if (-not (Post-BackgroundClick -Hwnd $hwnd -X $point.x -Y $point.y -Button $button -Count 1)) {
          throw "background_unavailable: PostMessage was refused. Retry with dispatch:'foreground'."
        }
        $result["method"] = "postmessage"
        $result["verified"] = $false
        $result["note"] = "Background click queued, delivery unverified. Chromium/Electron/UWP content may ignore PostMessage; if nothing happened, retry with dispatch:'foreground'."
        return $result
      }

      Click-At -X $point.x -Y $point.y -Button $button -Count 1
      $result["method"] = "sendinput"
      return $result
    }
    "double_click" {
      [void](Test-Failsafe)
      $point = Get-PointFromArgs $inputObject
      $button = Get-Prop $inputObject "button" "left"
      $dispatch = [string](Get-Prop $inputObject "dispatch" "auto")
      $result = [ordered]@{ ok = $true; action = "double_click"; x = $point.x; y = $point.y; button = $button; elementId = $point.elementId }
      if ((Has-WindowTarget $inputObject) -and ($null -eq $point.elementId)) {
        $target = Resolve-TargetWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X $point.x -Y $point.y -Target $target
        $point.x = $homed.x
        $point.y = $homed.y
        if ($null -ne $homed.homed) { $result["homed"] = $homed.homed }
      }
      if ($dispatch -eq "background") {
        $hwnd = 0
        if ($null -ne $point.element) { $hwnd = Invoke-Safe { [int64]$point.element.Current.NativeWindowHandle } 0 }
        if (-not ($hwnd -and $hwnd -ne 0)) { $hwnd = Resolve-TargetHwnd $inputObject }
        if (-not ($hwnd -and $hwnd -ne 0)) {
          throw "background_unavailable: no window handle to post to. Retry with dispatch:'foreground'."
        }
        if (-not (Post-BackgroundClick -Hwnd $hwnd -X $point.x -Y $point.y -Button $button -Count 2)) {
          throw "background_unavailable: PostMessage was refused. Retry with dispatch:'foreground'."
        }
        $result["method"] = "postmessage"
        $result["verified"] = $false
        $result["note"] = "Background double-click queued, delivery unverified (WM_LBUTTONDBLCLK). Retry with dispatch:'foreground' if nothing happened."
        return $result
      }
      Click-At -X $point.x -Y $point.y -Button $button -Count 2
      $result["method"] = "sendinput"
      return $result
    }
    "move" {
      [void](Test-Failsafe)
      $point = Get-PointFromArgs $inputObject
      $result = [ordered]@{ ok = $true; action = "move"; x = $point.x; y = $point.y; elementId = $point.elementId }
      if ((Has-WindowTarget $inputObject) -and ($null -eq $point.elementId)) {
        $target = Resolve-TargetWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X $point.x -Y $point.y -Target $target
        $point.x = $homed.x
        $point.y = $homed.y
        if ($null -ne $homed.homed) { $result["homed"] = $homed.homed }
      }
      Move-ToPoint -X $point.x -Y $point.y
      return $result
    }
    "drag" {
      [void](Test-Failsafe)
      Activate-TargetIfRequested $inputObject
      $path = @(Get-Prop $inputObject "path" @())
      if ($path.Count -lt 2) { throw "path must contain at least two points." }
      $button = Get-Prop $inputObject "button" "left"
      $flags = Get-ButtonFlags $button
      # Homing: shift the whole path if the target window moved since the
      # coordinates were observed.
      if (Has-WindowTarget $inputObject) {
        $target = Resolve-TargetWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X ([int]$path[0].x) -Y ([int]$path[0].y) -Target $target
        if ($null -ne $homed.homed) {
          $dx = $homed.homed.dx
          $dy = $homed.homed.dy
          $shifted = @()
          foreach ($pt in $path) { $shifted += [pscustomobject]@{ x = [int]$pt.x + $dx; y = [int]$pt.y + $dy } }
          $path = $shifted
        }
      }
      $first = $path[0]
      $last = $path[$path.Count - 1]
      [void][WindowsComputerUseNative]::SetCursorPos([int]$first.x, [int]$first.y)
      Start-Sleep -Milliseconds 50
      [void][WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32]$flags[0], 0)
      foreach ($pt in $path) {
        [void][WindowsComputerUseNative]::SetCursorPos([int]$pt.x, [int]$pt.y)
        Start-Sleep -Milliseconds 25
      }
      [void][WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32]$flags[1], 0)
      return ([ordered]@{ ok = $true; action = "drag"; points = $path.Count; button = $button })
    }
    "scroll" {
      [void](Test-Failsafe)
      $point = Get-PointFromArgs $inputObject
      $deltaY = [int](Get-Prop $inputObject "deltaY" 480)
      $deltaX = [int](Get-Prop $inputObject "deltaX" 0)
      if ((Has-WindowTarget $inputObject) -and ($null -eq $point.elementId)) {
        $target = Resolve-TargetWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X $point.x -Y $point.y -Target $target
        $point.x = $homed.x
        $point.y = $homed.y
      }
      if ($deltaY -ne 0 -or $deltaX -ne 0) {
        [void][WindowsComputerUseNative]::SetCursorPos($point.x, $point.y)
        Start-Sleep -Milliseconds 30
        if ($deltaY -ne 0) {
          [void][WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32][WindowsComputerUseNative]::MOUSEEVENTF_WHEEL, (-1 * $deltaY))
        }
        if ($deltaX -ne 0) {
          [void][WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32][WindowsComputerUseNative]::MOUSEEVENTF_HWHEEL, $deltaX)
        }
      }
      return ([ordered]@{ ok = $true; action = "scroll"; x = $point.x; y = $point.y; deltaX = $deltaX; deltaY = $deltaY; elementId = $point.elementId })
    }
    "type_text" {
      [void](Test-Failsafe)
      $method = [string](Get-Prop $inputObject "method" "clipboard")
      $text = [string](Get-Prop $inputObject "text" "")
      if ([string]::IsNullOrWhiteSpace($text)) { throw "text is required." }

      # Background path: post WM_CHAR straight into the target window's
      # message queue — no clipboard, no foreground, no system input queue.
      if ($method -eq "background") {
        if (-not (Has-WindowTarget $inputObject)) {
          throw "method:'background' requires a window target (windowTitle / processId / nativeWindowHandle)."
        }
        $hwnd = Resolve-TargetHwnd $inputObject
        if (-not ($hwnd -and $hwnd -ne 0)) { throw "No window handle found for the target." }
        $ok = Post-BackgroundText -Hwnd $hwnd -Text $text
        if (-not $ok) { throw "background_unavailable: some WM_CHAR messages were refused. Retry with method:'clipboard'." }
        return ([ordered]@{ ok = $true; action = "type_text"; length = $text.Length; method = "postmessage-wmchar"; verified = $false; note = "Background text queued, delivery unverified; controls that reject WM_CHAR (some custom UIs) need method:'clipboard'." })
      }

      # Foreground path (clipboard or sendinput): the target must be
      # foreground + focused. sendinput synthesizes Unicode key events
      # (KEYEVENTF_UNICODE) — no clipboard touched, so it also types into
      # password fields and other controls that reject paste.
      Activate-TargetIfRequested $inputObject
      Assert-TargetIsForeground $inputObject
      $focusedControl = $null
      $target = $null
      if (Has-WindowTarget $inputObject) {
        $target = Resolve-TargetWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $focusedControl = Focus-TextControl $target
      }
      $result = [ordered]@{ ok = $true; action = "type_text"; length = $text.Length; focusedControl = $focusedControl }
      if ($method -eq "sendinput") {
        $ok = [bool][WindowsComputerUseNative]::SendUnicodeText($text)
        if (-not $ok) { throw "method:'sendinput' dropped some key events (input queue full). Retry, or use method:'clipboard'." }
        $result["method"] = "sendinput-unicode"
        $result["note"] = "Synthesized Unicode key events; target was foreground + focused. Works on password fields (no paste)."
      } else {
        $restore = [bool](Get-Prop $inputObject "restoreClipboard" $true)
        Type-Text -Text $text -RestoreClipboard $restore
        $result["restoreClipboard"] = $restore
        $result["method"] = "clipboard-paste"
      }
      # Closed-loop verification: read back the value of the control we typed
      # into, so the model gets evidence instead of a blind "ok". (Skipped for
      # sendinput on password fields, which deliberately hide their value.)
      if ($method -ne "sendinput" -and $null -ne $focusedControl -and $null -ne $target) {
        $verify = Get-BestTextControl $target
        if ($null -ne $verify) {
          $val = Get-ValueText $verify
          if ($null -ne $val) { $result["verifyValue"] = if ($val.Length -gt 200) { $val.Substring(0, 200) + "..." } else { $val } }
        }
      }
      return $result
    }
    "keypress" {
      [void](Test-Failsafe)
      $dispatch = [string](Get-Prop $inputObject "dispatch" "foreground")
      $keys = @(Get-Prop $inputObject "keys" @())
      if (Has-WindowTarget $inputObject) {
        $ktarget = Resolve-TargetWindow $inputObject
        Assert-WindowIdentity $inputObject $ktarget
      }
      if ($dispatch -eq "background") {
        # Only a single printable character can be posted as WM_CHAR. Chords
        # and functional keys need the system input queue — say so honestly
        # instead of pretending (cua's background_unavailable pattern).
        if ($keys.Count -ne 1) {
          throw "background_unavailable: key chords and functional keys need the system input queue. Use dispatch:'foreground'."
        }
        $ch = [string]$keys[0]
        if ($ch.Length -ne 1) {
          throw "background_unavailable: only a single character can be posted in background. Use dispatch:'foreground' for functional keys."
        }
        if (-not (Has-WindowTarget $inputObject)) {
          throw "background dispatch requires a window target (windowTitle / processId / nativeWindowHandle)."
        }
        $hwnd = Resolve-TargetHwnd $inputObject
        if (-not ($hwnd -and $hwnd -ne 0)) { throw "No window handle found for the target." }
        $ok = [WindowsComputerUseNative]::PostMessageW([IntPtr]$hwnd, [WindowsComputerUseNative]::WM_CHAR, [IntPtr][int][char]$ch, [IntPtr]1)
        if (-not $ok) { throw "background_unavailable: WM_CHAR was refused. Use dispatch:'foreground'." }
        return ([ordered]@{ ok = $true; action = "keypress"; keys = $keys; method = "postmessage-wmchar"; verified = $false; note = "Background key queued, delivery unverified." })
      }
      Activate-TargetIfRequested $inputObject
      Assert-TargetIsForeground $inputObject
      $chord = Convert-KeyChord -Keys $keys
      [System.Windows.Forms.SendKeys]::SendWait($chord)
      return ([ordered]@{ ok = $true; action = "keypress"; keys = $keys; sendKeys = $chord; method = "sendkeys" })
    }
    "focus" {
      $elementId = [string](Get-Prop $inputObject "elementId" "")
      $el = Resolve-Element $elementId $inputObject
      $el.SetFocus()
      return ([ordered]@{ ok = $true; action = "focus"; elementId = $elementId })
    }
    "invoke" {
      $elementId = [string](Get-Prop $inputObject "elementId" "")
      $fallback = [bool](Get-Prop $inputObject "fallbackClick" $true)
      $el = Resolve-Element $elementId $inputObject
      $method = Invoke-ElementPattern $el
      if ($null -eq $method -and $fallback) {
        $rect = Convert-Rect (Invoke-Safe { $el.Current.BoundingRectangle } $null)
        if ($null -eq $rect) { throw "Element has no invokable pattern and no bounding box for fallback click." }
        Click-At -X $rect.centerX -Y $rect.centerY -Button "left" -Count 1
        $method = "ClickFallback"
      }
      if ($null -eq $method) { throw "Element has no supported invokable pattern." }
      return ([ordered]@{ ok = $true; action = "invoke"; elementId = $elementId; method = $method })
    }
    "set_value" {
      $elementId = [string](Get-Prop $inputObject "elementId" "")
      $value = [string](Get-Prop $inputObject "value" "")
      $fallback = [bool](Get-Prop $inputObject "fallbackType" $true)
      $restore = [bool](Get-Prop $inputObject "restoreClipboard" $true)
      $el = Resolve-Element $elementId $inputObject
      $method = Set-ElementValue $el -Value $value
      if ($null -eq $method -and $fallback) {
        $el.SetFocus()
        [System.Windows.Forms.SendKeys]::SendWait("^a")
        Type-Text -Text $value -RestoreClipboard $restore
        $method = "FocusSelectAllTypeFallback"
      }
      if ($null -eq $method) { throw "Element has no ValuePattern and fallbackType is false." }
      return ([ordered]@{ ok = $true; action = "set_value"; elementId = $elementId; method = $method; length = $value.Length })
    }
    "activate_window" {
      if (-not (Has-WindowTarget $inputObject)) { throw "Provide windowTitle, processId, or nativeWindowHandle." }
      $el = Resolve-TargetWindow $inputObject
      $activated = Set-WindowForeground $el
      Update-WindowCache $el
      Update-WindowIdentity $inputObject $el
      return ([ordered]@{ ok = $true; action = "activate_window"; activated = [bool]$activated; window = (Convert-ElementInfo -Element $el -Id "uia:active" -Depth 0) })
    }
    "cursor_pos" {
      $p = New-Object WindowsComputerUseNative+POINT
      [void][WindowsComputerUseNative]::GetCursorPos([ref]$p)
      return ([ordered]@{ ok = $true; x = $p.x; y = $p.y })
    }
    "screen_info" {
      # Diagnostics: raw virtual-screen metrics vs GDI+ virtual screen, so
      # coordinate-space mismatches (DPI awareness state) are visible.
      $p = New-Object WindowsComputerUseNative+POINT
      [void][WindowsComputerUseNative]::GetCursorPos([ref]$p)
      $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
      return ([ordered]@{
        ok = $true
        metrics = [ordered]@{
          xVirtualScreen = [WindowsComputerUseNative]::GetSystemMetrics(76)
          yVirtualScreen = [WindowsComputerUseNative]::GetSystemMetrics(77)
          cxVirtualScreen = [WindowsComputerUseNative]::GetSystemMetrics(78)
          cyVirtualScreen = [WindowsComputerUseNative]::GetSystemMetrics(79)
          primary = [ordered]@{ w = [WindowsComputerUseNative]::GetSystemMetrics(0); h = [WindowsComputerUseNative]::GetSystemMetrics(1) }
        }
        gdiVirtualScreen = [ordered]@{ x = $vs.Left; y = $vs.Top; width = $vs.Width; height = $vs.Height }
        cursor = [ordered]@{ x = $p.x; y = $p.y }
      })
    }
    "wait_for" {
      # Server-side polling: wait until a window appears/disappears (or
      # timeout). Saves the model from burning round-trips on sleeps.
      $title = [string](Get-Prop $inputObject "windowTitle" "")
      if ([string]::IsNullOrWhiteSpace($title)) { throw "windowTitle is required for wait_for." }
      $appear = [bool](Get-Prop $inputObject "appear" $true)
      $timeoutMs = [int](Get-Prop $inputObject "timeoutMs" 5000)
      $intervalMs = [int](Get-Prop $inputObject "intervalMs" 250)
      if ($intervalMs -lt 50) { $intervalMs = 50 }
      if ($timeoutMs -lt 100) { $timeoutMs = 100 }
      $start = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
      while ($true) {
        $found = $false
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $children = Get-Children -Element $root -ViewMode "control" -IncludeOffscreen $true
        for ($i = 0; $i -lt $children.Count; $i++) {
          $name = Invoke-Safe { $children.Item($i).Current.Name } ""
          if (($name + "").IndexOf($title, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $found = $true; break }
        }
        $hit = if ($appear) { $found } else { -not $found }
        $elapsed = [int]([DateTimeOffset]::Now.ToUnixTimeMilliseconds() - $start)
        if ($hit) {
          return ([ordered]@{ ok = $true; action = "wait_for"; found = $found; waitedMs = $elapsed })
        }
        if ($elapsed -ge $timeoutMs) {
          return ([ordered]@{ ok = $true; action = "wait_for"; found = $found; timedOut = $true; waitedMs = $elapsed })
        }
        Start-Sleep -Milliseconds $intervalMs
      }
    }
    "close_window" {
      # Graceful close: post WM_CLOSE (the app can veto it with a save dialog),
      # unlike killing the process.
      if (-not (Has-WindowTarget $inputObject)) { throw "Provide windowTitle, processId, or nativeWindowHandle." }
      $hwnd = Resolve-TargetHwnd $inputObject
      if (-not ($hwnd -and $hwnd -ne 0)) { throw "No window handle found for the target." }
      $posted = [WindowsComputerUseNative]::PostMessageW([IntPtr]$hwnd, [WindowsComputerUseNative]::WM_CLOSE, [IntPtr]0, [IntPtr]0)
      return ([ordered]@{ ok = $true; action = "close_window"; posted = [bool]$posted })
    }
    "move_window" {
      # Move (not resize) the target window. SWP_NOACTIVATE: does not steal
      # foreground. Note: maximized windows are not moved by Windows.
      if (-not (Has-WindowTarget $inputObject)) { throw "Provide windowTitle, processId, or nativeWindowHandle." }
      $x = Get-Prop $inputObject "x" $null
      $y = Get-Prop $inputObject "y" $null
      if ($null -eq $x -or $null -eq $y) { throw "x and y are required for move_window." }
      $el = Resolve-TargetWindow $inputObject
      $hwnd = Invoke-Safe { [int64]$el.Current.NativeWindowHandle } 0
      if (-not ($hwnd -and $hwnd -ne 0)) { throw "No window handle found for the target." }
      $flags = [uint32]([WindowsComputerUseNative]::SWP_NOSIZE -bor [WindowsComputerUseNative]::SWP_NOZORDER -bor [WindowsComputerUseNative]::SWP_NOACTIVATE)
      $ok = [WindowsComputerUseNative]::SetWindowPos([IntPtr]$hwnd, [IntPtr]::Zero, [int]$x, [int]$y, 0, 0, $flags)
      return ([ordered]@{ ok = $true; action = "move_window"; moved = [bool]$ok; x = [int]$x; y = [int]$y; note = if ($ok) { $null } else { "SetWindowPos refused (window may be maximized)." } })
    }
    "ocr" {
      # OCR the target window (or the whole desktop) — the fallback for
      # UIA-blind apps (games, self-drawn Tk/Qt, RDP, canvases). Word boxes
      # come back in SCREEN coordinates. With `query`, matched words are also
      # upgraded to the underlying UIA control (FromPoint), so the model can
      # then invoke/click the real control instead of the glyph.
      $scope = Get-Prop $inputObject "scope" "active_window"
      $maxWidth = [int](Get-Prop $inputObject "maxWidth" 1920)
      $query = [string](Get-Prop $inputObject "query" "")
      $winEl = $null
      if (Has-WindowTarget $inputObject) {
        $winEl = Resolve-TargetWindow $inputObject
      } elseif ($scope -ne "desktop") {
        $winEl = Get-ScopeRoot $scope $inputObject
      }
      $shot = Capture-Screenshot -WindowElement $winEl -MaxWidth $maxWidth
      if ($shot.windowCaptureFailed) { throw "OCR target has no capturable surface (minimized/hidden?). Restore the window and retry." }
      $origX = [int]$shot.bounds.x
      $origY = [int]$shot.bounds.y
      $scale = 1.0
      if ($null -ne $shot.imageScale) { $scale = [double]$shot.imageScale }
      $ocr = Invoke-Ocr -PngPath $shot.path
      $lines = @()
      foreach ($line in $ocr.lines) {
        $words = @()
        foreach ($w in $line.words) {
          $words += [ordered]@{
            text = $w.text
            x = [int]($origX + ($w.x / $scale))
            y = [int]($origY + ($w.y / $scale))
            width = [int]($w.width / $scale)
            height = [int]($w.height / $scale)
          }
        }
        $lines += [ordered]@{ text = $line.text; words = $words }
      }
      # OCR -> control upgrade: for lines containing the query, hit-test the
      # matched word's center with UIA FromPoint and report the control there.
      $matched = @()
      if ($query.Length -gt 0 -and $lines.Count -gt 0) {
        foreach ($line in $lines) {
          if ($matched.Count -ge 3) { break }
          $lineText = [string]$line.text
          $idx = $lineText.IndexOf($query, [System.StringComparison]::OrdinalIgnoreCase)
          if ($idx -lt 0) { continue }
          $words = @($line.words)
          if ($words.Count -eq 0) { continue }
          # Map the match's char offset to a word (words join with one space).
          $pos = 0
          $word = $words[0]
          foreach ($w in $words) {
            $wlen = ([string]$w.text).Length
            if ($pos -le $idx -and $idx -lt ($pos + $wlen)) { $word = $w; break }
            $pos += $wlen + 1
          }
          $wx = [int]([int]$word.x + [int]($word.width / 2))
          $wy = [int]([int]$word.y + [int]($word.height / 2))
          $ctl = $null
          $el = Invoke-Safe { [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($wx, $wy))) } $null
          if ($null -ne $el) {
            $ctl = [ordered]@{
              controlType = Get-ControlTypeName (Invoke-Safe { $el.Current.ControlType } $null)
              name = Invoke-Safe { $el.Current.Name } ""
              automationId = Invoke-Safe { $el.Current.AutomationId } ""
              className = Invoke-Safe { $el.Current.ClassName } ""
              boundingBox = Convert-Rect (Invoke-Safe { $el.Current.BoundingRectangle } $null)
            }
          }
          $matched += [ordered]@{ line = $lineText; word = [ordered]@{ text = $word.text; x = $wx; y = $wy }; control = $ctl }
        }
      }
      $result = [ordered]@{
        ok = $true
        action = "ocr"
        text = $ocr.text
        lines = $lines
        image = $shot.path
        imageBounds = $shot.bounds
        source = if ($winEl -ne $null) { "window" } else { "desktop" }
      }
      if ($query.Length -gt 0) {
        $result["query"] = $query
        $result["matched"] = $matched
        if ($matched.Count -eq 0) { $result["note"] = "No OCR line contained the query; the text may be split across words differently. Try a shorter query or read 'lines' directly." }
      }
      return $result
    }
    "wait" {
      $milliseconds = [int](Get-Prop $inputObject "milliseconds" 500)
      Start-Sleep -Milliseconds $milliseconds
      return ([ordered]@{ ok = $true; action = "wait"; milliseconds = $milliseconds })
    }
    default {
      return $null
    }
  }
}

# ============================================================================
# Entry points
# ============================================================================

Load-Assemblies
Set-DpiAware

if ($Persistent) {
  # Persistent mode: one JSON request per stdin line, one JSON response per
  # stdout line. Stays alive between actions so repeated calls skip process
  # startup, assembly loading and native-DLL resolution entirely.
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $req = $null
    try { $req = $line | ConvertFrom-Json } catch { continue }
    $id = Get-Prop $req "id" 0
    $name = [string](Get-Prop $req "action" "")
    $result = $null
    try {
      $result = Invoke-Action -Action $name -InputObject (Get-Prop $req "args" $null)
      if ($null -eq $result) { throw "Unknown action '$name'." }
    } catch {
      $result = [ordered]@{
        ok = $false
        action = $name
        error = $_.Exception.Message
        category = $_.CategoryInfo.Category.ToString()
        scriptStackTrace = $_.ScriptStackTrace
      }
    }
    $result["id"] = $id
    Write-Host ($result | ConvertTo-Json -Depth 50 -Compress)
    [Console]::Out.Flush()
  }
  exit 0
} else {
  if ([string]::IsNullOrWhiteSpace($Action)) {
    Write-Host ([ordered]@{ ok = $false; error = "No action given. Pass -Action <name>, or run with -Persistent for the line protocol." } | ConvertTo-Json -Depth 50 -Compress)
    exit 1
  }
  $inputObject = Get-InputObject
  $result = $null
  try {
    $result = Invoke-Action -Action $Action -InputObject $inputObject
    if ($null -eq $result) { throw "Unknown action '$Action'." }
  } catch {
    $result = [ordered]@{
      ok = $false
      action = $Action
      error = $_.Exception.Message
      category = $_.CategoryInfo.Category.ToString()
      scriptStackTrace = $_.ScriptStackTrace
    }
  }
  Write-Host ($result | ConvertTo-Json -Depth 50 -Compress)
  if (-not $result.ok) { exit 1 }
  exit 0
}
