# Live fixture owns its entire window and closes only itself. No physical input.
param([string]$ArtifactDirectory)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -Force
[Console]::WriteLine('{"phase":"utility-loaded"}')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
public class InactiveFixtureForm : System.Windows.Forms.Form {
  protected override bool ShowWithoutActivation {get {return true;}}
  [System.Runtime.InteropServices.DllImport("user32.dll")]
  public static extern System.IntPtr GetForegroundWindow();
}
'@
[Console]::WriteLine('{"phase":"form-type-compiled"}')
$form=New-Object InactiveFixtureForm
$form.Text='WCU issue18 isolated native fixture'
$form.Width=500;$form.Height=300
if ($env:WCU_TEST_WINDOW_X) {
  $form.StartPosition=[System.Windows.Forms.FormStartPosition]::Manual
  $form.Location=New-Object System.Drawing.Point ([int]$env:WCU_TEST_WINDOW_X),80
}
$edit=New-Object System.Windows.Forms.TextBox
$edit.Name='fixture-edit';$edit.Text='native needle';$edit.Width=200;$edit.Top=40;$edit.Left=20
$button=New-Object System.Windows.Forms.Button
$button.Text='Fixture button';$button.Top=80;$button.Left=20
# Background element actions report what reached the controls.
$check=New-Object System.Windows.Forms.CheckBox
$check.Text='Fixture check';$check.Top=120;$check.Left=20;$check.Width=160
$script:clicks=0
$button.Add_Click({$script:clicks++;[Console]::WriteLine((@{clicks=$script:clicks}|ConvertTo-Json -Compress))})
$check.Add_CheckedChanged({[Console]::WriteLine((@{checked=$check.Checked}|ConvertTo-Json -Compress))})
$edit.Add_TextChanged({[Console]::WriteLine((@{text=$edit.Text}|ConvertTo-Json -Compress))})
# A multi-line box with its own scroll bar, for background scrolling.
$lines=New-Object System.Windows.Forms.TextBox
$lines.Name='fixture-lines';$lines.AccessibleName='Fixture lines';$lines.Multiline=$true;$lines.ScrollBars='Vertical'
$lines.Top=40;$lines.Left=240;$lines.Width=220;$lines.Height=120;$lines.Text=((1..60|ForEach-Object{"line $_"}) -join "`r`n")
$form.Controls.Add($edit);$form.Controls.Add($button);$form.Controls.Add($check);$form.Controls.Add($lines)
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=100
$script:last=0
$timer.Add_Tick({
  $file=Join-Path $ArtifactDirectory 'native-command.json'
  if (-not [IO.File]::Exists($file)) {return}
  try {$command=[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)|ConvertFrom-Json} catch {return}
  if ($command.id -eq $script:last) {return};$script:last=$command.id
  if ($command.action -eq 'hang') {
    [Console]::WriteLine('{"hanging":true}')
    [Threading.Thread]::Sleep(3000)
    [Console]::WriteLine('{"recovered":true}')
  }
  # Focus inside this thread only: the window stays in the background.
  if ($command.action -eq 'focus-edit') {
    $beforeFocus=[InactiveFixtureForm]::GetForegroundWindow().ToInt64()
    [void]$edit.Focus();$edit.SelectionStart=$edit.TextLength;$edit.SelectionLength=0
    [Console]::WriteLine((@{focused=$edit.Focused;foregroundBeforeFocus=$beforeFocus;foregroundAfterFocus=[InactiveFixtureForm]::GetForegroundWindow().ToInt64()}|ConvertTo-Json -Compress))
  }
  if ($command.action -eq 'first-line') {
    [Console]::WriteLine((@{firstLine=$lines.GetLineFromCharIndex($lines.GetCharIndexFromPosition((New-Object System.Drawing.Point 2,2)))}|ConvertTo-Json -Compress))
  }
  if ($command.action -eq 'quit') {$form.Close()}
})
$form.Add_Shown({
  [Console]::WriteLine((@{ready=$true;hwnd=$form.Handle.ToInt64();pid=$PID;foregroundAtReady=[InactiveFixtureForm]::GetForegroundWindow().ToInt64()}|ConvertTo-Json -Compress))
  $timer.Start()
})
[Windows.Forms.Application]::Run($form)
$timer.Dispose();$form.Dispose()
