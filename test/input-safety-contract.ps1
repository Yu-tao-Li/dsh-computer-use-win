# Input lease behavior is exercised across real processes in input-mutex.mjs.
function Enter-DesktopInput { return $null }
function Exit-DesktopInput { param($Lease) }
function Test-Failsafe { return $true }
# Real guard/action bodies with deterministic windows and UIA. No user input.
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'), [Text.Encoding]::UTF8)
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Backend does not parse'}
foreach($name in @('Get-Prop','Invoke-Safe','Test-TargetMatch','Select-TargetWindow','Assert-InputProcess','Assert-NativeInputTarget','Test-InputWindow','Assert-InFront','Assert-PointOnTarget','Assert-ElementFocus','Assert-ElementPoint','Confirm-ElementPoint','Register-ObservedElement','Resolve-Element','Get-SendInputEdit','Wait-SendInputEdit','Invoke-Action')) {
  $f=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  $body=$f.Extent.Text.Replace('System.Windows.Automation.AutomationElement','Fixture.Element').Replace('System.Windows.Automation.TreeWalker','Fixture.Walker').Replace('System.Windows.Point','Fixture.Point').Replace('System.Windows.Forms','Fixture.Forms')
  . ([scriptblock]::Create($body))
}
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Text;
public static class WindowsComputerUseNative {
 public sealed class ProcessIdentity { public bool Gone,TokenAccessDenied; public string ImagePath; public uint? Integrity; }
 public static ProcessIdentity Target=new ProcessIdentity{ImagePath=@"C:\fixture\app.exe",Integrity=8192};
 public static uint? CurrentIntegrity=8192;
 public static ProcessIdentity ReadInputProcess(uint pid,bool checkImage){return Target;}
 public static uint? ReadCurrentIntegrity(){return CurrentIntegrity;}
 public static bool SendKeyChord(string[] keys){Fixture.Forms.SendKeys.SendWait(keys.Length==2&&keys[0]=="ctrl"?"^"+keys[1]:keys[keys.Length-1]);return true;}
 public static long Front=200,Hit=200;
 public static long Focus=190;
 public static bool EditPassword;
 public static string EditBefore;
 public static Queue<string> EditReads=new Queue<string>();
 public const uint WM_GETTEXTLENGTH=0x000E;
 public static Dictionary<long,long> Owners=new Dictionary<long,long>();
 public static List<long> Popups=new List<long>(),Hidden=new List<long>();
 public static bool IsWindowVisible(IntPtr h){return !Hidden.Contains(h.ToInt64());}
 public static IntPtr GetForegroundWindow(){return new IntPtr(Front);}
 public static bool IsWindow(IntPtr h){return h.ToInt64()==200;}
 public static uint GetWindowThreadProcessId(IntPtr h,out uint pid){pid=2;return 1;}
 public static IntPtr GetWindow(IntPtr h,uint command){long owner;return new IntPtr(Owners.TryGetValue(h.ToInt64(),out owner)?owner:0);}
 public static long[] VisiblePopups(uint pid){return Popups.ToArray();}
 public static int GetWindowText(IntPtr h,StringBuilder b,int n){return 0;}
 public static int GetClassName(IntPtr h,StringBuilder b,int n){if(h.ToInt64()!=190)return 0;b.Append("Edit");return 4;}
 public static int GetWindowLong(IntPtr h,int index){return EditPassword?0x20:0;}
 public static IntPtr FocusedWindow(IntPtr h){return new IntPtr(Focus);}
 public static string ReadEditText(IntPtr h,int capacity){return EditReads.Count!=0?EditReads.Dequeue():EditBefore;}
 public static int[] ReadEditSelection(IntPtr h){return new int[]{2,4};}
 // The target thread still holds queued keys while PaintLeft polls remain.
 public static bool PaintSignal=true;public static int PaintLeft;
 public static bool RequestPaint(IntPtr h){return PaintSignal;}
 public static bool PaintPending(IntPtr h){if(PaintLeft<=0)return false;PaintLeft--;return true;}
 public static IntPtr SendMessageTimeout(IntPtr h,uint msg,UIntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result) {
   result=msg==WM_GETTEXTLENGTH?new UIntPtr((uint)EditBefore.Length):UIntPtr.Zero;
   return new IntPtr(1);
 }
}
namespace Fixture {
 public struct Point {public double X,Y;public Point(double x,double y){X=x;Y=y;}}
 public class Properties {
  public bool HasKeyboardFocus,IsOffscreen;public bool IsEnabled=true;
  public object BoundingRectangle;public long NativeWindowHandle=200;
 }
 public class Element {
  public static Element Hit;public Element Parent;public Properties Current=new Properties();
  public int Id;public bool FocusSucceeds,HasPoint=true;public double X=17,Y=25;
  public Element(int id){Id=id;}
  public int[] GetRuntimeId(){return new[]{1,Id};}
  public void SetFocus(){Current.HasKeyboardFocus=FocusSucceeds;}
  public bool TryGetClickablePoint(out Point point){point=new Point(X,Y);return HasPoint;}
  public static Element FromPoint(Point point){return Hit;}
 }
 public class Walker {
  public static Walker RawViewWalker=new Walker();
  public Element GetParent(Element element){return element.Parent;}
 }
}
namespace Fixture.Forms {
 public static class SendKeys {public static int Calls;public static Action After;
  public static void SendWait(string keys){Calls++;if(After!=null)After();}
 }
}
'@
function Get-WindowProcessId {param($Hwnd) if($Hwnd -eq 400){return 3};return 2}
function Get-RootWindowAt {param($X,$Y) return [WindowsComputerUseNative]::Hit}
function Expect-Error {param([scriptblock]$Body,[string]$Pattern) $caught=$false;try{& $Body}catch{$caught=$true;if($_.Exception.Message -notmatch $Pattern){throw}};if(-not $caught){throw "Expected $Pattern"}}
function Assert-Equal {param($Actual,$Expected) if($Actual -ne $Expected){throw "Expected $Expected, received $Actual"}}
$state=@{target=200;procId=2;popups=@(210)}
$env:WCU_HOST_EXECUTABLE='';$env:WCU_HOST_PID='2'
Expect-Error {Assert-NativeInputTarget 200} 'HOST_INPUT_DENIED'
Expect-Error {Assert-NativeInputTarget 0} 'INPUT_TARGET_UNAVAILABLE'
$env:WCU_HOST_PID='999999';Assert-NativeInputTarget 200
Expect-Error {Assert-InputProcess $PID} 'HOST_INPUT_DENIED'
$env:WCU_HOST_PID=''
$env:WCU_HOST_EXECUTABLE='C:\fixture\dsh.exe'
$identity=[WindowsComputerUseNative]::Target
Assert-InputProcess 2
$identity.Integrity=12288
Expect-Error {Assert-InputProcess 2} 'ELEVATED_TARGET_DENIED:.+higher Windows integrity.+No input was sent'
[WindowsComputerUseNative]::CurrentIntegrity=12288
Assert-InputProcess 2
[WindowsComputerUseNative]::CurrentIntegrity=8192
$identity.ImagePath='c:\fixture\DSH.exe'
Expect-Error {Assert-InputProcess 2} 'HOST_INPUT_DENIED:.+host executable'
$identity.ImagePath='C:\fixture\app.exe'
$identity.Integrity=$null
Expect-Error {Assert-InputProcess 2} 'INPUT_TARGET_ACCESS_UNCONFIRMED:.+integrity.+No input was sent'
$identity.TokenAccessDenied=$true
Expect-Error {Assert-InputProcess 2} 'INPUT_TARGET_ACCESS_UNCONFIRMED:.+administrator.+No input was sent'
$identity.TokenAccessDenied=$false
$identity.Integrity=8192
[WindowsComputerUseNative]::CurrentIntegrity=$null
Expect-Error {Assert-InputProcess 2} 'INPUT_TARGET_ACCESS_UNCONFIRMED'
[WindowsComputerUseNative]::CurrentIntegrity=8192
$identity.ImagePath=$null
Expect-Error {Assert-InputProcess 2} 'INPUT_TARGET_ACCESS_UNCONFIRMED'
$identity.Gone=$true
Expect-Error {Assert-InputProcess 3} 'INPUT_TARGET_UNAVAILABLE:.+process has exited.+No input was sent'
$identity.Gone=$false
$identity.ImagePath='C:\fixture\app.exe'
$env:WCU_HOST_EXECUTABLE=''
$identity.Integrity=12288
Expect-Error {Assert-InputProcess 2} 'ELEVATED_TARGET_DENIED'
$identity.Integrity=8192
Assert-Equal (Test-InputWindow 200 200 $state) $true
Assert-Equal (Test-InputWindow 201 200 $state) $false
[WindowsComputerUseNative]::Owners[202]=200
Assert-Equal (Test-InputWindow 202 200 $state) $true
[WindowsComputerUseNative]::Owners[203]=202
Assert-Equal (Test-InputWindow 203 200 $state) $true
[WindowsComputerUseNative]::Owners[205]=206;[WindowsComputerUseNative]::Owners[206]=205
Assert-Equal (Test-InputWindow 205 200 $state) $false
[WindowsComputerUseNative]::Popups.Add(210);[WindowsComputerUseNative]::Popups.Add(211)
Assert-Equal (Test-InputWindow 210 200 $state) $false
Assert-Equal (Test-InputWindow 211 200 $state) $true
[WindowsComputerUseNative]::Popups.Add(400)
Assert-Equal (Test-InputWindow 400 200 $state) $false
[WindowsComputerUseNative]::Front=201
Expect-Error {Assert-InFront $state} 'no longer in front'
[WindowsComputerUseNative]::Hit=201
Expect-Error {Assert-PointOnTarget 10 20 200 $state} 'POINT_COVERED'
[WindowsComputerUseNative]::Front=200;[WindowsComputerUseNative]::Hit=200

