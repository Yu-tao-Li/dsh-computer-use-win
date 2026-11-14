# Optional installed-Office probe. Own unsaved documents; COM paste, no keys.
param([string]$Output)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
. (Join-Path $PSScriptRoot '../scripts/native-loader.ps1')
$clipboardSource=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-clipboard.cs'),[Text.Encoding]::UTF8)
if(-not (Import-PackagedHelper -Name clipboard -Source $clipboardSource)){Add-Type -TypeDefinition $clipboardSource -ReferencedAssemblies System.Windows.Forms,System.Drawing}
Add-Type -Name ClipboardOfficeWindow -Namespace Fixture -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);'
$old=[Windows.Forms.Clipboard]::GetDataObject();$saved=New-Object Windows.Forms.DataObject
if($old){foreach($format in $old.GetFormats($false)){$saved.SetData($format,$false,$old.GetData($format,$false))}}
$results=New-Object Collections.Generic.List[object]
$tokens=New-Object Collections.Generic.List[string]
try{
 foreach($kind in @('Word','Excel')){
  $application=$null;$document=$null;$sheet=$null;$range=$null;$window=$null;$lease=$null
  try{
   $application=New-Object -ComObject ($kind+'.Application')
   if($kind -eq 'Word'){
    if($application.Documents.Count -ne 0){throw 'Refusing a nonempty Word instance'}
    $document=$application.Documents.Add();$window=$document.ActiveWindow;$hwnd=[IntPtr]([int64]$window.Hwnd)
   }else{
    if($application.Workbooks.Count -ne 0){throw 'Refusing a nonempty Excel instance'}
    $document=$application.Workbooks.Add();$sheet=$document.Worksheets.Item(1);$hwnd=[IntPtr]([int64]$application.Hwnd)
   }
   [uint32]$targetProcess=0;[void][Fixture.ClipboardOfficeWindow]::GetWindowThreadProcessId($hwnd,[ref]$targetProcess)
   if(-not $targetProcess){throw 'No isolated Office window process'}
   $text='WCU_NEW_'+$kind+'_'+[Guid]::NewGuid().ToString('N');$tokens.Add($text)
   [Windows.Forms.Clipboard]::SetText('WCU_OLD_MUST_NOT_BE_PASTED')
   $lease=New-Object WcuClipboardLease($text,$true,[int]$targetProcess)
   Start-Sleep -Milliseconds 150
   if($kind -eq 'Word'){$range=$document.Content;$range.Paste();$actual=[string]$range.Text}
   else{$range=$sheet.Range('A1');$sheet.Paste($range,$false);$actual=[string]$range.Value2}
   $requested=$lease.Complete(2500)
   if($actual.Trim() -ne $text){throw 'Office pasted unexpected fixture content'}
   $reader=if($lease.RequestProcessId){Get-Process -Id $lease.RequestProcessId -ErrorAction SilentlyContinue}else{$null}
   $results.Add([ordered]@{application=$kind;passed=$true;driver='COM paste into own unsaved document';delayedReadMs=150;requestedTextObserved=$true;targetProcessId=$targetProcess;probeProcessId=$PID;firstRenderProcessId=$lease.RequestProcessId;firstRenderProcessName=$reader.ProcessName;firstRenderWindow=$lease.RequestWindow;targetReadConfirmed=$requested;clipboardRestored=$lease.Restored;physicalInputSent=$false})
  }catch{$results.Add([ordered]@{application=$kind;passed=$false;error=$_.Exception.Message;physicalInputSent=$false})}
  finally{
   Write-Output ('OFFICE_RESULT '+($results[$results.Count-1]|ConvertTo-Json -Compress))
   if($lease){$lease.Dispose();[void]$lease.Complete(2500)}
   try {
    if($document){if($kind -eq 'Word'){$saveChanges=0;$document.Close([ref]$saveChanges)}else{$document.Close($false)}}
    if($application){if($kind -eq 'Word'){if($application.Documents.Count -eq 0){$application.Quit()}}else{if($application.Workbooks.Count -eq 0){$application.Quit()}}}
   }catch{
    $rootError=$_.Exception;while($rootError.InnerException){$rootError=$rootError.InnerException}
    if($rootError.HResult -notin @(-2147023174,-2147417848,-2147023170)){throw}
    # An invisible Office server can exit when its final document closes.
   }
   foreach($item in @($range,$sheet,$window,$document,$application)){if($item -and [Runtime.InteropServices.Marshal]::IsComObject($item)){try{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)}catch [Runtime.InteropServices.InvalidComObjectException]{}}}
  }
 }
}finally{
 $current=[Windows.Forms.Clipboard]::GetText()
 if($tokens.Contains($current.Trim()) -or $current -eq 'WCU_OLD_MUST_NOT_BE_PASTED'){[Windows.Forms.Clipboard]::SetDataObject($saved,$true)}
}
$report=[ordered]@{results=@($results.ToArray());passed=@($results|Where-Object {-not $_.passed}).Count -eq 0;existingDocumentsModified=$false;physicalInputSent=$false}
$json=$report|ConvertTo-Json -Depth 6
if($Output){[IO.File]::WriteAllText($Output,$json,(New-Object Text.UTF8Encoding $false))}
Write-Output $json
if(-not $report.passed){exit 1}
