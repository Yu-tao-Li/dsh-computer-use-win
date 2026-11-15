# Inspect real native packets without calling SendInput or changing key state.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Backend source does not parse'}
$definition=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$script:WcuCs'},$true)
Invoke-Expression $definition.Extent.Text
Add-Type -TypeDefinition $script:WcuCs
function Check {param($Condition,$Message) if(-not $Condition){throw $Message}}
$packet=[WindowsComputerUseNative]::KeyChordPacket(@('ctrl','a'),0)
Check ($packet.Count -eq 4) 'Ctrl+A packet length'
Check (($packet | ForEach-Object {$_.U.ki.wVk}) -join ',' -eq '17,65,65,17') 'Ctrl+A ordering'
Check (($packet | ForEach-Object {$_.U.ki.dwFlags -band 2}) -join ',' -eq '0,0,2,2') 'Balanced key down/up'
foreach($event in $packet){Check ($event.U.ki.dwExtraInfo.ToInt64() -eq 0x44534857) 'Own input must carry marker'}
$held=[WindowsComputerUseNative]::KeyChordPacket(@('ctrl','a'),2)
Check ($held.Count -eq 2) 'User-held Ctrl must not be pressed or released by the agent'
foreach($keys in @(@('esc'),@('enter'),@('F24'),@('pageup'),@('ctrl','alt','delete'))){
  $packet=[WindowsComputerUseNative]::KeyChordPacket($keys,0)
  Check (($packet.Count % 2) -eq 0) 'Balanced named-key packet'
  foreach($event in $packet){Check ($event.U.ki.dwExtraInfo.ToInt64() -eq 0x44534857) 'Named-key marker'}
}
$refused=$false;try{[void][WindowsComputerUseNative]::KeyChordPacket(@('esc'),2)}catch{$refused=$_.Exception.Message -match 'COMPUTER_USE_MODIFIERS_HELD'}
Check $refused 'Unexpected user-held modifier must reject input'
Write-Output 'PASS tagged chord packets, ordering, balanced releases, named keys and user-held modifier preservation; no physical input'
