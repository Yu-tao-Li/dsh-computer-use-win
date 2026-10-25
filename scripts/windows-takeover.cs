// Original Windows UI for DSH. Uses only framework APIs; no input is synthesized.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Threading;
#if WCU_CORE
using System.Text.Json;
#else
using System.Web.Script.Serialization;
#endif
using System.Windows.Forms;

namespace DshTakeover {
  // PowerShell 7 uses modern .NET, where System.Web's serializer is unavailable.
  // Keep the command dictionary's primitive/array shapes identical on both runtimes.
  internal sealed class CommandJson {
#if WCU_CORE
    public string Serialize(object value) { return JsonSerializer.Serialize(value); }
    public T Deserialize<T>(string text) {
      using (var document = JsonDocument.Parse(text)) return (T)ConvertValue(document.RootElement);
    }
    static object ConvertValue(JsonElement value) {
      switch (value.ValueKind) {
        case JsonValueKind.Object:
          var map = new Dictionary<string,object>();
          foreach (var entry in value.EnumerateObject()) map.Add(entry.Name, ConvertValue(entry.Value));
          return map;
        case JsonValueKind.Array:
          var items = new List<object>();
          foreach (var entry in value.EnumerateArray()) items.Add(ConvertValue(entry));
          return items.ToArray();
        case JsonValueKind.String: return value.GetString();
        case JsonValueKind.Number:
          long integer;
          if (value.TryGetInt64(out integer)) return integer;
          return value.GetDouble();
        case JsonValueKind.True: return true;
        case JsonValueKind.False: return false;
        default: return null;
      }
    }
#else
    readonly JavaScriptSerializer inner = new JavaScriptSerializer();
    public string Serialize(object value) { return inner.Serialize(value); }
    public T Deserialize<T>(string text) { return inner.Deserialize<T>(text); }
#endif
  }
  public static class Host {
    public static void Run(string eventName, bool testMode) {
      try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
      Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
      Application.EnableVisualStyles();
      using (var context = new Controller(eventName, testMode)) Application.Run(context);
    }
  }

