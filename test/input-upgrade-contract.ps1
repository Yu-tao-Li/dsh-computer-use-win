# Shipped action bodies, deterministic native/clipboard APIs, no physical input.
$ErrorActionPreference='Stop'
$tokens=$null; $parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors | Out-String)}
foreach($name in @('Get-Prop','Get-ViewMode','Invoke-Safe','Test-TargetMatch','Get-ButtonFlags','Move-ToPoint','Click-At','Type-Text','Convert-KeyChord','Get-OcrWordBounds','Find-OcrWordRun','Invoke-Action')) {
  $f=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  . ([scriptblock]::Create($f.Extent.Text.Replace('System.Windows.Forms','Fixture.Forms')))
}
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic;
public static class WindowsComputerUseNative {
 public struct POINT {public int x,y;}
 public const int MOUSEEVENTF_LEFTDOWN=2,MOUSEEVENTF_LEFTUP=4,MOUSEEVENTF_RIGHTDOWN=8,MOUSEEVENTF_RIGHTUP=16,MOUSEEVENTF_MIDDLEDOWN=32,MOUSEEVENTF_MIDDLEUP=64,MOUSEEVENTF_WHEEL=2048,MOUSEEVENTF_HWHEEL=4096;
 public static int Moves,FailMoveAt,Press,Release,Scroll; public static uint ScrollResult=1;
 public static bool SetCursorPos(int x,int y){Moves++;return Moves!=FailMoveAt;}
 public static bool GetCursorPos(ref POINT p){return true;}
 public static uint SendMouseEvent(int x,int y,uint f,int d){if(f==2)Press++;else if(f==4)Release++;else Scroll++;return f==2048||f==4096?ScrollResult:1;}
 public static void Reset(){Moves=FailMoveAt=Press=Release=Scroll=0;ScrollResult=1;}
}
namespace Fixture.Forms {
 public class DataObject {
  public Dictionary<string,object> Values=new Dictionary<string,object>();
  public string[] GetFormats(bool convert){var a=new string[Values.Count];Values.Keys.CopyTo(a,0);return a;}
  public object GetData(string format,bool convert){return Values[format];}
  public void SetData(string format,bool convert,object value){Values[format]=value;}
 }
 public static class Clipboard {
  public static DataObject Data; public static object GetDataObject(){return Data;}
  public static void SetText(string text){Data=new DataObject();Data.SetData("Text",false,text);}
  public static void SetDataObject(object data,bool copy){Data=(DataObject)data;}
  public static void Clear(){Data=null;}
 }
 public static class SendKeys {public static bool Fail;public static void SendWait(string keys){if(Fail)throw new Exception("PASTE_FAILURE");}}
}
'@
function Start-Sleep {param($Milliseconds)}
function Test-Failsafe {return $true}
function Has-WindowTarget {param($InputObject) return -not [string]::IsNullOrWhiteSpace((Get-Prop $InputObject 'windowTitle' ''))}
function Activate-TargetIfRequested {param($InputObject)}
function Assert-TargetIsForeground {param($InputObject) $script:GuardCalls++}
function Get-PointFromArgs {param($InputObject) return @{x=1;y=2;elementId=$null}}
function Get-ObservationWindow {param($InputObject,$Scope) return $null}
function Capture-Screenshot {param($WindowElement,$MaxWidth) return @{path='fake.png';bounds=@{x=0;y=0};imageScale=1;method='fixture';occludedPossible=$script:Occluded}}
function Invoke-Ocr {param($PngPath) return @{text='NEEDLE42';lines=@(@{text='NEEDLE42';words=@(@{text='NEEDLE42';x=10;y=20;width=100;height=20})})}}
function Get-NativeWindowList {param($IncludeInvisible,$MaxWindows) return @(@{name='Fixture';nativeWindowHandle=42;processId=1})}
function Get-TreeResult {param($Scope,$MaxDepth,$MaxNodes,$InputObject) return @{tree=@{};nodeCount=6;truncated=$script:Truncated;durationMs=1;treeTimeoutMs=100;targetResponsive=$true}}
function Search-Tree {param($Node,$Query,$ControlType,$MaxResults,$Results) if($script:ElementFound){$Results.Add(@{name=$Query})}}
function Assert-Equal {param($Actual,$Expected) if($Actual -ne $Expected){throw "Expected $Expected, actual $Actual"}}
function Expect-Error {param([scriptblock]$Body,[string]$Pattern) $hit=$false;try{& $Body}catch{$hit=$true;if($_.Exception.Message -notmatch $Pattern){throw}};if(-not $hit){throw 'Expected failure'}}
Assert-Equal (Get-Prop ([ordered]@{answer=42}) 'answer' 0) 42
foreach($key in @('+','^','%','~','(',')','{','}','[',']')){Assert-Equal (Convert-KeyChord @($key)) ('{'+$key+'}')}
Assert-Equal (Convert-KeyChord @('ctrl','+')) '^{+}'
Assert-Equal (Convert-KeyChord @('ctrl','a')) '^a'
Assert-Equal (Convert-KeyChord @('Enter')) '{ENTER}'
foreach($fail in @($false,$true)){
  $original=New-Object Fixture.Forms.DataObject
  $original.SetData('Text',$false,'old');$original.SetData('Bitmap',$false,'image fixture');$original.SetData('FileDrop',$false,@('fixture.txt'))
  [Fixture.Forms.Clipboard]::Data=$original
  [Fixture.Forms.SendKeys]::Fail=$fail
  if($fail){Expect-Error {Type-Text 'new'} 'PASTE_FAILURE'}else{Type-Text 'new'}
  Assert-Equal ([Fixture.Forms.Clipboard]::Data.GetData('Bitmap',$false)) 'image fixture'
  Assert-Equal ([Fixture.Forms.Clipboard]::Data.GetData('FileDrop',$false)[0]) 'fixture.txt'
  Assert-Equal ([Fixture.Forms.Clipboard]::Data.GetData('Text',$false)) 'old'
}
[Fixture.Forms.SendKeys]::Fail=$false
$inputArgs=[pscustomobject]@{path=@(@{x=10;y=20},@{x=30;y=40})}
[WindowsComputerUseNative]::Reset(); $script:GuardCalls=0
[WindowsComputerUseNative]::FailMoveAt=2
Expect-Error {Invoke-Action 'drag' $inputArgs} 'COMPUTER_USE_INPUT_UNAVAILABLE'
Assert-Equal ([WindowsComputerUseNative]::Press) 1;Assert-Equal ([WindowsComputerUseNative]::Release) 1;Assert-Equal $script:GuardCalls 1
[WindowsComputerUseNative]::Reset()
[WindowsComputerUseNative]::ScrollResult=0
Expect-Error {Invoke-Action 'scroll' ([pscustomobject]@{})} 'Windows rejected scroll input'
[WindowsComputerUseNative]::Reset()
Assert-Equal (Invoke-Action 'drag' $inputArgs).points 2
$script:Occluded=$false
$result=Invoke-Action 'wait_for' ([pscustomobject]@{condition='text';query='NEEDLE42';timeoutMs=100})
Assert-Equal $result.verification 'observed';Assert-Equal $result.found $true
$script:Occluded=$true
$result=Invoke-Action 'wait_for' ([pscustomobject]@{condition='text';query='NEEDLE42';timeoutMs=100})
Assert-Equal $result.verification 'unconfirmed';Assert-Equal $result.conclusive $false
$result=Invoke-Action 'wait_for' ([pscustomobject]@{windowTitle='Fixture';timeoutMs=100})
Assert-Equal $result.verification 'observed'
$script:ElementFound=$false;$script:Truncated=$true
$result=Invoke-Action 'wait_for' ([pscustomobject]@{condition='element';query='missing';appear=$false;timeoutMs=100})
Assert-Equal $result.verification 'unconfirmed';Assert-Equal $result.conclusive $false
$script:Truncated=$false
$result=Invoke-Action 'wait_for' ([pscustomobject]@{condition='element';query='missing';appear=$false;timeoutMs=100})
Assert-Equal $result.verification 'observed'
$script:Truncated=$true;$script:ElementFound=$true
$result=Invoke-Action 'wait_for' ([pscustomobject]@{condition='element';query='present';timeoutMs=100})
Assert-Equal $result.verification 'observed';Assert-Equal $result.found $true
# dispatch:'auto' coordinate clicks prefer the element under the point. The hit
# test needs a real window, so the helper is stubbed here and exercised by the
# live suites; this contract pins the call and fallback matrix.
$script:SemanticCalls=0;$script:SemanticReturn=$null
function Invoke-SemanticClickAtPoint {param($InputObject,$Point) $script:SemanticCalls++;return $script:SemanticReturn}
[WindowsComputerUseNative]::Reset();$script:GuardCalls=0;$script:SemanticReturn='Invoke'
$result=Invoke-Action 'click' ([pscustomobject]@{x=10;y=20})
Assert-Equal $script:SemanticCalls 1
Assert-Equal $result.method 'background:Invoke@point'
Assert-Equal $result.Contains('verified') $false
Assert-Equal $script:GuardCalls 0
Assert-Equal ([WindowsComputerUseNative]::Moves) 0;Assert-Equal ([WindowsComputerUseNative]::Press) 0
[WindowsComputerUseNative]::Reset();$script:GuardCalls=0;$script:SemanticCalls=0;$script:SemanticReturn=$null
$result=Invoke-Action 'click' ([pscustomobject]@{x=10;y=20})
Assert-Equal $script:SemanticCalls 1
Assert-Equal $result.method 'sendinput'
Assert-Equal $script:GuardCalls 1
Assert-Equal ([WindowsComputerUseNative]::Press) 1
[WindowsComputerUseNative]::Reset();$script:GuardCalls=0;$script:SemanticCalls=0;$script:SemanticReturn='Invoke'
$result=Invoke-Action 'click' ([pscustomobject]@{x=10;y=20;button='right'})
Assert-Equal $script:SemanticCalls 0
Assert-Equal $result.method 'sendinput'
Assert-Equal $script:GuardCalls 1
[WindowsComputerUseNative]::Reset();$script:GuardCalls=0;$script:SemanticCalls=0
$result=Invoke-Action 'click' ([pscustomobject]@{x=10;y=20;dispatch='foreground'})
Assert-Equal $script:SemanticCalls 0
Assert-Equal $result.method 'sendinput'
Assert-Equal $script:GuardCalls 1
[WindowsComputerUseNative]::Reset();$script:GuardCalls=0;$script:SemanticCalls=0
$result=Invoke-Action 'double_click' ([pscustomobject]@{x=10;y=20})
Assert-Equal $script:SemanticCalls 0
Assert-Equal $result.method 'sendinput'
Assert-Equal ([WindowsComputerUseNative]::Press) 2
Write-Output 'PASS native dictionaries, literal key escaping, all-format clipboard restore on success/failure, drag cleanup, scroll rejection, OCR wait verification and semantic coordinate clicks (fake APIs only)'
