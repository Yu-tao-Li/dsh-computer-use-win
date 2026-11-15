# Add-Type references for helper sources on both runtimes, as the backend and
# the takeover helper use them. PowerShell 7 needs the .NET reference
# assemblies and the split Windows Forms and drawing assemblies.
function Get-HelperReferences {
  if ($PSVersionTable.PSEdition -ne 'Core') { return @('System.Windows.Forms', 'System.Drawing') }
  $list = @(Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll' | ForEach-Object { $_.FullName })
  $list += [System.Reflection.Assembly]::Load('System.Windows.Forms').Location
  $list += [System.Reflection.Assembly]::Load('System.Windows.Forms.Primitives').Location
  $list += [System.Reflection.Assembly]::Load('System.Drawing.Common').Location
  $list += @(Get-ChildItem -LiteralPath $PSHOME -Filter 'System.Private.Windows*.dll' | ForEach-Object { $_.FullName })
  return $list
}
