# OCR reading rules (#75): small text is enlarged before reading, Chinese and
# Japanese words are joined without spaces, and the recognizer language can be
# chosen. Compiles the shipped WinRT helper and reads only images this test
# renders. No screen capture, input or desktop change.
param([string]$BackendPath = "$PSScriptRoot/../scripts/windows-uia.ps1")
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Core') {
  # WinRT OCR runs under Windows PowerShell 5.1 only; that lane tests it.
  Write-Output 'PASS OCR reading rules are tested in the Windows PowerShell 5.1 lane'
  return
}
$source = [IO.File]::ReadAllText($BackendPath, [Text.Encoding]::UTF8)
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Backend source did not parse.' }
$helper = $ast.Find({param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$script:WcuOcrCs'}, $true)
Invoke-Expression $helper.Extent.Text
foreach ($name in @('Get-CsHash', 'Import-HelperAssembly', 'Get-OcrHelper', 'Invoke-Ocr')) {
  $function = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
  Invoke-Expression $function.Extent.Text
}
function Assert-Equal { param($Actual, $Expected, [string]$Message)
  if ($Actual -ne $Expected) { throw "$Message (expected=$Expected, actual=$Actual)" }
}
Get-OcrHelper
$ocr = [WindowsComputerUseOcr]

# Joining: no space between CJK characters or next to CJK punctuation; a space
# next to Latin words and digits, but not inside brackets or before a suffix.
$joins = @(
  @{words=@('安','装','选','项'); text='安装选项'},
  @{words=@('第','3','行','，','第','12','列'); text='第 3 行，第 12 列'},
  @{words=@('打开','ocr-cjk-test.txt','文件'); text='打开 ocr-cjk-test.txt 文件'},
  @{words=@('（','图','片','）'); text='（图片）'},
  @{words=@('“','引','号','”'); text='“引号”'},
  @{words=@('Windows','(CRLF)'); text='Windows (CRLF)'},
  @{words=@('100','%'); text='100%'},
  @{words=@('検','索','する'); text='検索する'},
  @{words=@('','设','','置'); text='设置'}
)
foreach ($case in $joins) {
  Assert-Equal ($ocr::JoinWords([string[]]$case.words)) $case.text ('Joined ' + ($case.words -join '|'))
}
Assert-Equal ($ocr::UsesSpaces('zh-Hans-CN')) $false 'Chinese joins without spaces'
Assert-Equal ($ocr::UsesSpaces('ja')) $false 'Japanese joins without spaces'
Assert-Equal ($ocr::UsesSpaces('en-US')) $true 'English keeps the recognizer spacing'
Assert-Equal ($ocr::UsesSpaces('ko-KR')) $true 'Korean keeps the recognizer spacing'
Write-Output 'PASS CJK-aware word joining'

# Enlarging: toward 36 px words, at most 3x, within MaxImageDimension and 36 megapixels.
Assert-Equal ($ocr::ReadScale([double[]]@(11, 12, 13), 900, 300, 10000)) 3 '12 px words are read at 3x'
Assert-Equal ($ocr::ReadScale([double[]]@(18), 900, 300, 10000)) 2 '18 px words are read at 2x'
Assert-Equal ($ocr::ReadScale([double[]]@(40), 900, 300, 10000)) 0.9 'Large words are not enlarged'
Assert-Equal ($ocr::ReadScale([double[]]@(), 900, 300, 10000)) 3 'Nothing read yet: try 3x'
Assert-Equal ([Math]::Round($ocr::ReadScale([double[]]@(16), 7680, 1440, 10000), 3)) 1.302 'A wide desktop stops at the maximum dimension'
Assert-Equal ([Math]::Round($ocr::ReadScale([double[]]@(10), 3840, 2160, 10000), 3)) 2.083 'A 4K window stops at the pixel budget'
Write-Output 'PASS read scale for small, large and very large captures'

# Languages: an unknown one fails and lists what is installed.
$installedText = $ocr::InstalledLanguages()
$installed = @(([regex]::Match($installedText, 'languages: (.+?)\. ')).Groups[1].Value -split ', ' | Where-Object { $_ -and $_ -ne 'none' })
try { [void]$ocr::CreateEngine('xx-Unknown'); throw 'An unknown OCR language must fail' }
catch { if ($_.Exception.Message -notmatch "OCR language 'xx-Unknown' is not installed\. Installed OCR languages: ") { throw } }
if ($installed.Count -eq 0) { Write-Output 'PASS reading rules; no OCR language installed, so nothing was read'; return }

# Read rendered 12 px text: it is enlarged, its boxes map back to the image,
# the full text has real line breaks, and a language prefix picks the engine.
Add-Type -AssemblyName System.Drawing
function Render { param([string[]]$Lines, [int]$Px, [string]$Path, [string]$FontName = 'Segoe UI')
  $bitmap = New-Object System.Drawing.Bitmap 640, (40 + 50 * $Lines.Count)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $font = New-Object System.Drawing.Font $FontName, $Px, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 26, 26))
    for ($i = 0; $i -lt $Lines.Count; $i++) { $graphics.DrawString($Lines[$i], $font, $brush, 20, (20 + 50 * $i)) }
    $font.Dispose(); $brush.Dispose()
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
$png = Join-Path $env:TEMP 'wcu-ocr-reading-latin.png'
Render -Lines @('Settings', 'Display scale') -Px 12 -Path $png
$read = Invoke-Ocr -PngPath $png
$latinScale = $read.readScale
Assert-Equal ($installed -contains $read.language) $true 'The recognizer language is reported'
if ($read.readScale -le 1.2) { throw "12 px text must be read enlarged (scale $($read.readScale))" }
if (($read.text -replace '\s', '') -notmatch 'Settings') { throw "Enlarged 12 px text was misread: $($read.text)" }
if ($read.lines.Count -ge 2 -and -not $read.text.Contains("`n")) { throw 'Lines must be separated by real line breaks' }
$word = @($read.lines | ForEach-Object { $_.words } | Where-Object { $_.text -match 'Settings' })[0]
if ($null -eq $word -or $word.x -lt 10 -or $word.x -gt 40 -or $word.y -lt 14 -or $word.y -gt 34 -or $word.height -lt 6 -or $word.height -gt 20) {
  throw "Word boxes must map back to the image's own pixels: $($word | ConvertTo-Json -Compress)"
}
$prefix = ($installed[0] -split '-')[0]
Assert-Equal ((Invoke-Ocr -PngPath $png -Language $prefix).language) (@($installed | Where-Object { $_ -like "$prefix-*" -or $_ -eq $prefix })[0]) 'A language prefix picks the installed recognizer'
$chinese = @($installed | Where-Object { $_ -like 'zh*' })[0]
if ($chinese) {
  $cjk = Join-Path $env:TEMP 'wcu-ocr-reading-cjk.png'
  Render -Lines @('安装选项') -Px 16 -Path $cjk -FontName 'Microsoft YaHei UI'
  $read = Invoke-Ocr -PngPath $cjk -Language $chinese
  if ($read.text -match '\s') { throw "Chinese text must come back without spaces between characters: '$($read.text)'" }
}
Remove-Item -LiteralPath $png -Force -ErrorAction SilentlyContinue
Write-Output "PASS real OCR (12 px read at ${latinScale}x) with $($installed -join ', '): enlarged reading, mapped boxes, line breaks and language choice"
