# Input lease behavior is exercised across real processes in input-mutex.mjs.
# Exercise the shipped OCR action with deterministic words and fake UIA hit tests.
# No screen capture, physical input, or desktop changes.
param([string]$BackendPath = "$PSScriptRoot/../scripts/windows-uia.ps1")
function Enter-DesktopInput { return $null }
function Exit-DesktopInput { param($Lease) }
function Test-Failsafe { return $true }
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText($BackendPath, [Text.Encoding]::UTF8)
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Backend source did not parse.' }
foreach ($name in @('Get-Prop', 'Invoke-Safe', 'Get-OcrWordBounds', 'Find-OcrWordRun', 'Invoke-Action')) {
  $function = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
  if ($null -ne $function) { Invoke-Expression ($function.Extent.Text.Replace('System.Windows','Fixture')) }
}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
namespace Fixture {
  public struct Point {
    public double X, Y;
    public Point(double x, double y) { X = x; Y = y; }
  }
}
namespace Fixture.Automation {
  public class AutomationElement {
    public class Info {
      public string ControlType = "Button", Name = "Fixture Control";
      public string AutomationId = "fixture-control", ClassName = "FixtureButton";
      public object BoundingRectangle = null;
    }
    public Info Current = new Info();
    public static List<Fixture.Point> Hits = new List<Fixture.Point>();
    public static bool ThrowOnHit;
    public static AutomationElement FromPoint(Fixture.Point point) {
      Hits.Add(point);
      if (ThrowOnHit) throw new Exception("Simulated UIA failure");
      return new AutomationElement();
    }
  }
}
'@
function Has-WindowTarget { param($InputObject) return [bool]$InputObject.nativeWindowHandle }
function Get-ObservationWindow { return @{nativeWindowHandle=42} }
function Get-WindowResponsive { return $true }
function Update-WindowCache {}
function Update-WindowIdentity {}
function Set-WindowForeground { throw $script:ActivationFailure }
function Capture-Screenshot { param($WindowElement, $MaxWidth) $script:CaptureWidth = $MaxWidth; return $script:Shot }
function Invoke-Ocr { param($PngPath, $Language) $script:OcrLanguage = $Language; return $script:Ocr }
function Get-ControlTypeName { param($ControlType) return $ControlType }
function Convert-Rect { param($Rect) return @{x=1;y=2;width=3;height=4} }
function Assert-Equal { param($Actual, $Expected, [string]$Message)
  if ($Actual -ne $Expected) { throw "$Message (expected=$Expected, actual=$Actual)" }
}
function Assert-Box { param($Actual, [int]$X, [int]$Y, [int]$Width, [int]$Height)
  if ($null -eq $Actual) { throw 'Missing bounding box.' }
  Assert-Equal $Actual.x $X 'Box x'; Assert-Equal $Actual.y $Y 'Box y'
  Assert-Equal $Actual.width $Width 'Box width'; Assert-Equal $Actual.height $Height 'Box height'
}
function Words { param([string[]]$Text)
  $index=0
  foreach ($part in $Text) { @{text=$part;x=(10+20*$index);y=20;width=12;height=20}; $index++ }
}
function Run-Ocr { param([object[]]$Lines, [string]$Query)
  [Fixture.Automation.AutomationElement]::Hits.Clear()
  $script:Ocr = @{text='Fixture OCR'; lines=$Lines}
  $script:Shot = @{path='fixture.png'; bounds=@{x=100;y=200}; imageScale=0.5}
  return Invoke-Action -Action 'ocr' -InputObject ([pscustomobject]@{scope='desktop'; query=$Query; resolveControl=$true})
}

