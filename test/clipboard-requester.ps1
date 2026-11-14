# Private fixture only: no user clipboard or visible windows.
$ErrorActionPreference='Stop'
$helper=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-clipboard.cs'))
$probe=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'clipboard-requester.cs'))
Add-Type -TypeDefinition ($helper+[Environment]::NewLine+$probe) -ReferencedAssemblies System.Windows.Forms,System.Drawing
[ClipboardRequesterProbe]::Run()
[ordered]@{passed=$true;privateWindowStation=$true;requestWindowMatches=$true;requestProcessMatches=$true;slowReadMs=150;heldOpenMs=150;confirmedRestore=$true;physicalInputSent=$false}|ConvertTo-Json -Compress
