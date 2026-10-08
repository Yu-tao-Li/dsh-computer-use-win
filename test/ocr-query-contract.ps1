# Exercise the shipped OCR action with deterministic words and fake UIA hit tests.
# No screen capture, physical input, or desktop changes.
param([string]$BackendPath = "$PSScriptRoot/../scripts/windows-uia.ps1")
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText($BackendPath, [Text.Encoding]::UTF8)
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Backend source did not parse.' }
foreach ($name in @('Get-Prop', 'Invoke-Safe', 'Get-OcrWordBounds', 'Find-OcrWordRun', 'Invoke-Action')) {
  $function = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
  if ($null -ne $function) { Invoke-Expression $function.Extent.Text }
}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
namespace System.Windows {
  public struct Point {
    public double X, Y;
    public Point(double x, double y) { X = x; Y = y; }
  }
}
namespace System.Windows.Automation {
  public class AutomationElement {
    public class Info {
      public string ControlType = "Button", Name = "Fixture Control";
      public string AutomationId = "fixture-control", ClassName = "FixtureButton";
      public object BoundingRectangle = null;
    }
    public Info Current = new Info();
    public static List<System.Windows.Point> Hits = new List<System.Windows.Point>();
    public static bool ThrowOnHit;
    public static AutomationElement FromPoint(System.Windows.Point point) {
      Hits.Add(point);
      if (ThrowOnHit) throw new Exception("Simulated UIA failure");
      return new AutomationElement();
    }
  }
}
'@
function Has-WindowTarget { param($InputObject) return $false }
function Capture-Screenshot { param($WindowElement, $MaxWidth) return $script:Shot }
function Invoke-Ocr { param($PngPath) return $script:Ocr }
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
  [System.Windows.Automation.AutomationElement]::Hits.Clear()
  $script:Ocr = @{text='Fixture OCR'; lines=$Lines}
  $script:Shot = @{path='fixture.png'; bounds=@{x=100;y=200}; imageScale=0.5}
  return Invoke-Action -Action 'ocr' -InputObject ([pscustomobject]@{scope='desktop'; query=$Query})
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
Assert-Equal ([System.Windows.Automation.AutomationElement]::Hits.Count) 2 'Hit-test count'
Assert-Equal ([System.Windows.Automation.AutomationElement]::Hits[1].X) 252 'FromPoint must use full run center'
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
  Assert-Equal ([System.Windows.Automation.AutomationElement]::Hits.Count) 0 'No hit-test without a match'
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
[System.Windows.Automation.AutomationElement]::ThrowOnHit = $true
$result = Run-Ocr @($lines[0]) '工作区'
Assert-Equal $result.matched.Count 1 'OCR match survives UIA failure'
Assert-Equal ($null -eq $result.matched[0].control) $true 'Unavailable control stays null'
Assert-Box $result.matched[0].boundingBox 120 240 104 40
[System.Windows.Automation.AutomationElement]::ThrowOnHit = $false
Write-Output 'PASS empty/absent/no-match output, match cap and UIA failure fallback'