# Reproduce the issue through the actual action, including screen-coordinate mapping.
$lines = @(
  @{text='工 作 区';words=@(Words @('工','作','区'))},
  @{text='默 认 工 作 区';words=@(Words @('默','认','工','作','区'))}
)
$result = Run-Ocr $lines '工作区'
Assert-Equal $result.matched.Count 2 'CJK query must match both lines'
Assert-Equal $result.matched[0].control.automationId 'fixture-control' 'UIA upgrade'
Assert-Box $result.matched[0].boundingBox 120 240 104 40
Assert-Box $result.matched[1].boundingBox 200 240 104 40
Assert-Box $result.lines[1].boundingBox 120 240 184 40
Assert-Equal $result.matched[0].word.x 172 'First run center x'
Assert-Equal $result.matched[1].word.x 252 'Prefixed run center x'
Assert-Equal $result.matched[0].word.y 260 'Run center y'
Assert-Equal ([Fixture.Automation.AutomationElement]::Hits.Count) 2 'Hit-test count'
Assert-Equal ([Fixture.Automation.AutomationElement]::Hits[1].X) 252 'FromPoint must use full run center'
Write-Output 'PASS CJK query, prefix offsets, DPI scaling, union boxes and actual UIA upgrade path'

$cases = @(
  @{words=@('设','定'); query='设 定'; x=120; width=64},
  @{words=@('設','定'); query='設定'; x=120; width=64},
  @{words=@('작','업','공','간'); query='작업공간'; x=120; width=144},
  @{words=@('Settings'); query='settings'; x=120; width=24},
  @{words=@('Save','AS'); query="saVE`t as"; x=120; width=64},
  @{words=@('Settings','Window'); query='tings win'; x=120; width=64},
  @{words=@(" `t",'前缀',' 工 ',"作`t",'区'); query="工$([char]0xA0)作区"; x=200; width=104},
  @{words=@('A,B','C'); query='b c'; x=120; width=64}
)
foreach ($case in $cases) {
  $line = @{text=($case.words -join '   ');words=@(Words $case.words)}
  $result = Run-Ocr @($line) $case.query
  Assert-Equal $result.matched.Count 1 'Query case must match'
  Assert-Box $result.matched[0].boundingBox $case.x 240 $case.width 40
}
Write-Output 'PASS Chinese, Japanese, Korean, case folding, whitespace, partial-word and cross-word queries'

foreach ($query in @('不存在'," `t$([char]0xA0)",'区作')) {
  $result = Run-Ocr @($lines[0]) $query
  Assert-Equal $result.matched.Count 0 'Nonmatching/blank query'
  Assert-Equal ([Fixture.Automation.AutomationElement]::Hits.Count) 0 'No hit-test without a match'
}
$result = Run-Ocr @(@{text='A,B';words=@(Words @('A,B'))}) 'ab'
Assert-Equal $result.matched.Count 0 'Punctuation must remain significant'
$result = Run-Ocr @(@{text='工作区';words=@()}) '工作区'
Assert-Equal $result.matched.Count 0 'No fabricated geometry when words are absent'
$result = Run-Ocr @($lines[0]) ''
Assert-Equal $result.Contains('matched') $false 'Empty query preserves no-query response'
Assert-Box $result.lines[0].boundingBox 120 240 104 40
$result = Run-Ocr @() '工作区'
Assert-Equal $result.lines.Count 0 'Empty OCR output'
Assert-Equal $result.matched.Count 0 'Empty OCR matches'

$result = Run-Ocr @($lines[0],$lines[0],$lines[0],$lines[0]) '工作区'
Assert-Equal $result.matched.Count 3 'Existing match limit'
[Fixture.Automation.AutomationElement]::ThrowOnHit = $true
$result = Run-Ocr @($lines[0]) '工作区'
Assert-Equal $result.matched.Count 1 'OCR match survives UIA failure'
Assert-Equal ($null -eq $result.matched[0].control) $true 'Unavailable control stays null'
Assert-Box $result.matched[0].boundingBox 120 240 104 40
[Fixture.Automation.AutomationElement]::ThrowOnHit = $false
Write-Output 'PASS empty/absent/no-match output, match cap and UIA failure fallback'

