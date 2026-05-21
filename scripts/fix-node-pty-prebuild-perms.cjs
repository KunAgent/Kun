/**
 * node-pty ships prebuilds with spawn-helper often mode 644 (non-executable).
 * macOS then fails PTY creation with: posix_spawnp failed.
 * Electron rebuild uses build/Release first (correct perms), but if rebuild
 * fails or is skipped, we fall back to prebuilds — chmod keeps that path usable.
 */
const fs = require('node:fs')
const path = require('node:path')

const nodePtyRoot = path.join(__dirname, '..', 'node_modules', 'node-pty')
const prebuildsRoot = path.join(nodePtyRoot, 'prebuilds')

function chmodSpawnHelpersUnder(dir) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      const helper = path.join(full, 'spawn-helper')
      if (fs.existsSync(helper)) {
        try {
          fs.chmodSync(helper, 0o755)
        } catch {
          /* ignore */
        }
      }
    }
  }
}

chmodSpawnHelpersUnder(prebuildsRoot)
