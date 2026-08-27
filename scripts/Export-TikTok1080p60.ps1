[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$InputPath,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputDirectory,

    [ValidateSet('pad', 'crop')]
    [string]$Fit = 'pad',

    [switch]$OpenTikTok
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$source = Get-Item -LiteralPath $InputPath -ErrorAction Stop
if ($source.PSIsContainer) { throw 'InputPath must point to a rendered video file, not a folder.' }

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$outputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$safeBase = ($source.BaseName -replace '[^A-Za-z0-9_-]', '_' -replace '_+', '_').Trim('_')
if ([string]::IsNullOrWhiteSpace($safeBase)) { $safeBase = 'video' }
$outputPath = Join-Path $outputDirectory ("{0}_tiktok_1080p60.mp4" -f $safeBase)
if (Test-Path -LiteralPath $outputPath) { throw "Refusing to overwrite an existing delivery: $outputPath" }

$bundledFfmpeg = Join-Path $repositoryRoot 'node_modules\ffmpeg-static\ffmpeg.exe'
if ($env:FFMPEG_PATH -and (Test-Path -LiteralPath $env:FFMPEG_PATH)) {
    $ffmpeg = $env:FFMPEG_PATH
} elseif (Test-Path -LiteralPath $bundledFfmpeg) {
    $ffmpeg = $bundledFfmpeg
} elseif (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) {
    $ffmpeg = (Get-Command ffmpeg.exe -ErrorAction Stop).Source
} else {
    throw 'FFmpeg was not found. Run npm ci in this repository or set FFMPEG_PATH to ffmpeg.exe.'
}

$videoFilter = if ($Fit -eq 'crop') {
    'scale=1080:1920:force_original_aspect_ratio=increase:force_divisible_by=2,crop=1080:1920,setsar=1,fps=60,format=yuv420p'
} else {
    'scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=60,format=yuv420p'
}

$arguments = @(
    '-hide_banner', '-n', '-i', $source.FullName,
    '-map', '0:v:0', '-map', '0:a?',
    '-vf', $videoFilter,
    '-c:v', 'libx264', '-preset', 'slow', '-b:v', '12M', '-maxrate', '16M', '-bufsize', '32M',
    '-profile:v', 'high', '-level:v', '4.2', '-pix_fmt', 'yuv420p',
    '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-r', '60', '-fps_mode', 'cfr',
    '-video_track_timescale', '60000', '-tag:v', 'avc1',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-write_tmcd', '0', $outputPath
)

Write-Host "Creating TikTok delivery from $($source.Name)..." -ForegroundColor Cyan
& $ffmpeg @arguments
if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed with exit code $LASTEXITCODE. No delivery was created." }

Write-Host "Delivery ready: $outputPath" -ForegroundColor Green
if ($OpenTikTok) {
    Start-Process 'https://www.tiktok.com/tiktokstudio/upload'
    Write-Host 'TikTok Studio opened. Review the delivery, add its caption and settings, then publish.'
}
