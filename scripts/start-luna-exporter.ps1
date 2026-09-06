[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot 'logs'
$logFile = Join-Path $logDirectory 'luna-exporter.log'
$errorLogFile = Join-Path $logDirectory 'luna-exporter-error.log'
$port = 4173

function Test-ExporterRunning {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch { return $false }
}

if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('The converter dependencies are missing. Open the project folder and run npm install once.', 'Local Video Converter') | Out-Null
    exit 1
}

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
if (-not (Test-ExporterRunning)) {
    $nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
    Start-Process -FilePath $nodeCommand -ArgumentList 'src/server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errorLogFile
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if (Test-ExporterRunning) { break }
    }
}

if (Test-ExporterRunning) {
    try { Start-Process 'http://127.0.0.1:4173' } catch { Write-Host 'Exporter is running at http://127.0.0.1:4173' }
} else {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("The converter could not start. Check the log at:`n$logFile", 'Local Video Converter') | Out-Null
}
