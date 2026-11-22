param(
  [Parameter(Mandatory = $false)]
  [string]$Action,
  [switch]$Persistent
)

$ErrorActionPreference = "Stop"
$loader = Join-Path $PSScriptRoot 'native-loader.ps1'
if ([IO.File]::Exists($loader)) { . $loader }
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:BackendStartupWatch = [System.Diagnostics.Stopwatch]::StartNew()
$script:BackendStage = 'start'
function Write-BackendStage {
  param([string]$Stage)
  $script:BackendStage = $Stage
  if ([string]$env:WCU_BACKEND_TRACE -eq '1') {
    [Console]::Error.WriteLine(('stage={0} elapsedMs={1}' -f $Stage, $script:BackendStartupWatch.ElapsedMilliseconds))
  }
}

# ============================================================================
# Win Computer Use — Windows desktop engine for the dsh-computer-use-win MCP server
#
# Modes:
#   -One-shot:  windows-uia.ps1 -Action <name>        (args: JSON on stdin)
#   -Persistent: windows-uia.ps1 -Persistent          (args: JSON lines on stdin,
#                one JSON line response per line on stdout; keeps the process
#                alive so repeated actions skip PowerShell startup, assembly
#                loading and C# compilation)
# ============================================================================

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
  if ($Object -is [System.Collections.IDictionary]) {
    if ($Object.Contains($Name) -and $null -ne $Object[$Name]) { return $Object[$Name] }
    return $Default
  }
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
  param([string]$ViewMode = "control", [bool]$IncludeOffscreen = $false, [switch]$SkipOffscreenFilter)
  $condition = switch ($ViewMode) {
      "raw" { [System.Windows.Automation.Automation]::RawViewCondition }
      "content" { [System.Windows.Automation.Automation]::ContentViewCondition }
      default { [System.Windows.Automation.Automation]::ControlViewCondition }
  }
  if ($null -eq $condition) {
    $condition = [System.Windows.Automation.Condition]::TrueCondition
  }
  if (-not $IncludeOffscreen -and -not $SkipOffscreenFilter) {
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
  // Shared with the stop listener. Remote-control input without this marker
  // remains eligible for Esc / the configured stop shortcut.
  public static readonly uint InputMarker = ParseInputMarker();
  private static uint ParseInputMarker() {
    string raw = Environment.GetEnvironmentVariable("WCU_INPUT_MARKER");
    if (!String.IsNullOrEmpty(raw)) {
      string s = raw.Trim();
      uint parsed;
      if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) {
        if (uint.TryParse(s.Substring(2), System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out parsed) && parsed != 0u) return parsed;
      } else if (uint.TryParse(s, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out parsed) && parsed != 0u) return parsed;
    }
    return 0x44534857u;
  }
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);
  [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
  public static bool IsInputDesktopAvailable() {
    IntPtr d = OpenInputDesktop(0, false, 0x0100u);
    if (d == IntPtr.Zero) return false;
    CloseDesktop(d);
    return true;
  }

  private const uint ProcessQueryLimitedInformation = 0x1000, TokenQuery = 0x0008;
  private const uint StillActive = 259;
  private const int TokenIntegrityLevel = 25, ErrorInvalidParameter = 87, ErrorInsufficientBuffer = 122;
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
  private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, System.Text.StringBuilder path, ref uint length);
  [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, uint length, out uint required);

  public sealed class InputProcessIdentity {
    public bool Gone;
    public string ImagePath;
    public uint? Integrity;
    public bool TokenAccessDenied;
  }

  private static string GetImagePath(IntPtr process) {
    uint size = 512;
    var path = new System.Text.StringBuilder((int)size);
    if (QueryFullProcessImageNameW(process, 0, path, ref size)) return path.ToString();
    if (Marshal.GetLastWin32Error() != ErrorInsufficientBuffer) return null;
    size = 32768;
    path = new System.Text.StringBuilder((int)size);
    return QueryFullProcessImageNameW(process, 0, path, ref size) ? path.ToString() : null;
  }

  private static uint? GetProcessIntegrity(IntPtr process, out bool tokenAccessDenied) {
    tokenAccessDenied = false;
    IntPtr token;
    if (!OpenProcessToken(process, TokenQuery, out token)) {
      tokenAccessDenied = Marshal.GetLastWin32Error() == 5;
      return null;
    }
    try {
      uint size;
      GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out size);
      if (Marshal.GetLastWin32Error() != ErrorInsufficientBuffer || size < IntPtr.Size || size > 4096) return null;
      IntPtr data = Marshal.AllocHGlobal((int)size);
      try {
        if (!GetTokenInformation(token, TokenIntegrityLevel, data, size, out size)) return null;
        // TOKEN_MANDATORY_LABEL starts with the SID pointer in SID_AND_ATTRIBUTES.
        IntPtr sid = Marshal.ReadIntPtr(data);
        if (sid == IntPtr.Zero) return null;
        string label = new System.Security.Principal.SecurityIdentifier(sid).Value;
        const string integrityAuthority = "S-1-16-";
        uint rid;
        if (!label.StartsWith(integrityAuthority, StringComparison.Ordinal) ||
            !UInt32.TryParse(label.Substring(integrityAuthority.Length), out rid)) return null;
        return rid;
      } finally { Marshal.FreeHGlobal(data); }
    } finally { CloseHandle(token); }
  }

  public static uint? ReadCurrentIntegrity() {
    bool ignored;
    return GetProcessIntegrity(GetCurrentProcess(), out ignored);
  }

  public static InputProcessIdentity ReadInputProcess(uint pid, bool checkImage) {
    // Use a single query-only handle for the image, token and liveness of the
    // same process. No permission to write to or modify the target is requested.
    IntPtr process = OpenProcess(ProcessQueryLimitedInformation, false, pid);
    if (process == IntPtr.Zero)
      return new InputProcessIdentity { Gone = Marshal.GetLastWin32Error() == ErrorInvalidParameter };
    try {
      var identity = new InputProcessIdentity { ImagePath = checkImage ? GetImagePath(process) : null };
      identity.Integrity = GetProcessIntegrity(process, out identity.TokenAccessDenied);
      uint exitCode;
      if (!GetExitCodeProcess(process, out exitCode)) return new InputProcessIdentity();
      if (exitCode != StillActive) return new InputProcessIdentity { Gone = true };
      return identity;
    } finally { CloseHandle(process); }
  }

  private static INPUT KeyInput(int key, bool up) {
    var input = new INPUT(); input.type=1; input.U.ki.wVk=(ushort)key;
    input.U.ki.dwFlags=(up?2u:0u) | ((key>=0x21&&key<=0x2E)?1u:0u);
    input.U.ki.dwExtraInfo=new IntPtr((long)(ulong)InputMarker); return input;
  }
  public static INPUT[] KeyChordPacket(string[] keys, int heldModifiers) {
    int modifiers=0, main=0, mainCount=0;
    foreach(string raw in keys) {
      string key=(raw??"").Trim().ToLowerInvariant();
      if(key=="ctrl"||key=="control"){modifiers|=2;continue;}
      if(key=="alt"||key=="option"){modifiers|=4;continue;}
      if(key=="shift"){modifiers|=1;continue;}
      if(key=="win"||key=="windows"||key=="cmd"||key=="meta")throw new ArgumentException("The Windows key is blocked by design.");
      mainCount++;
      switch(key) {
        case "enter":case "return":main=0x0D;break;
        case "tab":main=9;break;
        case "esc":case "escape":main=0x1B;break;
        case "backspace":case "bs":case "bksp":main=8;break;
        case "delete":case "del":main=0x2E;break;
        case "home":main=0x24;break;case "end":main=0x23;break;
        case "pageup":case "pgup":main=0x21;break;case "pagedown":case "pgdn":main=0x22;break;
        case "up":main=0x26;break;case "down":main=0x28;break;case "left":main=0x25;break;case "right":main=0x27;break;
        case "space":main=0x20;break;case "insert":case "ins":main=0x2D;break;
        case "capslock":main=0x14;break;case "numlock":main=0x90;break;case "scrolllock":main=0x91;break;
        case "pause":case "break":main=0x13;break;case "printscreen":case "prtsc":main=0x2C;break;
        case "add":main=0x6B;break;case "subtract":main=0x6D;break;case "multiply":main=0x6A;break;case "divide":main=0x6F;break;
        default:
          int number;
          if(key.Length>1&&key[0]=='f'&&int.TryParse(key.Substring(1),out number)&&number>=1&&number<=24)main=0x6F+number;
          else if(key.Length==1){int mapped=VkKeyScanW(key[0]);if(mapped==-1)throw new ArgumentException("Key cannot be mapped in the active keyboard layout.");main=mapped&255;modifiers|=(mapped>>8)&7;}
          else throw new ArgumentException("Unsupported key: "+key);
          break;
      }
    }
    if(mainCount!=1)throw new ArgumentException("Exactly one non-modifier key is required.");
    if((heldModifiers&~modifiers)!=0)throw new InvalidOperationException("COMPUTER_USE_MODIFIERS_HELD: Release other modifiers before this chord; no input was sent.");
    var packet=new System.Collections.Generic.List<INPUT>();
    int[] bits={2,4,1}, codes={0x11,0x12,0x10};
    for(int i=0;i<bits.Length;i++)if((modifiers&bits[i])!=0&&(heldModifiers&bits[i])==0)packet.Add(KeyInput(codes[i],false));
    packet.Add(KeyInput(main,false));packet.Add(KeyInput(main,true));
    for(int i=bits.Length-1;i>=0;i--)if((modifiers&bits[i])!=0&&(heldModifiers&bits[i])==0)packet.Add(KeyInput(codes[i],true));
    return packet.ToArray();
  }
  public static bool SendKeyChord(string[] keys) {
    int held=0;
    if((GetAsyncKeyState(0x10)&0x8000)!=0)held|=1;
    if((GetAsyncKeyState(0x11)&0x8000)!=0)held|=2;
    if((GetAsyncKeyState(0x12)&0x8000)!=0)held|=4;
    if((GetAsyncKeyState(0x5B)&0x8000)!=0||(GetAsyncKeyState(0x5C)&0x8000)!=0)held|=8;
    INPUT[] packet=KeyChordPacket(keys,held);ThrowIfCancelled();
    uint sent=SendInput((uint)packet.Length,packet,Marshal.SizeOf(typeof(INPUT)));
    if(sent==(uint)packet.Length)return true;
    // Undo only our own still-held keys after a partial packet. Never release
    // modifiers the user was already holding, or replay the accepted prefix.
    var down=new System.Collections.Generic.List<int>();
    for(int i=0;i<(int)sent;i++){int vk=packet[i].U.ki.wVk;if((packet[i].U.ki.dwFlags&2)==0)down.Add(vk);else down.Remove(vk);}
    for(int i=down.Count-1;i>=0;i--)SendInput(1,new[]{KeyInput(down[i],true)},Marshal.SizeOf(typeof(INPUT)));
    return false;
  }
  private static System.Threading.EventWaitHandle cancellation;
  private static System.Diagnostics.Process stopListener;
  private static System.Threading.EventWaitHandle stopReady;
  public static void SetStopListener(int processId) {
    if (stopListener != null && stopListener.Id == processId) return;
    if (stopListener != null) stopListener.Dispose();
    stopListener = null;
    if (processId <= 0) return;
    try { stopListener = System.Diagnostics.Process.GetProcessById(processId); }
    catch (ArgumentException) { throw new OperationCanceledException("COMPUTER_USE_STOP_LISTENER_UNAVAILABLE"); }
  }
  public static void ThrowIfCancelled() {
    string name = Environment.GetEnvironmentVariable("WCU_CANCEL_EVENT");
    if (String.IsNullOrEmpty(name)) return;
    if (stopListener != null && stopListener.HasExited) throw new OperationCanceledException("COMPUTER_USE_STOP_LISTENER_UNAVAILABLE");
    if (cancellation == null) {
      try { cancellation = System.Threading.EventWaitHandle.OpenExisting(name); }
      catch (System.Threading.WaitHandleCannotBeOpenedException) { throw new OperationCanceledException("COMPUTER_USE_STOP_LISTENER_UNAVAILABLE"); }
    }
    if (cancellation.WaitOne(0)) throw new OperationCanceledException("COMPUTER_USE_STOPPED_BY_USER");
    string ready=Environment.GetEnvironmentVariable("WCU_READY_EVENT");
    if(!String.IsNullOrEmpty(ready)){
      if(stopReady==null)try{stopReady=System.Threading.EventWaitHandle.OpenExisting(ready);}catch(System.Threading.WaitHandleCannotBeOpenedException){throw new OperationCanceledException("COMPUTER_USE_STOP_LISTENER_UNAVAILABLE");}
      if(!stopReady.WaitOne(0))throw new OperationCanceledException("COMPUTER_USE_STOP_LISTENER_UNAVAILABLE");
    }
  }
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
    mi.time = 0; mi.dwExtraInfo = new IntPtr((long)(ulong)InputMarker);
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = 0; // INPUT_MOUSE
    inputs[0].U.mi = mi;
    return SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  // Absolute coordinates require VIRTUALDESK and pixel-center normalization.
  // Omitting VIRTUALDESK maps a multi-monitor point to the primary display.
  public static INPUT[] ClickPacket(int x, int y, int left, int top,
      int width, int height, uint down, uint up) {
    if (width <= 0 || height <= 0 || width > 65536 || height > 65536 ||
        (long)x < left || (long)x >= (long)left + width ||
        (long)y < top || (long)y >= (long)top + height)
      throw new ArgumentOutOfRangeException("point", "Point or virtual screen cannot be mapped exactly.");
    INPUT[] packet = new INPUT[3];
    packet[0].type = packet[1].type = packet[2].type = 0;
    packet[0].U.mi.dx = (int)(((2L * ((long)x - left) + 1) * 65536) / (2L * width));
    packet[0].U.mi.dy = (int)(((2L * ((long)y - top) + 1) * 65536) / (2L * height));
    packet[0].U.mi.dwFlags = 0x0001 | 0x8000 | 0x4000;
    packet[1].U.mi.dwFlags = down;
    packet[2].U.mi.dwFlags = up;
    for(int i=0;i<packet.Length;i++)packet[i].U.mi.dwExtraInfo=new IntPtr((long)(ulong)InputMarker);
    return packet;
  }

  public static uint SendClick(int x, int y, uint down, uint up) {
    INPUT[] packet = ClickPacket(x, y, GetSystemMetrics(76), GetSystemMetrics(77),
      GetSystemMetrics(78), GetSystemMetrics(79), down, up);
    ThrowIfCancelled();
    uint sent = SendInput(3, packet, Marshal.SizeOf(typeof(INPUT)));
    // A partial batch can leave the button down. Release it before reporting
    // failure; never replay the click, which might already have taken effect.
    if (sent == 2) SendMouseEvent(0, 0, up, 0);
    return sent;
  }

  public const uint KEYEVENTF_UNICODE = 0x0004;

  // Synthesize the text as Unicode key events (KEYEVENTF_UNICODE). No clipboard
  // is touched, so this also works on password fields and other controls that
  // reject paste. The target control must be foreground + focused. Returns
  // false if any input event was dropped or the target lost focus.
  public static bool SendUnicodeText(string text, IntPtr front, IntPtr focus) {
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
      inputs[n].U.ki.dwExtraInfo = new IntPtr((long)(ulong)InputMarker);
      n++;
      // release
      inputs[n].type = 1;
      inputs[n].U.ki.wVk = 0;
      inputs[n].U.ki.wScan = ch;
      inputs[n].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      inputs[n].U.ki.time = 0;
      inputs[n].U.ki.dwExtraInfo = new IntPtr((long)(ulong)InputMarker);
      n++;
    }
    int sent = 0;
    int size = Marshal.SizeOf(typeof(INPUT));
    while (sent < n) {
      ThrowIfCancelled();
      if (GetForegroundWindow() != front || FocusedWindow(front) != focus) return false;
      int chunk = Math.Min(64, n - sent);
      if (sent + chunk < n && Char.IsHighSurrogate(chars[(sent + chunk) / 2 - 1]) &&
          Char.IsLowSurrogate(chars[(sent + chunk) / 2])) chunk -= 2;
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


  public delegate bool EnumWindowsCallback(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder text, int count);
  public static IntPtr[] TopLevelWindows() {
    var result = new System.Collections.Generic.List<IntPtr>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr data) { result.Add(hwnd); return true; }, IntPtr.Zero);
    return result.ToArray();
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct LaunchStartup {
    public int Size;
    public string Reserved, Desktop, Title;
    public uint X,Y,Width,Height,Columns,Rows,Fill,Flags;
    public ushort Show,ReservedSize;
    public IntPtr ReservedData,Input,Output,Error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct LaunchProcess {
    public IntPtr Process,Thread;
    public uint ProcessId,ThreadId;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateProcess(string application, System.Text.StringBuilder command,
    IntPtr processAttrs, IntPtr threadAttrs, bool inheritHandles, uint flags,
    IntPtr environment, string directory, ref LaunchStartup startup, out LaunchProcess process);
  public static uint StartBackgroundProgram(string executable, string arguments, string directory) {
    var startup = new LaunchStartup { Size=Marshal.SizeOf(typeof(LaunchStartup)) };
    var command = new System.Text.StringBuilder("\"" + executable + "\" " + arguments);
    LaunchProcess process;
    // Inherit the desktop and environment, but never the MCP stdio handles.
    if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false,
        0x08000000, IntPtr.Zero, directory, ref startup, out process))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    CloseHandle(process.Thread);
    CloseHandle(process.Process);
    return process.ProcessId;
  }

  // Chromium hosts (Electron, Chrome/Edge, CEF, WebView2) draw each page in a
  // Chrome_RenderWidgetHostHWND child window, possibly owned by another process.
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsCallback callback, IntPtr data);
  public static IntPtr[] ChromiumRenderers(IntPtr window, int max) {
    var result = new System.Collections.Generic.List<IntPtr>();
    var name = new System.Text.StringBuilder(64);
    EnumChildWindows(window, delegate(IntPtr hwnd, IntPtr data) {
      name.Length = 0;
      GetClassName(hwnd, name, name.Capacity);
      if (name.ToString() == "Chrome_RenderWidgetHostHWND" && IsWindowVisible(hwnd)) result.Add(hwnd);
      return result.Count < max;
    }, IntPtr.Zero);
    return result.ToArray();
  }

  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr wParam,
    IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  public static bool IsResponsive(IntPtr hwnd) {
    UIntPtr result;
    // WM_NULL, SMTO_BLOCK | SMTO_ABORTIFHUNG. Never enter the UIA provider here.
    return IsWindow(hwnd) && SendMessageTimeout(hwnd, 0, UIntPtr.Zero,
      IntPtr.Zero, 3, 200, out result) != IntPtr.Zero;
  }

  public const byte VK_MENU = 0x12;
  public const uint KEYEVENTF_KEYUP = 0x0002;

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

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
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
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

  // ---- less takeover: give the foreground and the pointer back ----
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO { public int cbSize; public uint flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint msg, IntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, ExactSpelling = true)]
  private static extern IntPtr ReadMessageText(IntPtr hwnd, uint msg, UIntPtr wParam, System.Text.StringBuilder text, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", ExactSpelling = true)]
  private static extern IntPtr ReadMessageSelection(IntPtr hwnd, uint msg, out uint start, out uint end, uint flags, uint timeout, out UIntPtr result);
  public const uint BM_CLICK = 0x00F5, EM_SETSEL = 0x00B1, EM_REPLACESEL = 0x00C2;
  public const uint WM_GETTEXTLENGTH = 0x000E, WM_HSCROLL = 0x0114, WM_VSCROLL = 0x0115;

  public static string ReadEditText(IntPtr hwnd, int capacity) {
    var text = new System.Text.StringBuilder(capacity);
    UIntPtr length;
    // WM_GETTEXT, with one extra slot to detect a truncated read.
    if (ReadMessageText(hwnd, 0x000D, new UIntPtr((uint)capacity), text, 3, 100, out length) == IntPtr.Zero ||
        length.ToUInt64() >= (ulong)(capacity - 1)) return null;
    return text.ToString();
  }

  public static int[] ReadEditSelection(IntPtr hwnd) {
    uint start, end;
    UIntPtr ignored;
    // EM_GETSEL writes both UTF-16 offsets. Some superclassed edits do not
    // populate both offsets in the packed return value.
    if (ReadMessageSelection(hwnd, 0x00B0, out start, out end, 3, 100, out ignored) == IntPtr.Zero ||
        start > Int32.MaxValue || end > Int32.MaxValue) return null;
    return new int[] { (int)start, (int)end };
  }

  [DllImport("user32.dll")] private static extern bool InvalidateRect(IntPtr hwnd, IntPtr rect, bool erase);
  [DllImport("user32.dll")] private static extern bool GetUpdateRect(IntPtr hwnd, IntPtr rect, bool erase);
  [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out RECT rect);

  // A thread gets WM_PAINT only when no posted message or input is waiting
  // for it. Request a repaint after queueing input: once the window's update
  // region is empty again, its thread has taken all of that input. A message
  // sent to the window cannot tell, since it is handled before queued input.
  public static bool RequestPaint(IntPtr hwnd) {
    RECT client;
    return hwnd != IntPtr.Zero && IsWindowVisible(hwnd) && GetClientRect(hwnd, out client) &&
      client.right > client.left && client.bottom > client.top && InvalidateRect(hwnd, IntPtr.Zero, false);
  }

  public static bool PaintPending(IntPtr hwnd) {
    return hwnd != IntPtr.Zero && GetUpdateRect(hwnd, IntPtr.Zero, false);
  }

  // The window with the keyboard focus in hwnd's thread. Each thread keeps its
  // own focus, also while its windows are in the background (zero when none).
  public static IntPtr FocusedWindow(IntPtr hwnd) {
    uint pid; uint thread = GetWindowThreadProcessId(hwnd, out pid);
    if (thread == 0) return IntPtr.Zero;
    var info = new GUITHREADINFO(); info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    return GetGUIThreadInfo(thread, ref info) ? info.hwndFocus : IntPtr.Zero;
  }

  // A menu, a system menu or a popup menu is open in the window's thread
  // (GUI_INMENUMODE | GUI_SYSTEMMENUMODE | GUI_POPUPMENUMODE).
  public static bool InMenuMode(IntPtr hwnd) {
    uint pid; uint thread = GetWindowThreadProcessId(hwnd, out pid);
    if (thread == 0) return false;
    var info = new GUITHREADINFO(); info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    return GetGUIThreadInfo(thread, ref info) && (info.flags & 0x1C) != 0;
  }

  // Hand the foreground to a window without pressing a key: this thread joins
  // the input of the thread in front, which may then pass the foreground on.
  public static bool GiveForeground(IntPtr hwnd) {
    IntPtr front = GetForegroundWindow();
    if (front == hwnd) return true;
    uint pid; uint frontThread = front == IntPtr.Zero ? 0 : GetWindowThreadProcessId(front, out pid);
    uint own = GetCurrentThreadId();
    bool attached = frontThread != 0 && frontThread != own && AttachThreadInput(own, frontThread, true);
    try { BringWindowToTop(hwnd); SetForegroundWindow(hwnd); }
    finally { if (attached) AttachThreadInput(own, frontThread, false); }
    return GetForegroundWindow() == hwnd;
  }

  // Visible top-level popup windows (WS_POPUP) of a process: a drop-down list,
  // a menu, a dialog. One that appears during an action was opened by it.
  public static long[] VisiblePopups(uint processId) {
    var result = new System.Collections.Generic.List<long>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr data) {
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      if (pid == processId && IsWindowVisible(hwnd) && (GetWindowLong(hwnd, -16) & unchecked((int)0x80000000)) != 0) result.Add(hwnd.ToInt64());
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }
}

// Low disruption (the default work mode) borrows the pointer and keyboard for
// a step without waiting for the user to stop. Meanwhile the user's own keys
// and mouse actions are held here and replayed to the user's window once the
// foreground and pointer are back, so nothing they type is lost or lands in
// DSH's window. Afterwards, while a window DSH worked in stays in front (a
// menu, list or dialog it opened, an app it started), the user's next key
// first gives the foreground back to their window and is replayed there; a
// click of theirs ends that. Esc always passes on to the stop listener. When
// Windows does not install the hooks, or drops one that answered too slowly,
// only this protection is lost.
public static class WcuInputHold {
  public const int Idle = 0, Holding = 1, Guarding = 2, Returning = 3;
  public static readonly uint ReplayMarker = unchecked(WindowsComputerUseNative.InputMarker + 1u);
  public struct Held { public bool Key, Up; public int Vk, Scan, Flags, X, Y, MouseData; public uint MouseFlags; }

  // The decisions, without Windows calls, so tests can drive them.
  public sealed class Core {
    public int State;
    public readonly System.Collections.Generic.List<Held> Queue = new System.Collections.Generic.List<Held>();
    public readonly System.Collections.Generic.HashSet<int> PreHeld = new System.Collections.Generic.HashSet<int>();
    public readonly System.Collections.Generic.HashSet<int> Keys = new System.Collections.Generic.HashSet<int>();
    public readonly System.Collections.Generic.HashSet<int> Buttons = new System.Collections.Generic.HashSet<int>();
    // Keys whose replayed press Windows has taken and whose replayed release
    // it has not: they read as down without being held by the user.
    public readonly System.Collections.Generic.HashSet<int> Replaying = new System.Collections.Generic.HashSet<int>();
    public int X, Y, KeyCount, MouseCount;
    public bool Moved;
    public void Reset(int x, int y) { Queue.Clear(); PreHeld.Clear(); Keys.Clear(); Buttons.Clear(); Replaying.Clear(); X = x; Y = y; Moved = false; KeyCount = 0; MouseCount = 0; }
    static bool Ours(bool injected, bool lowerIntegrity, ulong extra) {
      return injected && ((!lowerIntegrity && extra == (ulong)WindowsComputerUseNative.InputMarker) || extra == (ulong)ReplayMarker);
    }
    // A key (LLKHF flags: 0x01 extended, 0x02 injected at a lower integrity,
    // 0x10 injected). down: Windows reads the key as down already. In
    // Guarding, dshInFront: a window DSH worked in is in front and the user's
    // window is there to go back to. True: swallow the key.
    public bool Key(int vk, int scan, int flags, ulong extra, bool up, bool down, bool dshInFront, bool overdue) {
      bool injected = (flags & 0x10) != 0;
      if (injected && extra == (ulong)ReplayMarker) { if (up) Replaying.Remove(vk); else Replaying.Add(vk); return false; }
      if (Ours(injected, (flags & 0x02) != 0, extra)) return false;
      // Auto-repeat of a key the user pressed before the hold. A key whose
      // replay is under way also reads as down, and a typed character
      // (VK_PACKET, all characters on one code) never repeats.
      bool repeat = down && vk != 0xE7 && !Replaying.Contains(vk);
      if (State == Holding) {
        if (overdue || vk == 0x1B) return false;
        if (up) {
          if (Keys.Remove(vk)) { Add(vk, scan, flags, true); return true; }
          PreHeld.Remove(vk); return false;
        }
        // A key pressed before the hold: its repeats are dropped, its release passes.
        if (PreHeld.Contains(vk) || (repeat && !Keys.Contains(vk))) { PreHeld.Add(vk); return true; }
        Keys.Add(vk); KeyCount++; Add(vk, scan, flags, false); return true;
      }
      if (State == Guarding) {
        if (up || vk == 0x1B || !dshInFront) return false;
        State = Returning; Keys.Clear(); Keys.Add(vk); KeyCount = 1; Add(vk, scan, flags, false); return true;
      }
      if (State == Returning) {
        if (vk == 0x1B) return false;
        if (up) { if (Keys.Remove(vk)) { Add(vk, scan, flags, true); return true; } return false; }
        Keys.Add(vk); KeyCount++; Add(vk, scan, flags, false); return true;
      }
      return false;
    }
    // A mouse event (LLMHF flags: 0x01 injected, 0x02 injected at a lower
    // integrity). (x, y): where Windows would put the pointer; (cursorX,
    // cursorY): where it is. True: swallow the event.
    public bool Mouse(int message, int x, int y, int cursorX, int cursorY, int mouseData, int flags, ulong extra, bool overdue) {
      bool injected = (flags & 0x01) != 0;
      if (Ours(injected, (flags & 0x02) != 0, extra)) return false;
      int button = Button(message, mouseData);
      // A click of the user's own picks the window: the guard ends.
      if (State == Guarding) { if (button != 0 && Down(message)) State = Idle; return false; }
      if (State != Holding || overdue) return false;
      if (message == 0x200) {
        // A mouse moves the pointer by a distance; remote control, pens and touch place it.
        if (injected || (extra & 0xFFFFFF00UL) == 0xFF515700UL) { X = x; Y = y; } else { X += x - cursorX; Y += y - cursorY; }
        Moved = true; return true;
      }
      if (message == 0x20A || message == 0x20E) { MouseCount++; AddMouse(message, mouseData); return true; }
      if (button == 0) return false;
      if (Down(message)) { Buttons.Add(button); MouseCount++; AddMouse(message, mouseData); return true; }
      if (Buttons.Remove(button)) { AddMouse(message, mouseData); return true; }
      return false;
    }
    static bool Down(int message) { return message == 0x201 || message == 0x204 || message == 0x207 || message == 0x20B; }
    static int Button(int message, int mouseData) {
      switch (message) {
        case 0x201: case 0x202: return 1;
        case 0x204: case 0x205: return 2;
        case 0x207: case 0x208: return 3;
        case 0x20B: case 0x20C: return ((mouseData >> 16) & 0xFFFF) == 1 ? 4 : 5;
        default: return 0;
      }
    }
    void Add(int vk, int scan, int flags, bool up) { var held = new Held(); held.Key = true; held.Vk = vk; held.Scan = scan; held.Flags = flags; held.Up = up; Queue.Add(held); }
    void AddMouse(int message, int mouseData) {
      var held = new Held(); held.X = X; held.Y = Y;
      int high = (short)((mouseData >> 16) & 0xFFFF);
      switch (message) {
        case 0x201: held.MouseFlags = 0x0002; break;
        case 0x202: held.MouseFlags = 0x0004; break;
        case 0x204: held.MouseFlags = 0x0008; break;
        case 0x205: held.MouseFlags = 0x0010; break;
        case 0x207: held.MouseFlags = 0x0020; break;
        case 0x208: held.MouseFlags = 0x0040; break;
        case 0x20B: held.MouseFlags = 0x0080; held.MouseData = high & 0xFFFF; break;
        case 0x20C: held.MouseFlags = 0x0100; held.MouseData = high & 0xFFFF; break;
        case 0x20A: held.MouseFlags = 0x0800; held.MouseData = high; break;
        case 0x20E: held.MouseFlags = 0x1000; held.MouseData = high; break;
      }
      Queue.Add(held);
    }
  }

  // What Windows gets on replay, tagged so that neither hook holds it again.
  public static WindowsComputerUseNative.INPUT ToInput(Held held) {
    var input = new WindowsComputerUseNative.INPUT();
    if (held.Key) {
      // VK_PACKET: a character another program typed (KEYEVENTF_UNICODE).
      bool packet = held.Vk == 0xE7;
      input.type = 1;
      input.U.ki.wVk = (ushort)(packet ? 0 : held.Vk);
      input.U.ki.wScan = (ushort)held.Scan;
      input.U.ki.dwFlags = ((held.Flags & 0x01) != 0 && !packet ? 1u : 0u) | (held.Up ? 2u : 0u) | (packet ? 4u : 0u);
      input.U.ki.dwExtraInfo = new IntPtr((long)(ulong)ReplayMarker);
    } else {
      input.type = 0;
      input.U.mi.mouseData = unchecked((uint)held.MouseData);
      input.U.mi.dwFlags = held.MouseFlags;
      input.U.mi.dwExtraInfo = new IntPtr((long)(ulong)ReplayMarker);
    }
    return input;
  }

