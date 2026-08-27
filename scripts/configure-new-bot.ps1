[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$examplePath = Join-Path $projectRoot '.env.example'
$environmentPath = Join-Path $projectRoot '.env'
if (-not (Test-Path $environmentPath)) { Copy-Item $examplePath $environmentPath }

$username = Read-Host 'New dedicated exporter bot username, for example @MyLunaExporterBot'
$token = Read-Host 'API token for that new bot from BotFather (visible input)'
if ($username -notmatch '^@[A-Za-z0-9_]{5,}$') { throw 'Enter a valid bot username beginning with @. No configuration was changed.' }
if ($token -notmatch '^\d+:[A-Za-z0-9_-]{20,}$') { throw 'That does not look like a Telegram bot token. No configuration was changed.' }

$content = Get-Content -Raw $environmentPath
$content = [regex]::Replace($content, '(?m)^TELEGRAM_BOT_USERNAME=.*$', "TELEGRAM_BOT_USERNAME=$username")
$content = [regex]::Replace($content, '(?m)^TELEGRAM_BOT_TOKEN=.*$', "TELEGRAM_BOT_TOKEN=$token")
Set-Content -LiteralPath $environmentPath -Value $content -NoNewline
Write-Host "Saved the dedicated $username configuration locally. It is separate from OpenClaw." -ForegroundColor Green
