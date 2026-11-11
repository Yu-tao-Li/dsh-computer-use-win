# Exercise the actual screen-crop eligibility logic without reading the desktop.
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'), [Text.Encoding]::UTF8)
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Backend source did not parse' }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
public static class WindowsComputerUseNative {
  public struct RECT { public int left, top, right, bottom; }
  public static long Foreground = 42;
  public static long[] Order = new long[] {42};
  public static Dictionary<long,RECT> Bounds = new Dictionary<long,RECT>();
  public static HashSet<long> Hidden = new HashSet<long>();
  public static HashSet<long> Minimized = new HashSet<long>();
  public static int PrintCalls = 0, FrameShift = 0;
  public static IntPtr GetForegroundWindow() { return new IntPtr(Foreground); }
  public static IntPtr[] TopLevelWindows() { return Array.ConvertAll(Order, h => new IntPtr(h)); }
  public static bool IsWindowVisible(IntPtr h) { return !Hidden.Contains(h.ToInt64()); }
  public static bool IsIconic(IntPtr h) { return Minimized.Contains(h.ToInt64()); }
  public static bool GetWindowRect(IntPtr h, out RECT r) { return Bounds.TryGetValue(h.ToInt64(), out r); }
  public static bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags) { PrintCalls++; return false; }
  public static int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT r, int size) {
    r = new RECT {left=100+FrameShift,top=100,right=500+FrameShift,bottom=400}; return 0;
  }
  public static void Overlay(int left, int top, int right, int bottom) {
    Bounds[99] = new RECT {left=left,top=top,right=right,bottom=bottom};
  }
}
'@
$def = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-WindowScreenCapture' }, $true)
if ($null -eq $def) { throw 'Missing screen capture guard' }
. ([scriptblock]::Create($def.Extent.Text))
$bounds = @{x=100;y=100;width=400;height=300}
$virtual = @{Left=0;Top=0;Right=1000;Bottom=800}
function Check([bool]$Expected, [string]$Label, $TargetBounds=$bounds) {
  $actual = Test-WindowScreenCapture -Hwnd 42 -Bounds $TargetBounds -VirtualScreen $virtual
  if ($actual -ne $Expected) { throw "${Label}: expected $Expected; got $actual" }
}
Check $true 'Unobstructed foreground crop'
[WindowsComputerUseNative]::Foreground = 99
Check $false 'Background target'
[WindowsComputerUseNative]::Foreground = 42
Check $false 'Off-screen target' @{x=900;y=100;width=400;height=300}
Check $false 'Empty target' @{x=100;y=100;width=0;height=300}
Check $false 'Unknown target geometry' $null
[WindowsComputerUseNative]::Order = @(99,42)
[WindowsComputerUseNative]::Overlay(120,120,300,250)
Check $false 'Overlapping window above target, including an owned popup'
[WindowsComputerUseNative]::Order = @(42,99)
Check $true 'Window below target does not occlude it'
[WindowsComputerUseNative]::Order = @(99,42)
[WindowsComputerUseNative]::Overlay(500,100,700,400)
Check $true 'Touching edges are not an overlap'
[WindowsComputerUseNative]::Overlay(499,100,700,400)
Check $false 'One-pixel overlap'
[void][WindowsComputerUseNative]::Hidden.Add(99)
Check $true 'Hidden overlay ignored'
[WindowsComputerUseNative]::Hidden.Clear()
[void][WindowsComputerUseNative]::Minimized.Add(99)
Check $true 'Minimized overlay ignored'
[WindowsComputerUseNative]::Minimized.Clear()
[WindowsComputerUseNative]::Bounds.Clear()
Check $false 'Overlay with unknown bounds is inconclusive'
[WindowsComputerUseNative]::Order = @(42)
[void][WindowsComputerUseNative]::Hidden.Add(42)
Check $false 'Hidden target'
[WindowsComputerUseNative]::Hidden.Clear()
[void][WindowsComputerUseNative]::Minimized.Add(42)
Check $false 'Minimized target'
[WindowsComputerUseNative]::Minimized.Clear()
[WindowsComputerUseNative]::Order = @()
Check $false 'Target disappeared during enumeration'
$virtual = @{Left=-1000;Top=-800;Right=1000;Bottom=800}
[WindowsComputerUseNative]::Order = @(42)
Check $true 'Negative virtual-desktop coordinates' @{x=-900;y=-700;width=400;height=300}
Write-Output 'PASS foreground, Z order, overlays, visibility, geometry, disappearance and virtual-desktop screen-crop guards (fake native APIs only)'