  public static readonly Core Decisions = new Core();
  static readonly object gate = new object();
  static IntPtr user, pendingUser;
  static System.Collections.Generic.HashSet<long> dshWindows = new System.Collections.Generic.HashSet<long>();
  static System.Collections.Generic.HashSet<long> before = new System.Collections.Generic.HashSet<long>(), pendingBefore;
  static System.Collections.Generic.HashSet<uint> dshProcesses = new System.Collections.Generic.HashSet<uint>();
  static DateTime since, guardUntil;
  static string notice;
  public const string GuardNote = "This window stays in front for now; if the user types before your next step, the foreground goes back to their window first.";

  public sealed class UserInput { public bool Held, Fullscreen; public int Notification; public long Foreground; }
  static readonly int[] Watched = { 0x01, 0x02, 0x04, 0x05, 0x06, 0x10, 0x11, 0x12, 0x5B, 0x5C };
  static bool AnyHeld() { foreach (int key in Watched) if ((GetAsyncKeyState(key) & 0x8000) != 0) return true; return false; }
  // Whether borrowing now would break what the user is doing: a modifier or a
  // mouse button down, or a full-screen app or presentation in front
  // (SHQueryUserNotificationState: 2 busy, 3 Direct3D full screen, 4 presentation mode).
  public static UserInput UserState() {
    var state = new UserInput();
    state.Held = AnyHeld();
    int value;
    if (SHQueryUserNotificationState(out value) == 0) { state.Notification = value; state.Fullscreen = value == 2 || value == 3 || value == 4; }
    state.Foreground = WindowsComputerUseNative.GetForegroundWindow().ToInt64();
    return state;
  }

  // Before DSH's input on the user's desktop: hold the user's input from now
  // on. target: the window DSH works in (0: the one in front). False when the
  // hooks are not there; the step then runs without this protection.
  public static bool Begin(long target) {
    var windows = TopLevelSet();
    uint pid = 0;
    if (target != 0) WindowsComputerUseNative.GetWindowThreadProcessId(new IntPtr(target), out pid);
    for (int waited = 0; ; waited += 10) {
      lock (gate) {
        if (Decisions.State != Returning || waited >= 1000) {
          WindowsComputerUseNative.POINT cursor;
          WindowsComputerUseNative.GetCursorPos(out cursor);
          // Coming from a guard, the user's window is still the one from before.
          if (Decisions.State != Guarding) {
            user = WindowsComputerUseNative.GetForegroundWindow(); before = windows;
            dshWindows = new System.Collections.Generic.HashSet<long>(); dshProcesses = new System.Collections.Generic.HashSet<uint>();
          }
          Decisions.Reset(cursor.x, cursor.y);
          if (target != 0) dshWindows.Add(target);
          if (pid != 0) dshProcesses.Add(pid);
          since = DateTime.UtcNow;
          Decisions.State = Holding;
          break;
        }
      }
      System.Threading.Thread.Sleep(10);
    }
    // A fresh pair: Windows may have dropped an older hook without a word.
    Request(UninstallMessage, true);
    if (!Request(InstallMessage, false)) {
      lock (gate) Decisions.State = Idle;
      Request(UninstallMessage, true);
      return false;
    }
    for (int key = 0x08; key <= 0xFE; key++) if (key != 0xE7 && (GetAsyncKeyState(key) & 0x8000) != 0) lock (gate) Decisions.PreHeld.Add(key);
    return true;
  }

  // During the hold, a modifier or button the user pressed before it may still
  // be down; its release passes. True once none is down.
  public static bool WaitForRelease(int milliseconds) {
    DateTime start = DateTime.UtcNow;
    while (AnyHeld()) {
      if ((DateTime.UtcNow - start).TotalMilliseconds >= milliseconds) return false;
      System.Threading.Thread.Sleep(10);
    }
    return true;
  }

  // After DSH's input, with the foreground and pointer given back: replay what
  // the user did meanwhile. windows: what DSH worked in (the target and the
  // menus, lists and dialogs it opened). A note for the result, or null.
  public static string End(long[] windows) {
    IntPtr target; bool hasKeys = false; int keys, mouse;
    lock (gate) {
      if (Decisions.State != Holding) return null;
      if (windows != null) foreach (long window in windows) if (window != 0) dshWindows.Add(window);
      if (Decisions.Keys.Count > 0) hasKeys = true;
      foreach (Held held in Decisions.Queue) if (held.Key) hasKeys = true;
      keys = Decisions.KeyCount; mouse = Decisions.MouseCount; target = user;
    }
    IntPtr front = WindowsComputerUseNative.GetForegroundWindow();
    bool there = Present(target), returned = false, deliver = true, elevated = false, guard;
    if (hasKeys && front != target) { returned = there && GiveBack(target); deliver = returned; }
    // Windows lets no program type into a window that runs at a higher
    // integrity level (an app run as administrator while DSH is not).
    if (hasKeys && deliver && there) {
      uint pid; WindowsComputerUseNative.GetWindowThreadProcessId(target, out pid);
      var identity = pid == 0 ? null : WindowsComputerUseNative.ReadInputProcess(pid, false);
      uint? own = WindowsComputerUseNative.ReadCurrentIntegrity();
      if (identity != null && identity.Integrity.HasValue && own.HasValue && identity.Integrity.Value > own.Value) { deliver = false; elevated = true; }
    }
    lock (gate) guard = !hasKeys && there && front != target && IsDsh(front);
    int dropped = Drain(deliver, Holding, guard ? Guarding : Idle);
    int x, y; bool moved;
    lock (gate) { moved = Decisions.Moved; x = Decisions.X; y = Decisions.Y; guardUntil = DateTime.UtcNow.AddMinutes(10); }
    if (moved) Place(x, y);
    if (!guard) Request(UninstallMessage, false);
    var parts = new System.Collections.Generic.List<string>();
    if (elevated) parts.Add("The user typed during this step in a window that runs as administrator; Windows lets DSH replay no keys there, so they were dropped.");
    else if (returned) parts.Add("The user was typing, so the foreground went back to their window and their keys went there; a menu or list this step opened may have closed.");
    else if (dropped > 0) parts.Add("The user typed during this step, but Windows kept this window in front, so their keys were dropped rather than sent here.");
    else if (keys + mouse > 0) parts.Add("The user's own input during this step was held and then replayed to their window.");
    if (guard) parts.Add(GuardNote);
    return parts.Count == 0 ? null : String.Join(" ", parts.ToArray());
  }

  // Before an action that may bring a window forward without real input (an
  // app DSH starts, activate_window, an element action whose app comes forward).
  public static void Snapshot() {
    var windows = TopLevelSet();
    IntPtr front = WindowsComputerUseNative.GetForegroundWindow();
    lock (gate) {
      if (Decisions.State == Guarding) { pendingUser = user; pendingBefore = before; }
      else if (Decisions.State == Idle) { pendingUser = front; pendingBefore = windows; }
    }
  }
  // After it: until the user clicks, DSH's next input step or ten minutes, a
  // key the user types while one of these windows, or a new window of these
  // processes, is in front goes to the user's own window instead.
  public static bool ArmGuard(long[] windows, long[] processes) {
    lock (gate) {
      if (pendingUser == IntPtr.Zero || (Decisions.State != Idle && Decisions.State != Guarding)) return false;
      if (Decisions.State == Idle) { dshWindows = new System.Collections.Generic.HashSet<long>(); dshProcesses = new System.Collections.Generic.HashSet<uint>(); }
      user = pendingUser; before = pendingBefore ?? new System.Collections.Generic.HashSet<long>(); pendingUser = IntPtr.Zero;
      if (windows != null) foreach (long window in windows) if (window != 0) dshWindows.Add(window);
      if (processes != null) foreach (long process in processes) if (process > 0) dshProcesses.Add((uint)process);
      Decisions.Reset(0, 0); Decisions.State = Guarding; guardUntil = DateTime.UtcNow.AddMinutes(10);
    }
    if (Request(InstallMessage, false)) return true;
    lock (gate) if (Decisions.State == Guarding) Decisions.State = Idle;
    return false;
  }

  // A guard that acted between two steps, for the next result.
  public static string TakeNotice() { lock (gate) { string text = notice; notice = null; return text; } }

  static bool Present(IntPtr window) { return window != IntPtr.Zero && WindowsComputerUseNative.IsWindow(window) && WindowsComputerUseNative.IsWindowVisible(window); }
  static bool GiveBack(IntPtr window) {
    if (WindowsComputerUseNative.GiveForeground(window)) return true;
    System.Threading.Thread.Sleep(30);
    return WindowsComputerUseNative.GiveForeground(window);
  }
  static void Place(int x, int y) {
    int left = WindowsComputerUseNative.GetSystemMetrics(76), top = WindowsComputerUseNative.GetSystemMetrics(77);
    int width = WindowsComputerUseNative.GetSystemMetrics(78), height = WindowsComputerUseNative.GetSystemMetrics(79);
    if (width > 0 && height > 0) { x = Math.Max(left, Math.Min(left + width - 1, x)); y = Math.Max(top, Math.Min(top + height - 1, y)); }
    WindowsComputerUseNative.SetCursorPos(x, y);
  }
  static System.Collections.Generic.HashSet<long> TopLevelSet() {
    var set = new System.Collections.Generic.HashSet<long>();
    foreach (IntPtr window in WindowsComputerUseNative.TopLevelWindows()) set.Add(window.ToInt64());
    return set;
  }
  // Under gate. A window DSH worked in, one of them owns, or a new window of
  // the processes DSH worked in.
  static bool IsDsh(IntPtr window) {
    if (window == IntPtr.Zero) return false;
    IntPtr owner = window;
    for (int depth = 0; owner != IntPtr.Zero && depth < 8; depth++) {
      if (dshWindows.Contains(owner.ToInt64())) return true;
      owner = WindowsComputerUseNative.GetWindow(owner, 4);
    }
    uint pid; WindowsComputerUseNative.GetWindowThreadProcessId(window, out pid);
    return pid != 0 && dshProcesses.Contains(pid) && !before.Contains(window.ToInt64());
  }
  static bool Overdue() { return (DateTime.UtcNow - since).TotalMilliseconds > 8000; }

  // Replays the queue in order, also what arrives meanwhile, then switches
  // from expected to next once nothing is left (unless a new step took over).
  // Each batch waits until the hooks have seen its events: input the user sent
  // before them is ahead in Windows' queue and must be held, not let through
  // after the switch ahead of the replay. Keys go nowhere when they cannot
  // reach the user's window. Returns how many key events were dropped.
  static int Drain(bool deliverKeys, int expected, int next) {
    int dropped = 0, size = Marshal.SizeOf(typeof(WindowsComputerUseNative.INPUT));
    for (;;) {
      Held[] batch;
      lock (gate) {
        if (Decisions.State != expected) return dropped;
        if (Decisions.Queue.Count == 0) { Decisions.State = next; Decisions.Keys.Clear(); Decisions.Buttons.Clear(); Decisions.PreHeld.Clear(); return dropped; }
        batch = Decisions.Queue.ToArray(); Decisions.Queue.Clear();
      }
      int sent = 0;
      foreach (Held held in batch) {
        if (held.Key && !deliverKeys) { dropped++; continue; }
        if (!held.Key) WindowsComputerUseNative.SetCursorPos(held.X, held.Y);
        sent += (int)WindowsComputerUseNative.SendInput(1, new WindowsComputerUseNative.INPUT[] { ToInput(held) }, size);
      }
      int target = System.Threading.Interlocked.Add(ref replaySent, sent);
      DateTime start = DateTime.UtcNow;
      while (System.Threading.Volatile.Read(ref replaySeen) < target && (DateTime.UtcNow - start).TotalMilliseconds < 500) System.Threading.Thread.Sleep(1);
      if (System.Threading.Volatile.Read(ref replaySeen) < target) System.Threading.Interlocked.Exchange(ref replaySeen, target);
    }
  }
  static int replaySent, replaySeen;
  // On the hook thread: a replayed event has reached the hooks.
  static void Seen(bool injected, ulong extra) { if (injected && extra == (ulong)ReplayMarker) System.Threading.Interlocked.Increment(ref replaySeen); }
  static void ReturnToUser(object ignored) {
    IntPtr target; lock (gate) target = user;
    bool returned = Present(target) && GiveBack(target);
    Drain(returned, Returning, Idle);
    lock (gate) notice = returned
      ? "Since your last step the user typed while a window DSH worked in was in front, so the foreground went back to their window and their keys went there. Observe again before acting in that window."
      : "Since your last step the user typed while a window DSH worked in was in front; Windows did not give their window the foreground, so those keys were dropped.";
    Request(UninstallMessage, false);
  }

  // The hooks live on one thread with a message loop. Install and remove are
  // requests to it; a remove without force waits until nothing is held or guarded.
  delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint vk, scan, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MouseData { public int x, y; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetMessage(out Msg message, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool PeekMessage(out Msg message, IntPtr hwnd, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  const uint InstallMessage = 0x8001, UninstallMessage = 0x8002;
  static readonly HookProc keyboardProc = OnKey, mouseProc = OnMouse;
  static readonly object pump = new object();
  static System.Threading.Thread thread;
  static uint threadId;
  static int requested, done;
  static IntPtr keyboardHook, mouseHook;

  static void Pump() {
    Msg message;
    PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
    lock (pump) { threadId = WindowsComputerUseNative.GetCurrentThreadId(); System.Threading.Monitor.PulseAll(pump); }
    while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
      if (message.message == InstallMessage) {
        if (keyboardHook == IntPtr.Zero) keyboardHook = SetWindowsHookEx(13, keyboardProc, GetModuleHandle(null), 0);
        if (mouseHook == IntPtr.Zero) mouseHook = SetWindowsHookEx(14, mouseProc, GetModuleHandle(null), 0);
      } else if (message.message == UninstallMessage) {
        bool idle; lock (gate) idle = Decisions.State == Idle;
        if (idle || message.lParam != IntPtr.Zero) {
          if (keyboardHook != IntPtr.Zero) { UnhookWindowsHookEx(keyboardHook); keyboardHook = IntPtr.Zero; }
          if (mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(mouseHook); mouseHook = IntPtr.Zero; }
        }
      } else continue;
      lock (pump) { done = Math.Max(done, message.wParam.ToInt32()); System.Threading.Monitor.PulseAll(pump); }
    }
  }
  static bool Request(uint message, bool force) {
    int sequence; uint target;
    lock (pump) {
      if (thread == null || !thread.IsAlive) {
        threadId = 0;
        thread = new System.Threading.Thread(Pump);
        thread.IsBackground = true; thread.Name = "DSH input hold"; thread.Start();
        DateTime start = DateTime.UtcNow;
        while (threadId == 0 && (DateTime.UtcNow - start).TotalMilliseconds < 2000) System.Threading.Monitor.Wait(pump, 100);
        if (threadId == 0) return false;
      }
      sequence = ++requested; target = threadId;
    }
    if (!PostThreadMessage(target, message, new IntPtr(sequence), new IntPtr(force ? 1 : 0))) return false;
    lock (pump) {
      DateTime start = DateTime.UtcNow;
      while (done < sequence) {
        int left = 1000 - (int)(DateTime.UtcNow - start).TotalMilliseconds;
        if (left <= 0) return false;
        System.Threading.Monitor.Wait(pump, left);
      }
      return message != InstallMessage || (keyboardHook != IntPtr.Zero && mouseHook != IntPtr.Zero);
    }
  }
  static void Release() { PostThreadMessage(threadId, UninstallMessage, IntPtr.Zero, IntPtr.Zero); }

  static IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      var data = (KeyData)Marshal.PtrToStructure(lParam, typeof(KeyData));
      Seen((data.flags & 0x10) != 0, data.extra.ToUInt64());
      int kind = wParam.ToInt32();
      bool up = kind == 0x101 || kind == 0x105, swallow, returning, ended;
      bool down = !up && (GetAsyncKeyState((int)data.vk) & 0x8000) != 0;
      lock (gate) {
        int was = Decisions.State;
        bool dshInFront = false;
        if (was == Guarding && !up) {
          if (DateTime.UtcNow > guardUntil) Decisions.State = Idle;
          else {
            IntPtr front = WindowsComputerUseNative.GetForegroundWindow();
            dshInFront = front != user && Present(user) && IsDsh(front);
          }
        }
        swallow = Decisions.Key((int)data.vk, (int)data.scan, (int)data.flags, data.extra.ToUInt64(), up, down, dshInFront, was == Holding && Overdue());
        returning = was == Guarding && Decisions.State == Returning;
        ended = was == Guarding && Decisions.State == Idle;
      }
      if (returning) System.Threading.ThreadPool.QueueUserWorkItem(ReturnToUser);
      if (ended) Release();
      if (swallow) return new IntPtr(1);
    }
    return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
  }
  static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      var data = (MouseData)Marshal.PtrToStructure(lParam, typeof(MouseData));
      Seen((data.flags & 0x01) != 0, data.extra.ToUInt64());
      WindowsComputerUseNative.POINT cursor;
      WindowsComputerUseNative.GetCursorPos(out cursor);
      bool swallow, ended;
      lock (gate) {
        int was = Decisions.State;
        swallow = Decisions.Mouse(wParam.ToInt32(), data.x, data.y, cursor.x, cursor.y, unchecked((int)data.data), (int)data.flags, data.extra.ToUInt64(), was == Holding && Overdue());
        ended = was == Guarding && Decisions.State == Idle;
      }
      if (ended) Release();
      if (swallow) return new IntPtr(1);
    }
    return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
  }
}
'@

function Get-CsHash {
  param([string]$Source)
  $normalized = $Source.Replace("`r`n", "`n").Replace("`r", "`n")
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalized))
    return ([BitConverter]::ToString($bytes).Replace("-", "").Substring(0, 16)).ToLowerInvariant()
  } finally { $sha.Dispose() }
}

# Load a helper compiled into %TEMP%, compiling it first when no cached copy
# exists. The bytes are read rather than passed to Assembly.LoadFrom: .NET
# Framework refuses LoadFrom for an unsigned DLL it treats as coming from a
# remote or internet location (0x80131515), which left every tool failing with
# "Backend process exited" on some machines (#54). The compiler writes a
# file of its own and only a complete one is moved into place, because another
# backend may be reading the cache at the same time.
#
# TEMP is often an 8.3 short path. Windows PowerShell's FileSystemProvider
# rejects a short name that is longer than the name it stands for, such as
# C:\Users\LIHUA~1 for "Li Hua", with "An object at the specified path ...
# does not exist" (#78). Remove-Item met that on every OCR compile, so
# temporary files are handled with .NET calls only, never with Remove-Item,
# Get-ChildItem or Test-Path.
function Remove-TempFile {
  param([string]$Path)
  try { [System.IO.File]::Delete($Path) } catch { }
}

function Get-HelperCacheDir {
  $local = [Environment]::GetFolderPath('LocalApplicationData')
  $configured = [string]$env:TEMP
  if ($configured -and [IO.Directory]::Exists($configured)) {
    # Resolve a user's usual 8.3 TEMP spelling before deciding whether it is
    # a caller override. Cache file I/O itself still uses .NET paths.
    try { $configured = (Get-Item -LiteralPath $configured -ErrorAction Stop).FullName } catch {}
  }
  $default = Join-Path $local 'Temp'
  $userTemp = [Environment]::ExpandEnvironmentVariables([string][Environment]::GetEnvironmentVariable('TEMP','User'))
  if ($configured -and $configured.TrimEnd('\') -ne $default.TrimEnd('\') -and $configured -ne $userTemp) {
    if (-not [IO.Path]::IsPathRooted($configured)) { throw 'The configured TEMP path must be absolute.' }
    $dir = [IO.Path]::GetFullPath($configured)
  } else {
    $dir = Join-Path $local 'dsh-computer-use-win\native-cache'
    if (-not [IO.Directory]::Exists($dir)) {
      $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
      try {
        $acl=[Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true,$false)
        foreach($sid in @($identity.User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
          $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
        }
        if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($dir),$acl) }
        else { [void][IO.Directory]::CreateDirectory($dir,$acl) }
      } finally { $identity.Dispose() }
    }
  }
  [void][IO.Directory]::CreateDirectory($dir)
  Assert-PrivateHelperPath $dir -Directory
  return $dir
}

function Assert-PrivateHelperPath {
  param([string]$Path, [switch]$Directory)
  $attributes = [IO.File]::GetAttributes($Path)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -or
      ([bool]($attributes -band [IO.FileAttributes]::Directory) -ne [bool]$Directory)) {
    throw 'Native cache must contain ordinary files in a private directory.'
  }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  try { $trusted = @($identity.User.Value,$identity.Owner.Value,'S-1-5-18','S-1-5-32-544') }
  finally { $identity.Dispose() }
  $item = if ($Directory) { [IO.DirectoryInfo]::new($Path) } else { [IO.FileInfo]::new($Path) }
  $sections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
  $acl = if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::GetAccessControl($item,$sections) } else { $item.GetAccessControl($sections) }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) {
    throw 'Native cache ownership does not match the Windows account.'
  }
  $writeRights = [Security.AccessControl.FileSystemRights]'WriteData, AppendData, DeleteSubdirectoriesAndFiles, Delete, ChangePermissions, TakeOwnership'
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
        ($rule.FileSystemRights -band $writeRights) -and $rule.IdentityReference.Value -notin $trusted) {
      throw 'Native cache grants write access to another account.'
    }
  }
}