$script:NativeEditClass='^Edit$'
[WindowsComputerUseNative]::EditBefore='ab12cd'
$edit=Get-SendInputEdit ([IntPtr]190) 'XYZ'
Assert-Equal $edit.expected 'abXYZcd'
Assert-Equal $edit.head 'abXYZ'
Assert-Equal $edit.tail 'cd'
$native=[WindowsComputerUseNative]
$native::EditReads.Enqueue('abXcd')
$native::EditReads.Enqueue('abXYZcd')
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $edit 3) 'observed'
# Issue #90: a slow target keeps taking keys after 750 ms. While keys are
# still queued (repaint pending), slow progress is not mistaken for the end.
foreach($value in @(@('abXcd')*20+@('abXYcd')*20+@('abXYZcd'))){$native::EditReads.Enqueue($value)}
$native::PaintLeft=1000
$clock=[Diagnostics.Stopwatch]::StartNew()
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $edit 40) 'observed'
if($clock.ElapsedMilliseconds -lt 800){throw "Slow input should be waited for, returned after $($clock.ElapsedMilliseconds) ms"}
# Keys used up (repainted) and the text unchanged for 400 ms: incomplete.
$native::PaintLeft=0;$native::EditReads.Clear();$native::EditBefore='abXcd'
$clock.Restart()
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $edit 3) 'incomplete'
if($clock.ElapsedMilliseconds -lt 400){throw 'Incomplete was reported before 400 ms without change'}
# Keys still queued at the cap: incomplete, never 'changed'.
$native::PaintLeft=100000;$native::EditBefore='abXYZsuggestcd'
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $edit 3) 'incomplete'
# All typed text arrived and the application added to it or changed its case.
$native::PaintLeft=0
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $edit 3) 'changed'
$native::EditBefore='ABXYZCD'
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $edit 3) 'changed'
$native::EditBefore='abXYZ'
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $edit 3) 'incomplete'
$native::Focus=191
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $edit 3) 'incomplete'
$native::EditBefore='abXYZcd'
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $edit 3) 'observed'
$native::Focus=190
# A control without readback: at least 150 ms, and until its queue is drained.
$clock.Restart()
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $null 40) $null
if($clock.ElapsedMilliseconds -lt 150){throw 'The short grace was skipped'}
$native::PaintLeft=40
$clock.Restart()
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $null 40) $null
if($native::PaintLeft -ne 0 -or $clock.ElapsedMilliseconds -lt 300){throw 'Queued keys were not waited for'}
$native::PaintSignal=$false;$native::PaintLeft=1000
$clock.Restart()
Assert-Equal (Wait-SendInputEdit ([IntPtr]200) ([IntPtr]190) $null 40) $null
if($clock.ElapsedMilliseconds -ge 1000){throw 'Without a repaint signal the grace stays short'}
$native::PaintSignal=$true;$native::PaintLeft=0
$native::EditPassword=$true
Assert-Equal (Get-SendInputEdit ([IntPtr]190) 'XYZ') $null
$native::EditPassword=$false

