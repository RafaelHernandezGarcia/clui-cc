# Clui CC — Windows launcher
# Usage: .\start.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# ── Preflight checks ──

Write-Host ""
Write-Host "--- Checking environment" -ForegroundColor Cyan

$fail = 0

# Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = (node --version) -replace '^v', ''
    if ([version]$nodeVer -ge [version]"18.0.0") {
        Write-Host "  OK: Node.js v$nodeVer" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: Node.js v$nodeVer is too old. Clui CC requires Node 18+." -ForegroundColor Red
        Write-Host "  To fix: Install from https://nodejs.org" -ForegroundColor Yellow
        $fail = 1
    }
} else {
    Write-Host "  FAIL: Node.js is not installed." -ForegroundColor Red
    Write-Host "  To fix: Install from https://nodejs.org" -ForegroundColor Yellow
    $fail = 1
}

# npm
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $npmVer = npm --version
    Write-Host "  OK: npm $npmVer" -ForegroundColor Green
} else {
    Write-Host "  FAIL: npm is not installed (should come with Node.js)." -ForegroundColor Red
    $fail = 1
}

# Claude CLI
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Host "  OK: Claude Code CLI found" -ForegroundColor Green
} else {
    Write-Host "  FAIL: Claude Code CLI is not installed." -ForegroundColor Red
    Write-Host "  To fix: npm install -g @anthropic-ai/claude-code" -ForegroundColor Yellow
    $fail = 1
}

if ($fail -ne 0) {
    Write-Host ""
    Write-Host "Some checks failed. Fix them above, then rerun:" -ForegroundColor Red
    Write-Host "  .\start.ps1" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "All checks passed." -ForegroundColor Green

# ── Install ──

if (-not (Test-Path "node_modules")) {
    Write-Host ""
    Write-Host "--- Installing dependencies" -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "npm install failed." -ForegroundColor Red
        exit 1
    }
}

# ── Build ──

Write-Host ""
Write-Host "--- Building Clui CC" -ForegroundColor Cyan
# Use node directly to avoid path issues with & in directory names
$electronVite = Join-Path $PSScriptRoot "node_modules\electron-vite\bin\electron-vite.js"
if (Test-Path $electronVite) {
    node $electronVite build --mode production
} else {
    npx electron-vite build --mode production
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed." -ForegroundColor Red
    exit 1
}

# ── Launch ──

Write-Host ""
Write-Host "--- Launching Clui CC" -ForegroundColor Cyan
Write-Host "  Alt+Space to toggle the overlay." -ForegroundColor Gray
Write-Host "  Use tray icon > Quit to close." -ForegroundColor Gray
Write-Host ""

$electronPath = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
if (Test-Path $electronPath) {
    # Use short (8.3) path to avoid & and spaces breaking the path when passed to Electron
    try {
        $fso = New-Object -ComObject Scripting.FileSystemObject
        $folder = $fso.GetFolder($PSScriptRoot)
        $appPath = $folder.ShortPath
    } catch {
        $appPath = $PSScriptRoot
    }
    Set-Location $appPath
    & $electronPath $appPath
} else {
    npx electron .
}