function Get-HelperDigest {
  param([byte[]]$Bytes)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

# A compile that failed or was cut off leaves <helper>.<pid>.<guid>.dll and
# its .cs source behind (one pair per OCR call on the machines of #78). Those
# an hour old are removed before a helper is compiled.
function Remove-StaleHelperParts {
  param([string]$Directory)
  $cutoff = [DateTime]::UtcNow.AddHours(-1)
  try {
    foreach ($file in [System.IO.Directory]::EnumerateFiles($Directory, 'wcu-*.dll*')) {
      if ([System.IO.Path]::GetFileName($file) -cmatch '^wcu-(native|ocr|clipboard|wgc)-[a-z0-9-]+\.\d+\.[0-9a-f]{32}\.dll(\.cs)?$' -and [System.IO.File]::GetLastWriteTimeUtc($file) -lt $cutoff) { Remove-TempFile $file }
    }
  } catch { }
}

function Import-HelperAssembly {
  param([string]$Path, [scriptblock]$Compile)
  $directory = [IO.Path]::GetDirectoryName($Path)
  Assert-PrivateHelperPath $directory -Directory
  $digestFile = $Path + '.sha256'
  $mutex = [Threading.Mutex]::new($false, ('Local\DSH-WCU-Helper-' + (Get-CsHash $Path.ToUpperInvariant())))
  $owned = $false
  $partial = $Path -replace '\.dll$', (".$PID." + [Guid]::NewGuid().ToString('N') + '.dll')
  try {
    try { $owned = $mutex.WaitOne(20000) } catch [Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { throw 'Timed out waiting for the native helper cache.' }
    if ([IO.File]::Exists($Path)) { Assert-PrivateHelperPath $Path }
    if ([IO.File]::Exists($digestFile)) { Assert-PrivateHelperPath $digestFile }
    if ([IO.File]::Exists($Path) -and [IO.File]::Exists($digestFile)) {
      $bytes = [IO.File]::ReadAllBytes($Path)
      if ((Get-HelperDigest $bytes) -ceq [IO.File]::ReadAllText($digestFile)) {
        [void][Reflection.Assembly]::Load($bytes)
        return
      }
    }
    Remove-StaleHelperParts $directory
    & $Compile $partial
    $bytes = [IO.File]::ReadAllBytes($partial)
    [IO.File]::WriteAllText("$partial.sha256",(Get-HelperDigest $bytes))
    if ([IO.File]::Exists($Path)) { [IO.File]::Replace($partial,$Path,[NullString]::Value) }
    else { [IO.File]::Move($partial,$Path) }
    if ([IO.File]::Exists($digestFile)) { [IO.File]::Replace("$partial.sha256",$digestFile,[NullString]::Value) }
    else { [IO.File]::Move("$partial.sha256",$digestFile) }
    [void][Reflection.Assembly]::Load($bytes)
  } finally {
    Remove-TempFile $partial
    Remove-TempFile "$partial.cs"
    Remove-TempFile "$partial.sha256"
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

function Load-Assemblies {
  # DPI awareness MUST be set before any GDI+/WinForms assembly is loaded:
  # loading System.Windows.Forms/System.Drawing initializes GDI, which locks
  # the process DPI context (and GetSystemMetrics then returns virtualized
  # 150%-scaled values like 3414x960 instead of physical 5120x1440).
  if (-not ("WindowsComputerUseNative" -as [type])) {
    Write-BackendStage 'native-load-start'
    # Add-Type targets the current runtime. A Core-built helper cannot be used
    # by Windows PowerShell 5.1 even when its C# source is identical.
    $runtimeKey = $PSVersionTable.PSEdition.ToLowerInvariant() + '-clr' + [Environment]::Version.Major
    $precompiled = (Get-Command Import-PackagedHelper -ErrorAction SilentlyContinue) -and (Import-PackagedHelper -Name native -Source $script:WcuCs)
    if (-not $precompiled) {
      $dll = Join-Path (Get-HelperCacheDir) ("wcu-native-" + $runtimeKey + '-' + (Get-CsHash -Source $script:WcuCs) + ".dll")
      Import-HelperAssembly -Path $dll -Compile { param($out) Add-Type -TypeDefinition $script:WcuCs -OutputAssembly $out }
    }
  }
  Write-BackendStage 'native-load-complete'
  Set-DpiAware
  Write-BackendStage 'uia-assemblies-start'

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  # Standard Win32 controls need the client-side providers. Without these,
  # controls can silently appear as unnamed Pane nodes with no Value pattern.
  Add-Type -AssemblyName UIAutomationClientsideProviders
  # Register the exported table directly: .NET 10 assembly-name casing breaks proxy type lookup.
  Write-BackendStage 'uia-providers-start'
  $providers = [UIAutomationClientsideProviders.UIAutomationClientSideProviders]::ClientSideProviderDescriptionTable
  try {
    [System.Windows.Automation.ClientSettings]::RegisterClientSideProviders($providers)
  } catch {
    # .NET Framework's first registration can initialize its proxy table and
    # throw NullReferenceException. A single second registration completes it.
    if ($_.Exception.InnerException -isnot [NullReferenceException]) { throw }
    [System.Windows.Automation.ClientSettings]::RegisterClientSideProviders($providers)
  }
  Write-BackendStage 'uia-providers-complete'
  Add-Type -AssemblyName WindowsBase
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Write-BackendStage 'assemblies-complete'
}

function Set-DpiAware {
  # Per-Monitor V2 (context value -4); fall back to system-aware. Must run
  # before any screen/UIA work so coordinates and pixels are physical.
  $ok = $false
  try { $ok = [WindowsComputerUseNative]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) }
  catch [EntryPointNotFoundException] {}
  if (-not $ok) {
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
  param([object]$Element)
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
  param([object]$Element)
  if (Invoke-Safe { $Element.Current.IsPassword } $true) { return $null }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) } $false) {
    return Invoke-Safe { $pattern.Current.Value } $null
  }
  return $null
}

function New-ElementCacheRequest {
  param([string]$DetailLevel = "compact")
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.TreeScope = [System.Windows.Automation.TreeScope]::Element
  $cache.TreeFilter = [System.Windows.Automation.Automation]::RawViewCondition
  # Full keeps a live reference for navigation/actions; all observation reads
  # below use Cached, including RuntimeId. Never fetch an entire subtree.
  $cache.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::Full
  foreach ($name in @('Name','AutomationId','ClassName','ControlType','BoundingRectangle',
      'IsEnabled','IsOffscreen','HasKeyboardFocus','ProcessId','NativeWindowHandle','RuntimeId','FrameworkId','IsPassword')) {
    $cache.Add([System.Windows.Automation.AutomationElement]::("${name}Property"))
  }
  if ($DetailLevel -eq "full") {
    $cache.Add([System.Windows.Automation.AutomationElement]::LocalizedControlTypeProperty)
    $cache.Add([System.Windows.Automation.ValuePattern]::ValueProperty)
    foreach ($pattern in @([System.Windows.Automation.InvokePattern]::Pattern,
        [System.Windows.Automation.ValuePattern]::Pattern, [System.Windows.Automation.TogglePattern]::Pattern,
        [System.Windows.Automation.SelectionItemPattern]::Pattern,
        [System.Windows.Automation.ExpandCollapsePattern]::Pattern, [System.Windows.Automation.ScrollItemPattern]::Pattern)) {
      $cache.Add($pattern)
    }
  }
  return $cache
}

$script:ElementGeneration = [long]0
$script:ElementRegistry = @{}
function Register-ObservedElement {
  param([string]$Id,[object]$Element,[object]$Owner)
  if ($null -eq $script:ElementRegistry) { $script:ElementRegistry=@{} }
  if (-not $script:ElementRegistry.ContainsKey($Id) -and $script:ElementRegistry.Count -ge 6000) {
    $candidates=@($script:ElementRegistry.GetEnumerator() | Where-Object {
      [long]$_.Value.generation -ne [long]$script:ElementGeneration
    } | Sort-Object { [long]$_.Value.ts } | Select-Object -First 1000)
    foreach ($old in $candidates) { $script:ElementRegistry.Remove($old.Key) }
  }
  $script:ElementRegistry[$Id]=@{element=$Element;hwnd=$Owner.nativeWindowHandle;processId=$Owner.processId;
    ts=[DateTimeOffset]::Now.ToUnixTimeMilliseconds();generation=$script:ElementGeneration}
}
$script:ObservationOwner = $null
$script:NativeOwners = @{}
function Convert-ElementInfo {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [string]$Id = $null,
    [int]$Depth = 0,
    [string]$DetailLevel = "full",
    [switch]$UseCache
  )
  if (-not $UseCache) {
    $Element = $Element.GetUpdatedCache((New-ElementCacheRequest $DetailLevel))
  }
  $cached = try { $Element.Cached } catch { $null }
  $rect = Convert-Rect $(try { $cached.BoundingRectangle } catch { $null })
  $rtArr = try { @($Element.GetCachedPropertyValue([System.Windows.Automation.AutomationElement]::RuntimeIdProperty)) } catch { $null }
  $rtStr = $null
  if ($null -ne $rtArr -and $rtArr.Count -ge 2) { $rtStr = ($rtArr | ForEach-Object { [int]$_ }) -join "-" }
  $info = [ordered]@{
    id = if ($null -ne $rtStr) { "uia:rt:$rtStr" } else { $Id }
    depth = $Depth
    name = $(try { $cached.Name } catch { "" })
    automationId = $(try { $cached.AutomationId } catch { "" })
    className = $(try { $cached.ClassName } catch { "" })
    controlType = Get-ControlTypeName $(try { $cached.ControlType } catch { $null })
    boundingBox = $rect
    isEnabled = $(try { $cached.IsEnabled } catch { $null })
    isOffscreen = $(try { $cached.IsOffscreen } catch { $null })
    hasKeyboardFocus = $(try { $cached.HasKeyboardFocus } catch { $null })
  }
  if ($null -ne $rtStr -and $null -ne $script:ObservationOwner) {
    Register-ObservedElement "uia:rt:$rtStr" $Element $script:ObservationOwner
  }
  if ($DetailLevel -eq "full") {
    $valuePattern = $null
    $patterns = New-Object System.Collections.Generic.List[string]
    foreach ($pair in @(
      @('Invoke', [System.Windows.Automation.InvokePattern]::Pattern),
      @('Value', [System.Windows.Automation.ValuePattern]::Pattern),
      @('Toggle', [System.Windows.Automation.TogglePattern]::Pattern),
      @('SelectionItem', [System.Windows.Automation.SelectionItemPattern]::Pattern),
      @('ExpandCollapse', [System.Windows.Automation.ExpandCollapsePattern]::Pattern),
      @('ScrollItem', [System.Windows.Automation.ScrollItemPattern]::Pattern)
    )) {
      $pat = try { $Element.GetCachedPattern($pair[1]) } catch { $null }
      if ($null -ne $pat) {
        $patterns.Add($pair[0])
        if ($pair[0] -eq 'Value') { $valuePattern = $pat }
      }
    }
    $info["localizedControlType"] = try { $cached.LocalizedControlType } catch { "" }
    $info["processId"] = try { $cached.ProcessId } catch { $null }
    $info["nativeWindowHandle"] = try { $cached.NativeWindowHandle } catch { $null }
    $info["runtimeId"] = $rtStr
    $isPassword = Invoke-Safe { $cached.IsPassword } $true
    $info["value"] = if ($null -ne $valuePattern -and -not $isPassword) { try { $valuePattern.Cached.Value } catch { $null } } else { $null }
    $info["patterns"] = [string[]]$patterns.ToArray()
  } else {
    if ($Depth -le 1) { $info["processId"] = try { $cached.ProcessId } catch { $null } }
    $nativeHwnd = try { $cached.NativeWindowHandle } catch { 0 }
    if ($nativeHwnd) { $info["nativeWindowHandle"] = $nativeHwnd }
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
  param([object]$Element)
  $hwnd = if (Get-Prop $Element 'nativeWindowHandle' 0) { [int64]$Element.nativeWindowHandle } else { Invoke-Safe { $Element.Current.NativeWindowHandle } 0 }
  if (-not ($hwnd -and $hwnd -ne 0)) { return $false }
  Assert-NativeInputTarget $hwnd
  $ptr = [IntPtr]([int64]$hwnd)

  # SW_RESTORE is not a no-op on maximized/snapped windows: it un-maximizes
  # them. Only restore windows that are actually minimized.
  if ([WindowsComputerUseNative]::IsIconic($ptr)) {
    if ($env:WCU_CANCEL_EVENT) { [WindowsComputerUseNative]::ThrowIfCancelled() }
    [WindowsComputerUseNative]::ShowWindow($ptr, 9) | Out-Null
    # Wait until it is restored. A window that ignores ShowWindow still takes
    # the Restore command of its system menu (WM_SYSCOMMAND, SC_RESTORE).
    for ($i = 0; $i -lt 10 -and [WindowsComputerUseNative]::IsIconic($ptr); $i++) {
      if ($i -eq 4) { [void][WindowsComputerUseNative]::PostMessageW($ptr, 0x0112, [IntPtr]0xF120, [IntPtr]::Zero) }
      Start-Sleep -Milliseconds 50
    }
    # A minimized window can still take the foreground, but nobody sees it and
    # input would go to it unseen: report the activation as failed.
    if ([WindowsComputerUseNative]::IsIconic($ptr)) { return $false }
    Start-Sleep -Milliseconds 80
  }
  # First without a key press: joining the input of the thread in front lets
  # SetForegroundWindow pass the foreground on (it worked every time on local
  # fixtures). A lone Alt, below, can move focus to an app's menu bar.
  if ($env:WCU_CANCEL_EVENT) { [WindowsComputerUseNative]::ThrowIfCancelled() }
  if ([WindowsComputerUseNative]::GiveForeground($ptr)) { Start-Sleep -Milliseconds 60; return $true }

  # Beat the Windows foreground lock: a background process is normally
  # silently refused by SetForegroundWindow. Attaching our input thread to
  # the current foreground window's thread and tapping the Alt key releases
  # the lock long enough to switch (classic AutoHotkey trick).
  $fgPtr = [WindowsComputerUseNative]::GetForegroundWindow()
  $fgProcess = [uint32]0
  $fgThread = [WindowsComputerUseNative]::GetWindowThreadProcessId($fgPtr, [ref]$fgProcess)
  if (-not $fgThread) { return $false }
  $ownThread = [WindowsComputerUseNative]::GetCurrentThreadId()
  $attached = $false
  if ($fgThread -ne $ownThread) {
    $attached = [WindowsComputerUseNative]::AttachThreadInput($ownThread, $fgThread, $true)
  }
  try {
    if ($env:WCU_CANCEL_EVENT) { [WindowsComputerUseNative]::ThrowIfCancelled() }
    [void][WindowsComputerUseNative]::keybd_event([WindowsComputerUseNative]::VK_MENU, 0, 0, [UIntPtr]([uint64][WindowsComputerUseNative]::InputMarker))
    [void][WindowsComputerUseNative]::keybd_event([WindowsComputerUseNative]::VK_MENU, 0, [WindowsComputerUseNative]::KEYEVENTF_KEYUP, [UIntPtr]([uint64][WindowsComputerUseNative]::InputMarker))
    if ($env:WCU_CANCEL_EVENT) { [WindowsComputerUseNative]::ThrowIfCancelled() }
    [WindowsComputerUseNative]::SetForegroundWindow($ptr) | Out-Null
    Start-Sleep -Milliseconds 120
  } finally {
    if ($attached) { [void][WindowsComputerUseNative]::AttachThreadInput($ownThread, $fgThread, $false) }
  }

  # Verify the switch actually happened; report it so callers can react.
  $nowFg = [WindowsComputerUseNative]::GetForegroundWindow()
  return ($nowFg -eq $ptr)
}

function Activate-TargetIfRequested {
  param([object]$InputObject)
  if ((Has-WindowTarget $InputObject) -and [bool](Get-Prop $InputObject "activate" $false)) {
    $target = Get-ObservationWindow $InputObject
    Assert-NativeInputTarget ([int64]$target.nativeWindowHandle)
    $ok = Set-WindowForeground $target
    if (-not $ok) {
      $title = [string](Get-Prop $InputObject "windowTitle" "")
      throw "Failed to bring the target window ('$title') to the foreground (Windows foreground lock). Input was NOT sent. Try again, or pass a different window target."
    }
  }
}

# Same-process windows are not interchangeable (Explorer, browsers and UWP).
function Assert-InputProcess {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { throw 'INPUT_TARGET_UNAVAILABLE: the target process could not be identified.' }
  $hostProcess=0
  [void][int]::TryParse([string]$env:WCU_HOST_PID,[ref]$hostProcess)
  if ($ProcessId -eq $PID -or ($hostProcess -gt 0 -and $ProcessId -eq $hostProcess) -or
      ($script:TakeoverProcessId -gt 0 -and $ProcessId -eq $script:TakeoverProcessId)) {
    throw 'HOST_INPUT_DENIED: desktop input cannot target the DSH host or computer-use helper.'
  }
  $checkImage = [bool]$env:WCU_HOST_EXECUTABLE
  $target = [WindowsComputerUseNative]::ReadInputProcess([uint32]$ProcessId, $checkImage)
  if ($target.Gone) { throw 'INPUT_TARGET_UNAVAILABLE: the target process has exited. No input was sent.' }
  if ($checkImage -and $target.ImagePath -and
      [string]::Equals([IO.Path]::GetFullPath($target.ImagePath),[IO.Path]::GetFullPath($env:WCU_HOST_EXECUTABLE),[StringComparison]::OrdinalIgnoreCase)) {
    throw 'HOST_INPUT_DENIED: desktop input cannot target a DSH host executable window.'
  }
  $currentIntegrity = [WindowsComputerUseNative]::ReadCurrentIntegrity()
  if ($null -ne $target.Integrity -and $null -ne $currentIntegrity -and $target.Integrity -gt $currentIntegrity) {
    throw 'ELEVATED_TARGET_DENIED: the target window has a higher Windows integrity level than the input worker. No input was sent.'
  }
  if ($target.TokenAccessDenied) {
    throw 'INPUT_TARGET_ACCESS_UNCONFIRMED: Windows denied access to verify the target integrity level. It may be running as administrator. Open a non-elevated instance if possible. No input was sent.'
  }
  if ($null -eq $target.Integrity -or $null -eq $currentIntegrity -or ($checkImage -and -not $target.ImagePath)) {
    throw 'INPUT_TARGET_ACCESS_UNCONFIRMED: Windows did not allow the target identity or integrity level to be verified. No input was sent.'
  }
}

function Assert-NativeInputTarget {
  param([long]$Hwnd)
  if (-not $Hwnd -or -not [WindowsComputerUseNative]::IsWindow([IntPtr]$Hwnd)) {
    throw 'INPUT_TARGET_UNAVAILABLE: no live target window was resolved.'
  }
  Assert-InputProcess (Get-WindowProcessId $Hwnd)
}

function Test-InputWindow {
  param([long]$Candidate, [long]$Target, [hashtable]$State = $null)
  if (-not $Candidate -or -not $Target) { return $false }
  if ($Candidate -eq $Target) { return $true }
  $owner = $Candidate
  $seen = @{}
  for ($depth = 0; $depth -lt 40 -and $owner -and -not $seen.ContainsKey([string]$owner); $depth++) {
    $seen[[string]$owner] = $true
    $owner = [WindowsComputerUseNative]::GetWindow([IntPtr]$owner, 4).ToInt64()
    if ($owner -eq $Target) { return $true }
  }
  if ($null -ne $State -and $State.procId -and (Get-WindowProcessId $Candidate) -eq $State.procId -and $State.popups -notcontains $Candidate) {
    return (@([WindowsComputerUseNative]::VisiblePopups([uint32]$State.procId)) -contains $Candidate)
  }
  return $false
}

function Assert-InFront {
  param([hashtable]$State)
  if (-not $State.target) { return }
  $front = [WindowsComputerUseNative]::GetForegroundWindow().ToInt64()
  if (-not (Test-InputWindow $front $State.target $State)) {
    throw 'The target window is no longer in front (another window took the foreground), so no input was sent. Try again.'
  }
}

function Assert-ElementFocus {
  param([object]$Element)
  if (-not (Invoke-Safe { [bool]$Element.Current.HasKeyboardFocus } $false)) {
    throw 'ELEMENT_FOCUS_UNCONFIRMED: the requested element did not retain keyboard focus; no replacement text was sent.'
  }
}

# ============================================================================
# Less takeover. Each action uses the least intrusive way that works:
# 1. Background element actions: window messages (BM_CLICK, EM_REPLACESEL) or
#    UIA patterns, with no pointer, keyboard or clipboard. Some UIA providers
#    bring their window forward or move the pointer on their own (managed
#    Win32 proxies call SetForegroundWindow; a list view item's Invoke clicks
#    with the real pointer); both are given back at once.
# 2. Real input, only when nothing else works: the target comes forward for
#    the action, then the pointer goes back where the user left it and the
#    window the user had in front gets the foreground back. The target stays
#    in front while a menu, a drop-down or a dialog the action opened shows,
#    when the user switched windows meanwhile, and with activate:true.
# Input without a window target goes to the window DSH gave input to last in
# this operation series, never into the window the user got back.
# ============================================================================
$script:InputWindow = @{ series = $null; hwnd = [int64]0; at = 0 }
$script:WcuSeries = $null
$script:WcuQuiet = $false

function Get-WindowProcessId {
  param([long]$Hwnd)
  $procId = [uint32]0
  if ($Hwnd) { [void][WindowsComputerUseNative]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$procId) }
  return $procId
}

function Get-RootWindow {
  param([long]$Hwnd)
  if (-not $Hwnd) { return [int64]0 }
  return [WindowsComputerUseNative]::GetAncestor([IntPtr]$Hwnd, 2).ToInt64()
}

function Get-RootWindowAt {
  param([int]$X, [int]$Y)
  $point = New-Object WindowsComputerUseNative+POINT
  $point.x = $X; $point.y = $Y
  return (Get-RootWindow ([WindowsComputerUseNative]::WindowFromPoint($point).ToInt64()))
}

# The top-level window of a UIA element: most elements have no window handle
# of their own, so the nearest ancestor that has one decides.
function Get-ElementWindow {
  param([object]$Element)
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $Element
  for ($depth = 0; $null -ne $node -and $depth -lt 40; $depth++) {
    $hwnd = Invoke-Safe { [int64]$node.Current.NativeWindowHandle } 0
    if ($hwnd) { return (Get-RootWindow $hwnd) }
    $node = Invoke-Safe { $walker.GetParent($node) } $null
  }
  return [int64]0
}

# The window DSH works in: the window it gave input to last in this series
# (within two minutes when no series is known), while that window is still
# open; else the window in front. After the foreground went back to the user,
# input and observations without a window target keep to DSH's window.
function Get-WorkWindow {
  $last = $script:InputWindow
  $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $same = if ($null -ne $script:WcuSeries) { $last.series -eq $script:WcuSeries } else { $null -eq $last.series -and ($now - [int64]$last.at) -lt 120000 }
  if ($same -and $last.hwnd -and [WindowsComputerUseNative]::IsWindow([IntPtr]$last.hwnd) -and [WindowsComputerUseNative]::IsWindowVisible([IntPtr]$last.hwnd)) { return [int64]$last.hwnd }
  return [WindowsComputerUseNative]::GetForegroundWindow().ToInt64()
}

# A background element action (set_value, invoke, a pattern click, an element
# scroll) works in a window too: input without a window target goes there next,
# as after real input. set_value on a field, then keypress Enter, issue #82.
function Set-WorkWindow {
  param([long]$Hwnd)
  if ($Hwnd) { $script:InputWindow = @{ series = $script:WcuSeries; hwnd = [int64]$Hwnd; at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() } }
}

# The window that input for this call goes to: the requested target, else the
# window DSH works in. $script:InputWindowVia says which, so a result can tell
# when the keys went to whatever window happened to be in front.
function Resolve-InputWindow {
  param([object]$InputObject)
  if (Has-WindowTarget $InputObject) {
    $target = Get-ObservationWindow $InputObject
    if ($null -eq $target) { throw 'No native target window found.' }
    $hwnd=[int64]$target.nativeWindowHandle
    $script:InputWindowVia = 'window target'
  } else {
    $hwnd=Get-WorkWindow
    $script:InputWindowVia = if ($script:InputWindow.hwnd -and $hwnd -eq [int64]$script:InputWindow.hwnd) { 'last DSH window' } else { 'front window' }
  }
  Assert-NativeInputTarget $hwnd
  return $hwnd
}

# Before real input: note the window in front and the pointer, then bring the
# target (a top-level window, or 0 for whatever is in front) forward. With
# -NoActivate the input itself brings it forward (a click on an uncovered
# point, a UIA SetFocus); it is given back all the same.
function Start-Input {
  param([object]$InputObject, [long]$Hwnd, [switch]$NoActivate)
  Assert-NativeInputTarget $Hwnd
  # Low disruption: from here until Complete-Input the user's own keys and
  # mouse actions are held, then replayed to their window. A modifier or
  # button they already hold gets a second to come up.
  if ($script:WcuLowDisruption -and -not $script:WcuHolding -and -not (Get-Prop $InputObject 'activate' $false)) {
    $script:WcuHolding = [WcuInputHold]::Begin($Hwnd)
    if ($script:WcuHolding -and -not [WcuInputHold]::WaitForRelease(1000)) {
      [void](Stop-InputHold)
      throw 'WCU_USER_INPUT_HELD: The user is holding a key or mouse button, so nothing was sent. Try again in a moment, or use an element action, which needs neither.'
    }
  }
  try {
    $cursor = New-Object WindowsComputerUseNative+POINT
    [void][WindowsComputerUseNative]::GetCursorPos([ref]$cursor)
    $state = @{ user = [WindowsComputerUseNative]::GetForegroundWindow().ToInt64(); target = [int64]$Hwnd; keep = [bool](Get-Prop $InputObject 'activate' $false)
      cursor = $cursor; moved = $null; borrowed = $false; procId = (Get-WindowProcessId $Hwnd); popups = @() }
    if ($state.procId) { $state.popups = @([WindowsComputerUseNative]::VisiblePopups([uint32]$state.procId)) }
    if ($state.target -and $state.user -ne $state.target) {
      if (-not $NoActivate -and -not (Set-WindowForeground ([pscustomobject]@{ nativeWindowHandle = $state.target }))) {
        throw 'The target window could not be brought to the foreground (Windows foreground lock), so no input was sent. Try again, or call activate_window first.'
      }
      $state.borrowed = $true
    }
    return $state
  } catch {
    if ($script:WcuHolding) { [void](Stop-InputHold) }
    throw
  }
}

# The end of a hold: replays what the user did meanwhile (WcuInputHold::End).
# $Windows: what DSH worked in. Returns the note for the result, or $null.
function Stop-InputHold {
  param([long[]]$Windows = @())
  $script:WcuHolding = $false
  return [WcuInputHold]::End([long[]]$Windows)
}

# Real input lands on whatever shows at the point. With the target in front,
# the point must show the target or a window of its process (its menu, list or
# dialog); otherwise nothing is sent. WindowFromPoint skips the DSH indicator,
# which is layered and click-through.
function Assert-PointOnTarget {
  param([int]$X, [int]$Y, [long]$Target, [hashtable]$State = $null)
  if (-not $Target) { return }
  $hit = Get-RootWindowAt $X $Y
  if (Test-InputWindow $hit $Target $State) { return }
  $title = New-Object System.Text.StringBuilder 256
  [void][WindowsComputerUseNative]::GetWindowText([IntPtr]$hit, $title, 256)
  $class = New-Object System.Text.StringBuilder 128
  [void][WindowsComputerUseNative]::GetClassName([IntPtr]$hit, $class, 128)
  throw "POINT_COVERED: ($X,$Y) shows another window ('$($title.ToString())', class $($class.ToString()), HWND $hit) above the target, so no input was sent. Move or close that window, or pick a point of the target that is not covered."
}

# After real input, and under Low disruption also the end of the hold, whose
# note goes to the result as userInput.
function Complete-Input {
  param([hashtable]$State, [System.Collections.IDictionary]$Result)
  try { Complete-BorrowedInput $State $Result }
  finally {
    if ($script:WcuHolding) {
      # What DSH worked in: the target and the menus, lists and dialogs it opened.
      $windows = @()
      if ($State.target) { $windows += [int64]$State.target }
      if ($State.procId) { $windows += @([WindowsComputerUseNative]::VisiblePopups([uint32]$State.procId) | Where-Object { $State.popups -notcontains $_ }) }
      $note = Stop-InputHold $windows
      if ($note) { $Result['userInput'] = $note }
    }
  }
}

# Put the pointer back if it is still where DSH left it, and give the
# foreground back (see the section note). Adds pointer/foreground to the
# result, saying what was done.
function Complete-BorrowedInput {
  param([hashtable]$State, [System.Collections.IDictionary]$Result)
  $target = if ($State.target) { $State.target } else { [WindowsComputerUseNative]::GetForegroundWindow().ToInt64() }
  if ($target) { $script:InputWindow = @{ series = $script:WcuSeries; hwnd = [int64]$target; at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() } }
  if ($State.drain) {
    $front = [WindowsComputerUseNative]::GetForegroundWindow()
    if (Test-InputWindow $front.ToInt64() $State.target $State) {
      # WM_NULL can return ahead of pending SendInput events. Wait for a paint
      # on the receiving thread, bounded to avoid holding up a busy app.
      $paint = [WindowsComputerUseNative]::RequestPaint($front)
      $limit = if ($paint) { 1200 } else { 150 }
      $watch = [Diagnostics.Stopwatch]::StartNew()
      while ($watch.ElapsedMilliseconds -lt $limit -and [WindowsComputerUseNative]::GetForegroundWindow() -eq $front) {
        if ($paint -and -not [WindowsComputerUseNative]::PaintPending($front)) { break }
        Start-Sleep -Milliseconds 15
      }
      if (-not $paint -or [WindowsComputerUseNative]::PaintPending($front)) { $Result['inputQueue'] = 'unconfirmed' }
    }
  }
  if ($null -ne $State.moved) {
    $now = New-Object WindowsComputerUseNative+POINT
    [void][WindowsComputerUseNative]::GetCursorPos([ref]$now)
    if ($now.x -eq $State.moved.x -and $now.y -eq $State.moved.y) {
      [void][WindowsComputerUseNative]::SetCursorPos($State.cursor.x, $State.cursor.y)
      $Result['pointer'] = 'returned'
    } else { $Result['pointer'] = 'left where the user moved it' }
  }
  if (-not $State.borrowed) { return }
  if ($State.keep) { $Result['foreground'] = 'kept in front (activate:true)'; return }
  # Let the target handle the input before deciding.
  if (-not $State.drain) {
    $ignored = [UIntPtr]::Zero
    for ($i = 0; $i -lt 2; $i++) { [void][WindowsComputerUseNative]::SendMessageTimeout([IntPtr]$State.target, 0, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$ignored) }
  }
  $front = [WindowsComputerUseNative]::GetForegroundWindow().ToInt64()
  if (-not (Test-InputWindow $front $State.target $State)) { $Result['foreground'] = 'left: another window is in front now'; return }
  $opened = @([WindowsComputerUseNative]::VisiblePopups([uint32]$State.procId) | Where-Object { $State.popups -notcontains $_ })
  if ([WindowsComputerUseNative]::InMenuMode([IntPtr]$State.target) -or $opened.Count) { $Result['foreground'] = 'kept in front: a menu, list or dialog it opened is showing'; return }
  if (-not ([WindowsComputerUseNative]::IsWindow([IntPtr]$State.user) -and [WindowsComputerUseNative]::IsWindowVisible([IntPtr]$State.user))) { $Result['foreground'] = 'kept in front: the window that was in front is gone'; return }
  $Result['foreground'] = if ([WindowsComputerUseNative]::GiveForeground([IntPtr]$State.user)) { 'returned' } else { 'kept in front: Windows refused to switch back' }
}

# Where keys or text go: a window and, while it is in front, the control with
# the keyboard focus there. The control is read through UI Automation only when
# the window answers messages, so a hung app cannot hold the call. $Via says how
# the window was chosen (Resolve-InputWindow). Title and name are app text.
function Get-KeyDestination {
  param([long]$Hwnd, [string]$Via)
  $title = New-Object System.Text.StringBuilder 256
  [void][WindowsComputerUseNative]::GetWindowText([IntPtr]$Hwnd, $title, 256)
  $text = $title.ToString()
  if ($text.Length -gt 80) { $text = $text.Substring(0, 80) + '...' }
  $info = [ordered]@{ nativeWindowHandle = $Hwnd; processId = (Get-WindowProcessId $Hwnd); title = $text }
  if ($Via) { $info['via'] = $Via }
  if ([WindowsComputerUseNative]::GetForegroundWindow().ToInt64() -eq $Hwnd -and [WindowsComputerUseNative]::IsResponsive([IntPtr]$Hwnd)) {
    $focused = Invoke-Safe { [System.Windows.Automation.AutomationElement]::FocusedElement } $null
    if ($null -ne $focused) {
      $type = Get-ControlTypeName (Invoke-Safe { $focused.Current.ControlType } $null)
      $name = [string](Invoke-Safe { $focused.Current.Name } '')
      if ($name.Length -gt 60) { $name = $name.Substring(0, 60) + '...' }
      if ($type) { $info['focus'] = if ($name) { "$type '$name'" } else { $type } }
    }
  }
  return $info
}

# A background element action whose UIA provider may take the foreground or
# the pointer on its own: whatever it took is given back, except while a menu
# or list the call opened is showing. The report goes to $script:BackgroundReport.
function Invoke-Guarded {
  param([scriptblock]$Call, [object]$Element)
  $front = [WindowsComputerUseNative]::GetForegroundWindow().ToInt64()
  $cursor = New-Object WindowsComputerUseNative+POINT
  [void][WindowsComputerUseNative]::GetCursorPos([ref]$cursor)
  $procId = [uint32](Invoke-Safe { $Element.Current.ProcessId } 0)
  Assert-InputProcess $procId
  $popups = @([WindowsComputerUseNative]::VisiblePopups($procId))
  $script:BackgroundReport = [ordered]@{}
  if ($script:WcuLowDisruption) { [WcuInputHold]::Snapshot() }
  try { return (& $Call) }
  finally {
    $now = New-Object WindowsComputerUseNative+POINT
    [void][WindowsComputerUseNative]::GetCursorPos([ref]$now)
    if ($now.x -ne $cursor.x -or $now.y -ne $cursor.y) {
      $box = Convert-Rect (Invoke-Safe { $Element.Current.BoundingRectangle } $null)
      if ($null -ne $box -and $now.x -ge $box.x - 2 -and $now.y -ge $box.y - 2 -and $now.x -le $box.x + $box.width + 2 -and $now.y -le $box.y + $box.height + 2) {
        [void][WindowsComputerUseNative]::SetCursorPos($cursor.x, $cursor.y)
        $script:BackgroundReport['pointer'] = 'returned (the app moved it)'
      }
    }
    $after = [WindowsComputerUseNative]::GetForegroundWindow().ToInt64()
    if ($after -ne $front -and $procId -and (Get-WindowProcessId $after) -eq $procId -and $front -and [WindowsComputerUseNative]::IsWindow([IntPtr]$front)) {
      $opened = @([WindowsComputerUseNative]::VisiblePopups($procId) | Where-Object { $popups -notcontains $_ })
      $script:BackgroundReport['foreground'] = if ([WindowsComputerUseNative]::InMenuMode([IntPtr]$after) -or $opened.Count) { 'kept: the app came forward and a menu, list or dialog it opened is showing' }
        elseif ([WindowsComputerUseNative]::GiveForeground([IntPtr]$front)) { 'returned (the app had come forward)' } else { 'kept: the app came forward and Windows refused to switch back' }
      if ($script:WcuLowDisruption -and $script:BackgroundReport['foreground'] -like 'kept*' -and [WcuInputHold]::ArmGuard([long[]](@([int64]$after) + $opened), [long[]]@([int64]$procId))) { $script:BackgroundReport['userInput'] = [WcuInputHold]::GuardNote }
    }
  }
}

# A Win32 or WinForms push button, check box or radio button takes BM_CLICK in
# its own message queue: no pointer, no foreground (measured on WinForms; the
# managed UIA proxy's Invoke calls SetForegroundWindow instead). Posted, so a
# dialog the click opens cannot hold the call; WM_NULL then waits until the
# button has handled it. $null when the element is no such button.
function Invoke-NativeButton {
  param([object]$Element)
  $hwnd = Invoke-Safe { [int64]$Element.Current.NativeWindowHandle } 0
  if (-not $hwnd) { return $null }
  $class = New-Object System.Text.StringBuilder 128
  [void][WindowsComputerUseNative]::GetClassName([IntPtr]$hwnd, $class, 128)
  if ($class.ToString() -notmatch '^(Button|WindowsForms10\.BUTTON\..*)$') { return $null }
  # BS_GROUPBOX (7) frames other controls and takes no click.
  if (([WindowsComputerUseNative]::GetWindowLong([IntPtr]$hwnd, -16) -band 0xF) -eq 7) { return $null }
  if (-not [WindowsComputerUseNative]::IsWindowEnabled([IntPtr]$hwnd)) { throw 'ELEMENT_DISABLED: the button is disabled; it does not respond to clicks.' }
  [void](Test-Failsafe)
  if (-not [WindowsComputerUseNative]::PostMessageW([IntPtr]$hwnd, [WindowsComputerUseNative]::BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)) { return $null }
  $ignored = [UIntPtr]::Zero
  [void][WindowsComputerUseNative]::SendMessageTimeout([IntPtr]$hwnd, 0, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 2000, [ref]$ignored)
  return 'BM_CLICK'
}

$script:NativeEditClass = '^(Edit|RichEdit\w*|WindowsForms10\.EDIT\..*|WindowsForms10\.RichEdit\w*\..*)$'

# A Win32 edit or rich edit takes its text through EM_SETSEL + EM_REPLACESEL,
# as typing would (the change notifications fire), with no focus, foreground
# or clipboard. $null when the element is no such control.
function Set-NativeEditText {
  param([object]$Element, [string]$Value)
  $hwnd = Invoke-Safe { [int64]$Element.Current.NativeWindowHandle } 0
  if (-not $hwnd) { return $null }
  $class = New-Object System.Text.StringBuilder 128
  [void][WindowsComputerUseNative]::GetClassName([IntPtr]$hwnd, $class, 128)
  if ($class.ToString() -notmatch $script:NativeEditClass) { return $null }
  # ES_READONLY (0x0800)
  if (([WindowsComputerUseNative]::GetWindowLong([IntPtr]$hwnd, -16) -band 0x0800) -ne 0) { throw 'ELEMENT_READ_ONLY: the field is read-only; it takes no value.' }
  if (-not [WindowsComputerUseNative]::IsWindowEnabled([IntPtr]$hwnd)) { throw 'ELEMENT_DISABLED: the field is disabled; it takes no value.' }
  [void](Test-Failsafe)
  $ignored = [UIntPtr]::Zero
  if ([WindowsComputerUseNative]::SendMessageTimeout([IntPtr]$hwnd, [WindowsComputerUseNative]::EM_SETSEL, [UIntPtr]::Zero, [IntPtr](-1), 2, 2000, [ref]$ignored) -eq [IntPtr]::Zero) { return $null }
  if ([WindowsComputerUseNative]::SendMessageTimeoutW([IntPtr]$hwnd, [WindowsComputerUseNative]::EM_REPLACESEL, [IntPtr]1, $Value, 2, 2000, [ref]$ignored) -eq [IntPtr]::Zero) { return $null }
  return 'EM_REPLACESEL'
}

