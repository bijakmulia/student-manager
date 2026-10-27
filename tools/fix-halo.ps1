# One-off repair for sprites in assets\stor that were keyed before the edge band grew with
# image size: restores the magenta version from git when it exists, otherwise re-cleans the
# transparent PNG in place (treats transparency as background and re-mattes the edge).
# Run:  powershell -ExecutionPolicy Bypass -File .\tools\fix-halo.ps1
$root = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $root 'assets\stor'
$git = 'C:\Program Files\Git\cmd\git.exe'
Add-Type -AssemblyName System.Drawing
if (-not ('BmKey' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'BmKey.cs') }
Set-Location $root
$restored = 0; $recleaned = 0
Get-ChildItem $dir -Filter *.png | Where-Object { $_.BaseName -notlike 'bg_*' } | ForEach-Object {
    $rel = 'assets/stor/' + $_.Name
    $first = (& $git log --format=%h --diff-filter=A -- $rel | Select-Object -Last 1)
    $done = $false
    if ($first) {
        $tmp = [System.IO.Path]::GetTempFileName()
        cmd /c "`"$git`" show ${first}:$rel > `"$tmp`""
        $bytes = [System.IO.File]::ReadAllBytes($tmp); Remove-Item $tmp
        $ms = New-Object System.IO.MemoryStream (, $bytes)
        $img = [System.Drawing.Image]::FromStream($ms)
        $bmp = New-Object System.Drawing.Bitmap $img
        $bd = $bmp.LockBits((New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height), 'ReadOnly', 'Format32bppArgb')
        $buf = New-Object byte[] ($bd.Stride * $bmp.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $buf, 0, $buf.Length); $bmp.UnlockBits($bd)
        if ([BmKey]::DetectKey($buf, $bmp.Width, $bmp.Height)) {
            [System.IO.File]::WriteAllBytes($_.FullName, $bytes)     # magenta original: shrink-assets keys it again
            $restored++; $done = $true
        }
        $bmp.Dispose(); $img.Dispose(); $ms.Dispose()
    }
    if ($done) { return }
    # no magenta original in git: re-clean the transparent sprite in place
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $ms = New-Object System.IO.MemoryStream (, $bytes)
    $img = [System.Drawing.Image]::FromStream($ms)
    $bmp = New-Object System.Drawing.Bitmap $img; $img.Dispose(); $ms.Dispose()
    $bd = $bmp.LockBits((New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height), 'ReadWrite', 'Format32bppArgb')
    $buf = New-Object byte[] ($bd.Stride * $bmp.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $buf, 0, $buf.Length)
    if ([BmKey]::DetectKey($buf, $bmp.Width, $bmp.Height)) { $bmp.UnlockBits($bd); $bmp.Dispose(); return }   # still magenta: shrink-assets handles it
    [void][BmKey]::Run($buf, $bmp.Width, $bmp.Height, [int[]](255, 0, 255), 0.15, 0.75, 0.7, 1.0, 0.0, 0, $true, 4, $false)
    [System.Runtime.InteropServices.Marshal]::Copy($buf, 0, $bd.Scan0, $buf.Length); $bmp.UnlockBits($bd)
    $bmp.Save($_.FullName, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    $recleaned++
}
Write-Host "Dipulihkan dari git (magenta asal): $restored · dibersihkan semula: $recleaned"
& (Join-Path $root 'shrink-assets.ps1')
