param([Parameter(Mandatory=$true)][string]$CancelEvent,[switch]$ExpectCancelled,[switch]$WaitForCheck)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[ref]$tokens,[ref]$errors)
$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left -is [Management.Automation.Language.VariableExpressionAst] -and $n.Left.VariablePath.UserPath -eq 'script:WcuCs'},$true)
if($null -eq $assignment){throw 'Native cancellation source not found'}
$literal=$assignment.Right.Find({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst]},$true)
$source=$literal.Value
Add-Type -TypeDefinition $source
$env:WCU_CANCEL_EVENT=$CancelEvent
if($WaitForCheck){[Console]::WriteLine('WCU_PROBE_READY');if([Console]::ReadLine() -ne 'check'){throw 'Expected probe check command'}}
$cancelled=$false
try{[WindowsComputerUseNative]::ThrowIfCancelled()}catch{if($_.Exception.Message -notmatch 'COMPUTER_USE_STOPPED_BY_USER'){throw};$cancelled=$true}
if($cancelled -ne [bool]$ExpectCancelled){throw 'Native worker did not observe the shared cancellation event'}
Write-Output 'PASS actual backend native cancellation event; no desktop input'
