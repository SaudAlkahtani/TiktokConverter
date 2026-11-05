@echo off
setlocal
if "%~1"=="" (
  echo Drag a DaVinci Resolve master video onto this file to queue TikTok and Instagram exports.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\send-resolve-master.ps1" -VideoPath "%~1" -Platform both -OpenDashboard
set "result=%ERRORLEVEL%"
pause
exit /b %result%
