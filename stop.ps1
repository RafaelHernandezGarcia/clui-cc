# Clui CC — Stop script (Windows)
# Stops any running Electron/Clui CC processes

Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "Clui CC" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Clui CC stopped." -ForegroundColor Green
