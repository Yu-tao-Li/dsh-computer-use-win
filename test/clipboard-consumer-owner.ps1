param([int]$TargetProcessId,[switch]$SnapshotOnly,[string]$ExpectedText='')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
. (Join-Path $PSScriptRoot '../scripts/native-loader.ps1')
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-clipboard.cs'),[Text.Encoding]::UTF8)
if(-not (Import-PackagedHelper -Name clipboard -Source $source)){Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing}
$original=[Windows.Forms.Clipboard]::GetDataObject();$saved=New-Object Windows.Forms.DataObject
if($original){foreach($format in $original.GetFormats($false)){$saved.SetData($format,$false,$original.GetData($format,$false))}}
$text='WCU_CHROMIUM_'+[Guid]::NewGuid().ToString('N');$lease=$null
if($SnapshotOnly){$text=$ExpectedText}
try{
  if(-not $SnapshotOnly){
    [Windows.Forms.Clipboard]::SetText('WCU_OLD_CLIPBOARD_FIXTURE')
    $lease=New-Object WcuClipboardLease($text,$true,$TargetProcessId)
    $lease.MarkPasteSent([IntPtr]::Zero)
  }
  [Console]::WriteLine((@{kind='ready';text=$text}|ConvertTo-Json -Compress))
  if([Console]::ReadLine() -ne 'pasted'){throw 'Expected the consumer result'}
  if($lease){
    $confirmed=$lease.Complete(2500)
    $reader=if($lease.RequestProcessId){Get-Process -Id $lease.RequestProcessId -ErrorAction SilentlyContinue}else{$null}
    [Console]::WriteLine((@{kind='result';targetProcessId=$TargetProcessId;firstRenderProcessId=$lease.RequestProcessId;firstRenderProcessName=$reader.ProcessName;requestWindow=$lease.RequestWindow;targetReadConfirmed=$confirmed;clipboardRestored=$lease.Restored;restorationFailed=$lease.RestorationFailed}|ConvertTo-Json -Compress))
  }
}finally{
  if($lease){$lease.Dispose();[void]$lease.Complete(2500)}
  $current=[Windows.Forms.Clipboard]::GetText()
  if($current -eq $text -or $current -eq 'WCU_OLD_CLIPBOARD_FIXTURE'){[Windows.Forms.Clipboard]::SetDataObject($saved,$true)}
}
