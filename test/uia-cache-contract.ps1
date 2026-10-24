# Exercise shipped observation code against an instrumented provider. No desktop input.
param([string]$BackendPath = "$PSScriptRoot/../scripts/windows-uia.ps1", [switch]$Legacy)
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText($BackendPath, [Text.Encoding]::UTF8)
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Threading;
namespace Fixture {
  public struct Rect { public double X,Y,Width,Height; public bool IsEmpty {get {return false;}} }
}
namespace Fixture.Automation {
  public class AutomationProperty { public string Name; public AutomationProperty(string n) {Name=n;} }
  public class AutomationPattern { public string Name; public AutomationPattern(string n) {Name=n;} }
  public enum TreeScope {Element=1, Children=2, Descendants=4, Subtree=7}
  public enum AutomationElementMode {Full, None}
  public class Condition { public static Condition TrueCondition = new Condition(); }
  public class Automation { public static Condition RawViewCondition = new Condition(); public static Condition ControlViewCondition = new Condition(); public static Condition ContentViewCondition = new Condition(); }
  public class PropertyCondition : Condition { public PropertyCondition(AutomationProperty p, object v) {} }
  public class AndCondition : Condition { public AndCondition(Condition a, Condition b) {} }
  public class ControlType { public string ProgrammaticName="ControlType.Button"; }
  public class CacheRequest {
    public TreeScope TreeScope; public Condition TreeFilter; public AutomationElementMode AutomationElementMode;
    public List<string> Properties = new List<string>(); public List<string> Patterns = new List<string>();
    public void Add(AutomationProperty p) {Properties.Add(p.Name);} public void Add(AutomationPattern p) {Patterns.Add(p.Name);}
  }
  public class InvokePattern { public static AutomationPattern Pattern = new AutomationPattern("Invoke"); }
  public class TogglePattern { public static AutomationPattern Pattern = new AutomationPattern("Toggle"); }
  public class SelectionItemPattern { public static AutomationPattern Pattern = new AutomationPattern("SelectionItem"); }
  public class ExpandCollapsePattern { public static AutomationPattern Pattern = new AutomationPattern("ExpandCollapse"); }
  public class ScrollItemPattern { public static AutomationPattern Pattern = new AutomationPattern("ScrollItem"); }
  public class ValuePattern {
    public static AutomationPattern Pattern = new AutomationPattern("Value");
    public static AutomationProperty ValueProperty = new AutomationProperty("Value");
    public class Info { public string Value="cached value"; }
    public Info Cached = new Info(); public Info Current = new Info();
  }
  public class AutomationElement {
    public class Info {
      public string Name="Fixture node", AutomationId="fixture", ClassName="Fixture", LocalizedControlType="button", FrameworkId="Fixture";
      public ControlType ControlType=new ControlType(); public int ProcessId=4242, NativeWindowHandle=42;
      public bool IsEnabled=true, IsOffscreen=false, HasKeyboardFocus=false;
      public Fixture.Rect BoundingRectangle=new Fixture.Rect {X=1,Y=2,Width=30,Height=40};
    }
    public static int CurrentReads, RuntimeCalls, FindCalls, CacheBuilds, FirstCalls, SiblingCalls, DelayMs, FailAtNavigation;
    public static bool FailCache;
    public static void Reset() {CurrentReads=RuntimeCalls=FindCalls=CacheBuilds=FirstCalls=SiblingCalls=DelayMs=FailAtNavigation=0; FailCache=false;}
    public Info Current {get {CurrentReads++; return Cached;}} public Info Cached=new Info();
    public int Key; public CacheRequest Request; public AutomationElement Parent;
    public List<AutomationElement> Children=new List<AutomationElement>();
    public AutomationElement(int key=1) {Key=key;}
    public void Add(AutomationElement child) {child.Parent=this; Children.Add(child);}
    public int[] GetRuntimeId() {RuntimeCalls++; return new[] {42,Key};}
    public object GetCachedPropertyValue(AutomationProperty p) {return new[] {42,Key};}
    public AutomationElement GetUpdatedCache(CacheRequest request) {
      CacheBuilds++; if (FailCache) throw new Exception("provider unavailable"); Request=request; return this;
    }
    public object GetCachedPattern(AutomationPattern p) {
      if (Request==null || !Request.Patterns.Contains(p.Name)) throw new Exception("pattern not cached");
      if (p.Name=="Value") return new ValuePattern(); if (p.Name=="Invoke") return new InvokePattern(); throw new Exception("unsupported");
    }
    public bool TryGetCurrentPattern(AutomationPattern p, out object pattern) {CurrentReads++; pattern=null; return false;}
    public List<AutomationElement> FindAll(TreeScope scope, Condition condition) {FindCalls++; return Children;}
    public static AutomationProperty NameProperty=new AutomationProperty("Name"), AutomationIdProperty=new AutomationProperty("AutomationId"), ClassNameProperty=new AutomationProperty("ClassName"), ControlTypeProperty=new AutomationProperty("ControlType"), BoundingRectangleProperty=new AutomationProperty("BoundingRectangle"), IsEnabledProperty=new AutomationProperty("IsEnabled"), IsOffscreenProperty=new AutomationProperty("IsOffscreen"), HasKeyboardFocusProperty=new AutomationProperty("HasKeyboardFocus"), ProcessIdProperty=new AutomationProperty("ProcessId"), NativeWindowHandleProperty=new AutomationProperty("NativeWindowHandle"), RuntimeIdProperty=new AutomationProperty("RuntimeId"), LocalizedControlTypeProperty=new AutomationProperty("LocalizedControlType"), FrameworkIdProperty=new AutomationProperty("FrameworkId");
  }
  public class TreeWalker {
    public TreeWalker(Condition c) {}
    static void Step() {
      if (AutomationElement.DelayMs>0) Thread.Sleep(AutomationElement.DelayMs);
      if (AutomationElement.FailAtNavigation>0 && AutomationElement.FirstCalls+AutomationElement.SiblingCalls>=AutomationElement.FailAtNavigation) throw new Exception("provider navigation failed");
    }
    public AutomationElement GetFirstChild(AutomationElement e, CacheRequest c) {AutomationElement.FirstCalls++; Step(); return e.Children.Count==0?null:e.Children[0].GetUpdatedCache(c);}
    public AutomationElement GetNextSibling(AutomationElement e, CacheRequest c) {AutomationElement.SiblingCalls++; Step(); int i=e.Parent.Children.IndexOf(e)+1; return i>=e.Parent.Children.Count?null:e.Parent.Children[i].GetUpdatedCache(c);}
  }
}
// Native surface used by the Chromium page warm-up; no real windows involved.
public static class WindowsComputerUseNative {
  public static IntPtr[] Renderers = new IntPtr[0];
  public static HashSet<long> Hung = new HashSet<long>(), Gone = new HashSet<long>();
  public static IntPtr[] ChromiumRenderers(IntPtr window, int max) {return Renderers;}
  public static bool IsWindow(IntPtr hwnd) {return !Gone.Contains(hwnd.ToInt64());}
  public static bool IsResponsive(IntPtr hwnd) {return !Hung.Contains(hwnd.ToInt64());}
  public static uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId) {processId=4242; return 1;}
}
'@
$names = @('Get-Prop','Get-ViewMode','Get-DetailLevel','Get-ViewCondition','Invoke-Safe','Convert-Rect','Get-ControlTypeName','Get-Patterns','Get-ValueText','New-ElementCacheRequest','Convert-ElementInfo','Test-TreeBudget','Get-Children','Convert-Tree','Element-Matches','Search-Tree','Initialize-ChromiumPages','Get-TreeResult','Invoke-Action')
foreach ($name in $names) {
  $definition = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
  if ($null -ne $definition) { . ([scriptblock]::Create($definition.Extent.Text.Replace('System.Windows','Fixture'))) }
}
function Get-ScopeRoot {param($Scope,$InputObject) return $script:Root}
function Update-WindowCache {param($Element)}
function Update-WindowIdentity {param($InputObject,$Target)}
function Get-ObservationWindow {param($InputObject,$Scope) return @{nativeWindowHandle=42;name='Fixture window';className='Fixture';processId=4242;boundingBox=@{x=1;y=2;width=30;height=40};source='win32'}}
function Get-WindowResponsive {param($Window) return $script:Responsive}
function Has-WindowTarget {param($InputObject) return $true}
function Resolve-TargetWindow {param($InputObject) $script:Resolutions++; return $script:Root}
function Resolve-Element {param($ElementId,$InputObject) return $script:Root}
function Set-WindowForeground {param($Element) return $script:Activated}
function Test-Failsafe { return $true }
function Get-NativeWindowList {param([bool]$IncludeInvisible,[int]$MaxWindows) return ,@()}
# Renderer page probe: ready from the Nth probe of a renderer listed in PageReadyAt.
$script:ChromiumPages=@{}; $script:PageProbes=0; $script:PageReadyAt=@{}; $script:PageRefuses=@()
function Test-ChromiumPage {param([IntPtr]$Renderer) $script:PageProbes++; $key=[string]$Renderer.ToInt64(); if ($script:PageRefuses -contains $key) {throw 'Access is denied.'}; $at=$script:PageReadyAt[$key]; return ($null -ne $at -and $script:PageProbes -ge $at)}
function Assert-Equal {param($Actual,$Expected,[string]$Label) if ($Actual -ne $Expected) {throw "${Label}: expected=$Expected actual=$Actual"}}
function Reset-Fixture {
  [Fixture.Automation.AutomationElement]::Reset()
  $script:Root = New-Object Fixture.Automation.AutomationElement 1
  $script:Responsive=$true; $script:Activated=$false; $script:Resolutions=0
}
Reset-Fixture
for ($i=2;$i -le 1002;$i++) { $script:Root.Add((New-Object Fixture.Automation.AutomationElement $i)) }
if ($Legacy) {
  $count=0
  $null=Convert-Tree -Element $script:Root -Path active -Depth 0 -MaxDepth 1 -Count ([ref]$count) -MaxNodes 10
  [ordered]@{nodeCount=$count;currentPropertyReads=[Fixture.Automation.AutomationElement]::CurrentReads;runtimeIdCalls=[Fixture.Automation.AutomationElement]::RuntimeCalls;findAllCalls=[Fixture.Automation.AutomationElement]::FindCalls} | ConvertTo-Json -Compress
  exit
}
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{})
Assert-Equal $result.nodeCount 10 'Wide tree node cap'
Assert-Equal $result.truncationReason maxNodes 'Node truncation reason'
Assert-Equal ([Fixture.Automation.AutomationElement]::CacheBuilds) 10 'No cache built beyond node cap'
Assert-Equal ([Fixture.Automation.AutomationElement]::CurrentReads) 0 'No live property/pattern reads'
Assert-Equal ([Fixture.Automation.AutomationElement]::RuntimeCalls) 0 'Cached RuntimeId'
Assert-Equal ([Fixture.Automation.AutomationElement]::FindCalls) 0 'No eager sibling/subtree FindAll'
Assert-Equal $result.tree.children[0].id 'uia:rt:42-2' 'Stable runtime ids'
Assert-Equal $script:Root.Request.TreeScope Element 'Cache only one element'
Assert-Equal $script:Root.Request.Patterns.Count 0 'Compact requests no patterns'
Reset-Fixture
$child=New-Object Fixture.Automation.AutomationElement 2
$child.Add((New-Object Fixture.Automation.AutomationElement 3));$script:Root.Add($child)
$result=Get-TreeResult active_window 0 100 ([pscustomobject]@{})
Assert-Equal $result.nodeCount 1 'Depth zero only root'
Assert-Equal ([Fixture.Automation.AutomationElement]::FirstCalls) 0 'No navigation beyond depth cap'
$result=Get-TreeResult active_window 3 100 ([pscustomobject]@{detailLevel='full'})
Assert-Equal $result.nodeCount 3 'Deep tree traversal'
Assert-Equal $result.tree.value 'cached value' 'Full cached value'
Assert-Equal ($result.tree.patterns -join ',') 'Invoke,Value' 'Full supported cached patterns'
Assert-Equal $script:Root.Request.Patterns.Count 6 'Full batches patterns'
Assert-Equal ([Fixture.Automation.AutomationElement]::CurrentReads) 0 'Full has no live reads'
Reset-Fixture
$script:Root.Add((New-Object Fixture.Automation.AutomationElement 2))
[Fixture.Automation.AutomationElement]::DelayMs=150
$result=Get-TreeResult active_window 3 100 ([pscustomobject]@{treeTimeoutMs=100})
Assert-Equal $result.truncationReason timeBudget 'Slow provider partial tree'
Assert-Equal $result.nodeCount 1 'No node read after deadline'
Assert-Equal ([Fixture.Automation.AutomationElement]::SiblingCalls) 0 'No sibling fetched after deadline'
if (-not $result.warning) {throw 'Time budget needs warning'}
Reset-Fixture
$script:Responsive=$false
$result=Get-TreeResult active_window 3 100 ([pscustomobject]@{})
Assert-Equal $result.truncationReason targetUnresponsive 'Hung window rejected'
Assert-Equal ([Fixture.Automation.AutomationElement]::CacheBuilds) 0 'Hung window never enters UIA'
$result=Invoke-Action activate_window ([pscustomobject]@{nativeWindowHandle=42})
Assert-Equal $result.activated $false 'Hung window activation skipped'
Assert-Equal $result.targetResponsive $false 'Hung window diagnostic'
Assert-Equal $script:Resolutions 0 'Activation does not resolve hung UIA provider'
if (-not $result.warning -or -not $result.window.name -or -not $result.window.boundingBox) {throw 'Refusal needs warning and usable native metadata'}
Reset-Fixture
$result=Invoke-Action activate_window ([pscustomobject]@{nativeWindowHandle=42})
Assert-Equal $result.activated $false 'Foreground lock refusal'
Assert-Equal $result.targetResponsive $true 'Healthy refusal diagnostic'
if ($result.warning -notmatch 'foreground lock') {throw 'Missing foreground lock warning'}
$script:Activated=$true
$result=Invoke-Action activate_window ([pscustomobject]@{nativeWindowHandle=42})
Assert-Equal $result.activated $true 'Activation success'
if ($result.warning) {throw 'Successful activation should not warn'}
Reset-Fixture
$result=Invoke-Action element_info ([pscustomobject]@{elementId='uia:active'})
Assert-Equal $result.element.Contains('patterns') $false 'element_info defaults compact'
$result=Invoke-Action element_info ([pscustomobject]@{elementId='uia:active';detailLevel='full'})
Assert-Equal $result.element.value 'cached value' 'element_info explicit full'
Reset-Fixture
[Fixture.Automation.AutomationElement]::FailCache=$true
$result=Get-TreeResult active_window 3 100 ([pscustomobject]@{})
Assert-Equal $result.truncationReason providerError 'Root provider failure disclosed'
if (-not $result.providerError) {throw 'Missing provider error'}
Reset-Fixture
$script:Root.Add((New-Object Fixture.Automation.AutomationElement 2))
[Fixture.Automation.AutomationElement]::FailAtNavigation=2
$result=Get-TreeResult active_window 3 100 ([pscustomobject]@{})
Assert-Equal $result.truncationReason providerError 'Navigation provider failure disclosed'
Assert-Equal $result.nodeCount 2 'Provider failure preserves already read nodes'
[Fixture.Automation.AutomationElement]::FirstCalls=0
[Fixture.Automation.AutomationElement]::SiblingCalls=0
$result=Invoke-Action find ([pscustomobject]@{query='cached value';treeTimeoutMs=1000})
Assert-Equal $result.results.Count 2 'Find still matches cached value text'
Assert-Equal $result.treeTimeoutMs 1000 'Find forwards budget'
if (-not $result.warning) {throw 'Find must forward partial-tree warning'}
# Unnamed Chromium layout panes do not use up maxDepth; named or non-Chrome panes do.
function New-Node {param([int]$Key,[string]$Type,[string]$Name,[string]$Framework)
  $node=New-Object Fixture.Automation.AutomationElement $Key
  $node.Cached.ControlType=New-Object Fixture.Automation.ControlType; $node.Cached.ControlType.ProgrammaticName="ControlType.$Type"
  $node.Cached.Name=$Name; $node.Cached.FrameworkId=$Framework; return $node}
