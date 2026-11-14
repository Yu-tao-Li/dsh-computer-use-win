# Input lease behavior is exercised across real processes in input-mutex.mjs.
function Enter-DesktopInput { return $null }
function Exit-DesktopInput { param($Lease) }
# Real guard/action bodies with deterministic windows and UIA. No user input.
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'), [Text.Encoding]::UTF8)
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Backend does not parse'}
foreach($name in @('Get-Prop','Invoke-Safe','Test-TargetMatch','Select-TargetWindow','Assert-InputProcess','Assert-NativeInputTarget','Test-InputWindow','Assert-InFront','Assert-PointOnTarget','Assert-ElementFocus','Assert-ElementPoint','Confirm-ElementPoint','Register-ObservedElement','Resolve-Element','Invoke-Action')) {
  $f=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  $body=$f.Extent.Text.Replace('System.Windows.Automation.AutomationElement','Fixture.Element').Replace('System.Windows.Automation.TreeWalker','Fixture.Walker').Replace('System.Windows.Point','Fixture.Point').Replace('System.Windows.Forms','Fixture.Forms')
  . ([scriptblock]::Create($body))
}
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Text;
public static class WindowsComputerUseNative {
 public static bool SendKeyChord(string[] keys){Fixture.Forms.SendKeys.SendWait(keys.Length==2&&keys[0]=="ctrl"?"^"+keys[1]:keys[keys.Length-1]);return true;}
 public static long Front=200,Hit=200;
 public static Dictionary<long,long> Owners=new Dictionary<long,long>();
 public static List<long> Popups=new List<long>();
 public static IntPtr GetForegroundWindow(){return new IntPtr(Front);}
 public static bool IsWindow(IntPtr h){return h.ToInt64()==200;}
 public static uint GetWindowThreadProcessId(IntPtr h,out uint pid){pid=2;return 1;}
 public static IntPtr GetWindow(IntPtr h,uint command){long owner;return new IntPtr(Owners.TryGetValue(h.ToInt64(),out owner)?owner:0);}
 public static long[] VisiblePopups(uint pid){return Popups.ToArray();}
 public static int GetWindowText(IntPtr h,StringBuilder b,int n){return 0;}
 public static int GetClassName(IntPtr h,StringBuilder b,int n){return 0;}
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
function Test-Failsafe {return $true}
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
