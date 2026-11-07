[CmdletBinding()]
param(
    [string]$DestinationDirectory = [Environment]::GetFolderPath('Desktop'),
    [ValidateSet('auto', 'edge', 'chrome', 'brave')]
    [string]$Browser = 'auto'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $PSScriptRoot 'start-editor-desktop.ps1'
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw "The editor launcher is missing: $launcherPath" }
if (-not $DestinationDirectory) { throw 'Windows did not return a Desktop folder. Pass -DestinationDirectory with a folder you can write to.' }
New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null
$destination = (Resolve-Path -LiteralPath $DestinationDirectory).Path
$shortcutPath = Join-Path $destination 'Gym Editor Studio.lnk'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shell = New-Object -ComObject WScript.Shell
try {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershellPath
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherPath + '" -Browser ' + $Browser
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = 'Open Gym Editor Studio and start its local converter when needed.'
    $shortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',137'
    $shortcut.WindowStyle = 7
    $shortcut.Save()
} finally {
    if ($null -ne $shortcut) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}
Write-Output "Created desktop app shortcut: $shortcutPath"