function Get-NativeWindowList {param($IncludeInvisible,$MaxWindows) return $script:Windows}
$script:Windows=@(
 @{name='Project - copy';nativeWindowHandle=201;processId=2},
 @{name='Project';nativeWindowHandle=200;processId=2},
 @{name='Other Project';nativeWindowHandle=202;processId=3})
Assert-Equal (Select-TargetWindow @{windowTitle='Project'}).nativeWindowHandle 200
Assert-Equal (Select-TargetWindow @{windowTitle='Project -'}).nativeWindowHandle 201
Expect-Error {Select-TargetWindow @{windowTitle='Pro'}} 'WINDOW_TARGET_AMBIGUOUS'
Expect-Error {Select-TargetWindow @{processId=2}} 'WINDOW_TARGET_AMBIGUOUS'
Assert-Equal (Select-TargetWindow @{processId=2;nativeWindowHandle=201}).nativeWindowHandle 201
# Real processes also own hidden IME/DDE windows and tiny untitled visible ones.
$script:Windows=@(
 @{name='Default IME';nativeWindowHandle=301;processId=7;isOffscreen=$true;boundingBox=@{width=0;height=0}},
 @{name='';nativeWindowHandle=302;processId=7;isOffscreen=$false;boundingBox=@{width=15;height=15}},
 @{name='Notes - Editor';nativeWindowHandle=303;processId=7;isOffscreen=$false;boundingBox=@{width=800;height=600}},
 @{name='MSCTFIME UI';nativeWindowHandle=304;processId=7;isOffscreen=$true;boundingBox=@{width=0;height=0}},
 @{name='Tray';nativeWindowHandle=311;processId=8;isOffscreen=$true;boundingBox=@{width=160;height=28}},
 @{name='';nativeWindowHandle=312;processId=8;isOffscreen=$true;boundingBox=@{width=0;height=0}},
 @{name='Report';nativeWindowHandle=321;processId=9;isOffscreen=$false;boundingBox=@{width=900;height=700}},
 @{name='Report';nativeWindowHandle=322;processId=9;isOffscreen=$false;boundingBox=@{width=900;height=700}})
