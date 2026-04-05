@echo off
setlocal
cd /d "%~dp0"
echo Starting Local Task Management Server...
powershell.exe -ExecutionPolicy Bypass -NoProfile -File server.ps1
pause