# Typing without the keyboard: when the control with the focus in the window
# the text goes to is a Win32 edit, EM_REPLACESEL puts the text at its caret
# (in place of the selection), as typing or a paste would, with no pointer,
# keyboard, clipboard or foreground. Text with line breaks is left to real
# input, since a single-line edit handles Enter on its own. $null when this
# does not apply; else the edit and how much its length grew.
function Set-FocusedEditText {
  param([long]$Hwnd, [string]$Text)
  if (-not $Hwnd -or $Text -match "[`r`n]") { return $null }
  $focus = [WindowsComputerUseNative]::FocusedWindow([IntPtr]$Hwnd).ToInt64()
  if (-not $focus -or (Get-RootWindow $focus) -ne $Hwnd) { return $null }
  $class = New-Object System.Text.StringBuilder 128
  [void][WindowsComputerUseNative]::GetClassName([IntPtr]$focus, $class, 128)
  if ($class.ToString() -notmatch $script:NativeEditClass) { return $null }
  # ES_READONLY (0x0800)
  if (([WindowsComputerUseNative]::GetWindowLong([IntPtr]$focus, -16) -band 0x0800) -ne 0 -or -not [WindowsComputerUseNative]::IsWindowEnabled([IntPtr]$focus)) { return $null }
  [void](Test-Failsafe)
  $reply = [UIntPtr]::Zero
  if ([WindowsComputerUseNative]::SendMessageTimeout([IntPtr]$focus, [WindowsComputerUseNative]::WM_GETTEXTLENGTH, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 2000, [ref]$reply) -eq [IntPtr]::Zero) { return $null }
  $before = [double]$reply.ToUInt64()
  $ignored = [UIntPtr]::Zero
  if ([WindowsComputerUseNative]::SendMessageTimeoutW([IntPtr]$focus, [WindowsComputerUseNative]::EM_REPLACESEL, [IntPtr]1, $Text, 2, 2000, [ref]$ignored) -eq [IntPtr]::Zero) { return $null }
  [void][WindowsComputerUseNative]::SendMessageTimeout([IntPtr]$focus, [WindowsComputerUseNative]::WM_GETTEXTLENGTH, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 2000, [ref]$reply)
  return @{ hwnd = $focus; grew = [int]([double]$reply.ToUInt64() - $before) }
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
  [void](Test-Failsafe)
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
$script:WindowObservations = @{} # immutable token -> window identity and origin

function Get-FreshWindowRect {
  param([object]$Element)
  if (Get-Prop $Element 'nativeWindowHandle' 0) { return $Element.boundingBox }
  $hwnd = Invoke-Safe { [int64]$Element.Current.NativeWindowHandle } 0
  if ($hwnd) {
    $nativeRect = New-Object WindowsComputerUseNative+RECT
    if ([WindowsComputerUseNative]::GetWindowRect([IntPtr]$hwnd, [ref]$nativeRect)) {
      return [ordered]@{x=$nativeRect.left;y=$nativeRect.top;width=$nativeRect.right-$nativeRect.left;height=$nativeRect.bottom-$nativeRect.top}
    }
  }
  return Convert-Rect (Invoke-Safe { $Element.Current.BoundingRectangle } $null)
}

function Update-WindowCache {
  param([object]$Element)
  $hwnd = if (Get-Prop $Element 'nativeWindowHandle' 0) { [int64]$Element.nativeWindowHandle } else { Invoke-Safe { $Element.Current.NativeWindowHandle } 0 }
  if (-not $hwnd) { return }
  $rect = Get-FreshWindowRect $Element
  if ($null -eq $rect) { return }
  if ($null -eq $script:WindowObservations) { $script:WindowObservations=@{} }
  $token=[Guid]::NewGuid().ToString('N')
  $owner=[uint32](Get-Prop $Element 'processId' 0)
  if (-not $owner) { [void][WindowsComputerUseNative]::GetWindowThreadProcessId([IntPtr]$hwnd,[ref]$owner) }
  $entry=@{token=$token;x=$rect.x;y=$rect.y;hwnd=$hwnd;processId=$owner;ts=[DateTimeOffset]::Now.ToUnixTimeMilliseconds()}
  $script:WindowCache[[string]$hwnd]=$entry
  $script:WindowObservations[$token]=$entry
  if ($Element -is [System.Collections.IDictionary]) { $Element['observationToken']=$token }
  if ($script:WindowObservations.Count -gt 512) {
    foreach ($old in @($script:WindowObservations.GetEnumerator() | Sort-Object { [long]$_.Value.ts } | Select-Object -First 128)) {
      $script:WindowObservations.Remove($old.Key)
    }
  }
}

function Home-Point {
  # A point is already in current screen coordinates unless the caller
  # explicitly binds it to the origin of a previous observation.
  param([int]$X,[int]$Y,[object]$Target,[string]$ObservationToken='')
  $result=[ordered]@{x=$X;y=$Y;homed=$null}
  if (-not $ObservationToken) { return $result }
  $hwnd=if(Get-Prop $Target 'nativeWindowHandle' 0){[int64]$Target.nativeWindowHandle}else{Invoke-Safe {$Target.Current.NativeWindowHandle} 0}
  $cached=$script:WindowObservations[$ObservationToken]
  if ($null -eq $cached -or [int64]$cached.hwnd -ne $hwnd -or ([DateTimeOffset]::Now.ToUnixTimeMilliseconds()-[long]$cached.ts) -gt 300000) {
    throw 'OBSERVATION_TOKEN_STALE: re-observe the target and use its token or current screen coordinates.'
  }
  $owner=[uint32]0
  [void][WindowsComputerUseNative]::GetWindowThreadProcessId([IntPtr]$hwnd,[ref]$owner)
  if ($owner -ne [uint32]$cached.processId) { throw 'OBSERVATION_TOKEN_STALE: the target process changed.' }
  $now=Get-FreshWindowRect $Target
  if ($null -eq $now) { throw 'OBSERVATION_TOKEN_STALE: the target geometry is unavailable.' }
  $dx=$now.x-[int]$cached.x;$dy=$now.y-[int]$cached.y
  if ($dx -ne 0 -or $dy -ne 0) {
    $result.x=$X+$dx;$result.y=$Y+$dy
    $result.homed=[ordered]@{dx=$dx;dy=$dy;observationToken=$ObservationToken}
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
  param([object]$InputObject, [object]$Target)
  $title = [string](Get-Prop $InputObject "windowTitle" "")
  if ([string]::IsNullOrWhiteSpace($title) -or $null -eq $Target) { return }
  $hwnd = if (Get-Prop $Target 'nativeWindowHandle' 0) { [int64]$Target.nativeWindowHandle } else { Invoke-Safe { [int64]$Target.Current.NativeWindowHandle } 0 }
  $procId = if (Get-Prop $Target 'processId' 0) { [int]$Target.processId } else { Invoke-Safe { [int]$Target.Current.ProcessId } 0 }
  $script:WindowIdentity[$title.Trim().ToLowerInvariant()] = @{ hwnd = $hwnd; pid = $procId; ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
}

function Assert-WindowIdentity {
  param([object]$InputObject, [object]$Target)
  $title = [string](Get-Prop $InputObject "windowTitle" "")
  if ([string]::IsNullOrWhiteSpace($title) -or $null -eq $Target) { return }
  $key = $title.Trim().ToLowerInvariant()
  $hwnd = if (Get-Prop $Target 'nativeWindowHandle' 0) { [int64]$Target.nativeWindowHandle } else { Invoke-Safe { [int64]$Target.Current.NativeWindowHandle } 0 }
  $procId = if (Get-Prop $Target 'processId' 0) { [int]$Target.processId } else { Invoke-Safe { [int]$Target.Current.ProcessId } 0 }
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
  # Quiet actions are cancelled by the host's request/series state. They do not
  # arm the global stop listener; requiring its event here rejects the very
  # first background UIA/BM_CLICK/EM_REPLACESEL call in a real DSH session.
  # Assert-InputAllowed refuses physical input until the host upgrades the lease.
  if ($env:WCU_CANCEL_EVENT -and -not $script:WcuQuiet) { [WindowsComputerUseNative]::ThrowIfCancelled() }
  # Returns $true when an input action is ALLOWED. Throws when the failsafe
  # is engaged (cursor parked in the corner beyond the hold time).
  if ([string]$env:WCU_FAILSAFE -eq '0' -or $script:WcuCornerFailsafe -eq $false) { return $true }
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
  $target = Get-ObservationWindow $InputObject
  if ($null -eq $target) { throw 'No native target window found.' }
  Assert-NativeInputTarget ([int64]$target.nativeWindowHandle)
  return [int64]$target.nativeWindowHandle
}

function Post-BackgroundClick {
  # Post a button press/release at screen coords into the target window's
  # message queue (converted to client coords). Returns $true when the
  # messages were queued. The app may still ignore them (Chromium/Electron/
  # UWP) — callers must label the result as unverified.
  param([long]$Hwnd, [int]$X, [int]$Y, [string]$Button, [int]$Count)
  Assert-NativeInputTarget $Hwnd
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
  [void](Test-Failsafe)
  $ok = [WindowsComputerUseNative]::PostMessageW($ptr, $down, [IntPtr]$mk, $lp)
  Start-Sleep -Milliseconds 30
  $ok = [WindowsComputerUseNative]::PostMessageW($ptr, $up, [IntPtr]0, $lp) -and $ok
  if ($Count -ge 2 -and $dbl -ne 0) {
    # A real double-click: the double-click message carries the click, so a
    # second up completes it.
    Start-Sleep -Milliseconds 30
    [void](Test-Failsafe)
    $ok = [WindowsComputerUseNative]::PostMessageW($ptr, $dbl, [IntPtr]$mk, $lp) -and $ok
    Start-Sleep -Milliseconds 30
    $ok = [WindowsComputerUseNative]::PostMessageW($ptr, $up, [IntPtr]0, $lp) -and $ok
  }
  Start-Sleep -Milliseconds 40
  return $ok
}

# Posted keyboard messages go to the control with the keyboard focus in the
# target window. Each thread keeps its own focus while its windows are in the
# background. A top-level window does not pass characters posted to it on to
# its edit control, so posting to the window itself typed nothing. The focus
# may be the window itself (Chromium), but never a window outside the target.
function Get-BackgroundKeyTarget {
  param([long]$Hwnd)
  Assert-NativeInputTarget $Hwnd
  $focus = [WindowsComputerUseNative]::FocusedWindow([IntPtr]$Hwnd).ToInt64()
  if (-not $focus -or (Get-RootWindow $focus) -ne (Get-RootWindow $Hwnd)) {
    throw "background_unavailable: no control in the target window has the keyboard focus, so posted characters would reach nothing. Focus a field first (focus or click), or use method:'auto' / dispatch:'foreground'."
  }
  return $focus
}

# The text length of a Win32 edit, else $null: other controls answer
# WM_GETTEXTLENGTH with their caption, not their content.
function Get-EditTextLength {
  param([long]$Hwnd)
  $class = New-Object System.Text.StringBuilder 128
  [void][WindowsComputerUseNative]::GetClassName([IntPtr]$Hwnd, $class, 128)
  if ($class.ToString() -notmatch $script:NativeEditClass) { return $null }
  $reply = [UIntPtr]::Zero
  if ([WindowsComputerUseNative]::SendMessageTimeout([IntPtr]$Hwnd, [WindowsComputerUseNative]::WM_GETTEXTLENGTH, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$reply) -eq [IntPtr]::Zero) { return $null }
  return [int64]$reply.ToUInt64()
}

# Capture the expected post-input value of a small, plain Win32 edit. Treat
# password fields and unsupported or ambiguous reads as unverified.
function Get-SendInputEdit {
  param([IntPtr]$Focus, [string]$Text)
  if ($Focus -eq [IntPtr]::Zero -or $Text -match '\p{Cc}') { return $null }
  $class = New-Object System.Text.StringBuilder 128
  [void][WindowsComputerUseNative]::GetClassName($Focus, $class, 128)
  if ($class.ToString() -notmatch $script:NativeEditClass) { return $null }
  if (([WindowsComputerUseNative]::GetWindowLong($Focus, -16) -band 0x0020) -ne 0) { return $null } # ES_PASSWORD
  $reply = [UIntPtr]::Zero
  # EM_GETPASSWORDCHAR can identify a password mask installed at runtime.
  if ([WindowsComputerUseNative]::SendMessageTimeout($Focus, 0x00D2, [UIntPtr]::Zero, [IntPtr]::Zero, 3, 100, [ref]$reply) -eq [IntPtr]::Zero -or $reply.ToUInt64() -ne 0) { return $null }
  if ([WindowsComputerUseNative]::SendMessageTimeout($Focus, [WindowsComputerUseNative]::WM_GETTEXTLENGTH, [UIntPtr]::Zero, [IntPtr]::Zero, 3, 100, [ref]$reply) -eq [IntPtr]::Zero -or $reply.ToUInt64() + $Text.Length -gt 32768) { return $null }
  # Leave room for text the application adds itself, such as an autocomplete suffix.
  $capacity = [int]$reply.ToUInt64() + $Text.Length + 1026
  $before = [WindowsComputerUseNative]::ReadEditText($Focus, $capacity)
  if ($null -eq $before) { return $null }
  # RichEdit may count a line break as one selection unit but return CRLF in text.
  if ($class.ToString() -match 'RichEdit' -and $before -match "[`r`n]") { return $null }
  $selection = [WindowsComputerUseNative]::ReadEditSelection($Focus)
  if ($null -eq $selection) { return $null }
  $start, $end = $selection
  if ($start -gt $end -or $end -gt $before.Length) { return $null }
  $head = $before.Substring(0, $start) + $Text
  $tail = $before.Substring($end)
  $expected = $head + $tail
  if ([string]::Equals($expected, $before, [StringComparison]::Ordinal)) { return $null }
  return @{ expected = $expected; head = $head; tail = $tail; capacity = $capacity }
}

# SendInput returns once the keys sit in the target thread's input queue, but
# a key reaches whichever window has the focus when that thread takes it out.
# Giving the foreground back before then drops the rest of the text or sends
# it elsewhere (issue #90). So the foreground stays until the target has taken
# the keys; a repaint requested now arrives only after the last one.
#  - A readable edit is done once it holds the expected text. The wait goes on
#    while its text changes or the repaint is pending. After the repaint, reads
#    that show no change for 400 ms mean the keys are used up.
#  - Any other control waits at least 150 ms and until the repaint.
# The cap grows with the text. A foreground or focus change ends the wait.
# Returns 'observed', 'changed' (all typed text arrived, and the application
# added text or changed letter case), 'incomplete', or $null (not verified).
function Wait-SendInputEdit {
  param([IntPtr]$Front, [IntPtr]$Focus, [hashtable]$Edit, [int]$Length = 1)
  $wait = [Diagnostics.Stopwatch]::StartNew()
  $paint = [WindowsComputerUseNative]::RequestPaint($Focus)
  $limit = if ($null -eq $Edit) { [Math]::Min(5000, 150 + 50 * $Length) } else { [Math]::Min(15000, 1000 + 50 * $Length) }
  $classify = {
    param([string]$Value)
    if ([string]::Equals($Value, $Edit.expected, [StringComparison]::OrdinalIgnoreCase) -or
        ($Value.Length -gt $Edit.expected.Length -and $Value.StartsWith($Edit.head, [StringComparison]::Ordinal) -and $Value.EndsWith($Edit.tail, [StringComparison]::Ordinal))) { 'changed' } else { 'incomplete' }
  }
  $last = $null
  $still = [Diagnostics.Stopwatch]::StartNew()
  do {
    [void](Test-Failsafe)
    if ([WindowsComputerUseNative]::GetForegroundWindow() -ne $Front -or [WindowsComputerUseNative]::FocusedWindow($Front) -ne $Focus) {
      if ($null -eq $Edit) { return $null }
      $value = [WindowsComputerUseNative]::ReadEditText($Focus, $Edit.capacity)
      if ($null -ne $value -and [string]::Equals($value, $Edit.expected, [StringComparison]::Ordinal)) { return 'observed' }
      return 'incomplete'
    }
    $taken = -not ($paint -and [WindowsComputerUseNative]::PaintPending($Focus))
    if ($null -eq $Edit) {
      if ($taken -and $wait.ElapsedMilliseconds -ge 150) { return $null }
      Start-Sleep -Milliseconds 10
    } else {
      $value = [WindowsComputerUseNative]::ReadEditText($Focus, $Edit.capacity)
      if ($null -ne $value) {
        if ([string]::Equals($value, $Edit.expected, [StringComparison]::Ordinal)) { return 'observed' }
        if ($null -eq $last -or -not [string]::Equals($value, $last, [StringComparison]::Ordinal)) { $last = $value; $still.Restart() }
        elseif ($taken -and $still.ElapsedMilliseconds -ge 400) { return (& $classify $value) }
      }
      Start-Sleep -Milliseconds 25
    }
  } while ($wait.ElapsedMilliseconds -lt $limit)
  if ($null -eq $last) { return $null }
  if ($still.ElapsedMilliseconds -ge 400 -and -not ($paint -and [WindowsComputerUseNative]::PaintPending($Focus))) { return (& $classify $last) }
  return 'incomplete'
}

# Posted characters arrive after the post returns. For a Win32 edit, wait up
# to a second until its length grew by the text; when it did not (typing over
# a selection), the text is still found in its value. $null when the control
# is no Win32 edit and cannot be checked.
function Test-BackgroundTyped {
  param([long]$Hwnd, $Before, [string]$Text)
  if ($null -eq $Before) { return $null }
  $deadline = [DateTime]::UtcNow.AddMilliseconds(1000)
  do {
    Start-Sleep -Milliseconds 40
    $now = Get-EditTextLength $Hwnd
    if ($null -ne $now -and $now - $Before -eq $Text.Length) { return $true }
  } while ([DateTime]::UtcNow -lt $deadline)
  $value = Get-ValueText (Invoke-Safe { [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd) } $null)
  return ($null -ne $value -and $value.Contains($Text))
}

function Post-BackgroundText {
  # Post WM_CHAR per UTF-16 code unit to the given control. No clipboard,
  # no foreground, no system input queue. Works on controls that accept char
  # input (Edit, RichEdit, most Win32 dialogs).
  param([long]$Hwnd, [string]$Text)
  Assert-NativeInputTarget $Hwnd
  $ptr = [IntPtr]$Hwnd
  $allOk = $true
  foreach ($ch in $Text.ToCharArray()) {
    [void](Test-Failsafe)
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
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using Windows.Storage.Streams;

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

  // No tag: the Windows user languages, as before. A tag picks the installed
  // recognizer it names or that extends it ("zh-Hans" reads with zh-Hans-CN).
  public static OcrEngine CreateEngine(string tag) {
    if (String.IsNullOrWhiteSpace(tag)) {
      OcrEngine profile = OcrEngine.TryCreateFromUserProfileLanguages();
      if (profile == null) throw new Exception("No OCR language is installed for this user. " + InstalledLanguages());
      return profile;
    }
    string wanted = tag.Trim();
    foreach (Language language in OcrEngine.AvailableRecognizerLanguages)
      if (String.Equals(language.LanguageTag, wanted, StringComparison.OrdinalIgnoreCase)) return OcrEngine.TryCreateFromLanguage(language);
    foreach (Language language in OcrEngine.AvailableRecognizerLanguages)
      if (language.LanguageTag.StartsWith(wanted + "-", StringComparison.OrdinalIgnoreCase)) return OcrEngine.TryCreateFromLanguage(language);
    throw new Exception("OCR language '" + wanted + "' is not installed. " + InstalledLanguages());
  }

  public static string InstalledLanguages() {
    var tags = new List<string>();
    foreach (Language language in OcrEngine.AvailableRecognizerLanguages) tags.Add(language.LanguageTag);
    return "Installed OCR languages: " + (tags.Count == 0 ? "none" : String.Join(", ", tags.ToArray())) + ". Windows adds one with a language's optical character recognition feature (Settings > Time & language > Language & region).";
  }

  // Windows OCR misreads small text (#75). As in Text-Grab, a first pass
  // measures the words; when the median word is under 30 px tall the image is
  // read again enlarged toward 36 px, at most 3x and within the engine's
  // maximum image size and a 36-megapixel budget. On rendered 9-20 px UI text
  // this halved the character error rate; enlarging 4x did worse than 3x.
  public const double TargetWordHeight = 36, MaxUpscale = 3, PixelBudget = 36e6;
  public static double Fit(int width, int height, double maxDimension) {
    return Math.Min(maxDimension / Math.Max(width, height), Math.Sqrt(PixelBudget / ((double)width * height)));
  }
  public static double ReadScale(double[] wordHeights, int width, int height, double maxDimension) {
    double scale = MaxUpscale;
    if (wordHeights.Length > 0) {
      var sorted = (double[])wordHeights.Clone();
      Array.Sort(sorted);
      double median = sorted[sorted.Length / 2];
      if (median > 0) scale = Math.Min(MaxUpscale, TargetWordHeight / median);
    }
    return Math.Min(scale, Fit(width, height, maxDimension));
  }

  // Chinese and Japanese lines come back with a space between characters.
  // Their words are joined the way PowerToys Text Extractor does it
  // (OcrTextFormatter): a space only next to a word holding Latin letters or
  // digits, never after opening or before closing punctuation.
  public static bool UsesSpaces(string languageTag) {
    return !(languageTag.StartsWith("zh", StringComparison.OrdinalIgnoreCase) || languageTag.StartsWith("ja", StringComparison.OrdinalIgnoreCase));
  }
  private static bool Punctuation(UnicodeCategory c) {
    return c == UnicodeCategory.ConnectorPunctuation || c == UnicodeCategory.DashPunctuation || c == UnicodeCategory.OpenPunctuation || c == UnicodeCategory.ClosePunctuation
      || c == UnicodeCategory.InitialQuotePunctuation || c == UnicodeCategory.FinalQuotePunctuation || c == UnicodeCategory.OtherPunctuation;
  }
  private static bool TightPunctuation(int point) {
    switch (point) {
      case 0x3001: case 0x3002: case 0x30FB: case 0xFF01: case 0xFF05: case 0xFF0C: case 0xFF0E:
      case 0xFF1A: case 0xFF1B: case 0xFF1F: case 0xFF61: case 0xFF64: case 0xFF65: return true;
    }
    return false;
  }
  public static string JoinWords(IList<string> words) {
    var sb = new StringBuilder();
    bool started = false, leftSpaces = false;
    int leftLast = 0;
    UnicodeCategory leftCategory = UnicodeCategory.OtherNotAssigned;
    foreach (string word in words) {
      if (String.IsNullOrEmpty(word)) continue;
      int first = -1, last = 0;
      UnicodeCategory firstCategory = UnicodeCategory.OtherNotAssigned, lastCategory = UnicodeCategory.OtherNotAssigned;
      bool spaces = false, punctuationOnly = true;
      for (int i = 0; i < word.Length; i += Char.IsSurrogatePair(word, i) ? 2 : 1) {
        int point = Char.IsSurrogatePair(word, i) ? Char.ConvertToUtf32(word, i) : word[i];
        UnicodeCategory category = CharUnicodeInfo.GetUnicodeCategory(word, i);
        if (first < 0) { first = point; firstCategory = category; }
        last = point; lastCategory = category;
        spaces |= category == UnicodeCategory.UppercaseLetter || category == UnicodeCategory.LowercaseLetter || category == UnicodeCategory.TitlecaseLetter || category == UnicodeCategory.DecimalDigitNumber;
        punctuationOnly &= Punctuation(category);
      }
      bool space = started && (leftSpaces || spaces)
        && leftCategory != UnicodeCategory.OpenPunctuation && leftCategory != UnicodeCategory.InitialQuotePunctuation
        && firstCategory != UnicodeCategory.ClosePunctuation && firstCategory != UnicodeCategory.FinalQuotePunctuation
        && !(punctuationOnly && first < 0x10000 && ",.:;!?%‥…".IndexOf((char)first) >= 0)
        && !TightPunctuation(leftLast) && !TightPunctuation(first)
        && firstCategory != UnicodeCategory.NonSpacingMark && firstCategory != UnicodeCategory.SpacingCombiningMark && firstCategory != UnicodeCategory.EnclosingMark;
      if (space) sb.Append(' ');
      sb.Append(word);
      started = true; leftSpaces = spaces; leftLast = last; leftCategory = lastCategory;
    }
    return sb.ToString();
  }

  private static SoftwareBitmap Decode(BitmapDecoder decoder, int width, int height, double scale) {
    if (scale == 1) return WaitOp(decoder.GetSoftwareBitmapAsync());
    var transform = new BitmapTransform();
    transform.ScaledWidth = (uint)Math.Max(1, Math.Round(width * scale));
    transform.ScaledHeight = (uint)Math.Max(1, Math.Round(height * scale));
    transform.InterpolationMode = scale > 1 ? BitmapInterpolationMode.Cubic : BitmapInterpolationMode.Fant;
    return WaitOp(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, transform, ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage));
  }

  private static string Clean(string text) {
    return (text ?? "").Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ').Replace('\u001E', ' ').Replace('\u001F', ' ');
  }

  // Returns tab-separated lines; word boxes are in the PNG's own pixels:
  //   LANG\t<recognizer language tag>
  //   SCALE\t<factor the image was read at>
  //   LINE\t<line text>\t<word>\x1E<x>,<y>,<w>,<h>\x1F<word>\x1E...
  public static string Recognize(string pngPath, string languageTag) {
    StorageFile file = WaitOp(StorageFile.GetFileFromPathAsync(pngPath));
    using (IRandomAccessStream stream = WaitOp(file.OpenAsync(FileAccessMode.Read))) return RecognizeStream(stream,languageTag);
  }
  public static string RecognizeBytes(byte[] png, string languageTag) {
    using (IRandomAccessStream stream = new InMemoryRandomAccessStream()) {
      using (var writer = new DataWriter(stream)) {
        writer.WriteBytes(png); WaitOp(writer.StoreAsync()); writer.DetachStream();
      }
      stream.Seek(0); return RecognizeStream(stream,languageTag);
    }
  }
  private static string RecognizeStream(IRandomAccessStream stream, string languageTag) {
    try {
      OcrEngine engine = CreateEngine(languageTag);
      {
        BitmapDecoder decoder = WaitOp(BitmapDecoder.CreateAsync(stream));
        int width = (int)decoder.PixelWidth, height = (int)decoder.PixelHeight;
        double maxDimension = OcrEngine.MaxImageDimension;
        double scale = Math.Min(1, Fit(width, height, maxDimension));
        OcrResult result;
        using (var bitmap = Decode(decoder, width, height, scale)) result = WaitOp(engine.RecognizeAsync(bitmap));
        var heights = new List<double>();
        foreach (OcrLine line in result.Lines)
          foreach (OcrWord word in line.Words)
            if (word.BoundingRect.Height > 0) heights.Add(word.BoundingRect.Height / scale);
        double larger = ReadScale(heights.ToArray(), width, height, maxDimension);
        if (larger > scale * 1.2) {
          scale = larger;
          using (var bitmap = Decode(decoder, width, height, scale)) result = WaitOp(engine.RecognizeAsync(bitmap));
        }
        string tag = engine.RecognizerLanguage.LanguageTag;
        bool spaced = UsesSpaces(tag);
        var sb = new StringBuilder();
        sb.Append("LANG\t").AppendLine(tag);
        sb.Append("SCALE\t").AppendLine(scale.ToString("0.###", CultureInfo.InvariantCulture));
        foreach (OcrLine line in result.Lines) {
          var texts = new List<string>();
          var ws = new StringBuilder();
          foreach (OcrWord word in line.Words) {
            var r = word.BoundingRect;
            string text = Clean(word.Text);
            texts.Add(text);
            ws.Append(text).Append('\u001E')
              .Append((int)Math.Round(r.Left / scale)).Append(',')
              .Append((int)Math.Round(r.Top / scale)).Append(',')
              .Append((int)Math.Round(r.Width / scale)).Append(',')
              .Append((int)Math.Round(r.Height / scale)).Append('\u001F');
          }
          sb.Append("LINE\t").Append(spaced ? Clean(line.Text) : JoinWords(texts)).Append('\t').AppendLine(ws.ToString());
        }
        return sb.ToString();
      }
    } catch (Exception ex) {
      throw new Exception("OCR failed: " + ex.Message, ex);
    }
  }
}
'@

function Get-OcrHelper {
  # Compile (once, cached) and load the C# WinRT OCR helper.
  if ("WindowsComputerUseOcr" -as [type]) { return }
  if ((Get-Command Import-PackagedHelper -ErrorAction SilentlyContinue) -and (Import-PackagedHelper -Name ocr -Source $script:WcuOcrCs)) { return }
  $dll = Join-Path (Get-HelperCacheDir) ("wcu-ocr-" + (Get-CsHash -Source $script:WcuOcrCs) + ".dll")
  Import-HelperAssembly -Path $dll -Compile {
    param($target)
    $wd = "C:\Windows\System32\WinMetadata"
    # Only the winmds the C# code touches (plus the framework facades csc
    # needs for WinRT binding). Keeping the set small also keeps the command
    # line short.
    $need = @("Windows.Media.winmd", "Windows.Storage.winmd", "Windows.Graphics.winmd", "Windows.Foundation.winmd", "Windows.Globalization.winmd")
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
    $src = "$target.cs"
    [System.IO.File]::WriteAllText($src, $script:WcuOcrCs)
    # Each /r must be its own argument (PowerShell would otherwise hand the
    # whole joined string to csc as one file name).
    $refArgs = ($winmdRefs + @((Join-Path $fw "System.Runtime.dll"), (Join-Path $fw "System.dll"), (Join-Path $fw "System.Runtime.WindowsRuntime.dll"))) | ForEach-Object { "/r:$_" }
    $cscArgList = @("/nologo", "/target:library", "/out:$target") + $refArgs + @($src)
    $out = & $csc @cscArgList 2>&1
    Remove-TempFile $src
    if ($LASTEXITCODE -ne 0) {
      $msg = (($out | Out-String).Trim())
      throw "OCR helper compile failed: " + $msg.Substring(0, [Math]::Min(300, $msg.Length))
    }
  }
}

function Invoke-Ocr {
  # OCR a PNG file; word boxes come back in the image's pixel coordinates.
  # Language: an installed recognizer tag or its prefix; empty = Windows user languages.
  param([string]$PngPath, [string]$Language = '', [byte[]]$PngBytes = $null)
  Get-OcrHelper
  $raw = if ($null -ne $PngBytes) { [WindowsComputerUseOcr]::RecognizeBytes($PngBytes, $Language) } else { [WindowsComputerUseOcr]::Recognize($PngPath, $Language) }
  $linesOut = New-Object System.Collections.Generic.List[object]
  $lineTexts = New-Object System.Collections.Generic.List[string]
  $lang = ""
  $readScale = 1.0
  foreach ($line in ($raw -split "`r?`n")) {
    if ($line -match '^LANG\t(.*)$') { $lang = $Matches[1]; continue }
    if ($line -match '^SCALE\t(.*)$') { $readScale = [double]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture); continue }
    if ($line -match '^LINE\t(.*)\t(.*)$') {
      $lineText = $Matches[1]
      $words = New-Object System.Collections.Generic.List[object]
      # Words are separated by U+001F and text from its box by U+001E, so OCR
      # text may hold any printable character.
      foreach ($w in $Matches[2].Split([char]0x1F)) {
        if ($w -eq '') { continue }
        $at = $w.LastIndexOf([char]0x1E)
        if ($at -lt 0) { continue }
        $wtext = $w.Substring(0, $at)
        $coords = $w.Substring($at + 1) -split ','
        if ($coords.Count -lt 4) { continue }
        $words.Add([ordered]@{ text = $wtext; x = [int]$coords[0]; y = [int]$coords[1]; width = [int]$coords[2]; height = [int]$coords[3] })
      }
      $lineTexts.Add($lineText)
      $linesOut.Add([ordered]@{ text = $lineText; words = $words.ToArray() })
    }
  }
  return [ordered]@{ text = ($lineTexts.ToArray() -join "`n"); lines = $linesOut.ToArray(); language = $lang; readScale = $readScale }
}

function Get-OcrWordBounds {
  # Union of word boxes, in the same coordinate space as the supplied words.
  param([object[]]$Words)
  $bounds = $null
  foreach ($word in $Words) {
    if ($word.width -le 0 -or $word.height -le 0) { continue }
    $left = [int]$word.x
    $top = [int]$word.y
    $right = $left + [int]$word.width
    $bottom = $top + [int]$word.height
    if ($null -eq $bounds) {
      $bounds = @{left=$left;top=$top;right=$right;bottom=$bottom}
    } else {
      $bounds.left = [Math]::Min($bounds.left, $left)
      $bounds.top = [Math]::Min($bounds.top, $top)
      $bounds.right = [Math]::Max($bounds.right, $right)
      $bounds.bottom = [Math]::Max($bounds.bottom, $bottom)
    }
  }
  if ($null -eq $bounds) { return $null }
  return [ordered]@{x=$bounds.left;y=$bounds.top;width=($bounds.right-$bounds.left);height=($bounds.bottom-$bounds.top)}
}

function Find-OcrWordRun {
  # Keep normalized offsets tied to actual words, rather than assuming that
  # OCR line text inserts exactly one separator between adjacent words.
  param([object[]]$Words, [string]$Query)
  $normalizedQuery = [regex]::Replace($Query, '\s+', '')
  if ($normalizedQuery.Length -eq 0) { return $null }
  $parts = @($Words | ForEach-Object { [regex]::Replace([string]$_.text, '\s+', '') })
  $text = $parts -join ''
  $start = $text.IndexOf($normalizedQuery, [System.StringComparison]::OrdinalIgnoreCase)
  if ($start -lt 0) { return $null }
  $end = $start + $normalizedQuery.Length
  $offset = 0
  $hitWords = New-Object System.Collections.Generic.List[object]
  $hitTexts = New-Object System.Collections.Generic.List[string]
  for ($index = 0; $index -lt $Words.Count; $index++) {
    $length = $parts[$index].Length
    if ($length -gt 0 -and $offset -lt $end -and ($offset + $length) -gt $start) {
      $w = $Words[$index]
      $hitWords.Add($w)
      $hitTexts.Add([string]$w.text)
    }
    $offset += $length
  }
  $hitArr = $hitWords.ToArray()
  $bounds = Get-OcrWordBounds -Words $hitArr
  if ($null -eq $bounds) { return $null }
  return [ordered]@{text=($hitTexts.ToArray() -join ' ');boundingBox=$bounds}
}

# Shown top-level windows in Z order; -IncludeMinimized adds minimized ones
# (minimized: true; list_windows lists them, issue #82), -IncludeInvisible hidden
# ones too. $script:WindowListTruncated says whether MaxWindows left some out.
function Get-NativeWindowList {
  param([bool]$IncludeInvisible = $false, [int]$MaxWindows = 50, [switch]$RecordObservation, [bool]$IncludeMinimized = $false)
  $items = New-Object System.Collections.Generic.List[object]
  $script:WindowListTruncated = $false
  $foreground = [WindowsComputerUseNative]::GetForegroundWindow()
  $title = New-Object System.Text.StringBuilder 2048
  $class = New-Object System.Text.StringBuilder 256
  $rect = New-Object WindowsComputerUseNative+RECT
  foreach ($handle in [WindowsComputerUseNative]::TopLevelWindows()) {
    $visible = [WindowsComputerUseNative]::IsWindowVisible($handle)
    $iconic = [WindowsComputerUseNative]::IsIconic($handle)
    if (-not $IncludeInvisible -and (-not $visible -or ($iconic -and -not $IncludeMinimized))) { continue }
    $ownerId = [uint32]0
    [void][WindowsComputerUseNative]::GetWindowThreadProcessId($handle, [ref]$ownerId)
    if (-not $ownerId) { continue }
    if (-not [WindowsComputerUseNative]::GetWindowRect($handle, [ref]$rect)) { continue }
    if ($items.Count -ge $MaxWindows) { $script:WindowListTruncated = $true; break }
    $title.Length = 0
    [void][WindowsComputerUseNative]::GetWindowText($handle, $title, $title.Capacity)
    $class.Length = 0
    [void][WindowsComputerUseNative]::GetClassName($handle, $class, $class.Capacity)
    $hwnd = $handle.ToInt64()
    $box = [ordered]@{ x=$rect.left; y=$rect.top; width=$rect.right-$rect.left; height=$rect.bottom-$rect.top; centerX=($rect.left+$rect.right)/2; centerY=($rect.top+$rect.bottom)/2 }
    $entry = [ordered]@{id="uia:hwnd:${hwnd}:pid:${ownerId}"; depth=1; name=$title.ToString(); className=$class.ToString(); controlType='Window'; processId=$ownerId; nativeWindowHandle=$hwnd; boundingBox=$box; isEnabled=[WindowsComputerUseNative]::IsWindowEnabled($handle); isOffscreen=(-not $visible -or $iconic); hasKeyboardFocus=($foreground -eq $handle); source='win32'}
    if ($iconic) { $entry['minimized'] = $true }
    $items.Add($entry)
    # Target lookup must not replace the coordinates used by Home-Point.
    # Only explicit observations establish a new coordinate baseline. A
    # minimized window sits at -32000,-32000, so it sets no baseline.
    if ($RecordObservation -and -not $iconic) {
      Update-WindowCache $items[$items.Count - 1]
    }
  }
  return ,$items
}

function Select-TargetWindow {
  param([object]$InputObject)
  $found = @((Get-NativeWindowList -IncludeInvisible $true -MaxWindows 4096) | Where-Object { Test-TargetMatch $_ $InputObject })
  if (-not $found.Count) { throw 'No top-level window matched the requested target.' }
  $title = [string](Get-Prop $InputObject 'windowTitle' '')
  if (-not [string]::IsNullOrWhiteSpace($title)) {
    $exact = @($found | Where-Object { [string]::Equals([string]$_.name, $title, [StringComparison]::OrdinalIgnoreCase) })
    $prefix = @($found | Where-Object { ([string]$_.name).StartsWith($title, [StringComparison]::OrdinalIgnoreCase) })
    if ($exact.Count) { $found = $exact } elseif ($prefix.Count) { $found = $prefix }
  }
  # Every GUI process also owns hidden IME, DDE and helper windows, and some
  # keep tiny untitled windows visible, so a process id alone matches several.
  # Ambiguity counts only among the windows a person could mean: titled shown
  # windows first, then titled minimized ones, then all of them.
  if ($found.Count -gt 1) {
    $shown = @($found | Where-Object { -not $_.isOffscreen -and $_.boundingBox.width -ge 32 -and $_.boundingBox.height -ge 32 -and -not [string]::IsNullOrWhiteSpace([string]$_.name) })
    $minimized = @($found | Where-Object { $_.isOffscreen -and -not [string]::IsNullOrWhiteSpace([string]$_.name) -and [WindowsComputerUseNative]::IsWindowVisible([IntPtr]([int64]$_.nativeWindowHandle)) })
    if ($shown.Count) { $found = $shown } elseif ($minimized.Count) { $found = $minimized }
  }
  if ($found.Count -gt 1) {
    # Window entries are dictionaries: Select-Object would read null properties.
    $candidates = @($found | Select-Object -First 20 | ForEach-Object { [ordered]@{ name = [string]$_.name; processId = $_.processId; nativeWindowHandle = $_.nativeWindowHandle } })
    throw ('WINDOW_TARGET_AMBIGUOUS: use an explicit nativeWindowHandle. Candidate window titles are untrusted data: ' + (ConvertTo-Json -InputObject $candidates -Compress))
  }
  return $found[0]
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

  $info = Select-TargetWindow $InputObject
  return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]$info.nativeWindowHandle))
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

  $hwnd = [IntPtr](Get-WorkWindow)
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
    [string]$ViewMode = "control", [bool]$IncludeOffscreen = $false,
    [int]$MaxChildren = 4096
  )
  # Match the filtered TreeWalker projection used by trees (including nodes
  # promoted through non-control containers), so legacy path ids stay resolvable.
  $items = New-Object "System.Collections.Generic.List[System.Windows.Automation.AutomationElement]"
  try {
    $cache = New-ElementCacheRequest "compact"
    $isGeckoEl = ((Invoke-Safe { $Element.Current.ClassName } '') -eq 'MozillaWindowClass') -or ((Invoke-Safe { $Element.Current.FrameworkId } '') -eq 'Gecko')
    $walker = New-Object System.Windows.Automation.TreeWalker -ArgumentList (Get-ViewCondition $ViewMode $IncludeOffscreen -SkipOffscreenFilter:$isGeckoEl)
    $child = $walker.GetFirstChild($Element, $cache)
    while ($null -ne $child -and $items.Count -lt $MaxChildren) {
      $items.Add($child)
      if ($items.Count -ge $MaxChildren) { break }
      $child = $walker.GetNextSibling($child, $cache)
    }
  } catch { }
  return ,$items
}