[WindowsComputerUseNative]::Hidden.AddRange([long[]]@(301,304,312))
Assert-Equal (Select-TargetWindow @{processId=7}).nativeWindowHandle 303
Assert-Equal (Select-TargetWindow @{processId=8}).nativeWindowHandle 311
Expect-Error {Select-TargetWindow @{processId=9}} 'WINDOW_TARGET_AMBIGUOUS'
Expect-Error {Select-TargetWindow @{windowTitle='Report'}} '"name":"Report","processId":9,"nativeWindowHandle":322'
[WindowsComputerUseNative]::Hidden.Clear()

$script:Element=New-Object Fixture.Element(10)
[Fixture.Element]::Hit=$script:Element
$point=@{element=$script:Element;x=5;y=6}
Confirm-ElementPoint $point
Assert-Equal $point.x 17;Assert-Equal $point.y 25
$child=New-Object Fixture.Element(11);$child.Parent=$script:Element;[Fixture.Element]::Hit=$child
Assert-ElementPoint $script:Element 17 25
[Fixture.Element]::Hit=New-Object Fixture.Element(12)
Expect-Error {Assert-ElementPoint $script:Element 17 25} 'ELEMENT_POINT_COVERED'
$script:Element.Current.IsOffscreen=$true
Expect-Error {Assert-ElementPoint $script:Element 17 25} 'ELEMENT_OFFSCREEN'
$script:Element.Current.IsOffscreen=$false;$script:Element.Current.IsEnabled=$false
Expect-Error {Assert-ElementPoint $script:Element 17 25} 'ELEMENT_DISABLED'
$script:Element.Current.IsEnabled=$true

