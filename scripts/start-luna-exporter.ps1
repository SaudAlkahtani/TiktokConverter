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
    # Start only this project's dedicated local Bot API, never OpenClaw.
    $converterEnvironmentPath = Join-Path $projectRoot '.env'
    if (Test-Path -LiteralPath $converterEnvironmentPath) {
        $converterEnvironment = Get-Content -Raw -LiteralPath $converterEnvironmentPath
        if ($converterEnvironment -match '(?m)^TELEGRAM_API_ROOT=http://(?:127\.0\.0\.1|localhost):8081\s*$' -and
            $converterEnvironment -match '(?m)^TELEGRAM_BOT_TOKEN=\S+') {
            $converterClient = [System.Net.Sockets.TcpClient]::new()
            try { $converterClient.Connect('127.0.0.1', 8081); $converterApiRunning = $true }
            catch { $converterApiRunning = $false }
            finally { $converterClient.Dispose() }
            if (-not $converterApiRunning) {
                $converterApiStarter = Join-Path $projectRoot 'scripts\start-local-bot-api.cmd'
                Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$converterApiStarter`"" -WindowStyle Hidden
                $converterApiDeadline = (Get-Date).AddSeconds(30)
                while ((Get-Date) -lt $converterApiDeadline) {
                    $converterClient = [System.Net.Sockets.TcpClient]::new()
                    try { $converterClient.Connect('127.0.0.1', 8081); break }
                    catch { Start-Sleep -Milliseconds 500 }
                    finally { $converterClient.Dispose() }
                }
            }
        }
    }
    $converterPortableNode = Join-Path $projectRoot 'tools\node\node.exe'
    $nodeCommand = if (Test-Path -LiteralPath $converterPortableNode) { $converterPortableNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
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