# Use real bitmap encoding/scaling with synthetic pixels. No CopyFromScreen
# reaches user32, and no window is created or activated by these routing tests.
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$drawingReferences = @([Drawing.Graphics].Assembly.Location, [Drawing.Size].Assembly.Location) | Select-Object -Unique
Add-Type -ReferencedAssemblies $drawingReferences -TypeDefinition @'
using System;
using System.Drawing;
public class FixtureGraphics : IDisposable {
  private Graphics g;
  public static Action DuringCopy;
  public static FixtureGraphics FromImage(Image image) { return new FixtureGraphics {g=Graphics.FromImage(image)}; }
  public IntPtr GetHdc() { return g.GetHdc(); }
  public void ReleaseHdc(IntPtr h) { g.ReleaseHdc(h); }
  public void CopyFromScreen(int x, int y, int dx, int dy, Size size) {
    g.Clear(Color.Blue);
    g.FillRectangle(Brushes.Red, 0, size.Height/2, size.Width, size.Height-size.Height/2);
    if (DuringCopy != null) DuringCopy();
  }
  public void DrawImage(Image image, int x, int y) { g.DrawImage(image,x,y); }
  public void DrawImage(Image image, int x, int y, int w, int h) { g.DrawImage(image,x,y,w,h); }
  public System.Drawing.Drawing2D.InterpolationMode InterpolationMode {set {g.InterpolationMode=value;}}
  public void Dispose() { g.Dispose(); }
}
'@
foreach ($name in @('Get-Prop','Invoke-Safe','Get-ExtendedFrameBounds','Try-PrintWindowCapture','Remove-TempFile','Remove-OldScreenshots','Capture-Screenshot')) {
  $definition = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if ($null -eq $definition) { throw "Missing capture function: $name" }
  $body = $definition.Extent.Text.Replace('[System.Drawing.Graphics]', '[FixtureGraphics]')
  $body = $body.Replace('[System.Windows.Forms.SystemInformation]::VirtualScreen', '([Drawing.Rectangle]::new(0,0,1000,800))')
  . ([scriptblock]::Create($body))
}
function Invoke-WgcCapture { throw 'Deterministic WGC unavailable fixture' }
if ($env:TEMP -notmatch 'wcu-isolated-tests-') { throw 'Run bitmap routing through test/run-tests.mjs with an isolated TEMP directory' }
$target = @{nativeWindowHandle=42}
[WindowsComputerUseNative]::Foreground = 42
[WindowsComputerUseNative]::Order = @(42)
[WindowsComputerUseNative]::PrintCalls = 0
$shot = Capture-Screenshot -WindowElement $target -MaxWidth 200
if ($shot.method -ne 'screen-region' -or $shot.occludedPossible -ne $false -or
    $shot.imageScale -ne 0.5 -or [WindowsComputerUseNative]::PrintCalls -ne 0) { throw 'Clear crop must bypass PrintWindow and retain scale/occlusion metadata' }
$image = New-Object Drawing.Bitmap($shot.path)
try {
  if ($image.Width -ne 200 -or $image.Height -ne 150 -or $image.GetPixel(50,120).R -ne 255) { throw 'Lower-half pixels or downscaled geometry lost' }
} finally { $image.Dispose() }
[WindowsComputerUseNative]::Foreground = 99
$shot = Capture-Screenshot -WindowElement $target -MaxWidth 0
if ($shot.method -ne 'screen-region' -or $shot.occludedPossible -ne $true -or
    [WindowsComputerUseNative]::PrintCalls -ne 1) { throw 'Background PrintWindow failure plus unavailable WGC must reach flagged screen fallback' }
[WindowsComputerUseNative]::Foreground = 42
[FixtureGraphics]::DuringCopy = { [WindowsComputerUseNative]::Foreground = 99 }
$shot = Capture-Screenshot -WindowElement $target -MaxWidth 0
if ($shot.occludedPossible -ne $true -or [WindowsComputerUseNative]::PrintCalls -ne 2) { throw 'Focus race must discard clear crop and use flagged fallback' }
[WindowsComputerUseNative]::Foreground = 42
[FixtureGraphics]::DuringCopy = { [WindowsComputerUseNative]::FrameShift = 1 }
$shot = Capture-Screenshot -WindowElement $target -MaxWidth 0
if ($shot.occludedPossible -ne $true -or [WindowsComputerUseNative]::PrintCalls -ne 3) { throw 'Geometry race must discard clear crop' }
[FixtureGraphics]::DuringCopy = $null
Write-Output 'PASS actual capture routing: full lower-half pixels, scaling, failed PrintWindow/unavailable WGC fallback, focus and geometry races (synthetic pixels only)'
