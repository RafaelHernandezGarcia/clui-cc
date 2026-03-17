#!/usr/bin/env node
// Cross-platform postinstall: run patch-dev-icon.sh only on macOS

if (process.platform === 'darwin') {
  const { execSync } = require('child_process')
  const { join } = require('path')
  const script = join(__dirname, 'patch-dev-icon.sh')
  try {
    execSync(`bash "${script}"`, { stdio: 'inherit' })
  } catch (err) {
    console.warn('patch-dev-icon.sh failed (non-fatal):', err.message)
  }
}
