# Low disruption's hold and guard decisions (WcuInputHold.Core), what a replay
# sends, the user state the server reads, and a hook pair installed and
# removed. No keyboard or mouse input is sent.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Backend source does not parse'}
$definition=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$script:WcuCs'},$true)
Invoke-Expression $definition.Extent.Text
Add-Type -TypeDefinition $script:WcuCs
function Check {param($Condition,$Message) if(-not $Condition){throw $Message}}
$own=[uint64][WindowsComputerUseNative]::InputMarker
$replay=[uint64][WcuInputHold]::ReplayMarker
Check ($replay -ne $own) 'The replay marker differs from DSH''s own'

# Holding: the user's keys are held in order; DSH's own and replayed input pass.
$core=New-Object WcuInputHold+Core
$core.Reset(100,200); $core.State=[WcuInputHold]::Holding
Check (-not $core.Key(0x41,0x1E,0x10,$own,$false,$false,$false,$false)) 'DSH''s own key passes'
Check (-not $core.Key(0x41,0x1E,0x10,$replay,$false,$false,$false,$false)) 'A replayed key passes'
Check ($core.Key(0x41,0x1E,0,0,$false,$false,$false,$false)) 'A key the user presses is held'
Check ($core.Key(0x41,0x1E,0,0,$true,$false,$false,$false)) 'Its release is held too'
Check (-not $core.Key(0x1B,0x01,0,0,$false,$false,$false,$false)) 'Esc reaches the stop listener'
Check ($core.Queue.Count -eq 2 -and $core.KeyCount -eq 1) 'Two held key events, one key'
# A key the user pressed before the hold: its repeats are dropped, its release passes.
Check ($core.Key(0xA0,0x2A,0,0,$false,$true,$false,$false)) 'A repeat of a key pressed before the hold is swallowed'
Check ($core.Queue.Count -eq 2) 'and not replayed'
Check (-not $core.Key(0xA0,0x2A,0,0,$true,$false,$false,$false)) 'Its release passes'
# A key whose replay is under way reads as down: the user pressing it again
# meanwhile is a new press, not a repeat (found on CI: a character was lost).
$core.Reset(100,200); $core.State=[WcuInputHold]::Holding
Check (-not $core.Key(0x52,0x13,0x10,$replay,$false,$false,$false,$false)) 'A replayed press passes'
Check ($core.Key(0x52,0x13,0,0,$false,$true,$false,$false)) 'The user pressing the same key during its replay is held'
Check ($core.Queue.Count -eq 1) 'and kept for replay, not dropped as a repeat'
Check (-not $core.Key(0x52,0x13,0x10,$replay,$true,$false,$false,$false)) 'The replayed release passes'
Check ($core.Key(0x52,0x13,0,0,$true,$false,$false,$false)) 'The user''s release is held'
# Typed characters (VK_PACKET) share one code and never repeat.
Check ($core.Key(0xE7,0x72,0x10,0,$false,$true,$false,$false)) 'A typed character that reads as down is still held'
Check ($core.Key(0xE7,0x72,0x10,0,$true,$false,$false,$false)) 'and its release'
Check ($core.Queue.Count -eq 4 -and $core.KeyCount -eq 2) 'Both presses kept for replay'
$core.Reset(100,200); $core.State=[WcuInputHold]::Holding
# Remote control types without DSH's marker: those keys are the user's too.
Check ($core.Key(0x42,0x30,0x10,0,$false,$false,$false,$false)) 'A remote-control key is held'
Check ($core.Key(0x42,0x30,0x10,0,$true,$false,$false,$false)) 'and its release'
Check (-not $core.Key(0x43,0x2E,0,0,$false,$false,$false,$true)) 'An overdue hold lets input through'

