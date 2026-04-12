@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"
echo Starting Taskflow and Alarm Monitor...

:: Start the Alarm Monitor in the background
start /min powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File alarm_monitor.ps1

:: Start the main Server
powershell.exe -ExecutionPolicy Bypass -NoProfile -File server.ps1

:: Server exited, kill alarm_monitor
echo Shutting down Alarm Monitor...
powershell.exe -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -match 'alarm_monitor.ps1' } | ForEach-Object { $_.Terminate() }"
pause
