param([string]$Root)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/native-loader.ps1')
$scripts=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts'))
$source=[IO.File]::ReadAllText((Join-Path $scripts 'windows-uia.ps1'),[Text.Encoding]::UTF8)
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
$assignment=$ast.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$script:WcuCs'},$true)
Invoke-Expression $assignment.Extent.Text
[void][IO.Directory]::CreateDirectory((Join-Path $Root 'native'))
foreach($file in [IO.Directory]::GetFiles((Join-Path $scripts 'native'))){[IO.File]::Copy($file,(Join-Path (Join-Path $Root 'native') ([IO.Path]::GetFileName($file))),$true)}
$dll=Join-Path $Root 'native/wcu-native-netfx.dll'
$bytes=[IO.File]::ReadAllBytes($dll);$tampered=$bytes.Clone();$tampered[0]=0;[IO.File]::WriteAllBytes($dll,$tampered)
if(Import-PackagedHelper -Name native -Source $script:WcuCs -Root $Root){throw 'Tampered binary was accepted.'}
if('WindowsComputerUseNative' -as [type]){throw 'Invalid binary must not define a loaded native type.'}
[IO.File]::WriteAllBytes($dll,$bytes)
if(Import-PackagedHelper -Name native -Source ($script:WcuCs+'changed') -Root $Root){throw 'Source mismatch was accepted.'}
if(-not (Import-PackagedHelper -Name native -Source $script:WcuCs -Root $Root)){throw 'Valid packaged helper failed to load.'}
@{passed=$true;binaryTamperRejected=$true;sourceMismatchRejected=$true;validLoaded=$true}|ConvertTo-Json -Compress
