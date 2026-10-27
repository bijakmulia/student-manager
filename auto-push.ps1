# Commits and pushes any changes in this folder to GitHub every few minutes.
# Start:  powershell -ExecutionPolicy Bypass -File .\auto-push.ps1
# Stop:   press Ctrl+C in its terminal
param([int]$Minutes = 5)

$git = "C:\Program Files\Git\cmd\git.exe"
Set-Location $PSScriptRoot

while ($true) {
    $time = Get-Date -Format "yyyy-MM-dd HH:mm"
    # Shrink new game images to the sizes the game needs before they are published.
    try { & (Join-Path $PSScriptRoot 'shrink-assets.ps1') } catch { Write-Host "$time shrink-assets: $_" }
    if (& $git status --porcelain) {
        & $git add -A
        & $git commit -m "Auto-save $time"
        # Bring in changes made elsewhere (e.g. merged pull requests) before pushing.
        & $git pull --no-rebase --no-edit
        if ($LASTEXITCODE -ne 0) {
            & $git merge --abort
            Write-Host "$time could not merge GitHub changes automatically - nothing pushed"
        } else {
            & $git push
        }
    } else {
        Write-Host "$time no changes"
    }
    Start-Sleep -Seconds ($Minutes * 60)
}