# #82: a query returns the matching lines, not the whole transcript. Without a
# match, every line comes back with its text and box but no word boxes.
$other = @{text='其 他 文 字';words=@(Words @('其','他','文','字'))}
$result = Run-Ocr @($other,$lines[0],$other) '工作区'
Assert-Equal $result.lineCount 3 'Every recognized line is counted'
Assert-Equal $result.lines.Count 1 'Only the matching line comes back'
Assert-Equal $result.lines[0].text '工 作 区' 'The matching line'
Assert-Equal $result.lines[0].words.Count 3 'The matching line keeps its word boxes'
Assert-Equal $result.Contains('text') $false 'No full transcript with a query'
if ($result.note -notmatch 'without query') { throw 'Trimmed lines must say how to get everything' }
$result = Run-Ocr @($other,$lines[0]) '不存在'
Assert-Equal $result.lineCount 2 'A miss counts the lines'
Assert-Equal $result.lines.Count 2 'A miss returns every line'
Assert-Equal $result.lines[1].text '工 作 区' 'A miss keeps the line text'
Assert-Box $result.lines[1].boundingBox 120 240 104 40
Assert-Equal $result.lines[1].Contains('words') $false 'A miss leaves out word boxes'
if ($result.note -notmatch 'without query') { throw 'A miss must say how to get word boxes' }
$result = Run-Ocr @($other,$lines[0]) ''
Assert-Equal $result.text 'Fixture OCR' 'No query keeps the transcript'
Assert-Equal $result.lines[1].words.Count 3 'No query keeps every word box'
Assert-Equal $result.Contains('lineCount') $false 'No query adds no lineCount'
Write-Output 'PASS a query returns only the matching lines; a miss returns line texts and boxes without word boxes'

# #82: a minimized window draws only its title strip, so there is nothing to read.
$script:Ocr = @{text='Fixture OCR'; lines=@($lines[0])}
$script:Shot = @{path='fixture.png'; bounds=@{x=100;y=200}; imageScale=1; minimized=$true}
$threw = $false
try { $null = Invoke-Action -Action 'ocr' -InputObject ([pscustomobject]@{scope='desktop'}) }
catch { if ($_.Exception.Message -notmatch 'minimized') { throw }; $threw = $true }
Assert-Equal $threw $true 'OCR of a minimized window fails with the reason'
Write-Output 'PASS OCR of a minimized window fails and says to restore it'

# #75: the capture is read at full size unless maxWidth says otherwise, the
# requested language reaches the recognizer, and the result names both.
$script:Ocr = @{text='Fixture OCR'; lines=@($lines[0]); language='zh-Hans-CN'; readScale=2.5}
$script:Shot = @{path='fixture.png'; bounds=@{x=100;y=200}; imageScale=1}
$result = Invoke-Action -Action 'ocr' -InputObject ([pscustomobject]@{scope='desktop'})
Assert-Equal $script:CaptureWidth 0 'OCR captures at full size by default'
Assert-Equal $script:OcrLanguage '' 'No language means the Windows user languages'
Assert-Equal $result.language 'zh-Hans-CN' 'Result names the recognizer language'
Assert-Equal $result.ocrScale 2.5 'Result reports the read scale'
$result = Invoke-Action -Action 'ocr' -InputObject ([pscustomobject]@{scope='desktop'; maxWidth=1280; language='ja'})
Assert-Equal $script:CaptureWidth 1280 'An explicit maxWidth still shrinks the capture'
Assert-Equal $script:OcrLanguage 'ja' 'Requested language is passed to the recognizer'
Write-Output 'PASS full-size capture by default, requested language and reported language/scale'

$targeted = [pscustomobject]@{nativeWindowHandle=42;activate=$true}
foreach ($code in @('INPUT_TARGET_ACCESS_UNCONFIRMED','ELEVATED_TARGET_DENIED')) {
  $script:ActivationFailure = "${code}: Windows declined activation."
  $result = Invoke-Action -Action 'ocr' -InputObject $targeted
  Assert-Equal $result.ok $true 'OCR can still read without activation'
  if ($result.warning -notmatch ($code+'.+captured without activating')) { throw 'Missing activation warning' }
}
$script:ActivationFailure = 'HOST_INPUT_DENIED: protected host'
$threw = $false
try { $null = Invoke-Action -Action 'ocr' -InputObject $targeted }
catch { if ($_.Exception.Message -notmatch 'HOST_INPUT_DENIED') { throw }; $threw = $true }
Assert-Equal $threw $true 'Protected-host restrictions are not swallowed'
Write-Output 'PASS read-only OCR after a permission check fails; host restriction stays enforced'