function Test-TreeBudget {
  param([object]$Traversal)
  if ($Traversal.watch.ElapsedMilliseconds -ge $Traversal.budgetMs) {
    $Traversal.reason = "timeBudget"
    return $false
  }
  return $true
}

function Test-RectOverlap {
  param([object]$A, [object]$B)
  return ($null -ne $A -and $null -ne $B -and $A.width -gt 0 -and $A.height -gt 0 -and $B.width -gt 0 -and $B.height -gt 0 -and
    $A.x -lt ($B.x + $B.width) -and $B.x -lt ($A.x + $A.width) -and
    $A.y -lt ($B.y + $B.height) -and $B.y -lt ($A.y + $A.height))
}

function Convert-Tree {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [string]$Path, [int]$Depth, [int]$MaxDepth, [ref]$Count, [int]$MaxNodes,
    [string]$ViewMode = "control", [bool]$IncludeOffscreen = $false,
    [string]$DetailLevel = "compact", [object]$Traversal, [object]$Owner = $null,
    [int]$Level = -1, [object]$GeckoPageBounds = $null
  )
  if ($Count.Value -ge $MaxNodes) { $Traversal.reason = "maxNodes"; return $null }
  if (-not (Test-TreeBudget $Traversal)) { return $null }
  if ($Level -lt 0) { $Level = $Depth }
  $previousOwner = $script:ObservationOwner
  if ($null -eq $Owner -and $null -ne $script:NativeOwners) {
    $nativeHwnd = Invoke-Safe { [int64]$Element.Cached.NativeWindowHandle } 0
    $Owner = $script:NativeOwners[[string]$nativeHwnd]
  }
  $script:ObservationOwner = $Owner
  $info = Convert-ElementInfo -Element $Element -Id "uia:$Path" -Depth $Depth -DetailLevel $DetailLevel -UseCache
  $Count.Value++
  if ($Traversal.pruneGeckoOffscreen -and $info.controlType -eq 'Document') {
    # Gecko can mark the whole page offscreen while its native window is
    # visible. Keep controls whose bounds overlap this document, but keep
    # the provider's isOffscreen value and the input checks unchanged.
    $GeckoPageBounds = if ($Owner.isOffscreen -eq $false -and $info.isOffscreen -eq $true -and (Test-RectOverlap $info.boundingBox $Owner.boundingBox)) { $info.boundingBox }
  }
  # Chromium nests a page six or more levels down, under unnamed layout panes
  # (NonClientView, ClientView, View...), and Firefox-family browsers put it
  # under three unnamed Gecko panes (#56). In window-scoped trees those panes do
  # not use up maxDepth, so the default depths reach the page; 16 extra levels
  # bound the recursion. Desktop trees stay an overview of every window.
  $childLevel = $Level + 1
  $fw = Invoke-Safe { $Element.Cached.FrameworkId } ''
  if ($Traversal.browserLayout -and [string]::IsNullOrEmpty($info.name) -and (
      ($info.controlType -eq 'Pane' -and $fw -in @('Chrome', 'Gecko')) -or
      (($fw -eq 'Gecko' -or ($null -ne $Owner -and $Owner.className -eq 'MozillaWindowClass')) -and $info.controlType -in @('Pane', 'Group', 'Custom'))
    )) { $childLevel = $Level }
  $childrenOut = New-Object System.Collections.Generic.List[object]
  if ($childLevel -le $MaxDepth -and $Depth -lt $MaxDepth + 16 -and $Count.Value -lt $MaxNodes -and (Test-TreeBudget $Traversal)) {
    try {
      $child = $Traversal.walker.GetFirstChild($Element, $Traversal.cache)
      $i = 0
      while ($null -ne $child) {
        if ($Count.Value -ge $MaxNodes -or -not (Test-TreeBudget $Traversal)) { break }
        $childOut = Convert-Tree -Element $child -Path "$Path.$i" -Depth ($Depth + 1) -MaxDepth $MaxDepth -Count $Count -MaxNodes $MaxNodes -ViewMode $ViewMode -IncludeOffscreen $IncludeOffscreen -DetailLevel $DetailLevel -Traversal $Traversal -Owner $Owner -Level $childLevel -GeckoPageBounds $GeckoPageBounds
        if ($null -ne $childOut) { $childrenOut.Add($childOut) }
        if ($Count.Value -ge $MaxNodes -or $null -ne $Traversal.reason -or -not (Test-TreeBudget $Traversal)) { break }
        $child = $Traversal.walker.GetNextSibling($child, $Traversal.cache)
        $i++
      }
    } catch {
      $Traversal.reason = "providerError"
      $Traversal.error = $_.Exception.Message
    }
  }
  if ($Depth -gt 0 -and $Traversal.pruneGeckoOffscreen -and $info.isOffscreen -eq $true -and $childrenOut.Count -eq 0 -and $info.controlType -notin @('Window','Pane','Document','Group','Tab','TabItem') -and
      (-not (Test-RectOverlap $info.boundingBox $GeckoPageBounds) -or -not (Test-RectOverlap $info.boundingBox $Owner.boundingBox))) {
    $Count.Value--
    $script:ObservationOwner = $previousOwner
    return $null
  }
  if ($Count.Value -ge $MaxNodes -and $null -eq $Traversal.reason) { $Traversal.reason = "maxNodes" }
  # Only count nodes kept in the result, after the Gecko leaf filter.
  $Traversal.countedDepth = [Math]::Max([int]$Traversal['countedDepth'], $Level)
  $Traversal.structuralDepth = [Math]::Max([int]$Traversal['structuralDepth'], $Depth)
  $info["children"] = @($childrenOut.ToArray())
  $script:ObservationOwner = $previousOwner
  return $info
}

function Resolve-Element {
  param([string]$ElementId, [object]$InputObject = $null)
  if ([string]::IsNullOrWhiteSpace($ElementId)) {
    throw "elementId is required."
  }


  if ($ElementId -match '^uia:hwnd:(\d+):pid:(\d+)$') {
    $handle = [IntPtr]([int64]$Matches[1])
    $expectedOwner = [uint32]$Matches[2]
    $null = Get-ViewMode $InputObject "control"
    $ownerId = [uint32]0
    [void][WindowsComputerUseNative]::GetWindowThreadProcessId($handle, [ref]$ownerId)
    if (-not [WindowsComputerUseNative]::IsWindow($handle) -or $ownerId -ne $expectedOwner) { throw 'Window identity changed; refresh the window list.' }
    if (Has-WindowTarget $InputObject) {
      $requested = Get-ObservationWindow $InputObject
      if ([int64]$requested.nativeWindowHandle -ne $handle.ToInt64()) { throw 'Element belongs to a different target window; re-observe before acting.' }
    }
    return [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  }

  # Preferred form: uia:rt:<n>-<n>-... resolved by RuntimeId (stable for the
  # life of the owning process, immune to UI re-layouts).
  if ($ElementId -match '^uia:rt:(.+)$') {
    $runtimeText = $Matches[1]
    if ($runtimeText -notmatch '^-?\d+(?:--?\d+)+$') { throw "Malformed runtime element id '$ElementId'." }
    # RuntimeId lookup bypasses view traversal, but the declared view filters
    # must still be validated here — an illegal viewMode has to fail exactly
    # like it does on the legacy path instead of being silently ignored.
    $null = Get-ViewMode $InputObject "control"
    $entry = $script:ElementRegistry[$ElementId]
    if ($null -eq $entry -or ([DateTimeOffset]::Now.ToUnixTimeMilliseconds() - [int64]$entry.ts) -gt 300000) {
      throw "Element '$ElementId' is stale or was not observed by this backend. Re-run snapshot/tree/find for fresh ids."
    }
    $owner = [uint32]0
    [void][WindowsComputerUseNative]::GetWindowThreadProcessId([IntPtr]([int64]$entry.hwnd), [ref]$owner)
    if (-not [WindowsComputerUseNative]::IsWindow([IntPtr]([int64]$entry.hwnd)) -or $owner -ne [uint32]$entry.processId) { throw 'Element owner changed; re-observe before acting.' }
    if (Has-WindowTarget $InputObject) {
      $target = Get-ObservationWindow $InputObject
      if ([int64]$target.nativeWindowHandle -ne [int64]$entry.hwnd) { throw 'Element belongs to a different target window; re-observe before acting.' }
    }
    $actualId = Invoke-Safe { @($entry.element.GetRuntimeId()) -join '-' } $null
    if ($actualId -ne $runtimeText) { throw 'Element no longer exists; re-observe before acting.' }
    return $entry.element
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
      $children = Get-Children -Element $element -ViewMode $viewMode -IncludeOffscreen $includeOffscreen -MaxChildren ($index + 1)
      if ($null -eq $children -or $index -lt 0 -or $index -ge $children.Count) {
        throw "Element path '$ElementId' is stale or out of range at segment $i."
      }
      $element = $children.Item($index)
    }
    return $element
  }

  throw "Unsupported element id '$ElementId'. Use an id from windows_computer_use_snapshot or windows_computer_use_accessibility_tree."
}

function Assert-ElementPoint {
  param([object]$Element, [int]$X, [int]$Y)
  if ($null -eq $Element) { return }
  if ((Invoke-Safe { [bool]$Element.Current.IsOffscreen } $true)) { throw 'ELEMENT_OFFSCREEN: observe or scroll the requested element before clicking.' }
  if (-not (Invoke-Safe { [bool]$Element.Current.IsEnabled } $false)) { throw 'ELEMENT_DISABLED: the requested element is disabled.' }
  $point = New-Object System.Windows.Point($X, $Y)
  $hit = [System.Windows.Automation.AutomationElement]::FromPoint($point)
  $want = @($Element.GetRuntimeId()) -join '-'
  if (-not $want) { throw 'ELEMENT_ID_UNCONFIRMED: the requested element has no runtime identity.' }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  for ($depth = 0; $depth -lt 60 -and $null -ne $hit; $depth++) {
    if ((@($hit.GetRuntimeId()) -join '-') -eq $want) { return }
    $hit = $walker.GetParent($hit)
  }
  throw 'ELEMENT_POINT_COVERED: the point belongs to another element; no click was sent.'
}

function Confirm-ElementPoint {
  param([System.Collections.IDictionary]$Point)
  if ($null -eq $Point.element) { return }
  $candidate = New-Object System.Windows.Point
  try { $available = $Point.element.TryGetClickablePoint([ref]$candidate) } catch { $available = $false }
  if ($available) { $Point.x = [int][Math]::Round($candidate.X); $Point.y = [int][Math]::Round($candidate.Y) }
  else {
    $rect = Convert-Rect (Invoke-Safe { $Point.element.Current.BoundingRectangle } $null)
    if ($null -eq $rect) { throw 'ELEMENT_POINT_UNAVAILABLE: the element has no click point.' }
    $Point.x = [int]$rect.centerX; $Point.y = [int]$rect.centerY
  }
  Assert-ElementPoint $Point.element $Point.x $Point.y
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
  for ($i = 0; $i -lt $Count; $i++) {
    [void](Test-Failsafe)
    $sent = [WindowsComputerUseNative]::SendClick($X, $Y, [uint32]$flags[0], [uint32]$flags[1])
    if ($sent -lt 2) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected mouse input. The click was not replayed.' }
    if ($sent -ne 3) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected mouse release. Cleanup was attempted; the click was not replayed.' }
    if ($i + 1 -lt $Count) {
      # Pause between rapid multi-clicks so double/triple click detection fires reliably.
      Start-Sleep -Milliseconds 60
    }
  }
}

function Move-ToPoint {
  param([int]$X, [int]$Y)
  [void](Test-Failsafe)
  if (-not [WindowsComputerUseNative]::SetCursorPos($X, $Y)) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected cursor positioning. Restore the interactive desktop before retrying.' }
}

function Begin-ClipboardLease {
  param([string]$Text, [bool]$RestoreClipboard)
  if (-not ('WcuClipboardLease' -as [type])) {
    $clipboardSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-clipboard.cs'),[Text.Encoding]::UTF8)
    $precompiled = (Get-Command Import-PackagedHelper -ErrorAction SilentlyContinue) -and (Import-PackagedHelper -Name clipboard -Source $clipboardSource)
    if (-not $precompiled) {
      $runtimeKey = $PSVersionTable.PSEdition.ToLowerInvariant() + '-clr' + [Environment]::Version.Major
      $dll = Join-Path (Get-HelperCacheDir) ("wcu-clipboard-" + $runtimeKey + '-' + (Get-CsHash -Source $clipboardSource) + ".dll")
      $references = @('System.Windows.Forms', 'System.Drawing')
      if ($PSVersionTable.PSEdition -eq 'Core') {
        # As for the takeover helper: the short names alone miss the .NET
        # reference assemblies (HashSet<T>) and the split Windows Forms ones.
        $references = @(Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll' | ForEach-Object { $_.FullName })
        $references += [System.Reflection.Assembly]::Load('System.Windows.Forms').Location
        $references += [System.Reflection.Assembly]::Load('System.Windows.Forms.Primitives').Location
        $references += [System.Reflection.Assembly]::Load('System.Drawing.Common').Location
        $references += @(Get-ChildItem -LiteralPath $PSHOME -Filter 'System.Private.Windows*.dll' | ForEach-Object { $_.FullName })
      }
      Import-HelperAssembly -Path $dll -Compile { param($out) Add-Type -TypeDefinition $clipboardSource -ReferencedAssemblies $references -OutputAssembly $out }
    }
  }
  [uint32]$targetProcess = 0
  $focusedWindow=[WindowsComputerUseNative]::FocusedWindow([WindowsComputerUseNative]::GetForegroundWindow())
  if($focusedWindow -ne [IntPtr]::Zero){[void][WindowsComputerUseNative]::GetWindowThreadProcessId($focusedWindow, [ref]$targetProcess)}
  return New-Object -TypeName WcuClipboardLease -ArgumentList @($Text, $RestoreClipboard, [int]$targetProcess)
}

function Type-Text {
  param([string]$Text, [bool]$RestoreClipboard = $true)
  # Check the input desktop without repositioning the shared pointer. The user
  # may have moved it since GetCursorPos returned; pasting needs no mouse move.
  $position = New-Object WindowsComputerUseNative+POINT
  if (-not [WindowsComputerUseNative]::GetCursorPos([ref]$position)) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows input desktop is unavailable.' }
  $script:LastPasteInfo = $null
  [void](Test-Failsafe)
  $lease = Begin-ClipboardLease -Text $Text -RestoreClipboard $RestoreClipboard
  try {
    [void](Test-Failsafe)
    $pasteTarget=[WindowsComputerUseNative]::FocusedWindow([WindowsComputerUseNative]::GetForegroundWindow())
    if (-not $lease.TryPasteNative($pasteTarget)) {
      if (-not [WindowsComputerUseNative]::SendKeyChord(@('ctrl','v'))) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected paste input.' }
      $lease.MarkPasteSent([WindowsComputerUseNative]::FocusedWindow([WindowsComputerUseNative]::GetForegroundWindow()))
    }
    $deadline = [DateTime]::UtcNow.AddMilliseconds(2200)
    while (-not $lease.IsCompleted -and [DateTime]::UtcNow -lt $deadline) {
      [void](Test-Failsafe)
      [void]$lease.Complete(25)
    }
    $requested = $lease.Complete(0)
    $script:LastPasteInfo = @{ clipboardRequested = $requested; clipboardPasteCompleted = $lease.NativePasteCompleted; clipboardRestored = $lease.Restored; clipboardRestoreFailed = $lease.RestorationFailed; clipboardRequestWindow = $lease.RequestWindow; clipboardRequestProcessId = $lease.RequestProcessId }
  } finally {
    # The lease rolls back if nothing was sent. Once dispatched it keeps the
    # requested text available for slow recipients until a read is confirmed.
    $lease.Dispose()
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
    if ($main -match '^[+^%~(){}\[\]]$') { '{' + $main + '}' } else { $main.ToLowerInvariant() }
  } else {
    "{" + $main.ToUpperInvariant() + "}"
  }
  return $mod + $encoded
}

function Invoke-ElementPattern {
  param([object]$Element)
  Assert-InputProcess ([int](Invoke-Safe { $Element.Current.ProcessId } 0))
  $script:BackgroundReport = $null
  $native = Invoke-NativeButton $Element
  if ($null -ne $native) { return $native }
  return (Invoke-Guarded { Invoke-UiaPattern $Element } $Element)
}

function Invoke-UiaPattern {
  param([object]$Element)
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern) } $false) {
    [void](Test-Failsafe)
    $pattern.Invoke()
    return "Invoke"
  }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern) } $false) {
    [void](Test-Failsafe)
    $pattern.Toggle()
    return "Toggle"
  }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern) } $false) {
    [void](Test-Failsafe)
    $pattern.Select()
    return "SelectionItem"
  }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern) } $false) {
    $state = Invoke-Safe { $pattern.Current.ExpandCollapseState } $null
    [void](Test-Failsafe)
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
  Assert-InputProcess ([int](Invoke-Safe { $Element.Current.ProcessId } 0))
  $script:BackgroundReport = $null
  $native = Set-NativeEditText $Element $Value
  if ($null -ne $native) { return $native }
  $pattern = $null
  if (Invoke-Safe { $Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) } $false) {
    [void](Test-Failsafe)
    return (Invoke-Guarded { $pattern.SetValue($Value); 'ValuePattern' } $Element)
  }
  return $null
}

# invoke action:'expand' | 'collapse' | 'scroll_into_view': the element's own
# ExpandCollapse or ScrollItem pattern, under the UIA guard. An element already
# in the requested state is left as it is.
function Invoke-ElementAction {
  param([object]$Element, [string]$Kind)
  $script:BackgroundReport = $null
  $type = if ($Kind -eq 'scroll_into_view') { [System.Windows.Automation.ScrollItemPattern]::Pattern } else { [System.Windows.Automation.ExpandCollapsePattern]::Pattern }
  $pattern = $null
  if (-not (Invoke-Safe { $Element.TryGetCurrentPattern($type, [ref]$pattern) } $false)) {
    throw "ELEMENT_ACTION_UNSUPPORTED: this element has no $(if ($Kind -eq 'scroll_into_view') { 'ScrollItemPattern' } else { 'ExpandCollapsePattern' }), so it cannot $($Kind -replace '_', ' '). Use the default invoke, click it, or scroll its container."
  }
  if ($Kind -ne 'scroll_into_view') {
    $state = Invoke-Safe { $pattern.Current.ExpandCollapseState } $null
    if (($Kind -eq 'expand' -and $state -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) -or ($Kind -eq 'collapse' -and $state -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed)) {
      return $(if ($Kind -eq 'expand') { 'ExpandCollapse (already expanded)' } else { 'ExpandCollapse (already collapsed)' })
    }
    if ($state -eq [System.Windows.Automation.ExpandCollapseState]::LeafNode) { throw "ELEMENT_ACTION_UNSUPPORTED: this element is a leaf; it has nothing to $Kind." }
  }
  [void](Test-Failsafe)
  return (Invoke-Guarded {
    switch ($Kind) {
      'expand' { $pattern.Expand(); 'ExpandCollapse.Expand' }
      'collapse' { $pattern.Collapse(); 'ExpandCollapse.Collapse' }
      default { $pattern.ScrollIntoView(); 'ScrollItem.ScrollIntoView' }
    }
  } $Element)
}

# Scrolling an element without the pointer. The element, or its nearest
# ancestor that scrolls in that direction (ScrollPattern), scrolls by window
# messages when it is a Win32 control with its own scroll bar (WM_VSCROLL /
# WM_HSCROLL: no foreground), else through its ScrollPattern under the UIA
# guard. One wheel notch (120) scrolls the lines set for the wheel in Windows,
# or a page when the wheel is set to a screen at a time. $null when nothing
# scrolls; else the method and the scroll positions before and after.
function Invoke-ElementScroll {
  param([object]$Element, [int]$DeltaX, [int]$DeltaY)
  $script:BackgroundReport = $null
  $lines = [System.Windows.Forms.SystemInformation]::MouseWheelScrollLines
  $byPage = $lines -lt 0
  $steps = { param([int]$Delta) if ($Delta -eq 0) { 0 } elseif ($byPage) { [int][math]::Max(1, [math]::Round([math]::Abs($Delta) / 120)) } else { [int][math]::Min(100, [math]::Max(1, [math]::Round([math]::Abs($Delta) * $lines / 120))) } }
  $countY = & $steps $DeltaY
  $countX = & $steps $DeltaX
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $Element; $scroller = $null; $pattern = $null
  for ($depth = 0; $null -ne $node -and $depth -lt 12; $depth++) {
    $candidate = $null
    if (Invoke-Safe { $node.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$candidate) } $false) {
      $vertical = [bool](Invoke-Safe { $candidate.Current.VerticallyScrollable } $false)
      $horizontal = [bool](Invoke-Safe { $candidate.Current.HorizontallyScrollable } $false)
      if (($countY -eq 0 -or $vertical) -and ($countX -eq 0 -or $horizontal)) { $scroller = $node; $pattern = $candidate; break }
    }
    $node = Invoke-Safe { $walker.GetParent($node) } $null
  }
  $hwnd = if ($null -ne $scroller) { Invoke-Safe { [int64]$scroller.Current.NativeWindowHandle } 0 } else { Invoke-Safe { [int64]$Element.Current.NativeWindowHandle } 0 }
  $style = if ($hwnd) { [WindowsComputerUseNative]::GetWindowLong([IntPtr]$hwnd, -16) } else { 0 }
  # WS_VSCROLL (0x00200000), WS_HSCROLL (0x00100000)
  $native = $hwnd -and ($countY -eq 0 -or ($style -band 0x00200000) -ne 0) -and ($countX -eq 0 -or ($style -band 0x00100000) -ne 0)
  if (-not $native -and $null -eq $pattern) { return $null }
  $position = { if ($null -ne $pattern) { @([math]::Round([double](Invoke-Safe { $pattern.Current.HorizontalScrollPercent } -1), 1), [math]::Round([double](Invoke-Safe { $pattern.Current.VerticalScrollPercent } -1), 1)) } else { $null } }
  $before = & $position
  [void](Test-Failsafe)
  if ($native) {
    # SB_LINEUP 0 / SB_LINEDOWN 1 / SB_PAGEUP 2 / SB_PAGEDOWN 3, then SB_ENDSCROLL 8.
    $reply = [UIntPtr]::Zero
    foreach ($axis in @(@{ count = $countY; delta = $DeltaY; msg = [WindowsComputerUseNative]::WM_VSCROLL }, @{ count = $countX; delta = $DeltaX; msg = [WindowsComputerUseNative]::WM_HSCROLL })) {
      if ($axis.count -eq 0) { continue }
      $code = if ($axis.delta -gt 0) { 1 } else { 0 }
      if ($byPage) { $code += 2 }
      for ($i = 0; $i -lt $axis.count; $i++) {
        if ([WindowsComputerUseNative]::SendMessageTimeout([IntPtr]$hwnd, $axis.msg, [UIntPtr][uint32]$code, [IntPtr]::Zero, 2, 1000, [ref]$reply) -eq [IntPtr]::Zero) { return $null }
      }
      [void][WindowsComputerUseNative]::SendMessageTimeout([IntPtr]$hwnd, $axis.msg, [UIntPtr][uint32]8, [IntPtr]::Zero, 2, 1000, [ref]$reply)
    }
    $method = if ($countY) { 'WM_VSCROLL' } else { 'WM_HSCROLL' }
  } else {
    $method = Invoke-Guarded {
      $amount = [System.Windows.Automation.ScrollAmount]
      $none = $amount::NoAmount
      $amountY = if ($DeltaY -gt 0) { if ($byPage) { $amount::LargeIncrement } else { $amount::SmallIncrement } } else { if ($byPage) { $amount::LargeDecrement } else { $amount::SmallDecrement } }
      $amountX = if ($DeltaX -gt 0) { if ($byPage) { $amount::LargeIncrement } else { $amount::SmallIncrement } } else { if ($byPage) { $amount::LargeDecrement } else { $amount::SmallDecrement } }
      for ($i = 0; $i -lt $countY; $i++) { $pattern.Scroll($none, $amountY) }
      for ($i = 0; $i -lt $countX; $i++) { $pattern.Scroll($amountX, $none) }
      'ScrollPattern'
    } $Element
  }
  $result = [ordered]@{ method = "background:$method" }
  if ($null -ne $before) {
    $after = & $position
    $result['scrollPercent'] = [ordered]@{ before = $before; after = $after }
    if ($before[0] -eq $after[0] -and $before[1] -eq $after[1]) { $result['note'] = 'The scroll position did not change: the content may already be at its end in that direction.' }
  }
  return $result
}

# Real input is the last resort: a call that would need it while it runs in the
# background (no indicator, no Esc stop) asks the server to run it again with
# both, before anything is sent.
function Assert-InputAllowed {
  param([string]$What)
  if ($script:WcuQuiet) { throw "WCU_NEEDS_INPUT: $What needs the real pointer or keyboard." }
}

# Adds what a background element action gave back to the result.
function Add-BackgroundReport {
  param([System.Collections.IDictionary]$Result)
  if ($null -eq $script:BackgroundReport) { return }
  foreach ($key in $script:BackgroundReport.Keys) { $Result[$key] = $script:BackgroundReport[$key] }
}

