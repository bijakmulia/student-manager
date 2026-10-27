# Shrinks AI-generated game images in assets\stor to the sizes the game needs,
# so the published site stays fast on students' phones.
# Runs automatically from auto-push.ps1; can also be run by hand:
#   powershell -ExecutionPolicy Bypass -File .\shrink-assets.ps1
#
# - Names are tidied: "Bola Sepak.PNG" -> "bola_sepak.png"
# - Magenta (#FF00FF) backgrounds are removed (tools\BmKey.cs, same engine as tools/buang-magenta.html)
# - Images larger than their box are scaled down (aspect ratio kept)
# - Backgrounds (bg_*) are saved as JPG (much smaller; they need no transparency)
# - Files whose name is not in PROMPT-ASET.txt are left alone and reported
param([string]$Dir = (Join-Path $PSScriptRoot 'assets\stor'))

Add-Type -AssemblyName System.Drawing
if (-not ('BmKey' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'tools\BmKey.cs') }
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
    if ($id -like 'rak_*' -or $id -like 'atl_*' -or $id -like 'org_*' -or $id -like 'pekerja_*' -or $id -in @('pintu_stor', 'pembekal')) { return @(512, 768) }
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
    # 3) remove a magenta background (sprites only; full backgrounds bg_* are never keyed)
    $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g0 = [System.Drawing.Graphics]::FromImage($bmp); $g0.DrawImage($src, 0, 0, $src.Width, $src.Height); $g0.Dispose()
    $src.Dispose(); $ms.Dispose(); $src = $bmp
    $keyed = $false
    if ($base -notlike 'bg_*') {
        $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
        $bd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $buf = New-Object byte[] ($bd.Stride * $bmp.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $buf, 0, $buf.Length)
        $key = [BmKey]::DetectKey($buf, $bmp.Width, $bmp.Height)
        if ($key) {
            # lo .15, hi .75, strict .7, despill 1, choke .5, specks < 12 px, holes >= 4 px (racket strings, mesh), denoise
            $cleared = [BmKey]::Run($buf, $bmp.Width, $bmp.Height, $key, 0.15, 0.75, 0.7, 1.0, 0.5, 12, $true, 4, $true)
            [System.Runtime.InteropServices.Marshal]::Copy($buf, 0, $bd.Scan0, $buf.Length)
            $keyed = $true
            Write-Host ("  [aset] {0}: latar magenta rgb({1},{2},{3}) dibuang ({4:N0} piksel lutsinar)" -f $base, $key[0], $key[1], $key[2], $cleared)
        }
        # trim transparent margins: pieces that fill their box (shelves, door, counters tiled side
        # by side) are cut tight; items and characters keep a 2% margin
        $bb = [BmKey]::Bounds($buf, $bmp.Width, $bmp.Height, 8)
        $bmp.UnlockBits($bd)
        $tight = ($base -like 'rak_*' -or $base -like 'kaunter_*' -or $base -eq 'pintu_stor')
        $pad = if ($tight) { 0 } else { [int][Math]::Round([Math]::Max($bmp.Width, $bmp.Height) * 0.02) }
        if ($bb) {
            $x0 = [Math]::Max(0, $bb[0] - $pad); $y0 = [Math]::Max(0, $bb[1] - $pad)
            $x1 = [Math]::Min($bmp.Width - 1, $bb[2] + $pad); $y1 = [Math]::Min($bmp.Height - 1, $bb[3] + $pad)
            if ($x0 -gt 2 -or $y0 -gt 2 -or $x1 -lt $bmp.Width - 3 -or $y1 -lt $bmp.Height - 3) {
                $cw = $x1 - $x0 + 1; $ch = $y1 - $y0 + 1
                $crop = New-Object System.Drawing.Bitmap $cw, $ch, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                $gc = [System.Drawing.Graphics]::FromImage($crop); $gc.Clear([System.Drawing.Color]::Transparent)
                $gc.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $cw, $ch), $x0, $y0, $cw, $ch, [System.Drawing.GraphicsUnit]::Pixel); $gc.Dispose()
                $bmp.Dispose(); $bmp = $crop; $src = $crop; $keyed = $true      # forces a rewrite as PNG
                Write-Host ("  [aset] {0}: ruang kosong dipotong -> {1}x{2}" -f $base, $cw, $ch)
            }
        }
    }
    $max = Get-MaxSize $base
    $k = [Math]::Min(1.0, [Math]::Min($max[0] / $src.Width, $max[1] / $src.Height))
    $fmt = if ($base -like 'bg_*') { 'jpg' } elseif ($keyed) { 'png' } elseif ($ext -eq '.jpg') { 'jpg' } else { 'png' }
    $outPath = Join-Path $Dir ($base + '.' + $fmt)
    if ($k -ge 1.0 -and $outPath -eq $path -and -not $keyed) { $src.Dispose(); return }   # already fine

    # 4) scale down with high quality, keeping transparency
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
    $g.Dispose(); $src.Dispose()
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

# assets\sfx\senarai.json: audio files (sound effects & music) the game may play instead of its built-in beeps.
$sfxDir = Join-Path $PSScriptRoot 'assets\sfx'
if (Test-Path $sfxDir) {
    $aknown = @{}
    $alist = Join-Path $PSScriptRoot 'tools\audio-aset.json'
    if (Test-Path $alist) { ([regex]::Matches((Get-Content $alist -Raw -Encoding UTF8), '"id":\s*"([a-z0-9_]+)"')) | ForEach-Object { $aknown[$_.Groups[1].Value] = $true } }
    $apref = @{ '.mp3' = 4; '.m4a' = 3; '.ogg' = 2; '.wav' = 1 }
    $ahave = [ordered]@{}
    Get-ChildItem $sfxDir -File | Where-Object { $apref.ContainsKey($_.Extension.ToLower()) } | Sort-Object Name | ForEach-Object {
        $id = $_.BaseName.Trim().ToLower() -replace '[\s\-]+', '_'
        if ($id -cne $_.BaseName) { Rename-Item -LiteralPath $_.FullName -NewName ($id + $_.Extension.ToLower()); Write-Host "  [audio] nama dikemas: $($_.Name) -> $id$($_.Extension.ToLower())" }
        if ($aknown.Count -and -not $aknown.ContainsKey($id)) { Write-Host "  [audio] $id : nama tidak dikenali (semak tools\audio-aset.json)"; return }
        $p = $apref[$_.Extension.ToLower()]; $len = (Get-Item (Join-Path $sfxDir ($id + $_.Extension.ToLower()))).Length
        if (-not $ahave.Contains($id) -or $p -gt $ahave[$id].p) { $ahave[$id] = @{ p = $p; f = $id + $_.Extension.ToLower() + '?v=' + $len } }
    }
    $ajson = '{' + (($ahave.Keys | ForEach-Object { '"' + $_ + '":"' + $ahave[$_].f + '"' }) -join ',') + '}'
    $amf = Join-Path $sfxDir 'senarai.json'
    if (-not (Test-Path $amf) -or [System.IO.File]::ReadAllText($amf) -ne $ajson) {
        [System.IO.File]::WriteAllText($amf, $ajson, (New-Object System.Text.UTF8Encoding $false))
        Write-Host "  [audio] senarai.json dikemas kini ($($ahave.Count) audio)"
    }
}