# Mouse: a move shifts the user's point by its distance; presses are held there.
$core.Reset(100,200); $core.State=[WcuInputHold]::Holding
Check ($core.Mouse(0x200,510,305,500,300,0,0,0,$false)) 'A mouse move is held'
Check ($core.X -eq 110 -and $core.Y -eq 205 -and $core.Moved) 'The user''s point moved by the distance'
Check ($core.Mouse(0x201,500,300,500,300,0,0,0,$false)) 'A left press is held'
Check ($core.Mouse(0x202,500,300,500,300,0,0,0,$false)) 'Its release is held'
Check ($core.Mouse(0x20A,500,300,500,300,(-120 -shl 16),0,0,$false)) 'A wheel turn is held'
Check (-not $core.Mouse(0x205,500,300,500,300,0,0,0,$false)) 'A release whose press came before the hold passes'
Check (-not $core.Mouse(0x201,500,300,500,300,0,1,$own,$false)) 'DSH''s own click passes'
$events=$core.Queue.ToArray()
Check ($events.Count -eq 3) 'Three held mouse events'
Check ($events[0].X -eq 110 -and $events[0].Y -eq 205 -and $events[0].MouseFlags -eq 2) 'The press replays at the user''s point'
Check ($events[2].MouseFlags -eq 0x800 -and $events[2].MouseData -eq -120) 'The wheel keeps its direction'
Check ($core.Mouse(0x200,700,400,500,300,0,1,0,$false)) 'A remote-control move is held'
Check ($core.X -eq 700 -and $core.Y -eq 400) 'Remote control places the point'

# What a replay sends: DSH's replay marker, the key's flags; VK_PACKET as Unicode.
$k=New-Object WcuInputHold+Held; $k.Key=$true; $k.Vk=0x25; $k.Scan=0x4B; $k.Flags=1; $k.Up=$true
$sent=[WcuInputHold]::ToInput($k)
Check ($sent.type -eq 1 -and $sent.U.ki.wVk -eq 0x25 -and $sent.U.ki.dwFlags -eq 3 -and [uint64]$sent.U.ki.dwExtraInfo.ToInt64() -eq $replay) 'An extended key release replays tagged'
$p=New-Object WcuInputHold+Held; $p.Key=$true; $p.Vk=0xE7; $p.Scan=0x4F60
$sent=[WcuInputHold]::ToInput($p)
Check ($sent.U.ki.wVk -eq 0 -and $sent.U.ki.wScan -eq 0x4F60 -and $sent.U.ki.dwFlags -eq 4) 'A typed character replays as Unicode'
$sent=[WcuInputHold]::ToInput($events[2])
Check ($sent.type -eq 0 -and $sent.U.mi.dwFlags -eq 0x800 -and $sent.U.mi.mouseData -eq ([uint32]::MaxValue - 119) -and [uint64]$sent.U.mi.dwExtraInfo.ToInt64() -eq $replay) 'The wheel replays tagged (-120)'

# Guarding: a key while DSH's window is in front starts the way back; a click ends the guard.
$core.Reset(0,0); $core.State=[WcuInputHold]::Guarding
Check (-not $core.Key(0x41,0x1E,0,0,$false,$false,$false,$false)) 'Typing in the user''s own window passes'
Check ($core.State -eq [WcuInputHold]::Guarding) 'and the guard stays'
Check ($core.Key(0x41,0x1E,0,0,$false,$false,$true,$false)) 'A key while DSH''s window is in front is held'
Check ($core.State -eq [WcuInputHold]::Returning) 'and the foreground goes back to the user'
Check ($core.Key(0x42,0x30,0,0,$false,$false,$true,$false) -and $core.Key(0x41,0x1E,0,0,$true,$false,$true,$false)) 'Keys meanwhile wait in order'
Check (-not $core.Key(0x1B,0x01,0,0,$false,$false,$true,$false)) 'Esc still passes'
Check ($core.Queue.Count -eq 3) 'Three key events for the user''s window'
$core.Reset(0,0); $core.State=[WcuInputHold]::Guarding
Check (-not $core.Mouse(0x200,10,10,10,10,0,0,0,$false)) 'A move passes the guard'
Check (-not $core.Mouse(0x201,10,10,10,10,0,0,0,$false)) 'The user''s click passes'
Check ($core.State -eq [WcuInputHold]::Idle) 'and ends the guard'

# What the server reads before borrowing, and a hook pair that comes and goes.
$state=[WcuInputHold]::UserState()
Check ($null -ne $state -and $state.Notification -ge 0) 'The user state reads'
Check ($null -eq [WcuInputHold]::End($null)) 'Ending without a hold says nothing'
$begun=[WcuInputHold]::Begin(0)
try {
  Check $begun 'Windows installs the hold hooks'
  Check ([WcuInputHold]::Decisions.State -eq [WcuInputHold]::Holding) 'The hold is on'
} finally { [void][WcuInputHold]::End($null) }
Check ([WcuInputHold]::Decisions.State -eq [WcuInputHold]::Idle) 'Idle after the end'
Check ($null -eq [WcuInputHold]::TakeNotice()) 'No guard notice'
Write-Output 'PASS hold and replay decisions, tagged replay inputs, guard return and release, user state and hook lifecycle; no physical input'
