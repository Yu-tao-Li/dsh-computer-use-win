# Synthetic PrintWindow pixels and actual bitmap crop. No desktop read/input.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'core-references.ps1')
Add-Type -ReferencedAssemblies (Get-HelperReferences) -TypeDefinition @'
using System;using System.Drawing;
public static class WindowsComputerUseNative {
 public struct RECT{public int left,top,right,bottom;}
 public static int Left=93,Top=91,BorderX=7,BorderY=9;
 public static bool GetWindowRect(IntPtr h,out RECT r){r=new RECT{left=Left,top=Top,right=Left+400+2*BorderX,bottom=Top+300+2*BorderY};return true;}
 public static int DwmGetWindowAttribute(IntPtr h,int attr,out RECT r,int size){r=new RECT{left=Left+BorderX,top=Top+BorderY,right=Left+BorderX+400,bottom=Top+BorderY+300};return 0;}
 public static bool PrintWindow(IntPtr h,IntPtr dc,uint flags){
  using(var g=Graphics.FromHdc(dc)){
   g.Clear(Color.Black);g.FillRectangle(Brushes.Green,BorderX,BorderY,400,300);
   g.FillRectangle(Brushes.Red,BorderX,BorderY,1,1);
   g.FillRectangle(Brushes.Blue,BorderX+399,BorderY+299,1,1);
  }return true;
 }
}
'@
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[Text.Encoding]::UTF8)
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Backend does not parse'}
foreach($name in @('Invoke-Safe','Get-ExtendedFrameBounds','Try-PrintWindowCapture')){
 $f=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 . ([scriptblock]::Create($f.Extent.Text))
}
$checks=0
foreach($origin in @(@(93,91),@(-1407,-609))){
 [WindowsComputerUseNative]::Left=$origin[0];[WindowsComputerUseNative]::Top=$origin[1]
 foreach($border in @(@(0,0),@(7,9),@(16,16))){
  [WindowsComputerUseNative]::BorderX=$border[0];[WindowsComputerUseNative]::BorderY=$border[1]
  $bitmap=Try-PrintWindowCapture 42 400 300
  if($null -eq $bitmap){throw 'Synthetic PrintWindow capture was rejected'}
  try{
   if($bitmap.Width -ne 400 -or $bitmap.Height -ne 300){throw 'Visible frame dimensions drifted'}
   if($bitmap.GetPixel(0,0).ToArgb() -ne [Drawing.Color]::Red.ToArgb()){throw 'Visible frame origin is offset'}
   if($bitmap.GetPixel(399,299).ToArgb() -ne [Drawing.Color]::Blue.ToArgb()){throw 'Visible frame lower edge is offset'}
  }finally{$bitmap.Dispose()}
  $checks++
 }
}
Write-Output ('PASS PrintWindow visible-frame pixel alignment: '+$checks+' cases including negative origins and 0/7/9/16px invisible borders; no desktop read/input')