# More than 6000 nodes from the current observation must all keep valid IDs.
$script:ElementRegistry=@{};$script:ElementGeneration=1
$owner=@{nativeWindowHandle=200;processId=2}
for($i=1;$i -le 6100;$i++){
 $node=New-Object Fixture.Element($i)
 Register-ObservedElement ('uia:rt:1-'+$i) $node $owner
}
function Get-ViewMode {param($InputObject,$Default) return $Default}
function Has-WindowTarget {param($InputObject) return $false}
Assert-Equal (Resolve-Element 'uia:rt:1-1').Id 1
Assert-Equal (Resolve-Element 'uia:rt:1-6100').Id 6100
Assert-Equal $script:ElementRegistry.Count 6100
$script:ElementGeneration=2
Register-ObservedElement 'uia:rt:1-7000' (New-Object Fixture.Element(7000)) $owner
Assert-Equal (Resolve-Element 'uia:rt:1-7000').Id 7000
if($script:ElementRegistry.Count -lt 5000){throw 'Eviction must not clear the whole registry'}

function Resolve-Element {param($Id,$InputObject) return $script:Element}
function Set-ElementValue {param($Element,$Value) return $null}
function Add-BackgroundReport {param($Result)}
function Assert-InputAllowed {param($What)}
function Get-ElementWindow {param($Element) return 200}
function Start-Input {param($InputObject,$Hwnd) return @{target=200;procId=2;popups=@(210)}}
function Complete-Input {param($State,$Result) $script:Cleanups++}
function Type-Text {param($Text,$RestoreClipboard) $script:Pastes++}
$script:Cleanups=0;$script:Pastes=0
$inputArgs=@{elementId='fixture';value='replacement'}
$script:Element.FocusSucceeds=$false
Expect-Error {Invoke-Action 'set_value' $inputArgs} 'ELEMENT_FOCUS_UNCONFIRMED'
Assert-Equal ([Fixture.Forms.SendKeys]::Calls) 0;Assert-Equal $script:Pastes 0
$script:Element.FocusSucceeds=$true
[Fixture.Forms.SendKeys]::After=[Action]{$script:Element.Current.HasKeyboardFocus=$false}
Expect-Error {Invoke-Action 'set_value' $inputArgs} 'ELEMENT_FOCUS_UNCONFIRMED'
Assert-Equal ([Fixture.Forms.SendKeys]::Calls) 1;Assert-Equal $script:Pastes 0
[Fixture.Forms.SendKeys]::After=$null
$result=Invoke-Action 'set_value' $inputArgs
Assert-Equal $result.method 'FocusSelectAllTypeFallback';Assert-Equal $script:Pastes 1
Assert-Equal $script:Cleanups 3
Write-Output 'PASS same-process siblings denied, owned/new popup scope, target ambiguity, element hit/visibility, and focus confirmation before select-all and paste; no physical input'
