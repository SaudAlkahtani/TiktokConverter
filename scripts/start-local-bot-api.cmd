@echo off
for /f "delims=" %%P in ('wsl.exe -d Ubuntu-24.04 -- wslpath -u "%~dp0..\local-bot-api\start-server.sh"') do set "CONVERTER_API_SCRIPT=%%P"
wsl.exe -d Ubuntu-24.04 -- bash "%CONVERTER_API_SCRIPT%"
