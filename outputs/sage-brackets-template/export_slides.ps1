param(
    [string]$Pptx = "D:\Projects\Web\PAMS8\outputs\sage-brackets-template\sage-brackets-template.pptx",
    [string]$OutDir = "D:\Projects\Web\PAMS8\outputs\sage-brackets-template\slides"
)

if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Path $OutDir | Out-Null

# msoTrue = -1, msoFalse = 0
$ppt = New-Object -ComObject PowerPoint.Application

# Simple open: file, readonly:msoTrue, untitled:msoFalse, withWindow:msoFalse
$pres = $ppt.Presentations.Open($Pptx, -1, 0, 0)

for ($i = 1; $i -le $pres.Slides.Count; $i++) {
    $slide = $pres.Slides.Item($i)
    $outPath = Join-Path $OutDir ("slide-{0:D2}.png" -f $i)
    $slide.Export($outPath, "PNG", 1600, 900)
    Write-Output "Exported $outPath"
}

$pres.Close()
$ppt.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
