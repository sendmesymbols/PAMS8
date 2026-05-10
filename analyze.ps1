$commits = git -C D:/Projects/PAMS8 log --oneline --all 2>&1 | ForEach-Object { $_ }
$count = 0
foreach ($commit in $commits) {
    $hash = ($commit -split ' ')[0]
    $hasIcon = git -C D:/Projects/PAMS8 show "${hash}:MS/Engines/SymbolEngine.ts" 2>$null | Select-String -Pattern "icon:" -Quiet
    if ($hasIcon) {
        $content = git -C D:/Projects/PAMS8 show "${hash}:MS/Engines/SymbolEngine.ts"
        $lines = $content -split "`n"
        $iconLine = $lines | Where-Object { $_ -match "icon:" } | Select-Object -First 1
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($iconLine)
        $hex = -join ($bytes | ForEach-Object { $_.ToString("x2") })
        Write-Host "Commit: $hash"
        Write-Host "Line: $iconLine"
        Write-Host "Hex: $hex"
        break
    }
    $count++
    if ($count -gt 50) { break }
}