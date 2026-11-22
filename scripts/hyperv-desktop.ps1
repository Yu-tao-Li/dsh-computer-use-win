param(
  [Parameter(Mandatory)][ValidateSet('Relay','Configure','Guest')][string]$Mode,
  [string]$VMName,
  [string]$GuestRoot
)
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

function Write-ProtocolError([string]$Message) { [Console]::Error.WriteLine($Message) }

function Get-SelectedVm {
  if ([string]::IsNullOrWhiteSpace($VMName)) { throw 'WCU_HYPERV_VM_REQUIRED: name a local Hyper-V virtual machine in Computer Use settings.' }
  if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) { throw 'WCU_HYPERV_UNAVAILABLE: Hyper-V PowerShell tools are not installed.' }
  try { $result = @(Get-VM -ComputerName localhost | Where-Object Name -EQ $VMName) }
  catch {
    # Hyper-V refuses a token that is neither elevated nor in Hyper-V
    # Administrators, with a message in the system language and no usable
    # error category, so name the cause from the token itself.
    $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and
        -not $principal.IsInRole([Security.Principal.SecurityIdentifier]'S-1-5-32-578')) {
      throw 'WCU_HYPERV_PERMISSION: add your Windows account to the Hyper-V Administrators group, then sign out and back in.'
    }
    throw
  }
  if ($result.Count -ne 1) { throw 'WCU_HYPERV_VM_UNKNOWN: the configured local virtual machine could not be found.' }
  return $result[0]
}

