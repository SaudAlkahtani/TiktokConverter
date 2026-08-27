[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$secretsPath = Join-Path $projectRoot 'local-bot-api\secrets.env'
$environmentPath = Join-Path $projectRoot '.env'
$apiId = Read-Host 'Telegram API ID from https://my.telegram.org/apps'
$apiHash = Read-Host 'Telegram API hash from https://my.telegram.org/apps (visible input)'
if ($apiId -notmatch '^\d+$' -or $apiHash -notmatch '^[A-Fa-f0-9]{32}$') { throw 'Invalid API ID or API hash. Nothing was changed.' }

function Test-LocalBotApiPort {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { $client.Connect('127.0.0.1', 8081); return $true } catch { return $false } finally { $client.Dispose() }
}

Set-Content -LiteralPath $secretsPath -NoNewline -Value "TELEGRAM_API_ID=$apiId`nTELEGRAM_API_HASH=$apiHash`n"
New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'local-bot-api\data') | Out-Null

$startScript = Join-Path $projectRoot 'scripts\start-local-bot-api.cmd'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$startScript`"" -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  if (Test-LocalBotApiPort) { break }
  Start-Sleep -Milliseconds 500
}
if (-not (Test-LocalBotApiPort)) { throw 'Local Bot API Server did not start. Open local-bot-api/start-server.sh logs and retry.' }

if (-not (Test-Path $environmentPath)) { Copy-Item (Join-Path $projectRoot '.env.example') $environmentPath }
$environment = Get-Content -Raw $environmentPath
$tokenMatch = [regex]::Match($environment, '(?m)^TELEGRAM_BOT_TOKEN=(.+)$')
if (-not $tokenMatch.Success -or [string]::IsNullOrWhiteSpace($tokenMatch.Groups[1].Value)) { throw 'Configure the new dedicated bot token with scripts/configure-new-bot.ps1 before enabling Local Bot API.' }
$token = $tokenMatch.Groups[1].Value.Trim()

# Telegram requires a bot to be logged out from the public Bot API before the
# same token is served through a Local Bot API Server.  This affects only the
# dedicated exporter token from this project's .env file.
try {
    $logout = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/logOut"
    if (-not $logout.ok) { throw 'Telegram did not confirm logOut.' }
} catch {
    throw "Could not hand the dedicated bot over to the Local Bot API Server: $($_.Exception.Message)"
}

try {
    $localIdentity = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8081/bot$token/getMe"
    if (-not $localIdentity.ok) { throw 'The local server did not confirm the bot token.' }
} catch {
    throw "The Local Bot API Server started but could not use the dedicated bot token: $($_.Exception.Message)"
}

$environment = [regex]::Replace($environment, '(?m)^TELEGRAM_API_ROOT=.*$', 'TELEGRAM_API_ROOT=http://127.0.0.1:8081')
Set-Content -LiteralPath $environmentPath -NoNewline -Value $environment
Write-Host 'Local 4K Telegram server enabled for the dedicated exporter bot. Restart the Luna desktop shortcut.' -ForegroundColor Green
