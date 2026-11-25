# Exercise the shipped relay code with fake remoting and a private worker tree.
param([string]$RelayPath = (Join-Path $PSScriptRoot '..\scripts\hyperv-desktop.ps1'))
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($RelayPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$connect = $ast.Find({ param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Connect-Target'
}, $true)
$leaseState = $ast.Find({ param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-GuestLeaseState'
}, $true)
$cleanup = $ast.Find({ param($node)
  $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$guestCleanup'
}, $true)
. ([scriptblock]::Create($connect.Extent.Text))
. ([scriptblock]::Create($leaseState.Extent.Text))
. ([scriptblock]::Create($cleanup.Extent.Text))

function New-PSSessionOption {
  param($OpenTimeout, $OperationTimeout)
  @{ open = $OpenTimeout; operation = $OperationTimeout }
}
function New-PSSession {
  [CmdletBinding()]
  param($ComputerName, $Port, $Credential, $Authentication, $SessionOption)
  if ($script:failure) { throw $script:failure }
  return @{ host = $ComputerName; port = $Port; credential = $Credential; auth = $Authentication; option = $SessionOption }
}
function Get-Service {
  [CmdletBinding()]
  param($Name)
  if ($Name -ne 'WinRM') { throw 'Unexpected service' }
  return @{ Status = $script:serviceState }
}
function Assert-ConnectError([string]$Code) {
  try {
    [void](Connect-Target $remote $credential)
    throw 'Expected Connect-Target to fail'
  } catch {
    if (-not $_.Exception.Message.StartsWith($Code + ':')) { throw }
  }
}

$remote = @{ Kind = 'WinRM'; Host = 'vm.example.test'; Port = 55985 }
$fixtureSecret = [Security.SecureString]::new()
$fixtureSecret.AppendChar('x')
$fixtureSecret.MakeReadOnly()
$credential = [pscredential]::new('FixtureUser', $fixtureSecret)
$script:failure = ''
$script:serviceState = 'Running'
$connection = Connect-Target $remote $credential
if ($connection.host -ne $remote.Host -or $connection.port -ne $remote.Port -or
    $connection.auth -ne 'Negotiate' -or $connection.credential -ne $credential -or
    $connection.option.open -ne 20000) { throw 'WinRM did not forward the selected endpoint and credential' }

$script:failure = 'The client cannot connect to the destination. Check the WinRM service on the destination.'
Assert-ConnectError WCU_REMOTE_UNREACHABLE
$script:serviceState = 'Stopped'
Assert-ConnectError WCU_REMOTE_CLIENT
$script:failure = 'The remote address must be added to TrustedHosts.'
Assert-ConnectError WCU_REMOTE_TRUST
$script:failure = 'Access is denied.'
Assert-ConnectError WCU_REMOTE_SIGNIN_FAILED

function Get-Credential {
  param($Message)
  return $fixtureSetup.credential
}
function Invoke-Command {
  [CmdletBinding()]
  param($Session, $ScriptBlock)
  if ($fixtureSetup.error) { throw $fixtureSetup.error }
  if ($fixtureSetup.missing) { return $fixtureSetup.missing }
}
function Remove-PSSession {
  param($Session)
  $fixtureSetup.closedSessions++
}

function Start-Sleep {
  param($Milliseconds)
  if ([IO.File]::Exists((Join-Path $script:worker 'lease'))) { throw 'The worker still has a lease during cleanup' }
  [IO.File]::WriteAllText((Join-Path $script:worker 'closed'), '1')
}
function New-Object {
  param($ComObject)
  $script:taskRemovalRequested = $ComObject -eq 'Schedule.Service'
  $script:workerClosedFirst = [IO.File]::Exists((Join-Path $script:worker 'closed'))
  throw 'No real Task Scheduler in this fixture'
}

$originalLocalData = $env:LOCALAPPDATA
try {
  $temp = (Get-Item -LiteralPath ([IO.Path]::GetTempPath())).FullName
  $env:LOCALAPPDATA = Join-Path $temp ('wcu-winrm-contract-' + [Guid]::NewGuid().ToString('N'))
  $script:failure = ''
  $fixtureSetup = @{ credential = $credential; missing = 'WCU_HYPERV_NODE_REQUIRED'; error = ''; closedSessions = 0 }
  & $RelayPath -Mode Configure -Backend WinRM -Target 'vm.example.test:55985'
  if ($LASTEXITCODE -ne 0) { throw 'An expected guest setup step should allow saving the credential' }
  $credentialRoot = Join-Path $env:LOCALAPPDATA 'dsh-computer-use-win\hyperv'
  $stored = Get-ChildItem -LiteralPath $credentialRoot -File -Filter '*.credential.xml'
  if (@($stored).Count -ne 1) { throw 'Expected one saved credential for the configured endpoint' }
  $savedBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($stored.FullName))

  $fixtureSetup.credential = [pscredential]::new('ReplacementFixtureUser', $fixtureSecret)
  $fixtureSetup.missing = ''
  $fixtureSetup.error = 'Fixture remoting channel closed during the readiness check'
  & $RelayPath -Mode Configure -Backend WinRM -Target 'vm.example.test:55985'
  if ($LASTEXITCODE -ne 1) { throw 'A failed readiness check must fail configuration' }
  if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($stored.FullName)) -ne $savedBytes) {
    throw 'A failed readiness check must preserve the previous credential'
  }
  if ($fixtureSetup.closedSessions -ne 2) { throw 'Both configuration sessions must be closed' }

  $fixtureSetup.error = ''
  & $RelayPath -Mode Configure -Backend WinRM -Target 'vm.example.test:55985'
  if ($LASTEXITCODE -ne 0 -or (Import-Clixml -LiteralPath $stored.FullName).UserName -ne $fixtureSetup.credential.UserName) {
    throw 'A successful reconfiguration must replace the credential'
  }
  if (@(Get-ChildItem -LiteralPath $credentialRoot -File).Count -ne 1) {
    throw 'A successful reconfiguration must leave only the current credential'
  }
  $name = 'Wincu-Guest-' + [Guid]::NewGuid().ToString('N')
  $script:worker = Join-Path $env:LOCALAPPDATA "dsh-computer-use-win\hyperv-workers\$name"
  $foreign = Join-Path $env:LOCALAPPDATA 'unrelated'
  [void][IO.Directory]::CreateDirectory($script:worker)
  [void][IO.Directory]::CreateDirectory($foreign)
  [IO.File]::WriteAllText((Join-Path $foreign 'lease'), 'keep')
  & $guestCleanup $foreign $name
  if (-not [IO.File]::Exists((Join-Path $foreign 'lease'))) { throw 'Cleanup touched an unrelated directory' }
  $lease = Join-Path $script:worker 'lease'
  if ((Get-GuestLeaseState $lease) -ne 'cancelled') { throw 'An absent lease must cancel the worker' }
  foreach ($file in @('lease', 'ready')) { [IO.File]::WriteAllText((Join-Path $script:worker $file), '1') }
  if ((Get-GuestLeaseState $lease) -ne 'active') { throw 'A renewed lease must keep the worker running' }
  [IO.File]::SetLastWriteTimeUtc($lease, [DateTime]::UtcNow.AddSeconds(-60))
  if ((Get-GuestLeaseState $lease) -ne 'expired') { throw 'A disconnected worker must detect an expired lease' }
  $script:taskRemovalRequested = $false
  $script:workerClosedFirst = $false
  & $guestCleanup $script:worker $name
  if (-not $script:taskRemovalRequested -or -not $script:workerClosedFirst -or (Test-Path -LiteralPath $script:worker)) {
    throw 'Cleanup did not signal, wait for, and then remove the owned worker'
  }
} finally {
  $env:LOCALAPPDATA = $originalLocalData
}
Write-Output 'PASS WinRM endpoint, error routing and owned worker shutdown'
