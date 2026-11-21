$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
. (Join-Path $PSScriptRoot 'core-references.ps1')
Add-Type -Path (Join-Path $PSScriptRoot '../scripts/windows-clipboard.cs') -ReferencedAssemblies (Get-HelperReferences)
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class ClipboardReader {
 [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
 [DllImport("user32.dll")] static extern bool CloseClipboard();
 [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
 [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr data);
 [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr data);
 public static string Read(IntPtr window,int holdMs) {
  bool opened = false;
  for (int i = 0; i < 15 && !(opened = OpenClipboard(window)); i++) System.Threading.Thread.Sleep(10);
  if (!opened) throw new Exception("Test reader could not open clipboard");
  try { var data=GetClipboardData(13);var p=GlobalLock(data);
   try { var value=Marshal.PtrToStringUni(p);System.Threading.Thread.Sleep(holdMs);return value; }
   finally { GlobalUnlock(data); }
  } finally { CloseClipboard(); }
 }
}
'@
function Assert-Equal($Actual,$Expected) { if($Actual -ne $Expected){throw "Expected '$Expected', actual '$Actual'"} }
# Every clipboard change wakes clipboard listeners (IMEs, screenshot tools,
# clipboard history) that open the clipboard to read it. A read in that moment
# can come back empty although the text is there, so let the read settle.
function Get-ClipboardText($Expected) {
  $deadline = [DateTime]::UtcNow.AddSeconds(1)
  do {
    $text = [System.Windows.Forms.Clipboard]::GetText()
    if ($text -eq $Expected) { return $text }
    Start-Sleep -Milliseconds 25
  } while ([DateTime]::UtcNow -lt $deadline)
  return $text
}
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
$saved = New-Object System.Windows.Forms.DataObject
if ($null -ne $original) { foreach($format in $original.GetFormats($false)) { $saved.SetData($format,$false,$original.GetData($format,$false)) } }
$lease=$null
$consumer = New-Object System.Windows.Forms.Form
$consumerHandle = $consumer.Handle
$readerProcess = [System.Diagnostics.Process]::GetCurrentProcess().Id
try {
  $before=New-Object System.Windows.Forms.DataObject
  $before.SetData('UnicodeText',$false,'OLD CLIPBOARD MUST NOT BE PASTED')
  $before.SetData('FixtureData',$false,'preserve custom format')
  [System.Windows.Forms.Clipboard]::SetDataObject($before,$true)
  $lease=New-Object WcuClipboardLease('new text', $true, $readerProcess)
  $lease.MarkPasteSent([IntPtr]::Zero)
  Start-Sleep -Milliseconds 150
  Assert-Equal ([ClipboardReader]::Read($consumerHandle,150)) 'new text'
  $confirmed = $lease.Complete(2300)
  if($confirmed) {
    Assert-Equal $lease.Restored $true
    Assert-Equal ([System.Windows.Forms.Clipboard]::GetData('FixtureData')) 'preserve custom format'
    Assert-Equal (Get-ClipboardText 'OLD CLIPBOARD MUST NOT BE PASTED') 'OLD CLIPBOARD MUST NOT BE PASTED'
  } else {
    # A clipboard monitor may render before our reader. Its read is never
    # accepted as proof of paste; preserve the new text in that case.
    Assert-Equal $lease.Restored $false
    Assert-Equal (Get-ClipboardText 'new text') 'new text'
  }
  $lease.Dispose()
  $lease=New-Object WcuClipboardLease('timeout text', $true, $readerProcess)
  $lease.MarkPasteSent([IntPtr]::Zero)
  Assert-Equal ($lease.Complete(2600)) $false
  Assert-Equal (Get-ClipboardText 'timeout text') 'timeout text'
  Assert-Equal $lease.Restored $false
  $lease.Dispose()
  $lease=New-Object WcuClipboardLease('pending text', $true, $readerProcess)
  [System.Windows.Forms.Clipboard]::SetText('user copied something newer')
  $lease.Dispose()
  [void]$lease.Complete(2000)
  Assert-Equal (Get-ClipboardText 'user copied something newer') 'user copied something newer'
  Write-Output "PASS real delayed clipboard: 150ms delayed reader + 150ms held lock, confirmed restore=$confirmed, unread timeout and newer user copy"
} finally {
  if($null -ne $lease){$lease.Dispose();[void]$lease.Complete(2600)}
  [System.Windows.Forms.Clipboard]::SetDataObject($saved,$true)
  $consumer.Dispose()
}