# ============================================================================
# Screenshot: unobstructed foreground screen crop, otherwise window capture.
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

function Test-WindowScreenCapture {
  param([long]$Hwnd, [object]$Bounds, [object]$VirtualScreen)
  # Include this window's owned dialogs/menus in its screen crop. Unrelated
  # windows, including unowned same-process siblings, still make it unusable.
  if ($null -eq $Bounds -or $Bounds.width -le 0 -or $Bounds.height -le 0) { return $false }
  if (-not (Test-InputWindow ([WindowsComputerUseNative]::GetForegroundWindow().ToInt64()) $Hwnd)) { return $false }
  if ($Bounds.x -lt $VirtualScreen.Left -or $Bounds.y -lt $VirtualScreen.Top -or
      $Bounds.x + $Bounds.width -gt $VirtualScreen.Right -or
      $Bounds.y + $Bounds.height -gt $VirtualScreen.Bottom) { return $false }
  foreach ($handle in [WindowsComputerUseNative]::TopLevelWindows()) {
    if ($handle.ToInt64() -eq $Hwnd) {
      return ([WindowsComputerUseNative]::IsWindowVisible($handle) -and -not [WindowsComputerUseNative]::IsIconic($handle))
    }
    if (-not [WindowsComputerUseNative]::IsWindowVisible($handle) -or [WindowsComputerUseNative]::IsIconic($handle)) { continue }
    if (Test-InputWindow $handle.ToInt64() $Hwnd) { continue }
    [uint32]$overlayOwner = 0
    if ($script:TakeoverProcessId) {
      [void][WindowsComputerUseNative]::GetWindowThreadProcessId($handle, [ref]$overlayOwner)
      if ($overlayOwner -eq $script:TakeoverProcessId) { continue }
    }
    $other = New-Object WindowsComputerUseNative+RECT
    # Unknown geometry must not be treated as proof that the crop is clear.
    if (-not [WindowsComputerUseNative]::GetWindowRect($handle, [ref]$other)) { return $false }
    if ($other.right -gt $Bounds.x -and $other.left -lt $Bounds.x + $Bounds.width -and
        $other.bottom -gt $Bounds.y -and $other.top -lt $Bounds.y + $Bounds.height) { return $false }
  }
  return $false
}

function Try-PrintWindowCapture {
  param([long]$Hwnd,[int]$Width,[int]$Height)
  if ($Width -le 0 -or $Height -le 0) { return $null }
  $outer=New-Object WindowsComputerUseNative+RECT
  if (-not [WindowsComputerUseNative]::GetWindowRect([IntPtr]$Hwnd,[ref]$outer)) { return $null }
  $frame=Get-ExtendedFrameBounds $Hwnd
  if ($null -eq $frame -or $frame.width -ne $Width -or $frame.height -ne $Height) { return $null }
  $left=[int]$frame.x-$outer.left;$top=[int]$frame.y-$outer.top
  $fullWidth=$outer.right-$outer.left;$fullHeight=$outer.bottom-$outer.top
  if ($left -lt 0 -or $top -lt 0 -or $left+$Width -gt $fullWidth -or $top+$Height -gt $fullHeight) { return $null }
  $raw=New-Object System.Drawing.Bitmap $fullWidth,$fullHeight
  $cropped=$null;$accepted=$false
  try {
    $graphics=[System.Drawing.Graphics]::FromImage($raw)
    try {
      $hdc=$graphics.GetHdc()
      try { $ok=[WindowsComputerUseNative]::PrintWindow([IntPtr]$Hwnd,$hdc,2) }
      finally { $graphics.ReleaseHdc($hdc) }
    } finally { $graphics.Dispose() }
    if (-not $ok) { return $null }
    $after=New-Object WindowsComputerUseNative+RECT
    if (-not [WindowsComputerUseNative]::GetWindowRect([IntPtr]$Hwnd,[ref]$after) -or
        $after.left -ne $outer.left -or $after.top -ne $outer.top -or
        $after.right -ne $outer.right -or $after.bottom -ne $outer.bottom) { return $null }
    $crop=New-Object System.Drawing.Rectangle $left,$top,$Width,$Height
    $cropped=$raw.Clone($crop,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $allDark=$true
    $stepX=[Math]::Max(4,[Math]::Min(16,[int]($Width/16)))
    $stepY=[Math]::Max(4,[Math]::Min(16,[int]($Height/16)))
    $bmpRect=New-Object System.Drawing.Rectangle 0,0,$Width,$Height
    $bmpData=$cropped.LockBits($bmpRect,[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      for($y=0;$y -lt $Height;$y+=$stepY){
        $rowOffset=$y*$bmpData.Stride
        for($x=0;$x -lt $Width;$x+=$stepX){
          $argb=[System.Runtime.InteropServices.Marshal]::ReadInt32($bmpData.Scan0,$rowOffset+($x*4))
          if(((($argb -shr 16) -band 0xFF) -gt 4) -or ((($argb -shr 8) -band 0xFF) -gt 4) -or (($argb -band 0xFF) -gt 4)){$allDark=$false;break}
        }
        if(-not $allDark){break}
      }
    } finally {
      $cropped.UnlockBits($bmpData)
    }
    if($allDark){return $null}
    $accepted=$true;return $cropped
  } finally {
    $raw.Dispose()
    if(-not $accepted -and $null -ne $cropped){$cropped.Dispose()}
  }
}

# Our own screenshot PNGs older than 30 minutes. Times compare in UTC: a
# local write time against a UTC cutoff kept files for hours east of UTC and
# deleted fresh ones west of it.
$script:LastScreenshotCleanupUtc = $null
function Remove-OldScreenshots {
  $now = [DateTime]::UtcNow
  if ($null -ne $script:LastScreenshotCleanupUtc -and ($now - $script:LastScreenshotCleanupUtc).TotalSeconds -lt 60) { return }
  $script:LastScreenshotCleanupUtc = $now
  $cutoff = $now.AddMinutes(-30)
  try {
    foreach ($file in [System.IO.Directory]::EnumerateFiles($env:TEMP, 'windows-computer-use-*.png')) {
      if ([System.IO.File]::GetLastWriteTimeUtc($file) -lt $cutoff) { Remove-TempFile $file }
    }
  } catch { }
}

function Capture-Screenshot {
  param([object]$WindowElement = $null, [int]$MaxWidth = 1600, [bool]$IncludeImageData = ($script:WcuImageData -ne $false), [switch]$InMemory)
  $background = $env:WCU_BACKGROUND_DESKTOP -eq '1'
  if ($background -and $null -eq $WindowElement) {
    throw 'WCU_BACKGROUND_DESKTOP_TARGET_REQUIRED: capture a window by its nativeWindowHandle.'
  }
  if (-not $InMemory) { Remove-OldScreenshots }
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = $null
  $method = "screen"
  $occludedPossible = $false
  $windowCaptureFailed = $false
  $bx = $vs.Left; $by = $vs.Top; $bw = $vs.Width; $bh = $vs.Height
  $minimized = $false

  if ($null -ne $WindowElement) {
    $hwnd = if (Get-Prop $WindowElement 'nativeWindowHandle' 0) { [int64]$WindowElement.nativeWindowHandle } else { Invoke-Safe { [int64]$WindowElement.Current.NativeWindowHandle } 0 }
    # Windows parks a minimized window at -32000,-32000 and draws only its
    # title strip there: the capture works but shows nothing of the app (#82).
    $minimized = [bool]($hwnd -and [WindowsComputerUseNative]::IsIconic([IntPtr]$hwnd))
    $rect = $null
    if ($hwnd -and $hwnd -ne 0) { $rect = Get-ExtendedFrameBounds -Hwnd $hwnd }
    if ($null -eq $rect) { $rect = Convert-Rect (Invoke-Safe { $WindowElement.Current.BoundingRectangle } $null) }

    if ($null -ne $rect -and $hwnd -and $hwnd -ne 0) {
      # PrintWindow may return success with a partial Chromium/CEF surface.
      # For an unobstructed foreground window, read the actual desktop pixels.
      # Recheck Z order, focus and geometry after the copy before accepting it.
      if (-not $background -and (Invoke-Safe { Test-WindowScreenCapture -Hwnd $hwnd -Bounds $rect -VirtualScreen $vs } $false)) {
        $screen = $null
        try {
          $screen = New-Object System.Drawing.Bitmap $rect.width, $rect.height
          $sg = [System.Drawing.Graphics]::FromImage($screen)
          try { $sg.CopyFromScreen($rect.x, $rect.y, 0, 0, $screen.Size) } finally { $sg.Dispose() }
          $after = Get-ExtendedFrameBounds -Hwnd $hwnd
          if ($null -ne $after -and $after.x -eq $rect.x -and $after.y -eq $rect.y -and
              $after.width -eq $rect.width -and $after.height -eq $rect.height -and
              (Test-WindowScreenCapture -Hwnd $hwnd -Bounds $rect -VirtualScreen $vs)) {
            $bmp = $screen; $screen = $null; $method = "screen-region"
          }
        } catch {
          # The native window capture chain remains available after a race or
          # an unavailable desktop surface; no focus change is requested here.
        } finally {
          if ($null -ne $screen) { $screen.Dispose() }
        }
      }
      if ($null -eq $bmp) { $bmp = Invoke-Safe { Try-PrintWindowCapture -Hwnd $hwnd -Width $rect.width -Height $rect.height } $null }
      if ($null -ne $bmp) {
        if ($method -ne "screen-region") { $method = "printwindow" }
        $bx = $rect.x; $by = $rect.y; $bw = $rect.width; $bh = $rect.height
      } elseif (-not $background) {
        # PrintWindow may fail for composited surfaces. The final screen crop
        # is explicitly marked as possibly occluded.
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
    if ($background) { throw 'WCU_BACKGROUND_DESKTOP_LIMIT: Windows could not capture this window on the background desktop.' }
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

  $file = $null; $pngBytes = $null
  if ($InMemory) {
    $stream = New-Object System.IO.MemoryStream
    try { $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); $pngBytes = $stream.ToArray() }
    finally { $stream.Dispose(); $bmp.Dispose() }
    $byteLength = $pngBytes.Length
  } else {
    $file = Join-Path $env:TEMP ("windows-computer-use-" + [Guid]::NewGuid().ToString("N") + ".png")
    try { $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $bmp.Dispose() }
    $byteLength = (New-Object System.IO.FileInfo -ArgumentList $file).Length
  }

  $meta = [ordered]@{
    path = $file
    mimeType = "image/png"
    bytes = $byteLength
    method = $method
    bounds = [ordered]@{ x = $bx; y = $by; width = $bw; height = $bh }
    imageScale = [Math]::Round($scale, 4)
  }
  if ($method -eq "screen-region") { $meta["occludedPossible"] = $occludedPossible }
  if ($windowCaptureFailed) { $meta["windowCaptureFailed"] = $true }
  if ($minimized) { $meta["minimized"] = $true }
  if ($scale -ne 1.0) {
    $meta["imageScale"] = [Math]::Round($scale, 4)
    $meta["origin"] = [ordered]@{ x = $bx; y = $by }
  }
  if ($InMemory) { $meta['pngBytes'] = $pngBytes }
  elseif ($IncludeImageData) { $meta['base64'] = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($file)) }
  return $meta
}

function Get-ObservationWindow {
  # Without a window target: the window DSH works in (see Get-WorkWindow), or
  # with -Foreground the window actually in front.
  param([object]$InputObject, [string]$Scope = "active_window", [switch]$Foreground)
  if ($Scope -eq "desktop") { return $null }
  if (Has-WindowTarget $InputObject) {
    return (Select-TargetWindow $InputObject)
  }
  $hwnd = if ($Foreground) { [WindowsComputerUseNative]::GetForegroundWindow().ToInt64() } else { Get-WorkWindow }
  foreach ($info in (Get-NativeWindowList -IncludeInvisible $true -MaxWindows 4096)) {
    if ([int64]$info.nativeWindowHandle -eq $hwnd) { return $info }
  }
  return $null
}

function Get-WindowResponsive {
  param([object]$Window)
  if ($null -eq $Window) { return $null }
  return [WindowsComputerUseNative]::IsResponsive([IntPtr]([int64]$Window.nativeWindowHandle))
}

# ----------------------------------------------------------------------------
# Chromium page content (issue #50). Electron, Chrome/Edge, CEF and WebView2
# build a page's accessibility tree only after a UIA client reads a property of
# the page root, the first child of the Chrome_RenderWidgetHostHWND window.
# The control view skips that empty root, so tree walks alone can leave a
# window at its frame and layout panes. Before a window-scoped observation,
# read the root of each visible renderer and wait briefly for the page tree.
# An empty renderer is retried by later observations for 30 seconds; a single
# call waits at most 1.5 seconds and half of its traversal budget.
# ----------------------------------------------------------------------------
$script:ChromiumPages = @{}   # renderer hwnd -> @{ processId; firstSeen; ready }

function Test-ChromiumPage {
  param([IntPtr]$Renderer)
  # Resolve the renderer on every probe: enabling the page tree replaces the
  # root, and navigation from an element obtained earlier stays empty.
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $root = $walker.GetFirstChild([System.Windows.Automation.AutomationElement]::FromHandle($Renderer))
  if ($null -eq $root) { return $false }
  [void]$root.Current.ControlType
  return ($null -ne $walker.GetFirstChild($root))
}

# Attachment is not content. A document that finished loading before its content
# reached the DOM exposes its root and one unnamed container, so the page tree is
# attached while the window shows nothing: measured on Edge 157, a page whose
# body held only an empty mount element gave one descendant with no name, 0
# characters of text and the same all-white frame as about:blank. This walk
# answers one question -- does the page carry text? -- so one observation can
# say "nothing to read yet" instead of leaving it to be inferred from the
# attachment flag.
#
# It stops at the first descendant that carries text: the answer is a boolean,
# so walking the rest only spends the caller's time budget (measured on
# Electron 44, a full walk doubled a normal page's observation, 129 -> 274 ms).
# It also stops at $LimitMs and at $MaxNodes and says which happened, so a walk
# that did not finish is reported as unknown instead of empty.
#
# The page root is skipped on purpose: its name is the document title, which an
# otherwise blank page has too (<title> with an empty body still yields a named
# root). Returns $null when the renderer exposes no page root at all, which is
# "not built yet", not "empty".
#
# This looks for text, and only text. A page whose whole content is an image or
# a canvas carries no text and can still be a working page, so "no text" is a
# fact about text nodes, not a verdict about the page; callers must not turn it
# into "broken", and not into "reload".
function Get-ChromiumPageContent {
  param([IntPtr]$Renderer, [int]$LimitMs = 250, [int]$MaxNodes = 200)
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $root = $walker.GetFirstChild([System.Windows.Automation.AutomationElement]::FromHandle($Renderer))
  if ($null -eq $root) { return $null }
  [void]$root.Current.ControlType
  $facts = @{ hasText = $false; truncated = $false }
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $visited = 0
  $queue = New-Object System.Collections.Generic.Queue[object]
  $child = $walker.GetFirstChild($root)
  while ($null -ne $child -and $queue.Count -lt $MaxNodes -and $watch.ElapsedMilliseconds -lt $LimitMs) {
    $queue.Enqueue($child)
    $child = $walker.GetNextSibling($child)
  }
  if ($null -ne $child) { $facts.truncated = $true }
  while ($queue.Count -gt 0) {
    # Both limits mean the same thing here: the subtree was not read to the end.
    if ($visited -ge $MaxNodes -or $watch.ElapsedMilliseconds -ge $LimitMs) { $facts.truncated = $true; break }
    $element = $queue.Dequeue()
    $visited++
    $text = ''
    try { $text = [string]$element.Current.Name } catch { }
    if (-not $text.Trim()) {
      # A control that carries only a value (a filled input, a document body)
      # still shows text; the name is not the only place it can live.
      try {
        $pattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
          if ($null -ne $pattern -and ([string]$pattern.Current.Value).Trim()) { $text = [string]$pattern.Current.Value }
        }
      } catch { }
    }
    if ($text.Trim()) { return @{ hasText = $true; truncated = $false } }
    if ($watch.ElapsedMilliseconds -ge $LimitMs) { $facts.truncated = $true; break }
    $next = $walker.GetFirstChild($element)
    while ($null -ne $next -and $queue.Count -lt $MaxNodes -and $watch.ElapsedMilliseconds -lt $LimitMs) {
      $queue.Enqueue($next)
      $next = $walker.GetNextSibling($next)
    }
    if ($null -ne $next) { $facts.truncated = $true }
  }
  return $facts
}

function Initialize-ChromiumPages {
  param([object]$Window, [object]$Traversal)
  if ($null -eq $Window) { return $null }
  $renderers = @([WindowsComputerUseNative]::ChromiumRenderers([IntPtr]([int64]$Window.nativeWindowHandle), 8))
  if ($renderers.Count -eq 0) { return $null }
  foreach ($key in @($script:ChromiumPages.Keys)) {
    if (-not [WindowsComputerUseNative]::IsWindow([IntPtr]([int64]$key))) { $script:ChromiumPages.Remove($key) }
  }
  $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $status = [ordered]@{ renderers = $renderers.Count; ready = 0; waitedMs = 0; state = 'ready' }
  $pending = New-Object System.Collections.Generic.List[object]
  $responsive = New-Object System.Collections.Generic.List[object]
  foreach ($renderer in $renderers) {
    $owner = [uint32]0
    [void][WindowsComputerUseNative]::GetWindowThreadProcessId($renderer, [ref]$owner)
    $key = [string]$renderer.ToInt64()
    $page = $script:ChromiumPages[$key]
    if ($null -eq $page -or $page.processId -ne $owner) {
      $page = @{ processId = $owner; firstSeen = $now; ready = $false }
      $script:ChromiumPages[$key] = $page
    }
    # WebView2 and CEF renderers can belong to a process other than the window's.
    if (-not [WindowsComputerUseNative]::IsResponsive($renderer)) {
      $status["unresponsive"] = 1 + [int]$status["unresponsive"]
      continue
    }
    $responsive.Add($renderer)
    # A provider that refuses the read (an elevated app behind UIPI, a closing
    # page) gains nothing from waiting; the next observation probes it again.
    try { $ready = Test-ChromiumPage $renderer } catch { continue }
    if ($ready) { $page.ready = $true; $status.ready++; continue }
    # A page tree that disappeared (Chromium turned accessibility off again)
    # starts a new warm-up period.
    if ($page.ready) { $page.ready = $false; $page.firstSeen = $now }
    $pending.Add(@{ renderer = $renderer; page = $page })
  }
  # Measured on Electron 44: the page tree arrives 50-450 ms after the read.
  $start = $Traversal.watch.ElapsedMilliseconds
  $limit = [Math]::Min(1500, [int]($Traversal.budgetMs / 2))
  while ($true) {
    $waiting = @($pending | Where-Object { -not $_.page.ready -and ($now - $_.page.firstSeen) -lt 30000 })
    if ($waiting.Count -eq 0 -or ($Traversal.watch.ElapsedMilliseconds - $start) -ge $limit) { break }
    Start-Sleep -Milliseconds 50
    foreach ($item in $waiting) {
      if (Invoke-Safe { Test-ChromiumPage $item.renderer } $false) { $item.page.ready = $true; $status.ready++ }
    }
  }
  $status.waitedMs = [int]($Traversal.watch.ElapsedMilliseconds - $start)
  if ($status.ready -lt $renderers.Count) {
    $starting = @($pending | Where-Object { -not $_.page.ready -and ($now - $_.page.firstSeen) -lt 30000 }).Count
    $status.state = if ($status.ready -gt 0) { 'partial' } elseif ($starting -gt 0) { 'starting' } else { 'unavailable' }
  }
  # Report the content separately from the attachment above, and only for
  # renderers whose provider answered: a page that is still building has no
  # content reading yet, which is different from a page measured as empty.
  # ready, state and waitedMs keep their meaning, so existing callers of this
  # window-scoped status see no change.
  #
  # The walk gets a budget of its own -- at most 250 ms and at most a tenth of
  # treeTimeoutMs -- so the tree the caller asked for keeps most of the budget,
  # and the loop stops at the first renderer that carries text.
  $contentLimit = [Math]::Min(250, [int]($Traversal.budgetMs / 10))
  $measured = 0
  $foundText = $false
  foreach ($renderer in $responsive) {
    $facts = Invoke-Safe { Get-ChromiumPageContent $renderer $contentLimit } $null
    if ($null -eq $facts) { continue }
    if ($facts.hasText) { $foundText = $true; break }
    if (-not $facts.truncated) { $measured++ }
  }
  # contentState reports what was measured, never a guess: a walk cut short by
  # its time limit or the node cap, a refused provider and a page tree that has
  # not arrived all report unknown instead of claiming the page is empty.
  $status["contentState"] = if ($foundText) { 'content' } elseif ($measured -eq $renderers.Count) { 'empty' } else { 'unknown' }
  return $status
}

function Test-GeckoPageTree {
  param([IntPtr]$Hwnd)
  $el = [System.Windows.Automation.AutomationElement]::FromHandle($Hwnd)
  if ($null -eq $el) { return $false }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $docCond = New-Object System.Windows.Automation.PropertyCondition -ArgumentList ([System.Windows.Automation.AutomationElement]::ControlTypeProperty), ([System.Windows.Automation.ControlType]::Document)
  $doc = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $docCond)
  if ($null -ne $doc -and $null -ne $walker.GetFirstChild($doc)) { return $true }
  $child = $walker.GetFirstChild($el)
  $steps = 0
  while ($null -ne $child -and $steps -lt 64) {
    $steps++
    $ct = Invoke-Safe { $child.Current.ControlType } $null
    if ($ct -eq [System.Windows.Automation.ControlType]::Document) { return ($null -ne $walker.GetFirstChild($child)) }
    if ($ct -eq [System.Windows.Automation.ControlType]::Pane -or $ct -eq [System.Windows.Automation.ControlType]::Group) {
      $d2 = $walker.GetFirstChild($child)
      if ($null -ne $d2) {
        $d3 = $walker.GetFirstChild($d2)
        if ($null -ne $d3 -and $null -ne $walker.GetFirstChild($d3)) { return $true }
      }
    }
    $child = $walker.GetNextSibling($child)
  }
  return $false
}

$script:GeckoPages = @{}
function Initialize-GeckoPages {
  param([object]$Window, [object]$Traversal)
  if ($null -eq $Window -or $Window.className -ne 'MozillaWindowClass') { return $null }
  $hwnd = [IntPtr]([int64]$Window.nativeWindowHandle)
  if ($hwnd -eq [IntPtr]::Zero -or -not [WindowsComputerUseNative]::IsWindow($hwnd)) { return $null }
  if (-not [WindowsComputerUseNative]::IsResponsive($hwnd)) { return $null }
  if ($null -eq $script:GeckoPages) { $script:GeckoPages = @{} }
  $owner = [uint32]0
  [void][WindowsComputerUseNative]::GetWindowThreadProcessId($hwnd, [ref]$owner)
  $key = [string]$hwnd.ToInt64()
  $entry = $script:GeckoPages[$key]
  if ($null -eq $entry -or $entry.processId -ne $owner) {
    $entry = @{ processId = $owner; ready = $false }
    $script:GeckoPages[$key] = $entry
  }
  if ($entry.ready -and (Invoke-Safe { Test-GeckoPageTree $hwnd } $false)) {
    return @{ state = 'ready'; waitedMs = 0 }
  }
  $entry.ready = $false
  [UIntPtr]$wakeRes = [UIntPtr]::Zero
  try { [void][WindowsComputerUseNative]::SendMessageTimeout($hwnd, 0x003D, [UIntPtr]::Zero, [IntPtr](-4), 3, 500, [ref]$wakeRes) } catch { }
  if (Invoke-Safe { Test-GeckoPageTree $hwnd } $false) {
    $entry.ready = $true
    return @{ state = 'ready'; waitedMs = 0 }
  }
  $start = $Traversal.watch.ElapsedMilliseconds
  $limit = [Math]::Min(2500, [int]($Traversal.budgetMs / 2))
  while (($Traversal.watch.ElapsedMilliseconds - $start) -lt $limit) {
    Start-Sleep -Milliseconds 80
    if (Invoke-Safe { Test-GeckoPageTree $hwnd } $false) {
      $entry.ready = $true
      return @{ state = 'ready'; waitedMs = [int]($Traversal.watch.ElapsedMilliseconds - $start) }
    }
  }
  return @{ state = 'starting'; waitedMs = [int]($Traversal.watch.ElapsedMilliseconds - $start) }
}

function Get-TreeResult {
  param([string]$Scope, [int]$MaxDepth, [int]$MaxNodes, [object]$InputObject = $null)
  $script:ElementGeneration++
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $viewMode = Get-ViewMode $InputObject "control"
  $includeOffscreen = [bool](Get-Prop $InputObject "includeOffscreen" $false)
  $detailLevel = Get-DetailLevel $InputObject "compact"
  $budgetMs = [int](Get-Prop $InputObject "treeTimeoutMs" 5000)
  if ($budgetMs -lt 100 -or $budgetMs -gt 30000) { throw "treeTimeoutMs must be between 100 and 30000." }
  $window = Get-ObservationWindow $InputObject $Scope
  $script:ObservationOwner = $window
  $script:NativeOwners = @{}
  if ($Scope -eq 'desktop') {
    foreach ($native in (Get-NativeWindowList -IncludeInvisible $true -MaxWindows 4096)) { $script:NativeOwners[[string]$native.nativeWindowHandle] = $native }
  }
  $responsive = Get-WindowResponsive $window
  $cache = New-ElementCacheRequest $detailLevel
  $isGecko = ($null -ne $window -and $window.className -eq 'MozillaWindowClass')
  $walker = New-Object System.Windows.Automation.TreeWalker -ArgumentList (Get-ViewCondition $viewMode $includeOffscreen -SkipOffscreenFilter:$isGecko)
  $traversal = @{watch=$stopwatch; budgetMs=$budgetMs; cache=$cache; walker=$walker; reason=$null; error=$null; browserLayout=($Scope -ne 'desktop'); pruneGeckoOffscreen=($isGecko -and -not $includeOffscreen); countedDepth=0; structuralDepth=0}
  $tree = $null
  $count = 0
  $pages = $null
  if ($null -ne $responsive -and -not $responsive) {
    $traversal.reason = "targetUnresponsive"
  } else {
    $root = Get-ScopeRoot $Scope $InputObject
    Update-WindowCache $root
    Update-WindowIdentity $InputObject $root
    if ($Scope -ne 'desktop') {
      $pages = Initialize-ChromiumPages $window $traversal
      if ($null -eq $pages -and $isGecko) { [void](Initialize-GeckoPages $window $traversal) }
    }
    try {
      if (Test-TreeBudget $traversal) {
        $root = $root.GetUpdatedCache($cache)
        $prefix = if ($Scope -eq "desktop") { "root" } else { "active" }
        $tree = Convert-Tree -Element $root -Path $prefix -Depth 0 -MaxDepth $MaxDepth -Count ([ref]$count) -MaxNodes $MaxNodes -ViewMode $viewMode -IncludeOffscreen $includeOffscreen -DetailLevel $detailLevel -Traversal $traversal -Owner $window
      }
    } catch {
      $traversal.reason = "providerError"
      $traversal.error = $_.Exception.Message
    }
  }
  if ($null -ne $traversal.reason -and $traversal.reason -ne "targetUnresponsive") { $responsive = Get-WindowResponsive $window }
  $stopwatch.Stop()
  $script:ObservationOwner = $null
  $result = [ordered]@{
    ok = $true; scope = $Scope; viewMode = $viewMode; includeOffscreen = $includeOffscreen
    detailLevel = $detailLevel; nodeCount = $count; truncated = ($null -ne $traversal.reason)
    countedDepth = $traversal.countedDepth; structuralDepth = $traversal.structuralDepth
    durationMs = [int]$stopwatch.ElapsedMilliseconds; tree = $tree
    treeTimeoutMs = $budgetMs; targetResponsive = $responsive
  }
  if ($null -ne $window -and $null -ne $script:WindowCache -and $script:WindowCache.ContainsKey([string]$window.nativeWindowHandle)) {
    $result['windowObservation']=$script:WindowCache[[string]$window.nativeWindowHandle]
  }
  if ($null -ne $pages) { $result["webContent"] = $pages }
  if ($null -ne $traversal.reason) {
    $result["truncationReason"] = $traversal.reason
    if ($traversal.reason -ne "maxNodes") {
      $result["warning"] = "UIA traversal stopped ($($traversal.reason)). Avoid repeated tree calls; check the target window and use screenshot/ocr when appropriate. A single synchronous provider call can exceed treeTimeoutMs."
    }
    if ($null -ne $traversal.error) { $result["providerError"] = $traversal.error }
  }
  return $result
}

# ============================================================================
# Action dispatch (shared by one-shot and persistent modes)
# ============================================================================

function Resolve-LaunchTarget {
  param([string]$Target)
  $targetValue = [Environment]::ExpandEnvironmentVariables($Target.Trim())
  if ([string]::IsNullOrWhiteSpace($targetValue) -or $targetValue -match '[\x00-\x1f]') { throw 'LAUNCH_INVALID_TARGET: supply an executable, shortcut, installed app name or AppUserModelID.' }
  # Resolve files and application commands without interpreting shell syntax.
  $file = $null
  if ([IO.Path]::IsPathRooted($targetValue)) {
    if ($targetValue -notmatch '^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))') { throw 'LAUNCH_INVALID_TARGET: supply a fully qualified absolute path, not a drive-relative or root-relative path.' }
    if (-not (Test-Path -LiteralPath $targetValue -PathType Leaf)) { throw "LAUNCH_NOT_FOUND: $targetValue" }
    $file = (Get-Item -LiteralPath $targetValue).FullName
  } elseif ($targetValue -notmatch '[/\\:]') {
    $command = Get-Command -Name $targetValue -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $targetValue -or $_.Name -ieq ($targetValue + '.exe') } | Select-Object -First 1
    if ($command) { $file = $command.Source }
    if (-not $file) {
      $exeName = if ($targetValue.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) { $targetValue } else { $targetValue + '.exe' }
      foreach ($hive in @('HKCU:', 'HKLM:')) {
        $key = Get-Item -LiteralPath ($hive + '\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\' + $exeName) -ErrorAction SilentlyContinue
        if ($key) {
          $candidate = [Environment]::ExpandEnvironmentVariables(([string]$key.GetValue('')).Trim('"'))
          if (Test-Path -LiteralPath $candidate -PathType Leaf) { $file = (Get-Item -LiteralPath $candidate).FullName; break }
        }
      }
    }
  }
  if ($file) {
    if ([IO.Path]::GetExtension($file) -notin @('.exe', '.com', '.lnk')) { throw 'LAUNCH_INVALID_TARGET: only .exe, .com and .lnk files are supported.' }
    return @{ target=$file; kind='file' }
  }
  # Exact matching prevents an ambiguous display name from launching the wrong app.
  $apps = @(Get-StartApps -ErrorAction Stop | Where-Object { $_.AppID -ieq $targetValue -or $_.Name -ieq $targetValue })
  if ($apps.Count -eq 0) { throw "LAUNCH_NOT_FOUND: '$targetValue'. Supply a full executable path or an installed AppUserModelID." }
  if ($apps.Count -ne 1) { throw "LAUNCH_AMBIGUOUS: '$targetValue' matches several installed apps; use its AppUserModelID or full executable path." }
  return @{ target=('shell:AppsFolder\' + $apps[0].AppID); kind='installed-app' }
}

function Invoke-LaunchApp {
  param([object]$InputObject)
  $rawTarget = [Environment]::ExpandEnvironmentVariables([string](Get-Prop $InputObject 'target' ''))
  if ($rawTarget -match '^[\\/]{2,}') { throw 'LAUNCH_POLICY_DENIED: network paths are not supported.' }
  $resolved = Resolve-LaunchTarget $rawTarget
  $background = $env:WCU_BACKGROUND_DESKTOP -eq '1'
  if ($background -and ($resolved.kind -ne 'file' -or [IO.Path]::GetExtension($resolved.target) -notin @('.exe','.com'))) {
    throw 'WCU_BACKGROUND_DESKTOP_LIMIT: the hidden desktop starts an application executable only. Shortcuts and installed or Store apps open on the user''s desktop (desktop:"current").'
  }
  $approved = [bool](Get-Prop $InputObject '_wcuLaunchApproved' $false)
  $arguments = [string](Get-Prop $InputObject 'arguments' '')
  $directory = [string](Get-Prop $InputObject 'workingDirectory' '')
  if ($arguments -match '[\x00\r\n]' -or $directory -match '[\x00-\x1f]') { throw 'LAUNCH_INVALID_ARGUMENTS: arguments and workingDirectory must be single-line strings.' }
  if ($directory) {
    $directory = [Environment]::ExpandEnvironmentVariables($directory)
    if ($directory -match '^[\\/]{2,}') { throw 'LAUNCH_POLICY_DENIED: network working directories are not supported.' }
    if ($directory -notmatch '^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))' -or -not (Test-Path -LiteralPath $directory -PathType Container)) { throw 'LAUNCH_INVALID_DIRECTORY: supply an existing fully qualified absolute directory.' }
    $directory = (Get-Item -LiteralPath $directory).FullName
  }
  if ($resolved.kind -eq 'installed-app' -and ($arguments -or $directory)) { throw 'LAUNCH_INVALID_ARGUMENTS: AppUserModelID launches do not accept arguments or workingDirectory.' }
  # Command interpreters and script hosts run whatever their arguments say, so
  # with arguments launch_app would be a command channel the user never sees.
  # They start only without arguments; commands belong to DSH's own shell tool.
  # A shortcut is judged by the program it starts.
  if ($resolved.kind -eq 'file') {
    $program = $resolved.target
    $effectiveArguments=$arguments
    if ([IO.Path]::GetExtension($program) -ieq '.lnk') {
      $shell = $null; $link = $null
      try {
        $shell = New-Object -ComObject WScript.Shell; $link = $shell.CreateShortcut($program)
        $program = [Environment]::ExpandEnvironmentVariables([string]$link.TargetPath).Trim()
        if ([Environment]::ExpandEnvironmentVariables([string]$link.WorkingDirectory).Trim() -match '^[\\/]{2,}') { throw 'LAUNCH_POLICY_DENIED: network shortcut working directories are not supported.' }
        if ([string]$link.Arguments) { $effectiveArguments = ([string]$link.Arguments + ' ' + $arguments).Trim() }
      }
      finally { foreach ($com in @($link, $shell)) { if ($null -ne $com) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($com) } } }
      if ([string]::IsNullOrWhiteSpace($program)) {
        if (-not $approved) { throw 'WCU_APPROVAL_REQUIRED: launching shortcuts without a direct local target requires host approval.' }
      } elseif (-not [IO.Path]::IsPathRooted($program)) {
        $program = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetDirectoryName($resolved.target)) $program))
      }
    }
    if ($program -match '^[\\/]{2,}') { throw 'LAUNCH_POLICY_DENIED: network shortcut targets are not supported.' }
    if ($effectiveArguments.Trim() -and -not $approved) { throw 'WCU_APPROVAL_REQUIRED: launching with arguments requires host approval or explicit standalone configuration.' }
    $commandHosts = @('cmd', 'powershell', 'pwsh', 'wt', 'wsl', 'bash', 'sh', 'conhost', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32', 'msiexec', 'forfiles', 'schtasks', 'pcalua', 'ftp', 'python', 'pythonw', 'node', 'deno', 'bun', 'perl', 'ruby', 'php')
    $name = ([IO.Path]::GetFileNameWithoutExtension($program.TrimEnd('.', ' '))).ToLowerInvariant()
    if ($effectiveArguments.Trim() -and $name -in $commandHosts) { throw "LAUNCH_COMMAND_REFUSED: $name runs the commands in its arguments. launch_app starts command interpreters and script hosts only without arguments; run commands with DSH's own shell tool." }
  }
  $waitMs = [int](Get-Prop $InputObject 'waitMs' 1500)
  if ($waitMs -lt 0 -or $waitMs -gt 10000) { throw 'LAUNCH_INVALID_ARGUMENTS: waitMs must be 0-10000.' }
  $before = @(Get-NativeWindowList -MaxWindows 1000 | ForEach-Object { $_.ToArray() } | ForEach-Object { $_.nativeWindowHandle })
  if ($background) {
    [void](Test-Failsafe)
    # Without a folder of its own the app starts in the user's profile folder,
    # never in this plugin's: an app whose working folder is inside the plugin
    # keeps the plugin market from replacing it (mcp/update-guard.mjs).
    $working = if ($directory) { $directory } else { [Environment]::GetFolderPath('UserProfile') }
    $appPid = [WindowsComputerUseNative]::StartBackgroundProgram($resolved.target,$arguments,$working)
    if ($waitMs) { Start-Sleep -Milliseconds $waitMs }
    $observed = @(Get-NativeWindowList -MaxWindows 1000 | ForEach-Object { $_.ToArray() } | Where-Object { $before -notcontains $_.nativeWindowHandle -and $_.processId -eq $appPid })
    return [ordered]@{
      ok=$true; action='launch_app'; target=$resolved.target; launchMethod='background-desktop'; verification='dispatched'
      processId=$appPid; observedNewWindows=$observed
      note='Use list_windows to check whether the app opened a window here. Some apps reuse an existing instance.'
    }
  }
  $shellWindows = $null; $desktop = $null; $document = $null; $application = $null
  try {
    # The desktop folder view belongs to Explorer. Its ShellExecute starts the
    # application with the desktop environment/lifetime, outside the short-lived
    # tool's kill-on-close Job (#55). No elevation or breakaway flag is requested.
    $shellWindows = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'9BA05972-F6A8-11CF-A442-00A0C90A8F39'))
    $location = 0; $root = $null; $desktopHwnd = 0
    $desktop = $shellWindows.FindWindowSW([ref]$location, [ref]$root, 8, [ref]$desktopHwnd, 1)
    if ($null -eq $desktop) { throw 'The interactive Explorer desktop is unavailable.' }
    $document = $desktop.Document
    $application = $document.Application
    [void](Test-Failsafe)
    $show = if ([bool](Get-Prop $InputObject 'activate' $false)) { 1 } else { 4 }
    if ($script:WcuLowDisruption) { [WcuInputHold]::Snapshot() }
    $application.ShellExecute($resolved.target, $arguments, $directory, 'open', $show)
  } catch {
    throw ('LAUNCH_SHELL_FAILED: ' + $_.Exception.Message + ' An interactive Explorer desktop is required; the request is not retried as a tool child process.')
  } finally {
    foreach ($com in @($application, $document, $desktop, $shellWindows)) {
      if ($null -ne $com -and [Runtime.InteropServices.Marshal]::IsComObject($com)) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($com) }
    }
  }
  if ($waitMs) { Start-Sleep -Milliseconds $waitMs }
  $observed = @(Get-NativeWindowList -MaxWindows 1000 | ForEach-Object { $_.ToArray() } | Where-Object { $before -notcontains $_.nativeWindowHandle })
  $result = [ordered]@{
    ok=$true; action='launch_app'; target=$resolved.target; launchMethod='explorer-shell'; verification='dispatched'
    observedNewWindows=$observed
    note='The shell accepted the request. New windows are observations, not confirmed matches; an app may reuse an existing window or show none. Verify with list_windows/wait_for. activate=false requests no activation, but applications may activate themselves.'
  }
  # Low disruption: an app that comes forward by itself does not get the
  # user's typing; it goes to the window they were in.
  if ($script:WcuLowDisruption -and $observed.Count -and [WcuInputHold]::ArmGuard([long[]]@($observed | ForEach-Object { [int64]$_.nativeWindowHandle }), [long[]]@($observed | ForEach-Object { [int64]$_.processId }))) {
    $result['userInput'] = 'If the user types while this app is in front, the foreground goes back to their window first, until they click into it themselves.'
  }
  return $result
}

