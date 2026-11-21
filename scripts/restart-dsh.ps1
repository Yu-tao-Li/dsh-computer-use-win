# Restart DSH Desktop after a plugin update the plugin market cannot restart
# itself (its restart API refuses a host that DSH Desktop supervises). Started
# by mcp/restart.mjs through Explorer, so it runs outside DSH's process tree, on
# the user's desktop, and survives DSH quitting. Asks the running DSH Desktop to quit the way DSH's own
# installer does, waits until no DSH Desktop process is left, then opens DSH
# Desktop again through Explorer, as a shortcut would.
param(
  [Parameter(Mandatory)][ValidatePattern('\\DSH Desktop\.exe$')][string]$Executable
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { exit 2 }
$name = [IO.Path]::GetFileNameWithoutExtension($Executable)
# Leave the settings page a moment to show that the restart has begun.
Start-Sleep -Milliseconds 600
# A second instance with this flag makes the running one quit like the tray's
# Quit, then exits itself (DSH Desktop main.js: isDesktopInstallerQuitRequest).
Start-Process -FilePath $Executable -ArgumentList '--dsh-installer-quit' -WindowStyle Hidden
$deadline = [DateTime]::UtcNow.AddSeconds(90)
do { Start-Sleep -Milliseconds 500 }
while ((Get-Process -Name $name -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline)
# DSH did not quit (still busy, or it refused): leave it running as it is.
if (Get-Process -Name $name -ErrorAction SilentlyContinue) { exit 1 }
Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList ('"' + $Executable + '"')
exit 0
