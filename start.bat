@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

:: 既存のプロセスを終了（再起動時に古いコードが残らないようにする）
echo Stopping existing processes...
powershell.exe -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -match 'alarm_monitor\.ps1' } | ForEach-Object { $_.Terminate() }" >nul 2>&1
powershell.exe -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -match 'server\.ps1' } | ForEach-Object { $_.Terminate() }" >nul 2>&1
timeout /t 1 /nobreak >nul

:: ロックファイルを削除（前のプロセスが残したロックをクリア）
if exist alarm_monitor.lock del /f alarm_monitor.lock >nul 2>&1

echo Starting Taskflow and Alarm Monitor...

:: Start the Alarm Monitor in the background
start /min powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File alarm_monitor.ps1

:: Start the main Server
powershell.exe -ExecutionPolicy Bypass -NoProfile -File server.ps1

:: Server exited, kill alarm_monitor
echo Shutting down Alarm Monitor...
powershell.exe -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -match 'alarm_monitor\.ps1' } | ForEach-Object { $_.Terminate() }"
pause