  internal static class Native {
    internal delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] internal struct Key { public uint vk, scan, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int x, y; public Point(int a,int b) {x=a;y=b;} }
    [StructLayout(LayoutKind.Sequential)] internal struct Size { public int cx, cy; public Size(int a,int b) {cx=a;cy=b;} }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int left,top,right,bottom; internal Rectangle Bounds { get { return Rectangle.FromLTRB(left,top,right,bottom); } } }
    [StructLayout(LayoutKind.Sequential)] internal struct MonitorInfo { public uint size; public Rect bounds,work; public uint flags; }
    internal delegate bool MonitorCallback(IntPtr monitor,IntPtr dc,IntPtr rectangle,IntPtr data);
    [StructLayout(LayoutKind.Sequential, Pack=1)] internal struct Blend { public byte op, flags, alpha, format; }
    [StructLayout(LayoutKind.Sequential)] internal struct IconInfo { public bool icon; public int hotX, hotY; public IntPtr mask, color; }
    [DllImport("user32.dll", SetLastError=true)] internal static extern bool GetIconInfo(IntPtr icon, out IconInfo info);
    [DllImport("user32.dll")] internal static extern IntPtr LoadCursor(IntPtr instance, IntPtr name);
    [DllImport("user32.dll")] internal static extern uint GetDpiForSystem();
    [DllImport("user32.dll", SetLastError=true)] internal static extern bool SystemParametersInfo(uint action, uint param, out int value, uint ini);
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll", SetLastError=true)] internal static extern IntPtr SetWindowsHookEx(int id, Hook callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] internal static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] internal static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] internal static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll",SetLastError=true)] internal static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] internal static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll",SetLastError=true)] internal static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr clip,MonitorCallback callback,IntPtr data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
    [DllImport("shcore.dll")] internal static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint x, out uint y);
    [DllImport("user32.dll")] internal static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] internal static extern bool SetWindowDisplayAffinity(IntPtr window, uint affinity);
    [DllImport("user32.dll")] internal static extern bool GetWindowDisplayAffinity(IntPtr window, out uint affinity);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] internal static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] internal static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] internal static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] internal static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
    [DllImport("gdi32.dll")] internal static extern bool DeleteObject(IntPtr value);
    [DllImport("gdi32.dll")] internal static extern bool DeleteDC(IntPtr dc);
    [DllImport("user32.dll", SetLastError=true)] internal static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr screenDc, ref Point destination, ref Size size, IntPtr sourceDc, ref Point source, uint key, ref Blend blend, uint flags);
    internal static Rectangle[] ActiveDisplays() {
      var result=new List<Rectangle>();
      if(!EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,delegate(IntPtr monitor,IntPtr dc,IntPtr rect,IntPtr data){
        var info=new MonitorInfo {size=(uint)Marshal.SizeOf(typeof(MonitorInfo))};
        if(GetMonitorInfo(monitor,ref info)&&info.bounds.right>info.bounds.left&&info.bounds.bottom>info.bounds.top)result.Add(info.bounds.Bounds);
        return true;
      },IntPtr.Zero))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"Could not enumerate active displays");
      result.Sort(delegate(Rectangle a,Rectangle b){int x=a.Left.CompareTo(b.Left);return x!=0?x:a.Top.CompareTo(b.Top);});
      return result.ToArray();
    }
    internal static Rectangle DisplayFromPoint(Point point) {
      var info=new MonitorInfo {size=(uint)Marshal.SizeOf(typeof(MonitorInfo))};
      if(!GetMonitorInfo(MonitorFromPoint(point,2),ref info))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"Could not locate pointer display");
      return info.bounds.Bounds;
    }
    internal static string DisplayIdentity(Rectangle bounds) {
      IntPtr monitor=MonitorFromPoint(new Point(bounds.Left+bounds.Width/2,bounds.Top+bounds.Height/2),2);
      uint x=96,y=96;try{if(GetDpiForMonitor(monitor,0,out x,out y)!=0)x=y=96;}catch(EntryPointNotFoundException){}
      return bounds.ToString()+"/"+monitor.ToInt64()+"/"+x+"/"+y;
    }
    internal static void KeepOnTop(IntPtr window) { SetWindowPos(window,new IntPtr(-1),0,0,0,0,0x213); }
  }

  internal sealed class Controller : ApplicationContext {
    readonly Control dispatcher = new Control();
    readonly EventWaitHandle cancel;
    readonly Native.Hook callback;
    readonly IntPtr hook;
    readonly bool testMode;
    readonly CommandJson json = new CommandJson();
    readonly List<Frame> frames = new List<Frame>();
    PointerFrame pointer;
    Native.Point? testPointerPoint;
    Rectangle[] displays=new Rectangle[0],testDisplays;
    string displaySignature="";
    DateTime nextDisplayPoll=DateTime.MinValue;
    int displayRevision;
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    bool armed, paused, shuttingDown;
    readonly HashSet<int> physicalDown = new HashSet<int>(), swallowed = new HashSet<int>();
    string stopShortcut = "";
    int stopKey, stopModifiers;
    DateTime hideAt = DateTime.MaxValue;
    bool indicator = true, cursorIndicator = true, remoteVisible = true;
    int cursorError;
    string text = "DSH 正在控制电脑", position = "top";
    int idleMs = 800;

    internal Controller(string eventName, bool tests) {
      testMode = tests;
      cancel = new EventWaitHandle(false, EventResetMode.ManualReset, eventName);
      var handle = dispatcher.Handle;
      callback = OnKey;
      hook = Native.SetWindowsHookEx(13, callback, Native.GetModuleHandle(null), 0);
      if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Could not install the stop shortcut listener");
      timer.Interval = 35;
      timer.Tick += delegate {
        double elapsed = hideAt == DateTime.MaxValue ? -1 : (DateTime.UtcNow - hideAt).TotalMilliseconds;
        if (elapsed >= 160) { HideFrames(); HidePointer(); armed = false; hideAt = DateTime.MaxValue; return; }
        byte alpha = elapsed >= 0 ? (byte)Math.Max(0, 255 * (1 - elapsed / 160)) : (byte)255;
        if(armed&&!paused)RefreshDisplays(false);
        UpdatePointer(alpha);
        if (elapsed >= 0) foreach (var frame in frames) frame.Present(alpha);
      };
      timer.Start();
      SystemEventsSubscribe();
      new Thread(ReadCommands) { IsBackground = true, Name = "DSH takeover control" }.Start();
      RefreshDisplays(true);
      Emit(new { kind = "ready", hookActive = true, monitors = displays.Length });
    }

    void SystemEventsSubscribe() { Microsoft.Win32.SystemEvents.DisplaySettingsChanged += DisplaysChanged; Microsoft.Win32.SystemEvents.SessionSwitch += SessionChanged; Microsoft.Win32.SystemEvents.UserPreferenceChanged += PreferencesChanged; }
    // A pointer size or scheme change arrives as a preference change; measure the arrow again.
    void PreferencesChanged(object sender,Microsoft.Win32.UserPreferenceChangedEventArgs args) {
      if (shuttingDown) return;
      try { dispatcher.BeginInvoke((Action)PointerFrame.ForgetPointerSize); } catch (InvalidOperationException) { }
    }
    void SessionChanged(object sender,Microsoft.Win32.SessionSwitchEventArgs args) { DisplaysChanged(sender,EventArgs.Empty); }
    void DisplaysChanged(object sender, EventArgs args) {
      if (shuttingDown) return;
      try { dispatcher.BeginInvoke((Action)delegate { RefreshDisplays(true); UpdatePointer(255); }); } catch (InvalidOperationException) { }
    }
    bool RefreshDisplays(bool force) {
      if(!force&&DateTime.UtcNow<nextDisplayPoll)return false;
      nextDisplayPoll=DateTime.UtcNow.AddMilliseconds(500);
      Rectangle[] next=testMode&&testDisplays!=null?testDisplays:Native.ActiveDisplays();
      string signature=String.Join(";",Array.ConvertAll(next,delegate(Rectangle r){return Native.DisplayIdentity(r);}));
      if(signature==displaySignature){foreach(var frame in frames)Native.KeepOnTop(frame.Handle);if(pointer!=null)Native.KeepOnTop(pointer.Handle);return false;}
      displays=next;displaySignature=signature;displayRevision++;
      HideFrames();HidePointer();
      if(armed&&!paused&&indicator)ShowFrames();
      return true;
    }
    void ConfigureVisibility(bool visible) {
      remoteVisible=visible;
      foreach(var frame in frames)frame.SetRemoteVisible(visible);
      if(pointer!=null)pointer.SetRemoteVisible(visible);
    }
    void Emit(object value) { lock (json) { Console.Out.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }
    void ReadCommands() {
      try {
        string line;
        while ((line = Console.ReadLine()) != null) {
          var command = new CommandJson().Deserialize<Dictionary<string,object>>(line);
          dispatcher.BeginInvoke((Action)(() => Dispatch(command)));
        }
      } catch (Exception error) { Console.Error.WriteLine(error.Message); }
      finally { try { cancel.Set(); } catch (ObjectDisposedException) { } try { dispatcher.BeginInvoke((Action)(() => ExitThread())); } catch (InvalidOperationException) { } }
    }
    static T Get<T>(Dictionary<string,object> command, string name, T fallback) {
      object value; return command.TryGetValue(name, out value) ? (T)Convert.ChangeType(value, typeof(T)) : fallback;
    }
    void Dispatch(Dictionary<string,object> command) {
      object id; command.TryGetValue("id", out id);
      try {
        bool consumed = false;
        string action = Get(command, "command", "");
        if (action == "begin" || action == "preview") {
          if (paused) throw new InvalidOperationException("COMPUTER_USE_STOPPED_BY_USER");
          ConfigureShortcut(Get(command, "stopShortcut", stopShortcut));
          bool nextIndicator = Get(command, "indicatorEnabled", true);
          ConfigureVisibility(Get(command,"remoteIndicatorVisible",true));
          cursorIndicator = Get(command, "cursorIndicatorEnabled", true);
          string nextText = Get(command, "indicatorText", "DSH 正在控制电脑"), nextPosition = Get(command, "indicatorPosition", "top");
          bool rebuild = nextIndicator != indicator || nextText != text || nextPosition != position || frames.Count == 0;
          indicator = nextIndicator; text = nextText; position = nextPosition;
          idleMs = Math.Max(200, Math.Min(3000, Get(command, "indicatorIdleMs", 800)));
          armed = true; hideAt = action == "preview" ? DateTime.UtcNow.AddMilliseconds(1800) : DateTime.MaxValue;
          bool displaysRebuilt=RefreshDisplays(true);
          if (!indicator) HideFrames();
          else if (rebuild&&!displaysRebuilt) { HideFrames(); ShowFrames(); }
          else foreach (var frame in frames) frame.Present(255);
          UpdatePointer(255);
        } else if (action == "configure") {
          ConfigureShortcut(Get(command, "stopShortcut", ""));
          ConfigureVisibility(Get(command,"remoteIndicatorVisible",remoteVisible));
          cursorIndicator = Get(command, "cursorIndicatorEnabled", cursorIndicator); UpdatePointer(255);
        } else if (action == "end") {
          hideAt = DateTime.UtcNow.AddMilliseconds(idleMs);
        } else if (action == "stop") {
          Stop("user");
        } else if (action == "resume") {
          paused = false; armed = false; cancel.Reset(); HideFrames(); HidePointer(); hideAt = DateTime.MaxValue;
        } else if (action == "close") {
          cancel.Set(); ExitThread();
        } else if (action == "test_key" && testMode) {
          consumed = HandleKey(Get(command, "vk", 0), Get(command, "injected", false), Get(command, "down", true));
        } else if (action == "test_render" && testMode) {
          using (var image = Frame.Draw(1200, 675, Get(command, "indicatorText", text), Get(command, "indicatorPosition", "top"))) image.Save(Get(command, "path", ""), ImageFormat.Png);
        } else if (action == "test_render_pointer" && testMode) {
          float zoom=(float)Get(command,"scale",2.0);
          using (var image = PointerFrame.Draw(zoom, false, false)) {
            using (var graphics = Graphics.FromImage(image)) Cursors.Arrow.Draw(graphics, new Rectangle((int)(24*zoom),(int)(24*zoom),(int)(16*zoom),(int)(16*zoom)));
            image.Save(Get(command, "path", ""), ImageFormat.Png);
          }
        } else if (action == "test_pointer_source" && testMode) {
          testPointerPoint=new Native.Point(Get(command,"x",200),Get(command,"y",200)); UpdatePointer(255);
        } else if (action == "test_pointer_layout" && testMode) {
          var bounds = PointerFrame.LayoutForPoint(new Native.Point(Get(command,"x",0),Get(command,"y",0)), new Rectangle(Get(command,"left",0),Get(command,"top",0),Get(command,"width",1920),Get(command,"height",1080)), (float)Get(command,"scale",1.0));
          Emit(new { id=id,ok=true,left=bounds.X,top=bounds.Y,width=bounds.Width,height=bounds.Height }); return;
        } else if(action=="test_displays"&&testMode) {
          object supplied;if(!command.TryGetValue("displays",out supplied)||!(supplied is System.Collections.IEnumerable))throw new ArgumentException("Displays array required");
          var next=new List<Rectangle>();
          foreach(var item in (System.Collections.IEnumerable)supplied){var r=item as Dictionary<string,object>;if(r==null)throw new ArgumentException("Display object required");int width=Get(r,"width",0),height=Get(r,"height",0);if(width<64||height<64||width>8192||height>8192)throw new ArgumentException("Invalid test display size");next.Add(new Rectangle(Get(r,"left",0),Get(r,"top",0),width,height));}
          testDisplays=next.ToArray();nextDisplayPoll=DateTime.MinValue;
        } else if(action=="test_restore_displays"&&testMode) {
          testDisplays=null;nextDisplayPoll=DateTime.MinValue;
        } else if (action != "status") throw new InvalidOperationException("Unknown takeover command");
        Native.Point livePoint; bool liveCursorAvailable=Native.GetCursorPos(out livePoint);
        Emit(new { id = id, ok = true, armed = armed, paused = paused, cancelled = cancel.WaitOne(0), consumed = consumed, stopShortcut = stopShortcut, windows = frames.Count, remoteIndicatorVisible=remoteVisible, overlayCaptureExcluded=frames.Count>0&&frames.TrueForAll(frame=>frame.CaptureExcluded), overlayClickThrough=frames.Count>0&&frames.TrueForAll(frame=>frame.ClickThrough), displayRevision=displayRevision, displays=Array.ConvertAll(displays,r=>new {left=r.Left,top=r.Top,width=r.Width,height=r.Height}), overlayBounds=frames.ConvertAll(frame=>new {left=frame.DisplayBounds.Left,top=frame.DisplayBounds.Top,width=frame.DisplayBounds.Width,height=frame.DisplayBounds.Height}), cursorError = cursorError, liveCursorAvailable = liveCursorAvailable, pointerSource = testPointerPoint.HasValue ? "test-seam" : "windows", pointerVisible = pointer != null, pointerClickThrough = pointer != null && pointer.ClickThrough, pointerCaptureExcluded = pointer != null && pointer.CaptureExcluded, foreground = Native.GetForegroundWindow().ToInt64() });
      } catch (Exception error) { Emit(new { id = id, ok = false, error = error.Message }); }
    }
    IntPtr OnKey(int code, IntPtr message, IntPtr data) {
      if (code >= 0) {
        int kind = message.ToInt32();
        if (kind == 0x100 || kind == 0x104 || kind == 0x101 || kind == 0x105) {
          var key = (Native.Key)Marshal.PtrToStructure(data, typeof(Native.Key));
          if (HandleKey((int)key.vk, (key.flags & 0x12) != 0, kind == 0x100 || kind == 0x104)) return new IntPtr(1);
        }
      }
      return Native.CallNextHookEx(hook, code, message, data);
    }
    static int Modifier(int vk) {
      if (vk == 0x11 || vk == 0xA2 || vk == 0xA3) return 1;
      if (vk == 0x12 || vk == 0xA4 || vk == 0xA5) return 2;
      if (vk == 0x10 || vk == 0xA0 || vk == 0xA1) return 4;
      if (vk == 0x5B || vk == 0x5C) return 8;
      return 0;
    }
    void ConfigureShortcut(string shortcut) {
      int nextKey = 0, nextModifiers = 0;
      if (shortcut.Length > 0) {
        string[] parts = shortcut.Split('+');
        for (int i = 0; i < parts.Length - 1; i++) {
          int flag = parts[i] == "Ctrl" ? 1 : parts[i] == "Alt" ? 2 : parts[i] == "Shift" ? 4 : parts[i] == "Win" ? 8 : 0;
          if (flag == 0 || (nextModifiers & flag) != 0) throw new ArgumentException("Invalid stop shortcut modifiers");
          nextModifiers |= flag;
        }
        string key = parts[parts.Length - 1]; int number;
        if (key.Length == 1 && ((key[0] >= 'A' && key[0] <= 'Z') || (key[0] >= '0' && key[0] <= '9'))) nextKey = key[0];
        else if (key.StartsWith("F") && int.TryParse(key.Substring(1), out number) && number >= 1 && number <= 24) nextKey = 0x6F + number;
        else {
          var common = new Dictionary<string,int> { {"Space",0x20},{"Enter",0x0D},{"Tab",0x09},{"Backspace",0x08},{"Delete",0x2E},{"Insert",0x2D},{"Home",0x24},{"End",0x23},{"PageUp",0x21},{"PageDown",0x22},{"Up",0x26},{"Down",0x28},{"Left",0x25},{"Right",0x27},{"Pause",0x13},{"CapsLock",0x14},{"NumLock",0x90},{"ScrollLock",0x91} };
          if (!common.TryGetValue(key, out nextKey)) throw new ArgumentException("Invalid stop shortcut key");
        }
      }
      stopShortcut = shortcut; stopKey = nextKey; stopModifiers = nextModifiers;
    }
    bool HandleKey(int vk, bool injected, bool down) {
      if (injected) return false;
      if (!down) { physicalDown.Remove(vk); return swallowed.Remove(vk); }
      physicalDown.Add(vk);
      if (swallowed.Contains(vk)) return true;
      if (!armed || paused) return false;
      int modifiers = 0; foreach (int key in physicalDown) modifiers |= Modifier(key);
      if (vk != 0x1B && (stopKey == 0 || vk != stopKey || modifiers != stopModifiers)) return false;
      swallowed.Add(vk);
      // Signal the worker first, before any rendering or pipe activity.
      cancel.Set(); Stop(vk == 0x1B ? "escape" : "shortcut"); return true;
    }
    void Stop(string reason) {
      cancel.Set(); paused = true; armed = false; hideAt = DateTime.MaxValue; HideFrames(); HidePointer();
      Emit(new { kind = "stopped", reason = reason });
    }
    void ShowFrames() {
      foreach (var bounds in displays) { var frame = new Frame(bounds, text, position,remoteVisible); frames.Add(frame); frame.Show(); frame.Present(255); }
    }
    void HideFrames() { foreach (var frame in frames) frame.Dispose(); frames.Clear(); }
    void UpdatePointer(byte alpha) {
      if (!armed || paused || !cursorIndicator) { HidePointer(); return; }
      Native.Point point;
      if(testMode&&testPointerPoint.HasValue)point=testPointerPoint.Value;
      else if (!Native.GetCursorPos(out point)) { cursorError=Marshal.GetLastWin32Error(); HidePointer(); return; }
      cursorError=0;
      if (pointer == null) { pointer = new PointerFrame(remoteVisible); pointer.Update(point, alpha); pointer.Show(); }
      else pointer.Update(point, alpha);
    }
    void HidePointer() { if (pointer != null) { pointer.Dispose(); pointer = null; } }
    protected override void Dispose(bool disposing) {
      if (disposing && !shuttingDown) {
        shuttingDown = true; cancel.Set(); timer.Stop(); timer.Dispose(); HideFrames(); HidePointer();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= DisplaysChanged;
        Microsoft.Win32.SystemEvents.SessionSwitch -= SessionChanged;
        Microsoft.Win32.SystemEvents.UserPreferenceChanged -= PreferencesChanged;
        if (hook != IntPtr.Zero) Native.UnhookWindowsHookEx(hook);
        dispatcher.Dispose(); cancel.Dispose();
      }
      base.Dispose(disposing);
    }
  }

  // A small cursor-following layer. The system cursor, theme and input state
  // remain owned by Windows; closing/crashing this process leaves no cursor changes.
  internal sealed class PointerFrame : Form {
    IntPtr dc, bitmap, previous;
    float scale;
    bool flipX, flipY;
    Rectangle lastBounds;
    byte lastAlpha;
    SizeF lastExtent;
    bool remoteVisible;
    internal PointerFrame(bool visible) {
      remoteVisible=visible;
      AutoScaleMode = AutoScaleMode.None; FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
      Bounds = new Rectangle(0,0,1,1);
      dc = Native.CreateCompatibleDC(IntPtr.Zero);
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
      get { var value=base.CreateParams; value.ExStyle|=0x80000|0x20|0x80|0x08000000; return value; }
    }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); SetRemoteVisible(remoteVisible); }
    internal void SetRemoteVisible(bool visible) {remoteVisible=visible;if(IsHandleCreated)Native.SetWindowDisplayAffinity(Handle,visible?0u:0x11u);}
    internal bool ClickThrough { get { return (Native.GetWindowLong(Handle,-20)&0x08080020)==0x08080020; } }
    internal bool CaptureExcluded { get { uint affinity; return Native.GetWindowDisplayAffinity(Handle,out affinity)&&affinity==0x11; } }
    // Geometry in 96-DPI units. The tag sits just past the pointer's visible
    // extent; the canvas grows with it, and the default arrow keeps 120x84.
    static float TagX(SizeF extent) { return Math.Max(13f,extent.Width+2); }
    static float TagY(SizeF extent) { return Math.Max(17f,extent.Height-1); }
    static float CanvasWidth(SizeF extent) { return Math.Max(120f,24+TagX(extent)+48); }
    static float CanvasHeight(SizeF extent) { return Math.Max(84f,24+TagY(extent)+27); }
    static bool FlipX(Native.Point point, Rectangle screen, float zoom, SizeF extent) { return screen.Right-point.x < (CanvasWidth(extent)-24)*zoom; }
    static bool FlipY(Native.Point point, Rectangle screen, float zoom, SizeF extent) { return screen.Bottom-point.y < (CanvasHeight(extent)-18)*zoom; }
    internal static Rectangle LayoutForPoint(Native.Point point, Rectangle screen, float zoom) { return LayoutForPoint(point,screen,zoom,SizeF.Empty); }
    internal static Rectangle LayoutForPoint(Native.Point point, Rectangle screen, float zoom, SizeF extent) {
      float canvasWidth=CanvasWidth(extent),canvasHeight=CanvasHeight(extent);
      int width=(int)Math.Ceiling(canvasWidth*zoom),height=(int)Math.Ceiling(canvasHeight*zoom);
      int centerX=(int)Math.Round((FlipX(point,screen,zoom,extent)?canvasWidth-24:24)*zoom),centerY=(int)Math.Round((FlipY(point,screen,zoom,extent)?canvasHeight-24:24)*zoom);
      return new Rectangle(point.x-centerX,point.y-centerY,width,height);
    }
    // The user's pointer size: the arrow's visible extent past its hotspot, in
    // 96-DPI units. Measured once, and again only after Windows reports a
    // preference change (pointer size or cursor scheme).
    static SizeF? pointerExtent;
    internal static void ForgetPointerSize() { pointerExtent=null; }
    internal static SizeF PointerExtent() {
      if(!pointerExtent.HasValue) {
        var measured=MeasureCursor(Native.LoadCursor(IntPtr.Zero,new IntPtr(32512)));
        float dpi=96; try { dpi=Native.GetDpiForSystem(); } catch(EntryPointNotFoundException) { }
        // Windows enlarges the accessibility pointer when drawing it, not in the
        // arrow image; SPI_GETCURSORBASESIZE reports that size (32 by default).
        int baseSize; if(!Native.SystemParametersInfo(0x2028,0,out baseSize,0)||baseSize<32)baseSize=32;
        float factor=Math.Min(8f,baseSize/32f)/Math.Max(1f,dpi/96f);
        pointerExtent=new SizeF(measured.Width*factor,measured.Height*factor);
      }
      return pointerExtent.Value;
    }
    // Visible pixels past the hotspot, in physical pixels.
    internal static SizeF MeasureCursor(IntPtr cursor) {
      Native.IconInfo info;
      if(cursor==IntPtr.Zero||!Native.GetIconInfo(cursor,out info))return SizeF.Empty;
      try {
        using(var icon=Icon.FromHandle(cursor))
        using(var image=icon.ToBitmap()) {
          var data=image.LockBits(new Rectangle(0,0,image.Width,image.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
          int right=-1,bottom=-1;
          try {
            int row=Math.Abs(data.Stride)/4;var pixels=new int[row*image.Height];
            Marshal.Copy(data.Scan0,pixels,0,pixels.Length);
            for(int y=0;y<image.Height;y++)for(int x=0;x<image.Width;x++)if(((pixels[y*row+x]>>24)&0xff)>40){if(x>right)right=x;if(y>bottom)bottom=y;}
          } finally { image.UnlockBits(data); }
          // A monochrome pointer draws without alpha; size it from its cell like the arrow.
          if(right<0)return new SizeF(Math.Max(0,image.Width*.375f-info.hotX),Math.Max(0,image.Height*.6f-info.hotY));
          return new SizeF(Math.Max(0,right-info.hotX+1),Math.Max(0,bottom-info.hotY+1));
        }
      } catch(ArgumentException) { return SizeF.Empty; }
      catch(ExternalException) { return SizeF.Empty; }
      finally {
        if(info.mask!=IntPtr.Zero)Native.DeleteObject(info.mask);
        if(info.color!=IntPtr.Zero)Native.DeleteObject(info.color);
      }
    }
    internal void Update(Native.Point point, byte alpha) {
      var screen=Native.DisplayFromPoint(point);
      uint dpiX=96,dpiY=96; try { if(Native.GetDpiForMonitor(Native.MonitorFromPoint(point,2),0,out dpiX,out dpiY)!=0)dpiX=96; } catch(EntryPointNotFoundException) { }
      float zoom=Math.Max(1f,Math.Min(3f,dpiX/96f));
      var extent=PointerExtent();
      bool nextFlipX=FlipX(point,screen,zoom,extent),nextFlipY=FlipY(point,screen,zoom,extent);
      bool redraw=bitmap==IntPtr.Zero||Math.Abs(scale-zoom)>.01f||flipX!=nextFlipX||flipY!=nextFlipY||extent!=lastExtent;
      if(redraw) {
        using(var image=Draw(zoom,nextFlipX,nextFlipY,extent)) {
          IntPtr next=image.GetHbitmap(Color.FromArgb(0));
          IntPtr selected=Native.SelectObject(dc,next);
          if(bitmap==IntPtr.Zero)previous=selected; else Native.DeleteObject(bitmap);
          bitmap=next;
        }
        scale=zoom;flipX=nextFlipX;flipY=nextFlipY;lastExtent=extent;
      }
      var bounds=LayoutForPoint(point,screen,zoom,extent);
      if(!redraw&&bounds==lastBounds&&alpha==lastAlpha)return;
      var destination=new Native.Point(bounds.X,bounds.Y);var origin=new Native.Point(0,0);var size=new Native.Size(bounds.Width,bounds.Height);
      var blend=new Native.Blend { op=0,flags=0,alpha=alpha,format=1 };
      if(!Native.UpdateLayeredWindow(Handle,IntPtr.Zero,ref destination,ref size,dc,ref origin,0,ref blend,2))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"Could not present pointer indicator");
      lastBounds=bounds;lastAlpha=alpha;
    }
    internal static Bitmap Draw(float zoom,bool left,bool up) { return Draw(zoom,left,up,SizeF.Empty); }
    internal static Bitmap Draw(float zoom,bool left,bool up,SizeF extent) {
      float canvasWidth=CanvasWidth(extent),canvasHeight=CanvasHeight(extent);
      var image=new Bitmap((int)Math.Ceiling(canvasWidth*zoom),(int)Math.Ceiling(canvasHeight*zoom),PixelFormat.Format32bppPArgb);
      using(var g=Graphics.FromImage(image)) {
        g.Clear(Color.Transparent);g.SmoothingMode=SmoothingMode.AntiAlias;g.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;g.ScaleTransform(zoom,zoom);
        float x=left?canvasWidth-24:24,y=up?canvasHeight-24:24;
        // A soft spotlight under the tip instead of a hard ring.
        using(var spot=new GraphicsPath()) {
          spot.AddEllipse(x-16,y-16,32,32);
          using(var glow=new PathGradientBrush(spot) { CenterColor=Color.FromArgb(120,86,134,254), SurroundColors=new[] { Color.FromArgb(0,86,134,254) } }) g.FillPath(glow,spot);
        }
        // A solid name tag just past the arrow, like collaborative cursors.
        using(var font=new Font("Segoe UI",10,FontStyle.Bold,GraphicsUnit.Pixel))
        using(var format=new StringFormat(StringFormat.GenericTypographic) { Alignment=StringAlignment.Center, LineAlignment=StringAlignment.Center }) {
          float w=(float)Math.Ceiling(g.MeasureString("DSH",font,PointF.Empty,format).Width)+14,h=19;
          // Below-right clears the pointer's whole extent; the other corners only need to clear the tip.
          float bx=left?x-8-w:up?x+13:x+TagX(extent),by=up?y-10-h:left?y+17:y+TagY(extent);
          using(var shadow=Frame.Rounded(new RectangleF(bx,by+1.5f,w,h),6)) using(var brush=new SolidBrush(Color.FromArgb(60,0,0,0))) g.FillPath(brush,shadow);
          using(var shape=TagShape(new RectangleF(bx,by,w,h),left,up)) {
            using(var fill=new SolidBrush(Color.FromArgb(255,57,100,254)))g.FillPath(fill,shape);
            using(var outline=new Pen(Color.FromArgb(240,255,255,255),1.25f))g.DrawPath(outline,shape);
          }
          using(var brush=new SolidBrush(Color.White))g.DrawString("DSH",font,brush,new RectangleF(bx,by+.5f,w,h),format);
        }
      }
      return image;
    }
    // The corner nearest the pointer stays tight, so the tag reads as attached.
    static GraphicsPath TagShape(RectangleF r,bool left,bool up) {
      float topLeft=!left&&!up?2:6,topRight=left&&!up?2:6,bottomRight=left&&up?2:6,bottomLeft=!left&&up?2:6;
      var p=new GraphicsPath();
      p.AddArc(r.X,r.Y,topLeft*2,topLeft*2,180,90);p.AddArc(r.Right-topRight*2,r.Y,topRight*2,topRight*2,270,90);
      p.AddArc(r.Right-bottomRight*2,r.Bottom-bottomRight*2,bottomRight*2,bottomRight*2,0,90);p.AddArc(r.X,r.Bottom-bottomLeft*2,bottomLeft*2,bottomLeft*2,90,90);
      p.CloseFigure();return p;
    }
    protected override void Dispose(bool disposing) {
      if(dc!=IntPtr.Zero) { if(bitmap!=IntPtr.Zero){Native.SelectObject(dc,previous);Native.DeleteObject(bitmap);}Native.DeleteDC(dc);dc=IntPtr.Zero; }
      base.Dispose(disposing);
    }
  }

  internal sealed class Frame : Form {
    readonly Rectangle rectangle;
    bool remoteVisible;
    IntPtr dc, bitmap, previous;
    internal Frame(Rectangle bounds, string text, string position,bool visible) {
      remoteVisible=visible;rectangle = bounds; AutoScaleMode=AutoScaleMode.None;FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
      Bounds=bounds;
      using (var image = Draw(bounds.Width, bounds.Height, text, position)) bitmap = image.GetHbitmap(Color.FromArgb(0));
      dc = Native.CreateCompatibleDC(IntPtr.Zero); previous = Native.SelectObject(dc, bitmap);
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
      get { var value = base.CreateParams; value.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x08000000; return value; }
    }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); SetRemoteVisible(remoteVisible); }
    internal void SetRemoteVisible(bool visible) {remoteVisible=visible;if(IsHandleCreated)Native.SetWindowDisplayAffinity(Handle,visible?0u:0x11u);}
    internal Rectangle DisplayBounds {get{return rectangle;}}
    internal bool CaptureExcluded { get { uint affinity;return Native.GetWindowDisplayAffinity(Handle,out affinity)&&affinity==0x11; } }
    internal bool ClickThrough {get{return (Native.GetWindowLong(Handle,-20)&0x08080020)==0x08080020;}}
    internal void Present(byte alpha) {
      if (IsDisposed) return;
      var destination = new Native.Point(rectangle.X, rectangle.Y); var origin = new Native.Point(0,0);
      var size = new Native.Size(rectangle.Width,rectangle.Height);
      var blend = new Native.Blend { op=0, flags=0, alpha=alpha, format=1 };
      if (!Native.UpdateLayeredWindow(Handle, IntPtr.Zero, ref destination, ref size, dc, ref origin, 0, ref blend, 2)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Could not present takeover overlay");
    }
    internal static Bitmap Draw(int width, int height, string text, string position) {
      var image = new Bitmap(width,height,PixelFormat.Format32bppPArgb);
      using (var g = Graphics.FromImage(image)) {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        // ClearType needs an opaque surface; layered windows need grayscale text.
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(Color.Transparent);
        float scale = Math.Max(1f, Math.Min(2f, width/1920f));
        // Edge glow: a bright core line that reads on dark wallpapers, then a
        // DeepSeek-blue falloff that reads on light ones.
        g.CompositingMode = CompositingMode.SourceCopy;
        int core = (int)Math.Round(2*scale), glow = core+(int)Math.Round(18*scale);
        for (int i=0;i<glow;i++) {
          var color = i<core ? Color.FromArgb(235,150,184,255) : Color.FromArgb((int)(175*Math.Pow(1-(i-core)/(double)(glow-core),2.2)),77,124,254);
          using (var pen = new Pen(color,1)) g.DrawRectangle(pen,i,i,width-2*i-1,height-2*i-1);
        }
        g.CompositingMode = CompositingMode.SourceOver;
        // Status pill: live dot, the user's text, then an Esc keycap.
        using (var font = new Font("Microsoft YaHei UI",10.5f*scale,FontStyle.Regular,GraphicsUnit.Point))
        using (var keyFont = new Font("Segoe UI",8.5f*scale,FontStyle.Bold,GraphicsUnit.Point))
        using (var hintFont = new Font("Microsoft YaHei UI",9.5f*scale,FontStyle.Regular,GraphicsUnit.Point))
        using (var measure = new StringFormat(StringFormat.GenericTypographic) { FormatFlags = StringFormatFlags.NoWrap | StringFormatFlags.MeasureTrailingSpaces }) {
          const string hint = "停止";
          float pillHeight=40*scale, padding=16*scale, dot=8*scale, gap=10*scale, keyHeight=20*scale;
          float keyWidth=g.MeasureString("Esc",keyFont,PointF.Empty,measure).Width+12*scale;
          float hintWidth=g.MeasureString(hint,hintFont,PointF.Empty,measure).Width;
          float fixedWidth=padding*2+dot+gap*3+1+keyWidth+6*scale+hintWidth;
          float textWidth=Math.Min(g.MeasureString(text,font,PointF.Empty,measure).Width,Math.Max(48*scale,width-48*scale-fixedWidth));
          float pillWidth=fixedWidth+textWidth;
          float x=(float)Math.Round((width-pillWidth)/2), y=position=="bottom"?height-pillHeight-24*scale:24*scale, middle=y+pillHeight/2;
          for (int i=1;i<=6;i++)
            using (var shadow=Rounded(new RectangleF(x-i,y-i+2*scale,pillWidth+2*i,pillHeight+2*i),pillHeight/2+i))
            using (var brush=new SolidBrush(Color.FromArgb(9,0,0,0))) g.FillPath(brush,shadow);
          using (var shape=Rounded(new RectangleF(x,y,pillWidth,pillHeight),pillHeight/2)) {
            using (var fill=new SolidBrush(Color.FromArgb(238,20,22,28))) g.FillPath(fill,shape);
            using (var outline=new Pen(Color.FromArgb(40,255,255,255),1)) g.DrawPath(outline,shape);
          }
          float cursor=x+padding;
          using (var halo=new SolidBrush(Color.FromArgb(64,86,134,254))) g.FillEllipse(halo,cursor-3*scale,middle-dot/2-3*scale,dot+6*scale,dot+6*scale);
          using (var fill=new SolidBrush(Color.FromArgb(255,86,134,254))) g.FillEllipse(fill,cursor,middle-dot/2,dot,dot);
          cursor+=dot+gap;
          using (var brush=new SolidBrush(Color.FromArgb(255,245,247,250)))
          using (var format=new StringFormat(StringFormat.GenericTypographic) { LineAlignment=StringAlignment.Center, Trimming=StringTrimming.EllipsisCharacter, FormatFlags=StringFormatFlags.NoWrap })
            g.DrawString(text,font,brush,new RectangleF(cursor,y,textWidth+1,pillHeight),format);
          cursor+=textWidth+gap;
          using (var line=new Pen(Color.FromArgb(56,255,255,255),1)) g.DrawLine(line,cursor,middle-8*scale,cursor,middle+8*scale);
          cursor+=1+gap;
          var key=new RectangleF(cursor,middle-keyHeight/2,keyWidth,keyHeight);
          using (var shape=Rounded(key,5*scale)) {
            using (var fill=new SolidBrush(Color.FromArgb(34,255,255,255))) g.FillPath(fill,shape);
            using (var outline=new Pen(Color.FromArgb(64,255,255,255),1)) g.DrawPath(outline,shape);
          }
          using (var brush=new SolidBrush(Color.FromArgb(255,245,247,250)))
          using (var format=new StringFormat(StringFormat.GenericTypographic) { Alignment=StringAlignment.Center, LineAlignment=StringAlignment.Center })
            g.DrawString("Esc",keyFont,brush,key,format);
          cursor+=keyWidth+6*scale;
          using (var brush=new SolidBrush(Color.FromArgb(200,245,247,250)))
          using (var format=new StringFormat(StringFormat.GenericTypographic) { LineAlignment=StringAlignment.Center, FormatFlags=StringFormatFlags.NoWrap })
            g.DrawString(hint,hintFont,brush,new RectangleF(cursor,y,hintWidth+2,pillHeight),format);
        }
      }
      return image;
    }
    internal static GraphicsPath Rounded(RectangleF r,float radius) {
      var p=new GraphicsPath(); float d=radius*2;
      p.AddArc(r.X,r.Y,d,d,180,90);p.AddArc(r.Right-d,r.Y,d,d,270,90);p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);p.AddArc(r.X,r.Bottom-d,d,d,90,90);p.CloseFigure();return p;
    }
    protected override void Dispose(bool disposing) {
      if (dc!=IntPtr.Zero) { Native.SelectObject(dc,previous); Native.DeleteObject(bitmap); Native.DeleteDC(dc); dc=IntPtr.Zero; }
      base.Dispose(disposing);
    }
  }
}