function Find-Node {param($Node,[string]$Name) if ($null -eq $Node) {return $null}; if ($Node.name -eq $Name) {return $Node}; foreach ($child in @($Node.children)) {$hit=Find-Node $child $Name; if ($null -ne $hit) {return $hit}}; return $null}
function New-PaneChain {param([int]$Length,[string]$Name='',[string]$Framework='Chrome')
  Reset-Fixture; $parent=$script:Root
  for ($i=0;$i -lt $Length;$i++) {$pane=New-Node (2+$i) Pane $Name $Framework; $parent.Add($pane); $parent=$pane}
  $button=New-Node 500 Button 'Page action' Chrome; $parent.Add($button); $button.Add((New-Node 501 Text 'Page label' Chrome))}
New-PaneChain 7
$result=Get-TreeResult active_window 1 100 ([pscustomobject]@{})
Assert-Equal $result.nodeCount 9 'Layout panes do not use depth'
Assert-Equal (Find-Node $result.tree 'Page action').depth 8 'Reported depth stays structural'
Assert-Equal (Find-Node $result.tree 'Page label') $null 'Content levels still use depth'
Assert-Equal (Get-TreeResult active_window 2 100 ([pscustomobject]@{})).nodeCount 10 'Next content level'
Assert-Equal ([Fixture.Automation.AutomationElement]::CurrentReads) 0 'Layout check reads cached properties'
New-PaneChain 7 'Named pane'
Assert-Equal (Get-TreeResult active_window 1 100 ([pscustomobject]@{})).nodeCount 2 'Named panes use depth'
New-PaneChain 7 '' 'Win32'
Assert-Equal (Get-TreeResult active_window 1 100 ([pscustomobject]@{})).nodeCount 2 'Non-Chromium panes use depth'
New-PaneChain 30
Assert-Equal (Get-TreeResult active_window 2 100 ([pscustomobject]@{})).nodeCount 19 'Layout recursion bounded at maxDepth+16'
New-PaneChain 7
Assert-Equal (Get-TreeResult desktop 1 100 ([pscustomobject]@{})).nodeCount 2 'Desktop trees keep layout panes in maxDepth'
# Chromium page warm-up: probe each visible renderer, wait briefly, retry later.
Reset-Fixture
[WindowsComputerUseNative]::Renderers=@([IntPtr]101); $script:PageReadyAt=@{'101'=1}; $script:PageProbes=0
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{})
Assert-Equal $result.webContent.state ready 'Page tree present on first probe'
Assert-Equal $script:PageProbes 1 'Ready renderer probed once'
if ($result.webContent.waitedMs -gt 40) {throw 'Ready page must not wait'}
[WindowsComputerUseNative]::Renderers=@([IntPtr]102); $script:PageReadyAt=@{'102'=3}; $script:PageProbes=0
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{})
Assert-Equal $result.webContent.ready 1 'Late page tree awaited'
Assert-Equal $script:PageProbes 3 'Probes until the page tree arrives'
if ($result.webContent.waitedMs -lt 90) {throw "Probes must be spaced: $($result.webContent.waitedMs)"}
[WindowsComputerUseNative]::Renderers=@([IntPtr]103); $script:PageReadyAt=@{}
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{})
Assert-Equal $result.webContent.state starting 'Empty renderer still starting'
if ($result.webContent.waitedMs -lt 1450 -or $result.webContent.waitedMs -gt 1750) {throw "One call waits at most 1.5 s: $($result.webContent.waitedMs)"}
Assert-Equal $result.nodeCount 1 'Tree still returned after the wait'
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{treeTimeoutMs=400})
if ($result.webContent.waitedMs -gt 300) {throw "Wait limited to half the budget: $($result.webContent.waitedMs)"}
$script:ChromiumPages['103'].firstSeen-=31000; $probes=$script:PageProbes
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{})
Assert-Equal $result.webContent.state unavailable 'Warm-up period ends after 30 s'
Assert-Equal ($script:PageProbes-$probes) 1 'Expired renderer probed once without waiting'
if ($result.webContent.waitedMs -gt 40) {throw 'Expired renderer must not wait'}
$script:ChromiumPages['103'].ready=$true
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{treeTimeoutMs=400})
Assert-Equal $result.webContent.state starting 'A lost page tree starts a new warm-up period'
[void][WindowsComputerUseNative]::Hung.Add(104); [WindowsComputerUseNative]::Renderers=@([IntPtr]104); $probes=$script:PageProbes
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{})
Assert-Equal ($script:PageProbes-$probes) 0 'Hung renderer never entered'
Assert-Equal $result.webContent.unresponsive 1 'Hung renderer reported'
Assert-Equal $result.webContent.state unavailable 'Hung renderer has no page tree'
[WindowsComputerUseNative]::Renderers=@([IntPtr]105); $script:PageRefuses=@('105'); $probes=$script:PageProbes
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{})
Assert-Equal ($script:PageProbes-$probes) 1 'Refused renderer probed once'
Assert-Equal $result.webContent.state unavailable 'Refused renderer is not awaited'
if ($result.webContent.waitedMs -gt 40) {throw 'Refused renderer must not wait'}
$script:PageRefuses=@()
[WindowsComputerUseNative]::Renderers=@([IntPtr]101,[IntPtr]103); $script:PageReadyAt=@{'101'=1}; $script:PageProbes=0
$result=Get-TreeResult active_window 1 10 ([pscustomobject]@{treeTimeoutMs=400})
Assert-Equal $result.webContent.state partial 'One of two pages ready'
[void][WindowsComputerUseNative]::Gone.Add(101); [WindowsComputerUseNative]::Renderers=@([IntPtr]103)
[void](Get-TreeResult active_window 1 10 ([pscustomobject]@{treeTimeoutMs=400}))
Assert-Equal $script:ChromiumPages.ContainsKey('101') $false 'Closed renderers are forgotten'
$probes=$script:PageProbes
$result=Get-TreeResult desktop 1 10 ([pscustomobject]@{})
Assert-Equal ($script:PageProbes-$probes) 0 'Desktop scope does not warm pages'
Assert-Equal $result.Contains('webContent') $false 'Desktop scope reports no page state'
$result=Invoke-Action find ([pscustomobject]@{query='Fixture';treeTimeoutMs=400})
Assert-Equal $result.webContent.renderers 1 'Find forwards page state'
[WindowsComputerUseNative]::Renderers=@()
Assert-Equal (Get-TreeResult active_window 1 10 ([pscustomobject]@{})).Contains('webContent') $false 'Windows without renderers report no page state'
Write-Output 'PASS cached compact/full, stable ids, lazy wide/deep limits, Chromium layout depth, bounded page warm-up, partial deadlines, provider errors, value search, activation refusal/success/hung diagnostics and element_info detail contract'
