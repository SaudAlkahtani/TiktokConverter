[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$VideoPath,
    [ValidateSet('tiktok', 'instagram', 'both')]
    [string]$Platform = 'both',
    [switch]$OpenDashboard,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$source = Get-Item -LiteralPath $VideoPath -ErrorAction Stop
if ($source.PSIsContainer -or $source.Length -eq 0) {
    throw 'Choose a non-empty video file exported from DaVinci Resolve.'
}

$baseUrl = 'http://127.0.0.1:4173'
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 5
} catch {
    throw "The local converter is not running. Start Start-Local-Converter.cmd, then try again. ($($_.Exception.Message))"
}
if (-not $health.ok) { throw 'The local converter did not report a healthy status.' }
if ($health.uploadLimitBytes -and $source.Length -gt [double]$health.uploadLimitBytes) {
    throw "This master is larger than the converter's upload limit. Increase MAX_INPUT_GB in .env or export a smaller master."
}

Write-Host "Master: $($source.FullName)"
Write-Host ('Size: {0:N2} GB' -f ($source.Length / 1GB))
Write-Host "Destination: $Platform"
if ($CheckOnly) {
    Write-Host 'Preflight passed. No file was uploaded.'
    return
}

$curl = (Get-Command curl.exe -ErrorAction Stop).Source
$uploadUrl = "$baseUrl/api/uploads?platform=$Platform"
$body = & $curl --silent --show-error --fail-with-body --connect-timeout 10 --form "video=@$($source.FullName)" -- $uploadUrl
if ($LASTEXITCODE -ne 0) { throw "Upload failed. Server response: $body" }
$response = $body | ConvertFrom-Json
$jobs = @($response.jobs)
if (-not $jobs.Count) { throw 'The converter did not return any queued jobs.' }

foreach ($job in $jobs) {
    foreach ($output in @($job.outputs)) {
        Write-Host "Queued $($output.platform) job $($output.id)"
    }
}
if (@($response.rejected).Count) {
    Write-Warning "$(@($response.rejected).Count) upload(s) were rejected. Check the dashboard."
}
Write-Host 'The Resolve master was kept in place. Watch progress in the local dashboard.'
if ($OpenDashboard) { Start-Process "$baseUrl/$Platform" }
