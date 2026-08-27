[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ProjectName,

    [string]$WorkspaceRoot
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
    # Keep large media beside the cloned repository, never inside its Git tree.
    $WorkspaceRoot = Join-Path (Split-Path -Parent $repositoryRoot) 'Luna Video Projects'
}

$safeName = ($ProjectName -replace '[<>:"/\\|?*]', '-' -replace '\s+', '-' -replace '-+', '-').Trim('-').ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($safeName)) { throw 'ProjectName must contain at least one valid filename character.' }

$datePrefix = Get-Date -Format 'yyyy-MM-dd'
$projectPath = Join-Path $WorkspaceRoot "$datePrefix-$safeName"
if (Test-Path -LiteralPath $projectPath) { throw "Project folder already exists: $projectPath" }

$folders = @(
    '01-Camera-originals',
    '02-Proxies',
    '03-Edit-project',
    '04-Edit-master',
    '05-TikTok-delivery',
    '06-Notes'
)

foreach ($folder in $folders) {
    New-Item -ItemType Directory -Force -Path (Join-Path $projectPath $folder) | Out-Null
}

Write-Host "Created video project: $projectPath" -ForegroundColor Green
Write-Host 'Copy camera files to 01-Camera-originals and save your editor project in 03-Edit-project.'
