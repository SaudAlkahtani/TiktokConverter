[CmdletBinding()]
param(
    [ValidateSet('auto', 'edge', 'chrome', 'brave')]
    [string]$Browser = 'auto',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot 'logs'
$logFile = Join-Path $logDirectory 'editor-desktop.log'
$errorLogFile = Join-Path $logDirectory 'editor-desktop-error.log'

function Test-EditorRunning([string]$Url) {
    try {
        $response = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 2
        return $response.ok -eq $true -and $null -ne $response.profile -and $null -ne $response.uploadLimitBytes
    } catch { return $false }
}

function Find-AppBrowser([string]$Choice) {
    $programRoots = @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA) |
        Where-Object { $_ } | Select-Object -Unique
    $relativePaths = @{
        edge = 'Microsoft\Edge\Application\msedge.exe'
        chrome = 'Google\Chrome\Application\chrome.exe'
        brave = 'BraveSoftware\Brave-Browser\Application\brave.exe'
    }
    $choices = if ($Choice -eq 'auto') { @('edge', 'chrome', 'brave') } else { @($Choice) }
    foreach ($name in $choices) {
        foreach ($root in $programRoots) {
            $candidate = Join-Path $root $relativePaths[$name]
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        }
    }
    return $null
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules') -PathType Container)) {
        throw "Dependencies are missing. Open this project folder and run npm ci once:`n$projectRoot"
    }
    $nodeCommand = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $nodeCommand) { throw 'Node.js is missing. Install Node.js 20 or newer, then run npm ci in the project folder.' }
    $nodeVersion = & $nodeCommand --version
    if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 20) { throw "Node.js 20 or newer is required. Found $nodeVersion." }

    # Loading the actual config honors PORT, .env, MEDIA_ROOT and custom FFmpeg paths.
    Push-Location -LiteralPath $projectRoot
    try {
        $portText = 'import {config} from "./src/config.js"; process.stdout.write(String(config.port));' | & $nodeCommand --input-type=module -
        if ($LASTEXITCODE -ne 0) { throw 'Could not load the application configuration. Run npm ci and check .env.' }
    } finally { Pop-Location }
    $port = 0
    if (-not [int]::TryParse([string]$portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { throw 'PORT must be a number from 1 to 65535 in .env.' }
    $baseUrl = "http://127.0.0.1:$port"

    # Two quick shortcut clicks must not start competing server processes.
    $mutex = New-Object System.Threading.Mutex($false, "Local\GymEditorStudio-$port")
    $ownsMutex = $false
    try {
        try { $ownsMutex = $mutex.WaitOne(30000) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
        if (-not $ownsMutex) { throw 'Another editor launch is still starting. Try the shortcut again in a moment.' }
        if (-not (Test-EditorRunning $baseUrl)) {
            New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
            # Keep the backend hidden; closing the editor window leaves conversions running.
            Start-Process -FilePath $nodeCommand -ArgumentList 'src/server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errorLogFile | Out-Null
            $deadline = (Get-Date).AddSeconds(25)
            while ((Get-Date) -lt $deadline -and -not (Test-EditorRunning $baseUrl)) { Start-Sleep -Milliseconds 500 }
            if (-not (Test-EditorRunning $baseUrl)) { throw "The editor server could not start. Check:`n$errorLogFile`nAnother application may already be using port $port." }
        }
    } finally {
        if ($ownsMutex) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }

    $editorUrl = "$baseUrl/editor"
    if (-not $NoBrowser) {
        $browserPath = Find-AppBrowser $Browser
        if ($browserPath) {
            Start-Process -FilePath $browserPath -ArgumentList @("--app=$editorUrl", '--new-window') -WindowStyle Normal | Out-Null
        } else {
            Write-Warning "A supported app browser was not found for '$Browser'. Opening the editor in your default browser."
            Start-Process $editorUrl | Out-Null
        }
    }
    Write-Output "Gym Editor Studio is ready at $editorUrl"
} catch {
    $failure = $_.Exception.Message
    if (-not $NoBrowser) {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.MessageBox]::Show($failure, 'Gym Editor Studio could not open', 'OK', 'Error') | Out-Null
        } catch { }
    }
    Write-Error $failure
    exit 1
}
