# Commits and pushes any changes in this folder to GitHub every few minutes.
# Start:  powershell -ExecutionPolicy Bypass -File .\auto-push.ps1
# Stop:   press Ctrl+C in its terminal
param([int]$Minutes = 5)

$git = "C:\Program Files\Git\cmd\git.exe"
Set-Location $PSScriptRoot

while ($true) {
    $time = Get-Date -Format "yyyy-MM-dd HH:mm"
    if (& $git status --porcelain) {
        & $git add -A
        & $git commit -m "Auto-save $time"
        & $git push
    } else {
        Write-Host "$time no changes"
    }
    Start-Sleep -Seconds ($Minutes * 60)
}
