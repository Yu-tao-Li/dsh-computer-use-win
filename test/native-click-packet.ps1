# Compile the shipped C# but inspect packets only. Never calls SendInput.
$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[Text.Encoding]::UTF8)
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Backend does not parse'}
$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$script:WcuCs'},$true)
$code=$assignment.Right.Expression.Value
Add-Type -TypeDefinition $code
$checks=0
foreach($screen in @(@(0,0,1920,1080),@(-2560,-1440,6400,2880),@(100,-500,5120,2160),@(0,0,1,1),@(0,0,65536,65536))){
 $left,$top,$width,$height=$screen
 foreach($point in @(@($left,$top),@(($left+$width-1),($top+$height-1)),@(($left+[int][Math]::Floor($width/2)),($top+[int][Math]::Floor($height/2))))){
  $packet=[WindowsComputerUseNative]::ClickPacket($point[0],$point[1],$left,$top,$width,$height,2,4)
  if($packet.Length -ne 3 -or $packet[0].U.mi.dwFlags -ne 49153 -or $packet[1].U.mi.dwFlags -ne 2 -or $packet[2].U.mi.dwFlags -ne 4){throw 'Packet must atomically position, press, release on the virtual desktop'}
  $actualX=[int][Math]::Floor([double]$packet[0].U.mi.dx*$width/65536)+$left
  $actualY=[int][Math]::Floor([double]$packet[0].U.mi.dy*$height/65536)+$top
  if($actualX -ne $point[0] -or $actualY -ne $point[1]){throw 'Absolute mapping did not recover the exact pixel'}
  $checks++
 }
}
$rejected=$false;try{[void][WindowsComputerUseNative]::ClickPacket(-1,0,0,0,1920,1080,2,4)}catch{$rejected=$true}
if(-not $rejected){throw 'An out-of-screen point must be rejected'}
Write-Output ('PASS shipped atomic click packets: '+$checks+' exact pixel mappings, negative virtual origins, virtual-desktop flag and edge validation; no physical input')
