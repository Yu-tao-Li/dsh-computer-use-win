# Input lease behavior is exercised across real processes in input-mutex.mjs.
function Enter-DesktopInput { return $null }
function Exit-DesktopInput { param($Lease) }
# Shipped action bodies, deterministic native/clipboard APIs, no physical input.
$ErrorActionPreference='Stop'
$tokens=$null; $parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors | Out-String)}
foreach($name in @('Get-Prop','Get-ViewMode','Invoke-Safe','Test-TargetMatch','Get-ButtonFlags','Move-ToPoint','Type-Text','Convert-KeyChord','Get-OcrWordBounds','Find-OcrWordRun','Invoke-Action')) {
  $f=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  . ([scriptblock]::Create($f.Extent.Text.Replace('System.Windows.Forms','Fixture.Forms')))
}
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic;
public static class WindowsComputerUseNative {
 public static List<string> Chords=new List<string>();
 public static int FailChordAt;
 public static bool SendKeyChord(string[] keys){Chords.Add(String.Join("+",keys));if(FailChordAt==Chords.Count)throw new Exception("KEY_SEQUENCE_FAILURE");Fixture.Forms.SendKeys.SendWait(keys.Length==2&&keys[0]=="ctrl"?"^"+keys[1]:keys[keys.Length-1]);return true;}
 public struct POINT {public int x,y;}
 public const int MOUSEEVENTF_LEFTDOWN=2,MOUSEEVENTF_LEFTUP=4,MOUSEEVENTF_RIGHTDOWN=8,MOUSEEVENTF_RIGHTUP=16,MOUSEEVENTF_MIDDLEDOWN=32,MOUSEEVENTF_MIDDLEUP=64,MOUSEEVENTF_WHEEL=2048,MOUSEEVENTF_HWHEEL=4096;
 public static int Moves,FailMoveAt,Press,Release,Scroll; public static uint ScrollResult=1;
 public static IntPtr GetForegroundWindow(){return IntPtr.Zero;}
 public static IntPtr FocusedWindow(IntPtr hwnd){return IntPtr.Zero;}
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
 public static class SendKeys {public static bool Fail;public static string[] Pasted;public static void SendWait(string keys){if(keys=="^v"&&Clipboard.Data!=null)Pasted=Clipboard.Data.GetFormats(false);if(Fail)throw new Exception("PASTE_FAILURE");}}
}
'@
function Start-Sleep {param($Milliseconds)}
function Test-Failsafe {if($script:CancelSequence -and [WindowsComputerUseNative]::Chords.Count -gt 0){throw 'SEQUENCE_CANCELLED'};return $true}
function Begin-ClipboardLease {
  param($Text,$RestoreClipboard)
  $old=[Fixture.Forms.Clipboard]::Data
  $data=New-Object Fixture.Forms.DataObject
  $data.SetData('UnicodeText',$false,$Text)
  foreach($format in @('ExcludeClipboardContentFromMonitorProcessing','CanIncludeInClipboardHistory','CanUploadToCloudClipboard')){$data.SetData($format,$false,0)}
  [Fixture.Forms.Clipboard]::Data=$data
  $lease=[pscustomobject]@{IsCompleted=$true;Restored=$false;RestorationFailed=$false;Previous=$old;Restore=$RestoreClipboard}
  $lease|Add-Member ScriptMethod Complete {param($Timeout) if($this.Restore){[Fixture.Forms.Clipboard]::Data=$this.Previous;$this.Restored=$true};return $true}
  $lease|Add-Member ScriptMethod MarkPasteSent {param($Hwnd)}; $lease|Add-Member ScriptMethod Dispose {}
  $lease|Add-Member ScriptMethod TryPasteNative {param($Hwnd) return $false}
  return $lease
}
function Has-WindowTarget {param($InputObject) return -not [string]::IsNullOrWhiteSpace((Get-Prop $InputObject 'windowTitle' ''))}
function Activate-TargetIfRequested {param($InputObject)}
function Start-Input {param($InputObject,$Hwnd,[switch]$NoActivate) $script:GuardCalls++; return @{moved=$null}}
function Resolve-InputWindow {param($InputObject) $script:InputWindowVia='front window'; return 0}
function Get-KeyDestination {param($Hwnd,$Via) $script:DestinationReads++; return [ordered]@{nativeWindowHandle=$Hwnd;via=$Via}}
function Assert-InFront {param($State)}
function Complete-Input {param($State,$Result) $script:CompleteCalls++}
function Get-RootWindowAt {param($X,$Y) return 7}
function Get-ElementWindow {param($Element) return 0}
function Assert-PointOnTarget {param($X,$Y,$Target,$State)}
function Confirm-ElementPoint {param($Point)}
function Assert-InputAllowed {param($What)}
function Get-PointFromArgs {param($InputObject) return @{x=1;y=2;elementId=$null}}
function Get-ObservationWindow {param($InputObject,$Scope) return $null}
function Capture-Screenshot {param($WindowElement,$MaxWidth) return @{path='fake.png';bounds=@{x=0;y=0};imageScale=1;method='fixture';occludedPossible=$script:Occluded}}
function Invoke-Ocr {param($PngPath) return @{text='NEEDLE42';lines=@(@{text='NEEDLE42';words=@(@{text='NEEDLE42';x=10;y=20;width=100;height=20})})}}
function Get-NativeWindowList {param($IncludeInvisible,$MaxWindows,[switch]$RecordObservation,$IncludeMinimized) $script:ListedMinimized=$IncludeMinimized;$script:WindowListTruncated=$script:FixtureTruncated;$list=New-Object System.Collections.Generic.List[object];$list.Add([ordered]@{name='Fixture';nativeWindowHandle=42;processId=1;boundingBox=@{x=1;y=2};isOffscreen=$false});if($IncludeMinimized){$list.Add([ordered]@{id='uia:hwnd:43:pid:1';name='Parked';className='Fixture';nativeWindowHandle=43;processId=1;boundingBox=@{x=-32000;y=-32000};isOffscreen=$true;minimized=$true})};return ,$list}
function Get-TreeResult {param($Scope,$MaxDepth,$MaxNodes,$InputObject) return @{tree=@{};nodeCount=6;truncated=$script:Truncated;durationMs=1;treeTimeoutMs=100;targetResponsive=$true}}
function Search-Tree {param($Node,$Query,$ControlType,$MaxResults,$Results) if($script:ElementFound){$Results.Add(@{name=$Query})}}
function Assert-Equal {param($Actual,$Expected) if($Actual -ne $Expected){throw "Expected $Expected, actual $Actual"}}
function Expect-Error {param([scriptblock]$Body,[string]$Pattern) $hit=$false;try{& $Body}catch{$hit=$true;if($_.Exception.Message -notmatch $Pattern){throw}};if(-not $hit){throw 'Expected failure'}}
Assert-Equal (Get-Prop ([ordered]@{answer=42}) 'answer' 0) 42
foreach($key in @('+','^','%','~','(',')','{','}','[',']')){Assert-Equal (Convert-KeyChord @($key)) ('{'+$key+'}')}
Assert-Equal (Convert-KeyChord @('ctrl','+')) '^{+}'
Assert-Equal (Convert-KeyChord @('ctrl','a')) '^a'
Assert-Equal (Convert-KeyChord @('Enter')) '{ENTER}'
$sequenceArgs=[pscustomobject]@{keys=@('alt','h');thenKeys=@(@('o'),@('w'));intervalMs=0}
$script:GuardCalls=0;$script:CompleteCalls=0
[WindowsComputerUseNative]::Chords.Clear()
$script:DestinationReads=0
$sequenceResult=Invoke-Action 'keypress' $sequenceArgs
Assert-Equal ([WindowsComputerUseNative]::Chords -join ',') 'alt+h,o,w'
Assert-Equal $sequenceResult.chordsSent 3
# Where the keys went is part of the result (issue #82), read once per call.
Assert-Equal $sequenceResult.deliveredTo.via 'front window';Assert-Equal $script:DestinationReads 1
Assert-Equal $script:GuardCalls 1;Assert-Equal $script:CompleteCalls 1
[WindowsComputerUseNative]::Chords.Clear();[WindowsComputerUseNative]::FailChordAt=2
$script:GuardCalls=0;$script:CompleteCalls=0
Expect-Error {Invoke-Action 'keypress' $sequenceArgs} 'KEY_SEQUENCE_FAILURE'
Assert-Equal ([WindowsComputerUseNative]::Chords -join ',') 'alt+h,o'
Assert-Equal $script:GuardCalls 1;Assert-Equal $script:CompleteCalls 1
[WindowsComputerUseNative]::FailChordAt=0;[WindowsComputerUseNative]::Chords.Clear()
$script:CancelSequence=$true;$script:CompleteCalls=0
Expect-Error {Invoke-Action 'keypress' $sequenceArgs} 'SEQUENCE_CANCELLED'
Assert-Equal ([WindowsComputerUseNative]::Chords -join ',') 'alt+h'
Assert-Equal $script:CompleteCalls 1
$script:CancelSequence=$false;[WindowsComputerUseNative]::Chords.Clear()
foreach($fail in @($false,$true)){
  $original=New-Object Fixture.Forms.DataObject
  $original.SetData('Text',$false,'old');$original.SetData('Bitmap',$false,'image fixture');$original.SetData('FileDrop',$false,@('fixture.txt'))
  [Fixture.Forms.Clipboard]::Data=$original
  [Fixture.Forms.SendKeys]::Fail=$fail
  if($fail){Expect-Error {Type-Text 'new'} 'PASTE_FAILURE'}else{Type-Text 'new'}
  # The pasted text is kept out of clipboard history and cloud clipboard.
  foreach($format in @('UnicodeText','ExcludeClipboardContentFromMonitorProcessing','CanIncludeInClipboardHistory','CanUploadToCloudClipboard')){if([Fixture.Forms.SendKeys]::Pasted -notcontains $format){throw "Pasted data lacks $format"}}
  if($fail){Assert-Equal ([Fixture.Forms.Clipboard]::Data.GetData('UnicodeText',$false)) 'new'}
  else {
    Assert-Equal ([Fixture.Forms.Clipboard]::Data.GetData('Bitmap',$false)) 'image fixture'
    Assert-Equal ([Fixture.Forms.Clipboard]::Data.GetData('FileDrop',$false)[0]) 'fixture.txt'
    Assert-Equal ([Fixture.Forms.Clipboard]::Data.GetData('Text',$false)) 'old'
  }
}
[Fixture.Forms.SendKeys]::Fail=$false
$inputArgs=[pscustomobject]@{path=@(@{x=10;y=20},@{x=30;y=40})}
[WindowsComputerUseNative]::Reset(); $script:GuardCalls=0; $script:CompleteCalls=0
[WindowsComputerUseNative]::FailMoveAt=2
Expect-Error {Invoke-Action 'drag' $inputArgs} 'COMPUTER_USE_INPUT_UNAVAILABLE'
# A failed drag still releases the button and gives the pointer and foreground back.
Assert-Equal ([WindowsComputerUseNative]::Press) 1;Assert-Equal ([WindowsComputerUseNative]::Release) 1;Assert-Equal $script:GuardCalls 1;Assert-Equal $script:CompleteCalls 1
[WindowsComputerUseNative]::Reset()
[WindowsComputerUseNative]::ScrollResult=0
Expect-Error {Invoke-Action 'scroll' ([pscustomobject]@{})} 'Windows rejected scroll input'
Assert-Equal $script:CompleteCalls 2
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
# Issue #82: list_windows lists minimized windows without their parking box, and
# says when maxWindows left windows out; batch's internal call can opt out.
$script:FixtureTruncated=$true
$listing=Invoke-Action 'list_windows' ([pscustomobject]@{})
Assert-Equal $script:ListedMinimized $true;Assert-Equal $listing.windows.Count 2;Assert-Equal $listing.truncated $true
Assert-Equal $listing.windows[1].minimized $true;Assert-Equal $listing.windows[1].isOffscreen $true;Assert-Equal $listing.windows[1].Contains('boundingBox') $false
Assert-Equal $listing.windows[0].Contains('boundingBox') $true
$script:FixtureTruncated=$false
$listing=Invoke-Action 'list_windows' ([pscustomobject]@{includeMinimized=$false})
Assert-Equal $script:ListedMinimized $false;Assert-Equal $listing.windows.Count 1;Assert-Equal $listing.Contains('truncated') $false
function Get-PointFromArgs {param($InputObject) return @{x=1;y=2;elementId='uia:fixture';element=[pscustomobject]@{Current=[pscustomobject]@{NativeWindowHandle=0}}}}
function Invoke-ElementPattern {param($Element) return $null}
function Get-ElementWindow {param($Element) return 42}
function Resolve-TargetHwnd {param($InputObject) throw 'Unexpected foreground fallback'}
function Assert-InputAllowed {param($What) if($script:WcuQuiet){throw 'WCU_NEEDS_INPUT'}}
function Post-BackgroundClick {param($Hwnd,$X,$Y,$Button,$Count) $script:PostedHwnd=$Hwnd;return $true}
function Click-At {param($X,$Y,$Button,$Count) $script:RealClicks++}
$script:RealClicks=0;$script:PostedHwnd=0;$script:WcuQuiet=$true
Expect-Error {Invoke-Action 'click' ([pscustomobject]@{elementId='uia:fixture';_wcuQuiet=$true})} 'WCU_NEEDS_INPUT'
Assert-Equal $script:RealClicks 0;Assert-Equal $script:PostedHwnd 0
$script:WcuQuiet=$false
Assert-Equal (Invoke-Action 'click' ([pscustomobject]@{elementId='uia:fixture'})).method 'sendinput'
Assert-Equal $script:RealClicks 1
Assert-Equal (Invoke-Action 'click' ([pscustomobject]@{elementId='uia:fixture';dispatch='background'})).method 'postmessage'
Assert-Equal $script:PostedHwnd 42
Write-Output 'PASS native dictionaries, keys, clipboard, drag cleanup, OCR verification, quiet click upgrade and explicit background owning HWND (fake APIs only)'
