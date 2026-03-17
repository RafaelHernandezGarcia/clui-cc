@echo off
REM Clui CC launcher - double-click to start
REM Uses short path to avoid issues with & in folder names (e.g. "Science & Innovation")

cd /d "%~dp0"

REM Get short path (8.3 format) - avoids spaces and & breaking the path
for %%I in (.) do set "SHORT_PATH=%%~sI"
set "SHORT_PATH=%SHORT_PATH:~0,-1%"

REM Run PowerShell script (handles install, build, launch)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
