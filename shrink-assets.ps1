# Shrinks AI-generated game images in assets\stor to the sizes the game needs,
# so the published site stays fast on students' phones.
# Runs automatically from auto-push.ps1; can also be run by hand:
#   powershell -ExecutionPolicy Bypass -File .\shrink-assets.ps1
#
# - Names are tidied: "Bola Sepak.PNG" -> "bola_sepak.png"
# - Images larger than their box are scaled down (aspect ratio kept)
# - Backgrounds (bg_*) are saved as JPG (much smaller; they need no transparency)
# - Files whose name is not in PROMPT-ASET.txt are left alone and reported
param([string]$Dir = (Join-Path $PSScriptRoot 'assets\stor'))

Add-Type -AssemblyName System.Drawing
if (-not (Test-Path $Dir)) { return }

# Known asset names come from the prompt list the app generates.
$known = @{}
$list = Join-Path $Dir 'PROMPT-ASET.txt'
if (Test-Path $list) {
    Get-Content $list -Encoding UTF8 | ForEach-Object {
        if ($_ -match '^\d+\.\s+([a-z0-9_]+)\.png') { $known[$Matches[1]] = $true }
    }
}

function Get-MaxSize([string]$id) {
    if ($id -like 'bg_*') { return @(1600, 1000) }
    if ($id -like 'rak_*' -or $id -like 'atl_*' -or $id -like 'pekerja_*' -or $id -in @('pintu_stor', 'pembekal')) { return @(512, 768) }
    if ($id -like 'kaunter_*') { return @(768, 512) }
    if ($id -in @('dapur', 'blender', 'meja_telefon', 'dulang', 'logo_stor')) { return @(512, 512) }
    return @(256, 256)
}

function Save-Image($img, [string]$path, [string]$fmt) {
    if ($fmt -eq 'jpg') {
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
        $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]84)
        $img.Save($path, $codec, $ep)
    } else {
        $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
}

$changed = 0
Get-ChildItem $Dir -File | Where-Object { $_.Extension -match '^\.(png|jpe?g)$' } | ForEach-Object {
    $file = $_
    # 1) tidy the name
    $base = $file.BaseName.Trim().ToLower() -replace '[\s\-]+', '_'
    $ext = $file.Extension.ToLower(); if ($ext -eq '.jpeg') { $ext = '.jpg' }
    $path = $file.FullName
    if ("$base$ext" -cne $file.Name) {
        $target = Join-Path $Dir "$base$ext"
        if ((Test-Path $target) -and ($target -ne $path)) { Write-Host "  [aset] $($file.Name): nama $base$ext sudah wujud - dilangkau"; return }
        Rename-Item -LiteralPath $path -NewName "$base.tmp$ext"
        Rename-Item -LiteralPath (Join-Path $Dir "$base.tmp$ext") -NewName "$base$ext"
        $path = $target
        Write-Host "  [aset] nama dikemas: $($file.Name) -> $base$ext"
    }
    if ($known.Count -and -not $known.ContainsKey($base)) { Write-Host "  [aset] $base$ext : nama tidak dikenali (semak PROMPT-ASET.txt)"; return }

    # 2) read into memory so the file is not locked
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $ms = New-Object System.IO.MemoryStream (, $bytes)
    try { $src = [System.Drawing.Image]::FromStream($ms) } catch { Write-Host "  [aset] $base$ext : bukan gambar yang sah"; $ms.Dispose(); return }
    $max = Get-MaxSize $base
    $k = [Math]::Min(1.0, [Math]::Min($max[0] / $src.Width, $max[1] / $src.Height))
    $fmt = if ($base -like 'bg_*') { 'jpg' } elseif ($ext -eq '.jpg') { 'jpg' } else { 'png' }
    $outPath = Join-Path $Dir ($base + '.' + $fmt)
    if ($k -ge 1.0 -and $outPath -eq $path) { $src.Dispose(); $ms.Dispose(); return }   # already fine

    # 3) scale down with high quality, keeping transparency
    $w = [Math]::Max(1, [int][Math]::Round($src.Width * $k)); $h = [Math]::Max(1, [int][Math]::Round($src.Height * $k))
    $dst = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    if ($fmt -eq 'jpg') { $g.Clear([System.Drawing.Color]::White) } else { $g.Clear([System.Drawing.Color]::Transparent) }
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)                   # no dark fringe at edges
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $g.Dispose(); $src.Dispose(); $ms.Dispose()
    $before = $bytes.Length
    Save-Image $dst $outPath $fmt
    $dst.Dispose()
    if ($outPath -ne $path) { Remove-Item -LiteralPath $path }
    $after = (Get-Item $outPath).Length
    Write-Host ("  [aset] {0}.{1}: {2}x{3}, {4:N0} KB -> {5:N0} KB" -f $base, $fmt, $w, $h, ($before / 1KB), ($after / 1KB))
    $changed++
}
if ($changed) { Write-Host "  [aset] $changed gambar dikecilkan" }

# senarai.json: which assets exist, so the game downloads only the images it shows.
# "?v=" changes when a file is replaced, so phones fetch the new picture.
$pref = @{ '.webp' = 3; '.png' = 2; '.jpg' = 1 }
$have = [ordered]@{}
Get-ChildItem $Dir -File | Where-Object { $pref.ContainsKey($_.Extension.ToLower()) } | Sort-Object Name | ForEach-Object {
    $id = $_.BaseName
    if ($known.Count -and -not $known.ContainsKey($id)) { return }
    $p = $pref[$_.Extension.ToLower()]
    if (-not $have.Contains($id) -or $p -gt $have[$id].p) { $have[$id] = @{ p = $p; f = $_.Name + '?v=' + $_.Length } }
}
$json = '{' + (($have.Keys | ForEach-Object { '"' + $_ + '":"' + $have[$_].f + '"' }) -join ',') + '}'
$mf = Join-Path $Dir 'senarai.json'
if (-not (Test-Path $mf) -or [System.IO.File]::ReadAllText($mf) -ne $json) {
    [System.IO.File]::WriteAllText($mf, $json, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  [aset] senarai.json dikemas kini ($($have.Count) gambar)"
}
