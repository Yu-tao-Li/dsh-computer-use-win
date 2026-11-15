param([string]$Before,[string]$During,[string]$After)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System.Drawing;
public static class CapturePixels {
 public static double Background(string file){using(var image=new Bitmap(file)){
  int same=0;for(int y=0;y<image.Height;y++)for(int x=0;x<image.Width;x++){
   Color c=image.GetPixel(x,y);if(c.R==40&&c.G==40&&c.B==40)same++;
  }return (double)same/(image.Width*image.Height);
 }}
}
'@
[ordered]@{before=[CapturePixels]::Background($Before);during=[CapturePixels]::Background($During);after=[CapturePixels]::Background($After)}|ConvertTo-Json -Compress