function Get-DesktopInputMutexName {
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  return "Local\DSH-WCU-Input-v1-$sid"
}

function Enter-DesktopInput {
  # The session's input is shared by everything on the user's desktop. A hidden
  # desktop receives no real input, so its actions skip this lease (-Skip).
  param([switch]$Skip)
  if ($Skip) { return $null }
  # Local names isolate Windows sessions; the SID isolates users in a session.
  # Never queue or replay an input request after a competing operation.
  $mutex = New-Object System.Threading.Mutex($false, (Get-DesktopInputMutexName))
  $owned = $false
  try {
    try { $owned = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] {
      # WaitOne acquired the abandoned mutex. Its former action has an unknown
      # result, so release ownership but require this caller to observe again.
      $owned = $true
      throw 'COMPUTER_USE_PREVIOUS_INPUT_INTERRUPTED: Another input process exited unexpectedly. Observe the desktop again before acting; do not replay its input.'
    }
    if (-not $owned) { throw 'COMPUTER_USE_BUSY: Another process is operating the desktop. This input was not sent; observe again before a later action.' }
    return $mutex
  } catch {
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    throw
  }
}

function Exit-DesktopInput {
  param([object]$Lease)
  if ($null -ne $Lease) {
    try { $Lease.ReleaseMutex() } finally { $Lease.Dispose() }
  }
}

