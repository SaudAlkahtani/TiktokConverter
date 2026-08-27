@echo off
setlocal
cd /d "%~dp0"
if exist "tools\node\node.exe" (
  "tools\node\node.exe" "src\server.js"
) else (
  node "src\server.js"
)
