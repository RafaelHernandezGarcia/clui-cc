#!/usr/bin/env node
// Clui CC environment doctor — cross-platform diagnostics

const { execSync } = require('child_process')
const { platform } = require('os')

const isWin = platform() === 'win32'

function check(label, ok, detail) {
  const status = ok ? 'PASS' : 'FAIL'
  const color = ok ? '\x1b[32m' : '\x1b[31m'
  const reset = '\x1b[0m'
  console.log(`  ${color}${status}${reset}  ${label} — ${detail}`)
  return ok ? 0 : 1
}

function versionGte(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va > vb) return true
    if (va < vb) return false
  }
  return true
}

let fail = 0

console.log('')
console.log('Clui CC Environment Check')
console.log('=========================')
console.log('')

if (isWin) {
  // ─── Windows checks ───
  let nodeVer = ''
  try {
    nodeVer = execSync('node --version', { encoding: 'utf-8' }).trim().replace(/^v/, '')
  } catch {}
  fail += check('Node.js', !!nodeVer && versionGte(nodeVer, '18.0.0'), nodeVer ? `v${nodeVer}` : 'not found — install from https://nodejs.org')

  let npmVer = ''
  try {
    npmVer = execSync('npm --version', { encoding: 'utf-8' }).trim()
  } catch {}
  fail += check('npm', !!npmVer, npmVer || 'not found')

  let claudeVer = ''
  try {
    claudeVer = execSync('claude --version', { encoding: 'utf-8' }).trim()
  } catch {}
  fail += check('Claude CLI', !!claudeVer, claudeVer || 'not found — npm install -g @anthropic-ai/claude-code')
} else {
  // ─── macOS: delegate to bash script ───
  const { spawnSync } = require('child_process')
  const { join } = require('path')
  const result = spawnSync('bash', [join(__dirname, 'doctor.sh')], {
    stdio: 'inherit',
  })
  process.exit(result.status)
}

console.log('')
if (fail > 0) {
  console.log('Some checks failed. Fix them above, then rerun:')
  console.log('')
  console.log('  npm run doctor')
  console.log('  .\\start.ps1')
  console.log('')
  process.exit(1)
} else {
  console.log('Environment looks good.')
  process.exit(0)
}