function Invoke-Action {
  param([string]$Action, [object]$inputObject = $null)

  $script:WcuImageData = [bool](Get-Prop $inputObject '_wcuImageData' ($env:WCU_IMAGE_MODE -ne 'file'))
  $script:WcuCornerFailsafe = [bool](Get-Prop $inputObject '_wcuCornerFailsafe' $true)
  # Set by the server: a background attempt (no indicator, no Esc stop) and the
  # operation series (host turn) this call belongs to.
  $script:WcuQuiet = [bool](Get-Prop $inputObject '_wcuQuiet' $false)
  $script:WcuSeries = Get-Prop $inputObject '_wcuSeries' $null
  $background = $env:WCU_BACKGROUND_DESKTOP -eq '1'
  # Low disruption on the user's desktop: real input holds the user's own
  # input and replays it afterwards, and a window DSH leaves in front is
  # guarded (WcuInputHold).
  $script:WcuLowDisruption = [bool](Get-Prop $inputObject '_wcuLowDisruption' $false) -and -not $background
  $script:WcuHolding = $false
  if ($background) {
    $nativeTarget = Get-Prop $inputObject 'nativeWindowHandle' $null
    if ($null -ne $nativeTarget -and [WindowsComputerUseNative]::TopLevelWindows() -notcontains [IntPtr]([long]$nativeTarget)) {
      throw 'WCU_BACKGROUND_DESKTOP_WINDOW_UNAVAILABLE: the target window is not on this background desktop.'
    }
    if ($Action -in @('move','drag','focus','activate_window') -or (Get-Prop $inputObject 'activate' $false) -or
        ($Action -eq 'element_info' -and $null -ne (Get-Prop $inputObject 'x' $null))) {
      throw 'WCU_BACKGROUND_DESKTOP_LIMIT: this action requires the input desktop.'
    }
  }
  $inputLease = $null
  try {
  if ($Action -in @('launch_app','click','double_click','move','drag','scroll','type_text','keypress','focus','invoke','set_value','activate_window','close_window','move_window') -or (Get-Prop $inputObject 'activate' $false)) {
    $inputLease = Enter-DesktopInput -Skip:$background
    $script:TakeoverProcessId = [int](Get-Prop $inputObject '_wcuTakeoverPid' 0)
    if ($env:WCU_CANCEL_EVENT) { [WindowsComputerUseNative]::SetStopListener($script:TakeoverProcessId) }
    [void](Test-Failsafe)
  }

  switch ($Action) {
    "launch_app" { return (Invoke-LaunchApp $inputObject) }
    "input_state" {
      $state = [WcuInputHold]::UserState()
      return [ordered]@{ ok = $true; action = 'input_state'; held = $state.Held; fullscreen = $state.Fullscreen; notification = $state.Notification; foreground = $state.Foreground }
    }
    "health" {
      $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
      # Health checks backend availability independently of any application's
      # UIA provider. Reading the foreground provider here can wedge a health
      # request even though native enumeration/capture remain available.
      Write-BackendStage 'health-native-window-start'
      $active = Get-ObservationWindow ([pscustomobject]@{}) -Foreground
      Update-WindowCache $active
      Write-BackendStage 'health-native-window-complete'
      return ([ordered]@{
        ok = $true
        platform = "Windows"
        powershell = $PSVersionTable.PSVersion.ToString()
        mode = if ($Persistent) { "persistent" } else { "oneshot" }
        uiAutomation = $true
        treeObservation = @{cached=$true; defaultTreeTimeoutMs=5000; providerCallInterruptible=$false; chromiumHint="Use a scoped control tree; if traversal truncates or times out, check responsiveness before retrying and prefer screenshot/ocr."}
        screenshot = $true
        sendInput = (-not $background)
        desktopTarget = if ($background) { 'background' } else { 'current' }
        postmessage = $true
        ocr = "lazy"
        homing = $true
        failsafe = ($script:WcuCornerFailsafe -and [string]$env:WCU_FAILSAFE -ne '0')
        activeWindow = $active
        uiAutomationProviderChecked = $false
        targetResponsive = Get-WindowResponsive $active
        inputDesktopAvailable = Invoke-Safe { if ([WindowsComputerUseNative].GetMethod('IsInputDesktopAvailable') -ne $null) { [WindowsComputerUseNative]::IsInputDesktopAvailable() } else { $true } } $false
        virtualScreen = [ordered]@{ x = $screen.Left; y = $screen.Top; width = $screen.Width; height = $screen.Height }
      })
    }
    "snapshot" {
      $scope = Get-Prop $inputObject "scope" "active_window"
      $includeScreenshot = [bool](Get-Prop $inputObject "includeScreenshot" $true)
      $captureWindow = [bool](Get-Prop $inputObject "captureWindow" (Has-WindowTarget $inputObject))
      $maxWidth = [int](Get-Prop $inputObject "maxWidth" 1600)
      $maxDepth = [int](Get-Prop $inputObject "maxDepth" 5)
      $maxNodes = [int](Get-Prop $inputObject "maxNodes" 250)
      $treeResult = Get-TreeResult -Scope $scope -MaxDepth $maxDepth -MaxNodes $maxNodes -InputObject $inputObject
      if ($includeScreenshot) {
        $winEl = $null
        # The window DSH works in may be behind the user's window: then the
        # screen shows the user's window, so capture DSH's window itself.
        $behind = $scope -ne 'desktop' -and -not (Has-WindowTarget $inputObject) -and (Get-WorkWindow) -ne [WindowsComputerUseNative]::GetForegroundWindow().ToInt64()
        if (($captureWindow -or $behind -or $background) -and $treeResult.targetResponsive -ne $false) {
          $winEl = Get-ObservationWindow $inputObject $scope
        }
        $treeResult.screenshot = Capture-Screenshot -WindowElement $winEl -MaxWidth $maxWidth
        if ($treeResult.screenshot.occludedPossible) {
          $treeResult["warning"] = (([string]$treeResult.warning + " The window capture may include an occluding window; inspect screenshot.occludedPossible.").Trim())
        }
        if ($treeResult.screenshot.minimized) {
          $treeResult["warning"] = (([string]$treeResult.warning + " The window is minimized: the capture shows only its title strip. Call activate_window to restore it.").Trim())
        }
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
      # Minimized windows are listed: they are still there and can be targeted
      # (activate_window restores them). batch keeps to shown ones.
      $includeMinimized = [bool](Get-Prop $inputObject "includeMinimized" $true)
      $windows = Get-NativeWindowList -IncludeInvisible $includeInvisible -MaxWindows $maxWindows -RecordObservation -IncludeMinimized $includeMinimized
      # A minimized window's box is the -32000,-32000 parking spot: leave it out
      # rather than let it read as a position.
      $listed = @($windows.ToArray() | ForEach-Object { if ($_.Contains('minimized')) { [ordered]@{ id = $_.id; name = $_.name; className = $_.className; processId = $_.processId; nativeWindowHandle = $_.nativeWindowHandle; isOffscreen = $true; minimized = $true } } else { $_ } })
      $listing = [ordered]@{ ok = $true; windows = $listed }
      if ($script:WindowListTruncated) { $listing['truncated'] = $true; $listing['truncationReason'] = "maxWindows ($maxWindows) reached; pass a larger maxWindows (up to 200) to list the rest." }
      return $listing
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
        treeTimeoutMs = Get-Prop $inputObject "treeTimeoutMs" 5000
        windowTitle = Get-Prop $inputObject "windowTitle" $null
        processId = Get-Prop $inputObject "processId" $null
        nativeWindowHandle = Get-Prop $inputObject "nativeWindowHandle" $null
        activate = [bool](Get-Prop $inputObject "activate" $false)
      }
      $treeResult = Get-TreeResult -Scope $scope -MaxDepth $maxDepth -MaxNodes $maxNodes -InputObject $findInput
      $results = New-Object System.Collections.Generic.List[object]
      Search-Tree -Node $treeResult.tree -Query $query -ControlType $controlType -MaxResults $maxResults -Results $results
      $out = [ordered]@{ ok = $true; query = $query; results = @($results.ToArray()); scannedNodes = $treeResult.nodeCount; truncated = $treeResult.truncated }
      foreach ($key in @('durationMs','treeTimeoutMs','targetResponsive','truncationReason','warning','providerError','webContent')) {
        if ($treeResult.Contains($key)) { $out[$key] = $treeResult[$key] }
      }
      if ($results.Count -eq 0 -and $treeResult.nodeCount -lt 10) {
        $out["hint"] = "UIA tree is sparse (fewer than 10 nodes): this app may not expose an accessibility tree (game / self-drawn Tk / Qt / canvas / RDP). Use the ocr tool to locate text by pixels."
      }
      return $out
    }
    "element_info" {
      $detailLevel = Get-DetailLevel $inputObject "compact"
      $elementId = Get-Prop $inputObject "elementId" $null
      if ($null -ne $elementId) {
        $el = Resolve-Element $elementId $inputObject
        return ([ordered]@{ ok = $true; element = (Convert-ElementInfo -Element $el -Id $elementId -Depth 0 -DetailLevel $detailLevel) })
      } else {
        $x = [int](Get-Prop $inputObject "x" 0)
        $y = [int](Get-Prop $inputObject "y" 0)
        Activate-TargetIfRequested $inputObject
        $point = New-Object System.Windows.Point($x, $y)
        $nativePoint = New-Object WindowsComputerUseNative+POINT
        $nativePoint.x = $x; $nativePoint.y = $y
        $pointHwnd = [WindowsComputerUseNative]::GetAncestor([WindowsComputerUseNative]::WindowFromPoint($nativePoint), 2).ToInt64()
        $ownerWindow = $null
        foreach ($native in (Get-NativeWindowList -IncludeInvisible $true -MaxWindows 4096)) {
          if ([int64]$native.nativeWindowHandle -eq $pointHwnd) { $ownerWindow = $native; break }
        }
        if (Has-WindowTarget $inputObject) {
          $requested = Get-ObservationWindow $inputObject
          if ($pointHwnd -ne [int64]$requested.nativeWindowHandle) { throw 'Point is outside or occluded by another target window.' }
        }
        # A cold Chromium page answers hit tests with its layout pane.
        $pages = Initialize-ChromiumPages $ownerWindow @{ watch = [Diagnostics.Stopwatch]::StartNew(); budgetMs = 2000 }
        $el = [System.Windows.Automation.AutomationElement]::FromPoint($point)
        $script:ObservationOwner = $ownerWindow
        try {
          $result = [ordered]@{ ok = $true; point = [ordered]@{ x = $x; y = $y }; element = (Convert-ElementInfo -Element $el -Id $null -Depth 0 -DetailLevel $detailLevel) }
          if ($null -ne $pages) { $result["webContent"] = $pages }
          return $result
        } finally { $script:ObservationOwner = $null }
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
        $target = Get-ObservationWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X $point.x -Y $point.y -Target $target -ObservationToken ([string](Get-Prop $inputObject 'observationToken' ''))
        $point.x = $homed.x
        $point.y = $homed.y
        if ($null -ne $homed.homed) { $result["homed"] = $homed.homed }
      }

      # Dispatch layering (cua-style): a left click on an element tries the
      # element itself first (BM_CLICK or a UIA pattern, in the background);
      # raw coordinates and other buttons need the system input queue
      # (foreground SendInput) unless the caller explicitly asks for
      # background PostMessage. A pattern stands for a left click only.
      $useBackground = ($dispatch -eq "background") -or (($dispatch -eq "auto") -and ($null -ne $point.elementId) -and $button -eq 'left' -and -not [bool](Get-Prop $inputObject 'activate' $false))
      if ($useBackground) {
        if ($null -ne $point.elementId -and $button -eq 'left') {
          $patternMethod = Invoke-ElementPattern $point.element
          if ($null -ne $patternMethod) {
            $result["method"] = "background:$patternMethod"
            Add-BackgroundReport $result
            Set-WorkWindow (Get-ElementWindow $point.element)
            return $result
          }
        }
        # Auto is a background-first policy, not permission to silently post
        # an unhandled mouse message. Upgrade before sending any real input.
        if ($dispatch -ne 'background') {
          Assert-InputAllowed 'This element has no background click pattern'
        } else {
        $hwnd = 0
        if ($null -ne $point.element) { $hwnd = Invoke-Safe { [int64]$point.element.Current.NativeWindowHandle } 0 }
        if (-not ($hwnd -and $hwnd -ne 0)) { $hwnd = if ($null -ne $point.element) { Get-ElementWindow $point.element } else { Resolve-TargetHwnd $inputObject } }
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
      }

      Assert-InputAllowed 'This click'
      # Real input: a target comes forward for the click and the point must
      # show it; without a target the click goes to the window at the point,
      # which it brings forward itself. Pointer and foreground are given back.
      $targeted = (Has-WindowTarget $inputObject) -or ($null -ne $point.element)
      $hwnd = if (Has-WindowTarget $inputObject) { [int64](Get-ObservationWindow $inputObject).nativeWindowHandle } elseif ($null -ne $point.element) { Get-ElementWindow $point.element } else { Get-RootWindowAt $point.x $point.y }
      $state = Start-Input -InputObject $inputObject -Hwnd $hwnd -NoActivate:(-not $targeted)
      try {
        Confirm-ElementPoint $point
        if ($targeted) { Assert-PointOnTarget $point.x $point.y $hwnd $state }
        $result.x = $point.x; $result.y = $point.y
        $state.moved = @{ x = $point.x; y = $point.y }
        $state.drain = $true
        Click-At -X $point.x -Y $point.y -Button $button -Count 1
        $result["method"] = "sendinput"
      } finally { Complete-Input $state $result }
      return $result
    }
    "double_click" {
      [void](Test-Failsafe)
      $point = Get-PointFromArgs $inputObject
      $button = Get-Prop $inputObject "button" "left"
      [void](Get-ButtonFlags $button)
      $dispatch = [string](Get-Prop $inputObject "dispatch" "auto")
      $result = [ordered]@{ ok = $true; action = "double_click"; x = $point.x; y = $point.y; button = $button; elementId = $point.elementId }
      if ((Has-WindowTarget $inputObject) -and ($null -eq $point.elementId)) {
        $target = Get-ObservationWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X $point.x -Y $point.y -Target $target -ObservationToken ([string](Get-Prop $inputObject 'observationToken' ''))
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
      $targeted = (Has-WindowTarget $inputObject) -or ($null -ne $point.element)
      $hwnd = if (Has-WindowTarget $inputObject) { [int64](Get-ObservationWindow $inputObject).nativeWindowHandle } elseif ($null -ne $point.element) { Get-ElementWindow $point.element } else { Get-RootWindowAt $point.x $point.y }
      $state = Start-Input -InputObject $inputObject -Hwnd $hwnd -NoActivate:(-not $targeted)
      try {
        Confirm-ElementPoint $point
        if ($targeted) { Assert-PointOnTarget $point.x $point.y $hwnd $state }
        $result.x = $point.x; $result.y = $point.y
        $state.moved = @{ x = $point.x; y = $point.y }
        $state.drain = $true
        Click-At -X $point.x -Y $point.y -Button $button -Count 2
        $result["method"] = "sendinput"
      } finally { Complete-Input $state $result }
      return $result
    }
    "move" {
      [void](Test-Failsafe)
      $point = Get-PointFromArgs $inputObject
      $result = [ordered]@{ ok = $true; action = "move"; x = $point.x; y = $point.y; elementId = $point.elementId }
      Activate-TargetIfRequested $inputObject
      if ((Has-WindowTarget $inputObject) -and ($null -eq $point.elementId)) {
        $target = Get-ObservationWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X $point.x -Y $point.y -Target $target -ObservationToken ([string](Get-Prop $inputObject 'observationToken' ''))
        $point.x = $homed.x
        $point.y = $homed.y
        if ($null -ne $homed.homed) { $result["homed"] = $homed.homed }
      }
      Move-ToPoint -X $point.x -Y $point.y
      return $result
    }
    "drag" {
      [void](Test-Failsafe)
      $path = @(Get-Prop $inputObject "path" @())
      if ($path.Count -lt 2) { throw "path must contain at least two points." }
      $button = Get-Prop $inputObject "button" "left"
      $flags = Get-ButtonFlags $button
      # Homing: shift the whole path if the target window moved since the
      # coordinates were observed.
      if (Has-WindowTarget $inputObject) {
        $target = Get-ObservationWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X ([int]$path[0].x) -Y ([int]$path[0].y) -Target $target -ObservationToken ([string](Get-Prop $inputObject 'observationToken' ''))
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
      $targeted = Has-WindowTarget $inputObject
      $hwnd = if ($targeted) { [int64](Get-ObservationWindow $inputObject).nativeWindowHandle } else { Get-RootWindowAt ([int]$first.x) ([int]$first.y) }
      $result = [ordered]@{ ok = $true; action = "drag"; points = $path.Count; button = $button; homed = if ($null -ne $homed) { $homed.homed } else { $null } }
      $state = Start-Input -InputObject $inputObject -Hwnd $hwnd -NoActivate:(-not $targeted)
      try {
        if ($targeted) { Assert-PointOnTarget ([int]$first.x) ([int]$first.y) $hwnd $state }
        Move-ToPoint -X ([int]$first.x) -Y ([int]$first.y)
        Start-Sleep -Milliseconds 50
        $state.drain = $true
        try {
          if ([WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32]$flags[0], 0) -ne 1) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected mouse input.' }
          # Under Low disruption the user's input waits for the stroke, so a
          # long one moves faster: about a second at most.
          $pause = if ($script:WcuLowDisruption -and $path.Count -gt 40) { [Math]::Max(8, [int](1000 / $path.Count)) } else { 25 }
          foreach ($pt in $path) {
            [void](Test-Failsafe)
            Move-ToPoint -X ([int]$pt.x) -Y ([int]$pt.y)
            Start-Sleep -Milliseconds $pause
          }
          $state.moved = @{ x = [int]$last.x; y = [int]$last.y }
        } finally {
          if ([WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32]$flags[1], 0) -ne 1) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected mouse release.' }
        }
      } finally { Complete-Input $state $result }
      return $result
    }
    "scroll" {
      [void](Test-Failsafe)
      $point = Get-PointFromArgs $inputObject
      $deltaY = [int](Get-Prop $inputObject "deltaY" 480)
      $deltaX = [int](Get-Prop $inputObject "deltaX" 0)
      if ((Has-WindowTarget $inputObject) -and ($null -eq $point.elementId)) {
        $target = Get-ObservationWindow $inputObject
        Assert-WindowIdentity $inputObject $target
        $homed = Home-Point -X $point.x -Y $point.y -Target $target -ObservationToken ([string](Get-Prop $inputObject 'observationToken' ''))
        $point.x = $homed.x
        $point.y = $homed.y
      }
      $result = [ordered]@{ ok = $true; action = "scroll"; x = $point.x; y = $point.y; deltaX = $deltaX; deltaY = $deltaY; elementId = $point.elementId; homed = if ($null -ne $homed) { $homed.homed } else { $null } }
      # An element scrolls in the background first (Invoke-ElementScroll); the
      # wheel at its center, with real input, is the fallback.
      if (($deltaY -ne 0 -or $deltaX -ne 0) -and $null -ne $point.element -and -not [bool](Get-Prop $inputObject 'activate' $false)) {
        $scrolled = Invoke-ElementScroll $point.element $deltaX $deltaY
        if ($null -ne $scrolled) {
          foreach ($key in $scrolled.Keys) { $result[$key] = $scrolled[$key] }
          Add-BackgroundReport $result
          Set-WorkWindow (Get-ElementWindow $point.element)
          return $result
        }
        Assert-InputAllowed 'Scrolling this element'
      }
      if ($deltaY -ne 0 -or $deltaX -ne 0) {
        $targeted = (Has-WindowTarget $inputObject) -or ($null -ne $point.element)
        $hwnd = if (Has-WindowTarget $inputObject) { [int64](Get-ObservationWindow $inputObject).nativeWindowHandle } elseif ($null -ne $point.element) { Get-ElementWindow $point.element } else { Get-RootWindowAt $point.x $point.y }
        $state = Start-Input -InputObject $inputObject -Hwnd $hwnd -NoActivate:(-not $targeted)
        try {
          if ($targeted) { Assert-PointOnTarget $point.x $point.y $hwnd $state }
          $state.moved = @{ x = $point.x; y = $point.y }
          Move-ToPoint -X $point.x -Y $point.y
          Start-Sleep -Milliseconds 30
          [void](Test-Failsafe)
          if ($deltaY -ne 0) {
            if ([WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32][WindowsComputerUseNative]::MOUSEEVENTF_WHEEL, (-1 * $deltaY)) -ne 1) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected scroll input.' }
          }
          if ($deltaX -ne 0) {
            if ([WindowsComputerUseNative]::SendMouseEvent(0, 0, [uint32][WindowsComputerUseNative]::MOUSEEVENTF_HWHEEL, $deltaX) -ne 1) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected scroll input.' }
          }
          # The wheel goes to the window under the pointer; give it a moment.
          Start-Sleep -Milliseconds 60
        } finally { Complete-Input $state $result }
      }
      return $result
    }
    "type_text" {
      [void](Test-Failsafe)
      $method = [string](Get-Prop $inputObject "method" "auto")
      $text = [string](Get-Prop $inputObject "text" "")
      if ($text.Length -eq 0) { throw "text is required." }

      # auto (default): a Win32 edit with the focus in the window the text goes
      # to takes it in the background (Set-FocusedEditText); any other control
      # gets a clipboard paste, with that window borrowed for it.
      if ($method -eq 'auto') {
        # activate:true asks for the window in front, which real input gives.
        if ((Get-Prop $inputObject 'focusMode' 'preserve') -ne 'main' -and -not [bool](Get-Prop $inputObject 'activate' $false)) {
          if (Has-WindowTarget $inputObject) { Assert-WindowIdentity $inputObject (Get-ObservationWindow $inputObject) }
          $window = Resolve-InputWindow $inputObject
          $via = $script:InputWindowVia
          $typed = Set-FocusedEditText $window $text
          if ($null -ne $typed) {
            $script:InputWindow = @{ series = $script:WcuSeries; hwnd = [int64]$window; at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
            # Typed when the field grew by the text, or (in place of a selection)
            # now holds it.
            $value = Get-ValueText (Invoke-Safe { [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$typed.hwnd) } $null)
            $verified = $typed.grew -eq $text.Length -or ($null -ne $value -and $value.Contains($text))
            $result = [ordered]@{ ok = $true; action = "type_text"; length = $text.Length; method = "background:EM_REPLACESEL"; verified = $verified; deliveredTo = (Get-KeyDestination $window $via) }
            if ($null -ne $value) { $result["verifyValue"] = if ($value.Length -gt 200) { $value.Substring(0, 200) + "..." } else { $value } }
            if (-not $verified) { $result["note"] = "The field's length changed by $($typed.grew), not by the length of the text: it may limit its length or drop some characters. Check the field." }
            return $result
          }
        }
        Assert-InputAllowed 'Typing into this control'
        $method = 'clipboard'
      }

      # Background path: post WM_CHAR to the control with the keyboard focus
      # in the target window — no clipboard, no foreground, no system input
      # queue.
      if ($method -eq "background") {
        if (-not (Has-WindowTarget $inputObject)) {
          throw "method:'background' requires a window target (windowTitle / processId / nativeWindowHandle)."
        }
        $hwnd = Resolve-TargetHwnd $inputObject
        if (-not ($hwnd -and $hwnd -ne 0)) { throw "No window handle found for the target." }
        $focus = Get-BackgroundKeyTarget $hwnd
        $before = Get-EditTextLength $focus
        $ok = Post-BackgroundText -Hwnd $focus -Text $text
        if (-not $ok) { throw "background_unavailable: some WM_CHAR messages were refused. Retry with method:'clipboard'." }
        $typed = Test-BackgroundTyped $focus $before $text
        $result = [ordered]@{ ok = $true; action = "type_text"; length = $text.Length; method = "postmessage-wmchar"; verified = ($typed -eq $true) }
        if ($null -eq $typed) { $result["note"] = "Background text queued to the focused control, delivery unverified; controls that reject WM_CHAR (some custom UIs) need method:'clipboard'." }
        elseif (-not $typed) { $result["note"] = "The focused field did not take the text within a second: it may reject WM_CHAR or limit its length. Check the field, or use method:'clipboard'." }
        return $result
      }

      # Foreground path (clipboard or sendinput): the target must be
      # foreground + focused. sendinput synthesizes Unicode key events
      # (KEYEVENTF_UNICODE) — no clipboard touched, so it also types into
      # password fields and other controls that reject paste. The window the
      # text goes to comes forward for it and gives the foreground back after.
      $focusedControl = $null
      $target = $null
      if (Has-WindowTarget $inputObject) {
        $target = Get-ObservationWindow $inputObject
        Assert-WindowIdentity $inputObject $target
      }
      $result = [ordered]@{ ok = $true; action = "type_text"; length = $text.Length; focusedControl = $null }
      $inputHwnd = Resolve-InputWindow $inputObject
      $via = $script:InputWindowVia
      $state = Start-Input -InputObject $inputObject -Hwnd $inputHwnd
      try {
        if ($null -ne $target -and (Get-Prop $inputObject 'focusMode' 'preserve') -eq 'main') {
          $uiaTarget = Resolve-TargetWindow $inputObject
          $focusedControl = Focus-TextControl $uiaTarget
          if ($null -eq $focusedControl) { throw 'Could not focus the requested main text control; no text sent.' }
          $result["focusedControl"] = $focusedControl
        }
        $destination = Get-KeyDestination ([WindowsComputerUseNative]::GetForegroundWindow().ToInt64()) $via
        Assert-InFront $state
        $result["deliveredTo"] = $destination
        if ($method -eq "sendinput") {
          $front = [WindowsComputerUseNative]::GetForegroundWindow()
          $focus = [WindowsComputerUseNative]::FocusedWindow($front)
          $edit = Get-SendInputEdit $focus $text
          Assert-InFront $state
          if ([WindowsComputerUseNative]::GetForegroundWindow() -ne $front -or [WindowsComputerUseNative]::FocusedWindow($front) -ne $focus) {
            throw 'INPUT_FOCUS_CHANGED: focus changed before typing. No input was sent.'
          }
          [void](Test-Failsafe)
          $ok = [bool][WindowsComputerUseNative]::SendUnicodeText($text, $front, $focus)
          $typed = Wait-SendInputEdit $front $focus $edit $text.Length
          if (-not $ok -or $typed -eq 'incomplete') {
            throw 'INPUT_TEXT_INCOMPLETE: the full text was not confirmed in the target. Some text may already be present. Inspect the field before retrying.'
          }
          $result["method"] = "sendinput-unicode"
          $result["verified"] = ($typed -eq 'observed') -or ($typed -eq 'changed')
          $result["verification"] = if ($result["verified"]) { 'observed' } else { 'unconfirmed' }
          if ($typed -eq 'changed') { $result["note"] = 'The field holds the typed text, and the application added text or changed letter case (for example autocomplete). Check the field if the exact value matters.' }
          elseif ($null -eq $typed) { $result["note"] = 'Windows queued the Unicode input. The edited field could not be verified. Check the field before retrying.' }
        } else {
          $restore = [bool](Get-Prop $inputObject "restoreClipboard" $true)
          Type-Text -Text $text -RestoreClipboard $restore
          $result["restoreClipboard"] = $restore
          $result["method"] = "clipboard-paste"
          if ($script:LastPasteInfo) { foreach ($entry in $script:LastPasteInfo.GetEnumerator()) { $result[$entry.Key] = $entry.Value } }
          $result["verified"] = $false
          if ($script:LastPasteInfo -and -not $script:LastPasteInfo.clipboardRestored -and $restore) { $result["clipboardRestoreNote"] = 'Previous clipboard was not restored because the target read was not confirmed or restoration failed; requested text remains available for a late paste.' }
        }
      } finally { Complete-Input $state $result }
      # Clipboard: provide the requested main control's value when available.
      if ($method -ne "sendinput" -and $null -ne $focusedControl -and $null -ne $target) {
        $verify = Get-BestTextControl $uiaTarget
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
        $ktarget = Get-ObservationWindow $inputObject
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
        $focus = Get-BackgroundKeyTarget $hwnd
        $before = Get-EditTextLength $focus
        [void](Test-Failsafe)
        $ok = [WindowsComputerUseNative]::PostMessageW([IntPtr]$focus, [WindowsComputerUseNative]::WM_CHAR, [IntPtr][int][char]$ch, [IntPtr]1)
        if (-not $ok) { throw "background_unavailable: WM_CHAR was refused. Use dispatch:'foreground'." }
        $typed = Test-BackgroundTyped $focus $before $ch
        $result = [ordered]@{ ok = $true; action = "keypress"; keys = $keys; method = "postmessage-wmchar"; verified = ($typed -eq $true) }
        if ($typed -ne $true) { $result["note"] = "Background key queued to the focused control, delivery unverified." }
        return $result
      }
      $sequence = New-Object 'System.Collections.Generic.List[object]'
      $sequence.Add([string[]]$keys)
      foreach($next in @(Get-Prop $inputObject 'thenKeys' @())){$sequence.Add([string[]]$next)}
      $chords = @($sequence | ForEach-Object { Convert-KeyChord -Keys $_ })
      $result = [ordered]@{ ok = $true; action = "keypress"; keys = $keys; sendKeys = $chords[0]; method = "sendinput" }
      if($sequence.Count -gt 1){$result['thenKeys']=@(Get-Prop $inputObject 'thenKeys' @());$result['chordsSent']=0}
      $inputHwnd = Resolve-InputWindow $inputObject
      $via = $script:InputWindowVia
      $state = Start-Input -InputObject $inputObject -Hwnd $inputHwnd
      try {
        for($i=0;$i -lt $sequence.Count;$i++){
          if($i -gt 0){Start-Sleep -Milliseconds ([int](Get-Prop $inputObject 'intervalMs' 60))}
          [void](Test-Failsafe)
          # The keys reach the focused control of the window in front: name both
          # (deliveredTo), so a result shows where they went, not only "sent".
          if($i -eq 0){$destination=Get-KeyDestination ([WindowsComputerUseNative]::GetForegroundWindow().ToInt64()) $via}
          Assert-InFront $state
          $state.drain = $true
          if (-not [WindowsComputerUseNative]::SendKeyChord([string[]]$sequence[$i])) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected the key chord.' }
          if($i -eq 0){$result['deliveredTo']=$destination}
          if($sequence.Count -gt 1){$result['chordsSent']=$i+1}
        }
      } finally { Complete-Input $state $result }
      return $result
    }
    "focus" {
      $elementId = [string](Get-Prop $inputObject "elementId" "")
      $el = Resolve-Element $elementId $inputObject
      [void](Test-Failsafe)
      # Keyboard focus brings the element's window forward; it is given back,
      # and typing without a target goes to this window again.
      $result = [ordered]@{ ok = $true; action = "focus"; elementId = $elementId }
      $state = Start-Input -InputObject $inputObject -Hwnd (Get-ElementWindow $el) -NoActivate
      try { $el.SetFocus() } finally { Complete-Input $state $result }
      return $result
    }
    "invoke" {
      $elementId = [string](Get-Prop $inputObject "elementId" "")
      $fallback = [bool](Get-Prop $inputObject "fallbackClick" $true)
      $kind = [string](Get-Prop $inputObject "action" "default")
      $el = Resolve-Element $elementId $inputObject
      if ($kind -ne 'default') {
        $result = [ordered]@{ ok = $true; action = "invoke"; elementId = $elementId; elementAction = $kind; method = (Invoke-ElementAction $el $kind) }
        Add-BackgroundReport $result
        Set-WorkWindow (Get-ElementWindow $el)
        return $result
      }
      $method = Invoke-ElementPattern $el
      $result = [ordered]@{ ok = $true; action = "invoke"; elementId = $elementId; method = $method }
      Add-BackgroundReport $result
      if ($null -ne $method) { Set-WorkWindow (Get-ElementWindow $el) }
      if ($null -eq $method -and $fallback) {
        $rect = Convert-Rect (Invoke-Safe { $el.Current.BoundingRectangle } $null)
        if ($null -eq $rect) { throw "Element has no invokable pattern and no bounding box for fallback click." }
        Assert-InputAllowed 'This element has no invokable pattern; its fallback click'
        $hwnd = Get-ElementWindow $el
        $state = Start-Input -InputObject $inputObject -Hwnd $hwnd
        try {
          $point = @{element=$el; x=$rect.centerX; y=$rect.centerY}
          Confirm-ElementPoint $point
          Assert-PointOnTarget $point.x $point.y $hwnd $state
          $state.moved = @{ x = $point.x; y = $point.y }
          $state.drain = $true
          Click-At -X $point.x -Y $point.y -Button "left" -Count 1
          $result["method"] = "ClickFallback"
        } finally { Complete-Input $state $result }
        return $result
      }
      if ($null -eq $method) { throw "Element has no supported invokable pattern." }
      return $result
    }
    "set_value" {
      $elementId = [string](Get-Prop $inputObject "elementId" "")
      $value = [string](Get-Prop $inputObject "value" "")
      $fallback = [bool](Get-Prop $inputObject "fallbackType" $true)
      $restore = [bool](Get-Prop $inputObject "restoreClipboard" $true)
      $el = Resolve-Element $elementId $inputObject
      $method = Set-ElementValue $el -Value $value
      $result = [ordered]@{ ok = $true; action = "set_value"; elementId = $elementId; method = $method; length = $value.Length }
      Add-BackgroundReport $result
      if ($null -ne $method) { Set-WorkWindow (Get-ElementWindow $el) }
      if ($null -eq $method -and $fallback) {
        Assert-InputAllowed 'This element has no ValuePattern; typing into it'
        [void](Test-Failsafe)
        $hwnd = Get-ElementWindow $el
        $state = Start-Input -InputObject $inputObject -Hwnd $hwnd
        try {
          $el.SetFocus()
          Assert-InFront $state
          Assert-ElementFocus $el
          if (-not [WindowsComputerUseNative]::SendKeyChord(@('ctrl','a'))) { throw 'COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected select-all input.' }
          # Ctrl+A can trigger application handlers that move focus.
          Assert-InFront $state
          Assert-ElementFocus $el
          Type-Text -Text $value -RestoreClipboard $restore
          $result["method"] = "FocusSelectAllTypeFallback"
        } finally { Complete-Input $state $result }
        return $result
      }
      if ($null -eq $method) { throw "Element has no ValuePattern and fallbackType is false." }
      return $result
    }
    "activate_window" {
      if (-not (Has-WindowTarget $inputObject)) { throw "Provide windowTitle, processId, or nativeWindowHandle." }
      $window = Get-ObservationWindow $inputObject
      $responsive = Get-WindowResponsive $window
      $result = [ordered]@{ok=$true; action="activate_window"; activated=$false; window=$window; targetResponsive=$responsive}
      if (-not $responsive) {
        $result["warning"] = "The target window is unresponsive; activation was skipped. Do not retry tree or input calls until the target recovers."
        return $result
      }
      $hwnd = [int64]$window.nativeWindowHandle
      $wasMinimized = [WindowsComputerUseNative]::IsIconic([IntPtr]$hwnd)
      if ($script:WcuLowDisruption) { [WcuInputHold]::Snapshot() }
      $result.activated = [bool](Set-WindowForeground $window)
      # Report the window as it is now. The entry above was read before the
      # activation, so a window just restored would still show its minimized
      # -32000 box and read as "nothing happened" (issue #82).
      foreach ($now in (Get-NativeWindowList -IncludeInvisible $true -MaxWindows 4096)) {
        if ([int64]$now.nativeWindowHandle -eq $hwnd) { $result.window = $now; break }
      }
      $stillMinimized = [WindowsComputerUseNative]::IsIconic([IntPtr]$hwnd)
      if ($wasMinimized) { $result['restored'] = -not $stillMinimized }
      if ($stillMinimized) { $result.activated = $false } else { Update-WindowCache $result.window }
      Update-WindowIdentity $inputObject $window
      # Kept in front by request; typing without a target goes here too.
      if ($result.activated) { $script:InputWindow = @{ series = $script:WcuSeries; hwnd = $hwnd; at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() } }
      if ($result.activated -and $script:WcuLowDisruption -and [WcuInputHold]::ArmGuard([long[]]@($hwnd), [long[]]@([int64](Get-WindowProcessId $hwnd)))) { $result['userInput'] = [WcuInputHold]::GuardNote }
      if (-not $result.activated) {
        $result["targetResponsive"] = Get-WindowResponsive $window
        $result["warning"] = if ($stillMinimized) { "The window is still minimized: Windows did not restore it. Try again; if it stays minimized, ask the user to restore it." } elseif ($result.targetResponsive) { "The window could not be brought to the foreground (Windows foreground lock)." } else { "The target window became unresponsive; avoid repeated activation, tree or input calls." }
      }
      return $result
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
      $condition = [string](Get-Prop $inputObject 'condition' 'window')
      $query = [string](Get-Prop $inputObject 'query' '')
      if ($condition -eq 'window' -and -not (Has-WindowTarget $inputObject)) { throw 'Window wait requires a window target.' }
      if ($condition -ne 'window' -and [string]::IsNullOrWhiteSpace($query)) { throw 'Text/element wait requires query.' }
      $appear = [bool](Get-Prop $inputObject 'appear' $true)
      $timeoutMs = [int](Get-Prop $inputObject 'timeoutMs' 5000)
      $intervalMs = [int](Get-Prop $inputObject 'intervalMs' 250)
      $watch = [Diagnostics.Stopwatch]::StartNew()
      while ($true) {
        $found = $false
        $conclusive = $true
        if ($condition -eq 'window') {
          foreach ($info in (Get-NativeWindowList -IncludeInvisible $true -MaxWindows 4096)) {
            if (Test-TargetMatch $info $inputObject) { $found=$true; break }
          }
        } elseif ($condition -eq 'text') {
          # Internal observations never expose an image path to the host.
          $observationArgs = [pscustomobject]@{scope=(Get-Prop $inputObject 'scope' 'active_window');windowTitle=(Get-Prop $inputObject 'windowTitle' $null);processId=(Get-Prop $inputObject 'processId' $null);nativeWindowHandle=(Get-Prop $inputObject 'nativeWindowHandle' $null);query=$query;resolveControl=$false;activate=$false;_wcuSeries=$script:WcuSeries}
          $observationArgs | Add-Member NoteProperty '_wcuInternalOcr' $true
          $observation = Invoke-Action 'ocr' $observationArgs
          $found = $observation.matched.Count -gt 0
          $conclusive = -not [bool]$observation.occludedPossible
        } else {
          $budget = [Math]::Max(100, [Math]::Min([int](Get-Prop $inputObject 'treeTimeoutMs' 1000), $timeoutMs - [int]$watch.ElapsedMilliseconds))
          $observationArgs = [pscustomobject]@{scope=(Get-Prop $inputObject 'scope' 'active_window');windowTitle=(Get-Prop $inputObject 'windowTitle' $null);processId=(Get-Prop $inputObject 'processId' $null);nativeWindowHandle=(Get-Prop $inputObject 'nativeWindowHandle' $null);query=$query;controlType=(Get-Prop $inputObject 'controlType' '');viewMode=(Get-Prop $inputObject 'viewMode' 'control');includeOffscreen=(Get-Prop $inputObject 'includeOffscreen' $false);treeTimeoutMs=$budget;maxDepth=(Get-Prop $inputObject 'maxDepth' 8);maxNodes=(Get-Prop $inputObject 'maxNodes' 1200);maxResults=1;_wcuSeries=$script:WcuSeries}
          $observation = Invoke-Action 'find' $observationArgs
          $found = $observation.results.Count -gt 0
          $conclusive = -not $observation.truncated
        }
        $hit = if ($appear) { $found -and ($condition -ne 'text' -or $conclusive) } else { -not $found -and $conclusive }
        if ($hit -or $watch.ElapsedMilliseconds -ge $timeoutMs) {
          return ([ordered]@{ok=$true;action='wait_for';condition=$condition;found=$found;conclusive=$conclusive;timedOut=(-not $hit);waitedMs=[int]$watch.ElapsedMilliseconds;verification=if ($hit) {'observed'} else {'unconfirmed'}})
        }
        Start-Sleep -Milliseconds ([Math]::Min($intervalMs, [Math]::Max(1,$timeoutMs-[int]$watch.ElapsedMilliseconds)))
      }
    }
    "close_window" {
      # Graceful close: post WM_CLOSE (the app can veto it with a save dialog),
      # unlike killing the process.
      if (-not (Has-WindowTarget $inputObject)) { throw "Provide windowTitle, processId, or nativeWindowHandle." }
      $hwnd = Resolve-TargetHwnd $inputObject
      if (-not ($hwnd -and $hwnd -ne 0)) { throw "No window handle found for the target." }
      [void](Test-Failsafe)
      $posted = [WindowsComputerUseNative]::PostMessageW([IntPtr]$hwnd, [WindowsComputerUseNative]::WM_CLOSE, [IntPtr]0, [IntPtr]0)
      return ([ordered]@{ ok = $true; action = "close_window"; posted = [bool]$posted })
    }
    "move_window" {
      # Move (not resize) the target window. Default is SWP_NOACTIVATE (no
      # focus steal); activate:true hands the foreground to the moved window.
      # Note: maximized windows are not moved by Windows.
      if (-not (Has-WindowTarget $inputObject)) { throw "Provide windowTitle, processId, or nativeWindowHandle." }
      $x = Get-Prop $inputObject "x" $null
      $y = Get-Prop $inputObject "y" $null
      if ($null -eq $x -or $null -eq $y) { throw "x and y are required for move_window." }
      $el = Get-ObservationWindow $inputObject
      $hwnd = [int64]$el.nativeWindowHandle
      if (-not ($hwnd -and $hwnd -ne 0)) { throw "No window handle found for the target." }
      Assert-NativeInputTarget $hwnd
      $flags = [uint32]([WindowsComputerUseNative]::SWP_NOSIZE -bor [WindowsComputerUseNative]::SWP_NOZORDER)
      if (-not [bool](Get-Prop $inputObject "activate" $false)) {
        $flags = [uint32]($flags -bor [WindowsComputerUseNative]::SWP_NOACTIVATE)
      }
      [void](Test-Failsafe)
      $ok = [WindowsComputerUseNative]::SetWindowPos([IntPtr]$hwnd, [IntPtr]::Zero, [int]$x, [int]$y, 0, 0, $flags)
      $result = [ordered]@{ ok = $true; action = "move_window"; moved = [bool]$ok; x = [int]$x; y = [int]$y; note = if ($ok) { $null } else { "SetWindowPos refused (window may be maximized)." } }
      if ([bool](Get-Prop $inputObject "activate" $false)) {
        # SetWindowPos's implicit activation is silently refused by the
        # Windows foreground lock for background callers, so enforce the
        # switch with the AttachThreadInput helper and report the outcome.
        $activated = Set-WindowForeground $el
        $result["activated"] = [bool]$activated
        if (-not $activated) {
          $result["warning"] = "activate:true was requested but the window could not be brought to the foreground (Windows foreground lock); the window was moved but is not foreground."
        }
      }
      return $result
    }
    "screenshot" {
      $scope = Get-Prop $inputObject 'scope' 'active_window'
      $window = Get-ObservationWindow $inputObject $scope
      if ($null -ne $window) {
        if ([bool](Get-Prop $inputObject 'activate' $false) -and -not (Set-WindowForeground $window)) { throw 'Target activation refused; screenshot not taken.' }
        Update-WindowCache $window
        Update-WindowIdentity $inputObject $window
      }
      $responsive = Get-WindowResponsive $window
      $shot = Capture-Screenshot -WindowElement $(if ($responsive -eq $false) { $null } else { $window }) -MaxWidth ([int](Get-Prop $inputObject 'maxWidth' 1600))
      $result=[ordered]@{ok=$true;action='screenshot';source='win32';targetResponsive=$responsive;screenshot=$shot;degraded=($responsive -eq $false)}
      if ($shot.minimized) { $result['warning'] = 'The window is minimized: Windows draws only its title strip. Call activate_window to restore it, then capture again.' }
      if ($null -ne $window) { $result['windowObservation']=$script:WindowCache[[string]$window.nativeWindowHandle] }
      return $result
    }
    "ocr" {
      # OCR the target window (or the whole desktop) — the fallback for
      # UIA-blind apps (games, self-drawn Tk/Qt, RDP, canvases). Word boxes
      # come back in SCREEN coordinates. With `query`, matched words are also
      # upgraded to the underlying UIA control (FromPoint), so the model can
      # then invoke/click the real control instead of the glyph.
      $scope = Get-Prop $inputObject "scope" "active_window"
      # Native pixels by default: shrinking a wide window first makes its text
      # smaller than OCR reads well, and the helper enlarges small text itself.
      $maxWidth = [int](Get-Prop $inputObject "maxWidth" 0)
      $language = [string](Get-Prop $inputObject "language" "")
      $query = [string](Get-Prop $inputObject "query" "")
      $winEl = $null
      $activationRefused = $false
      $activationError = $null
      if (Has-WindowTarget $inputObject) {
        $winEl = Get-ObservationWindow $inputObject $scope
        # Capture happens on screen pixels: an occluded window would OCR the
        # overlapping content, so honour activate:true before capturing. A
        # refused activation degrades the capture but is not fatal — warn.
        if ([bool](Get-Prop $inputObject "activate" $false)) {
          try { $activationRefused = -not (Set-WindowForeground $winEl) }
          catch {
            if ($_.Exception.Message -notmatch '^(INPUT_TARGET_ACCESS_UNCONFIRMED|ELEVATED_TARGET_DENIED):') { throw }
            $activationRefused = $true
            $activationError = $_.Exception.Message
          }
        }
      } elseif ($scope -ne "desktop") {
        $winEl = Get-ObservationWindow $inputObject $scope
      }
      if ($null -ne $winEl) {
        if ((Get-WindowResponsive $winEl) -eq $false) { throw 'Target is unresponsive; skip OCR and inspect a desktop screenshot.' }
        Update-WindowCache $winEl
        Update-WindowIdentity $inputObject $winEl
      }
      $internalOcr = [bool](Get-Prop $inputObject '_wcuInternalOcr' $false)
      $shot = Capture-Screenshot -WindowElement $winEl -MaxWidth $maxWidth -InMemory:$internalOcr
      if ($shot.windowCaptureFailed) { throw "OCR target has no capturable surface (minimized/hidden?). Restore the window and retry." }
      if ($shot.minimized) { throw "OCR target window is minimized: Windows draws only its title strip, so there is no text to read. Call activate_window to restore it, then read again." }
      $origX = [int]$shot.bounds.x
      $origY = [int]$shot.bounds.y
      $scale = 1.0
      if ($null -ne $shot.imageScale) { $scale = [double]$shot.imageScale }
      $ocr = if ($internalOcr) { Invoke-Ocr -PngBytes $shot.pngBytes -Language $language } else { Invoke-Ocr -PngPath $shot.path -Language $language }
      $lines = New-Object System.Collections.Generic.List[object]
      foreach ($line in $ocr.lines) {
        $words = New-Object System.Collections.Generic.List[object]
        foreach ($w in $line.words) {
          $words.Add([ordered]@{
            text = $w.text
            x = [int]($origX + ($w.x / $scale))
            y = [int]($origY + ($w.y / $scale))
            width = [int]($w.width / $scale)
            height = [int]($w.height / $scale)
          })
        }
        $wordArr = $words.ToArray()
        $lines.Add([ordered]@{ text = $line.text; words = $wordArr; boundingBox = (Get-OcrWordBounds -Words $wordArr) })
      }
      # OCR -> control upgrade: ignore OCR whitespace when matching, then
      # hit-test the center of the matching word run's union box with UIA.
      $matched = New-Object System.Collections.Generic.List[object]
      $matchedLines = New-Object System.Collections.Generic.List[object]
      if ($query.Length -gt 0 -and $lines.Count -gt 0) {
        if ([bool](Get-Prop $inputObject 'resolveControl' $false) -and $null -ne $winEl) {
          if ($winEl.className -eq 'MozillaWindowClass') { [void](Initialize-GeckoPages $winEl @{ watch = [Diagnostics.Stopwatch]::StartNew(); budgetMs = 2000 }) }
          else { [void](Initialize-ChromiumPages $winEl @{ watch = [Diagnostics.Stopwatch]::StartNew(); budgetMs = 2000 }) }
        }
        foreach ($line in $lines) {
          if ($matched.Count -ge 3) { break }
          $lineText = [string]$line.text
          $hit = Find-OcrWordRun -Words @($line.words) -Query $query
          if ($null -eq $hit) { continue }
          $wx = [int]($hit.boundingBox.x + [int]($hit.boundingBox.width / 2))
          $wy = [int]($hit.boundingBox.y + [int]($hit.boundingBox.height / 2))
          $ctl = $null
          $el = $null
          if ([bool](Get-Prop $inputObject 'resolveControl' $false)) { $el = Invoke-Safe { [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($wx, $wy))) } $null }
          if ($null -ne $el) {
            $ctl = [ordered]@{
              controlType = Get-ControlTypeName (Invoke-Safe { $el.Current.ControlType } $null)
              name = Invoke-Safe { $el.Current.Name } ""
              automationId = Invoke-Safe { $el.Current.AutomationId } ""
              className = Invoke-Safe { $el.Current.ClassName } ""
              boundingBox = Convert-Rect (Invoke-Safe { $el.Current.BoundingRectangle } $null)
            }
          }
          $matched.Add([ordered]@{ source = "ocr"; line = $lineText; word = [ordered]@{ text = $hit.text; x = $wx; y = $wy }; boundingBox = $hit.boundingBox; control = $ctl })
          $matchedLines.Add($line)
        }
      }
      $result = [ordered]@{
        ok = $true
        action = "ocr"
        text = $ocr.text
        lines = $lines.ToArray()
        image = $shot.path
        imageBounds = $shot.bounds
        source = if ($winEl -ne $null) { "window" } else { "desktop" }
      }
      $result['coordinateSpace'] = 'screen'
      $result['imageScale'] = $scale
      # The recognizer that read the text, and how much the capture was
      # enlarged for it (1 = read at capture size).
      $result['language'] = $ocr.language
      $result['ocrScale'] = $ocr.readScale
      $result['captureMethod'] = $shot.method
      $result['occludedPossible'] = $shot.occludedPossible
      if ([bool](Get-Prop $inputObject 'includeScreenshot' $false)) { $result['screenshot'] = $shot }
      if ($query.Length -gt 0) {
        $result["query"] = $query
        $result["matched"] = $matched.ToArray()
        # A query asks for that text, not the whole transcript. Word boxes of
        # every line are most of a result (about 50,000 characters for a
        # 1500x900 window of text), so keep the matching lines whole and,
        # without a match, line texts and boxes to reformulate from (#82).
        $result.Remove('text')
        $result["lineCount"] = $lines.Count
        if ($matchedLines.Count -gt 0) {
          $result["lines"] = $matchedLines.ToArray()
          $result["note"] = "'lines' holds only the lines with a match; lineCount counts every recognized line. Call ocr without query for all text and word boxes."
        } else {
          $result["lines"] = @($lines | ForEach-Object { [ordered]@{ text = $_.text; boundingBox = $_.boundingBox } })
          $result["note"] = "No OCR word sequence matched the query (case-insensitive, ignoring whitespace). 'lines' holds every recognized line with its box; call ocr without query for word boxes."
        }
      }
      if ($activationRefused) {
        $reason = if ($activationError) { $activationError } else { 'Windows refused to bring the target window to the foreground.' }
        $result["warning"] = "$reason OCR captured without activating the target. Check for overlapping content before using any coordinates."
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
  } finally {
    # A step that failed between Start-Input and Complete-Input still replays.
    if ($script:WcuHolding) { [void](Stop-InputHold) }
    Exit-DesktopInput $inputLease
  }
}

# ============================================================================
# Entry points
# ============================================================================

try {
  # Resolve the built-in JSON/Add-Type commands from this PowerShell installation,
  # without searching inherited third-party module paths on the first request.
  Write-BackendStage 'utility-import-start'
  Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
  Write-BackendStage 'utility-import-complete'
  Load-Assemblies
  Set-DpiAware
} catch {
  # One line the server can quote. Otherwise a startup failure reached the
  # model only as "Backend process exited" (#54).
  $inner = $_.Exception
  while ($inner.InnerException) { $inner = $inner.InnerException }
  $hresult = if ($inner.HResult) { ' (HRESULT 0x{0:X8})' -f $inner.HResult } else { '' }
  [Console]::Error.WriteLine(('WCU_BACKEND_STARTUP_FAILED stage={0}: {1}{2}' -f $script:BackendStage, ($_.Exception.Message -replace '\s+', ' ').Trim(), $hresult))
  exit 3
}
Write-BackendStage 'backend-ready'

if ($Persistent) {
  [Console]::Out.WriteLine((@{type='ready';protocol=1;pid=$PID}|ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  # Persistent mode: one JSON request per stdin line, one JSON response per
  # stdout line. Stays alive between actions so repeated calls skip process
  # startup, assembly loading and native-DLL resolution entirely.
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $req = $null
    Write-BackendStage 'request-parse-start'
    try { $req = $line | ConvertFrom-Json } catch {
      [Console]::Error.WriteLine('WCU_BACKEND_PROTOCOL_ERROR: request was not valid JSON')
      [Console]::Out.WriteLine('{"id":null,"ok":false,"error":"WCU_BACKEND_PROTOCOL_ERROR: request was not valid JSON"}')
      [Console]::Out.Flush()
      continue
    }
    Write-BackendStage 'request-parse-complete'
    $id = Get-Prop $req "id" 0
    $name = [string](Get-Prop $req "action" "")
    $result = $null
    try {
      $result = Invoke-Action -Action $name -InputObject (Get-Prop $req "args" $null)
      if ($null -eq $result) { throw "Unknown action '$name'." }
      $notice = [WcuInputHold]::TakeNotice()
      if ($notice -and $result -is [System.Collections.IDictionary]) { $result['userInputNotice'] = $notice }
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
    Write-BackendStage 'response-serialize-start'
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