# What the relay needs inside the guest, checked read-only when the connection
# is configured: the same rules as the relay's own check below, without
# creating a worker folder. Returns the missing step's code, or nothing.
$guestReadiness = {
  $ErrorActionPreference = 'Stop'
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $desktop = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object {
    $_.SessionId -gt 0 -and (Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid).Sid -eq $identity.User.Value
  } | Select-Object -ExpandProperty SessionId -Unique)
  if ($desktop.Count -ne 1) { return 'WCU_HYPERV_DESKTOP_REQUIRED' }
  $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
  if (-not $node) {
    $node = @((Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')) |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  }
  if (-not $node) { return 'WCU_HYPERV_NODE_REQUIRED' }
  $version = (& $node --version | Select-Object -First 1)
  if ($version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { return 'WCU_HYPERV_NODE_REQUIRED' }
}

function Connect-Guest($Vm, [pscredential]$Credential) {
  if ($Vm.State -in @('Off','Saved')) {
    $cold = $Vm.State -eq 'Off'
    Start-VM -VM $Vm | Out-Null
    if ($cold) {
      $deadline = [DateTime]::UtcNow.AddSeconds(35)
      do {
        $heartbeat = (Get-VM -ComputerName localhost -Id $Vm.Id).Heartbeat
        if ($heartbeat -in @('OkApplicationsHealthy','OkApplicationsUnknown','Disabled')) { break }
        Start-Sleep -Milliseconds 500
      } while ([DateTime]::UtcNow -lt $deadline)
    }
  }
  elseif ($Vm.State -ne 'Running') { throw 'WCU_HYPERV_VM_UNAVAILABLE: start the selected virtual machine and try again.' }
  if (-not $env:COMPUTERNAME) { $env:COMPUTERNAME = [Environment]::MachineName }
  # The GUI user must already have an interactive desktop. PowerShell Direct is
  # used only for staging and transport and has no interactive desktop itself.
  return (New-PSSession -VMId $Vm.Id -Credential $Credential)
}

function Start-GuestWorker([string]$Root) {
  $config = Get-Content -LiteralPath (Join-Path $Root 'worker.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ((Get-Process -Id $PID).SessionId -ne $config.sessionId -or $config.sessionId -le 0) {
    throw 'WCU_HYPERV_WRONG_SESSION: the worker did not start on the selected interactive desktop.'
  }
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $config.node
  $start.Arguments = '"' + (Join-Path $Root 'mcp\server.mjs') + '"'
  $start.WorkingDirectory = $Root
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($prop in $config.environment.PSObject.Properties) { $start.EnvironmentVariables[$prop.Name] = [string]$prop.Value }

  $lease = Join-Path $Root 'lease'
  $sequence = 0L
  $output = [IO.FileStream]::new((Join-Path $Root 'out.ndjson'), 'CreateNew', 'Write', 'ReadWrite', 1)
  $errors = [IO.FileStream]::new((Join-Path $Root 'worker.log'), 'CreateNew', 'Write', 'ReadWrite', 1)
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  $started = $false
  $recentCalls = [Collections.Generic.Queue[object]]::new()
  try {
    $started = $process.Start()
    if (-not $started) { throw 'Could not start the Windows computer-use worker.' }
    $copyOutput = $process.StandardOutput.BaseStream.CopyToAsync($output)
    $copyError = $process.StandardError.BaseStream.CopyToAsync($errors)
    $inputPipe = [IO.StreamWriter]::new($process.StandardInput.BaseStream,$utf8)
    $inputPipe.AutoFlush = $true
    [IO.File]::WriteAllText((Join-Path $Root 'ready'),[string]$config.sessionId)
    while (-not $process.HasExited) {
      if (-not [IO.File]::Exists($lease) -or ([DateTime]::UtcNow - [IO.File]::GetLastWriteTimeUtc($lease)).TotalSeconds -gt 45) { break }
      $batch = Join-Path $Root ('in-' + $sequence + '.ndjson')
      if (-not [IO.File]::Exists($batch)) { Start-Sleep -Milliseconds 35; continue }
      try { $lines = [IO.File]::ReadAllLines($batch,$utf8) }
      catch [IO.IOException] { Start-Sleep -Milliseconds 35; continue }
      foreach ($line in $lines) {
        try {
          $message = $line | ConvertFrom-Json
          if ($message.method -eq 'tools/call' -and $null -ne $message.id) {
            if ($recentCalls.Count -ge 64) { [void]$recentCalls.Dequeue() }
            $recentCalls.Enqueue($message.id)
          }
        } catch {}
        $inputPipe.WriteLine($line)
      }
      $sequence++
      try { [IO.File]::Delete($batch) } catch [IO.IOException] {}
    }
  } finally {
    if ($started -and -not $process.HasExited) {
      try {
        foreach ($id in $recentCalls) {
          $inputPipe.WriteLine((@{jsonrpc='2.0';method='notifications/cancelled';params=@{requestId=$id;reason='Isolated desktop disconnected'}} | ConvertTo-Json -Compress))
        }
        $inputPipe.Dispose()
      } catch {}
      if (-not $process.WaitForExit(1800)) { $process.Kill(); $process.WaitForExit() }
    }
    try { if ($copyOutput) { $copyOutput.GetAwaiter().GetResult() }; if ($copyError) { $copyError.GetAwaiter().GetResult() } } catch {}
    $output.Dispose()
    $errors.Dispose()
    $process.Dispose()
    [IO.File]::WriteAllText((Join-Path $Root 'closed'),'1')
  }
}

if ($Mode -eq 'Guest') {
  try { Start-GuestWorker $GuestRoot }
  catch {
    [IO.File]::WriteAllText((Join-Path $GuestRoot 'failed'),$_.Exception.Message,$utf8)
    exit 1
  }
  exit 0
}

$session = $null
$remote = $null
$archive = $null
$taskName = 'Wincu-Guest-' + [Guid]::NewGuid().ToString('N')
try {
  $vm = Get-SelectedVm
  $credentialRoot = Join-Path $env:LOCALAPPDATA 'dsh-computer-use-win\hyperv'
  $credentialFile = Join-Path $credentialRoot ($vm.Id.ToString('D') + '.credential.xml')
  if ($Mode -eq 'Configure') {
    $credential = Get-Credential -Message "Sign in to the Windows guest $($vm.Name) for Wincu. Use the account already signed in inside this VM."
    if ($null -eq $credential) { [Console]::WriteLine('{"cancelled":true}'); exit 0 }
    try { $session = Connect-Guest $vm $credential }
    catch {
      # PowerShell Direct reports a wrong password, a PIN or a guest that has
      # not finished starting in the system language; the settings page shows
      # one sign-in hint for all of them and keeps this text as the detail.
      if ($_.Exception.Message -match '^WCU_HYPERV_') { throw }
      throw ('WCU_HYPERV_SIGNIN_FAILED: ' + $_.Exception.Message)
    }
    [void][IO.Directory]::CreateDirectory($credentialRoot)
    $credential | Export-Clixml -LiteralPath $credentialFile -Force
    # The credential works. A step still missing inside the guest is reported,
    # not failed: the relay checks it again on every start.
    $missing = $null
    try { $missing = Invoke-Command -Session $session -ScriptBlock $guestReadiness | Select-Object -First 1 } catch {}
    [Console]::WriteLine((@{ ok = $true; missing = $(if ($missing -match '^WCU_HYPERV_(DESKTOP|NODE)_REQUIRED$') { [string]$missing } else { $null }) } | ConvertTo-Json -Compress))
    exit 0
  }

  if (-not (Test-Path -LiteralPath $credentialFile -PathType Leaf)) {
    throw 'WCU_HYPERV_CONFIG_REQUIRED: select Configure connection in Computer Use settings.'
  }
  $credential = Import-Clixml -LiteralPath $credentialFile
  if ($credential -isnot [pscredential]) { throw 'WCU_HYPERV_CONFIG_REQUIRED: configure the connection again.' }
  $session = Connect-Guest $vm $credential
  $guestInfo = Invoke-Command -Session $session -ArgumentList $taskName -ScriptBlock {
    param($name)
    $ErrorActionPreference = 'Stop'
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $desktop = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object {
      $_.SessionId -gt 0 -and (Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid).Sid -eq $identity.User.Value
    } | Select-Object -ExpandProperty SessionId -Unique)
    if ($desktop.Count -ne 1) { throw 'WCU_HYPERV_DESKTOP_REQUIRED: sign in to the VM with the configured Windows account.' }
    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
    if (-not $node) {
      $node = @((Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')) |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    if (-not $node) { throw 'WCU_HYPERV_NODE_REQUIRED: install Node.js 22 or newer in the virtual machine.' }
    $version = (& $node --version | Select-Object -First 1)
    if ($version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'WCU_HYPERV_NODE_REQUIRED: install Node.js 22 or newer in the virtual machine.' }
    $folder = Join-Path $env:LOCALAPPDATA ('dsh-computer-use-win\hyperv-workers\' + $name)
    [void][IO.Directory]::CreateDirectory($folder)
    @{ root=$folder; node=$node; sessionId=$desktop[0]; userSid=$identity.User.Value }
  }
  $remote = $guestInfo.root

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $packageRoot = Split-Path -Parent $PSScriptRoot
  $package = Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $archive = Join-Path ([IO.Path]::GetTempPath()) ($taskName + '.zip')
  $zip = [IO.Compression.ZipFile]::Open($archive,'Create')
  try {
    foreach ($entry in @('package.json') + @($package.files)) {
      if ($entry -match '^[A-Za-z0-9_./-]+$' -and $entry -notmatch '(^/|\.\.)') {
        $path = Join-Path $packageRoot $entry
        if (Test-Path -LiteralPath $path -PathType Leaf) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$path,$entry) }
      }
    }
  } finally { $zip.Dispose() }
  Copy-Item -LiteralPath $archive -Destination (Join-Path $remote 'worker.zip') -ToSession $session

  $hostFiles = [ordered]@{ WCU_CONFIG_FILE='settings.json'; WCU_ACTIVITY_FILE='activity.json' }
  $guestFiles = [ordered]@{ WCU_STATE_FILE='state.json'; WCU_LAYOUT_FILE='overlay-layout.json' }
  $guestEnvironment = @{
    WCU_IMAGE_MODE='inline'; WCU_BROWSER_ATTACH_USER='0'; WCU_APPROVAL_LEDGER=(Join-Path $remote 'approvals.json')
  }
  # The guest has its own loopback interface; the host web server's port is not a guest service.
  foreach ($key in @('WCU_TOOL_MODE','WCU_ENABLED_TOOLS','WCU_BROWSER_APP','WCU_BROWSER_HEADLESS','WCU_BROWSER_SIGNIN','WCU_SETTINGS_JSON','WCU_ADAPTER_NOTICES','WCU_APPROVAL_SECRET','WCU_LOCALE')) {
    $value = [Environment]::GetEnvironmentVariable($key)
    if ($null -ne $value) { $guestEnvironment[$key] = $value }
  }
  foreach ($map in @($hostFiles,$guestFiles)) {
    foreach ($key in $map.Keys) {
      if ([Environment]::GetEnvironmentVariable($key)) { $guestEnvironment[$key] = Join-Path $remote $map[$key] }
    }
  }
  $payload = @{ sessionId=$guestInfo.sessionId; node=$guestInfo.node; environment=$guestEnvironment } | ConvertTo-Json -Compress -Depth 5
  Invoke-Command -Session $session -ArgumentList $remote,$taskName,$guestInfo.sessionId,$guestInfo.userSid,$payload -ScriptBlock {
    param($root,$name,$sessionId,$sid,$payload)
    $ErrorActionPreference = 'Stop'
    $utf8 = [Text.UTF8Encoding]::new($false)
    Expand-Archive -LiteralPath (Join-Path $root 'worker.zip') -DestinationPath $root
    [IO.File]::WriteAllText((Join-Path $root 'worker.json'),$payload,$utf8)
    [IO.File]::WriteAllText((Join-Path $root 'lease'),'1',$utf8)
    $scheduler = New-Object -ComObject 'Schedule.Service'
    $scheduler.Connect()
    $folder = $scheduler.GetFolder('\')
    $task = $scheduler.NewTask(0)
    $task.Principal.UserId = $sid
    $task.Principal.LogonType = 3
    $task.Settings.Hidden = $true
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries = $false
    $task.Settings.ExecutionTimeLimit = 'PT0S'
    $action = $task.Actions.Create(0)
    $action.Path = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $script = Join-Path $root 'scripts\hyperv-desktop.ps1'
    $action.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$script+'" -Mode Guest -GuestRoot "'+$root+'"'
    $registered = $folder.RegisterTaskDefinition($name,$task,2,$sid,$null,3,$null)
    [void]$registered.RunEx($null,4,[int]$sessionId,$null)
  }

  $hostReader = [IO.StreamReader]::new([Console]::OpenStandardInput(),$utf8)
  $output = [Console]::OpenStandardOutput()
  $read = $hostReader.ReadLineAsync()
  $offset = 0L
  $sequence = 0L
  $inputClosed = $false
  $updatedInputs = @{}
  $knownOutputs = @{}
  $deadline = [DateTime]::UtcNow.AddSeconds(17)
  do {
    $pending = [Collections.Generic.List[string]]::new()
    while (-not $inputClosed -and $read.IsCompleted -and $pending.Count -lt 64) {
      $line = $read.GetAwaiter().GetResult()
      if ($null -eq $line) { $inputClosed = $true; break }
      $pending.Add($line)
      $read = $hostReader.ReadLineAsync()
    }
    if ($inputClosed -and -not $pending.Count) { break }
    $mirrors = @{}
    foreach ($key in $hostFiles.Keys) {
      $file = [Environment]::GetEnvironmentVariable($key)
      if (-not $file -or -not [IO.File]::Exists($file)) { continue }
      try { $body = [IO.File]::ReadAllText($file,$utf8) } catch [IO.IOException] { continue }
      if ($updatedInputs[$hostFiles[$key]] -cne $body) { $mirrors[$hostFiles[$key]] = $body }
    }
    $chunk = if ($pending.Count) { ($pending -join "`n") + "`n" } else { '' }
    $frame = Invoke-Command -Session $session -ArgumentList $remote,$offset,$chunk,$mirrors,$sequence -ScriptBlock {
      param($root,$offset,$chunk,$mirrors,$sequence)
      $utf8 = [Text.UTF8Encoding]::new($false)
      $lease = Join-Path $root 'lease'
      [IO.File]::SetLastWriteTimeUtc($lease,[DateTime]::UtcNow)
      $mirrored = @()
      foreach ($entry in $mirrors.GetEnumerator()) {
        $file = Join-Path $root $entry.Key
        $temp = $file + '.relay-tmp'
        try {
          [IO.File]::WriteAllText($temp,$entry.Value,$utf8)
          if ([IO.File]::Exists($file)) { [IO.File]::Replace($temp,$file,[NullString]::Value) } else { [IO.File]::Move($temp,$file) }
          $mirrored += $entry.Key
        } catch [IO.IOException] {}
      }
      if ($chunk) {
        # A published batch is immutable. The reader can only see complete lines.
        $batch = Join-Path $root ('in-' + $sequence + '.ndjson')
        $temp = $batch + '.tmp'
        for ($attempt = 0; ; $attempt++) {
          try {
            [IO.File]::WriteAllText($temp,$chunk,$utf8)
            [IO.File]::Move($temp,$batch)
            break
          } catch [IO.IOException] {
            if ($attempt -ge 5) { throw }
            Start-Sleep -Milliseconds 35
          }
        }
      }
      $output = Join-Path $root 'out.ndjson'
      $bytes = ''
      if ([IO.File]::Exists($output)) {
        $stream = [IO.FileStream]::new($output,'Open','Read','ReadWrite')
        try {
          $stream.Position = $offset
          $buffer = New-Object byte[] 131072
          $size = $stream.Read($buffer,0,$buffer.Length)
          $offset += $size
          if ($size) { $bytes = [Convert]::ToBase64String($buffer,0,$size) }
        } finally { $stream.Dispose() }
      }
      $state = @{}
      foreach ($name in @('state.json','overlay-layout.json')) {
        $file = Join-Path $root $name
        if ([IO.File]::Exists($file)) {
          try { $state[$name] = [IO.File]::ReadAllText($file,$utf8) } catch [IO.IOException] {}
        }
      }
      $failed = Join-Path $root 'failed'
      @{
        next=$offset; bytes=$bytes; state=$state; mirrored=$mirrored
        ready=[IO.File]::Exists((Join-Path $root 'ready'))
        closed=[IO.File]::Exists((Join-Path $root 'closed'))
        failed=if ([IO.File]::Exists($failed)) { [IO.File]::ReadAllText($failed,$utf8) } else { '' }
      }
    }
    if ($chunk) { $sequence++ }
    foreach ($name in $frame.mirrored) { $updatedInputs[$name] = $mirrors[$name] }
    foreach ($key in $guestFiles.Keys) {
      $file = [Environment]::GetEnvironmentVariable($key)
      $body = $frame.state[$guestFiles[$key]]
      if (-not $file -or -not $body -or $knownOutputs[$key] -ceq $body) { continue }
      $temp = $file + '.hyperv-tmp'
      try {
        [IO.File]::WriteAllText($temp,$body,$utf8)
        if ([IO.File]::Exists($file)) { [IO.File]::Replace($temp,$file,[NullString]::Value) } else { [IO.File]::Move($temp,$file) }
        $knownOutputs[$key] = $body
      } catch [IO.IOException] {}
    }
    if ($frame.bytes) {
      $data = [Convert]::FromBase64String($frame.bytes)
      $output.Write($data,0,$data.Length)
      $output.Flush()
    }
    $offset = $frame.next
    if ($frame.failed) { throw $frame.failed }
    if ($frame.closed -and -not $frame.bytes) { throw 'WCU_HYPERV_WORKER_STOPPED: the isolated desktop worker exited.' }
    if (-not $frame.ready -and [DateTime]::UtcNow -gt $deadline) {
      $taskResult = Invoke-Command -Session $session -ArgumentList $taskName -ScriptBlock {
        param($name)
        $scheduler = New-Object -ComObject 'Schedule.Service'
        $scheduler.Connect()
        return $scheduler.GetFolder('\').GetTask($name).LastTaskResult
      }
      throw "WCU_HYPERV_DESKTOP_TIMEOUT: the worker could not start in the interactive VM session (Task Scheduler: $taskResult)."
    }
    if (-not $frame.bytes -and -not $chunk) { Start-Sleep -Milliseconds 150 }
  } while ($true)
} catch {
  Write-ProtocolError $_.Exception.Message
  exit 1
} finally {
  if ($session) {
    if ($remote) {
      try {
        Invoke-Command -Session $session -ArgumentList $remote,$taskName -ScriptBlock {
          param($root,$name)
          $lease = Join-Path $root 'lease'
          if ([IO.File]::Exists($lease)) { [IO.File]::SetLastWriteTimeUtc($lease,[DateTime]::UtcNow.AddSeconds(-6)) }
          $deadline = [DateTime]::UtcNow.AddSeconds(3)
          while ([IO.File]::Exists((Join-Path $root 'ready')) -and -not [IO.File]::Exists((Join-Path $root 'closed')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 60 }
          $scheduler = New-Object -ComObject 'Schedule.Service'
          $scheduler.Connect()
          $folder = $scheduler.GetFolder('\')
          try { $folder.DeleteTask($name,0) } catch {}
          # Keep guest application data; remove only the worker created for this relay.
          $directory = Join-Path $env:LOCALAPPDATA 'dsh-computer-use-win\hyperv-workers'
          $owned = Get-Item -LiteralPath $root -Force -ErrorAction SilentlyContinue
          if ($owned -and $owned.PSIsContainer -and $name -match '^Wincu-Guest-[0-9a-f]{32}$' -and
              $owned.FullName -eq [IO.Path]::GetFullPath((Join-Path $directory $name)) -and
              -not ($owned.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Remove-Item -LiteralPath $owned.FullName -Recurse -Force -ErrorAction SilentlyContinue
          }
        }
      } catch {}
    }
    Remove-PSSession $session
  }
  if ($archive) { Remove-Item -LiteralPath $archive -ErrorAction SilentlyContinue }
}
