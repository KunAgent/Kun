const { spawnSync } = require('node:child_process')

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: options.shell ?? false
  })
}

function verifyNodePtyPrebuild() {
  try {
    const { loadNativeModule } = require('node-pty/lib/utils')
    if (process.platform === 'win32') {
      loadNativeModule('conpty')
      loadNativeModule('pty')
    } else {
      loadNativeModule('pty')
    }
    return true
  } catch (error) {
    console.error('[postinstall] node-pty prebuild could not be loaded:')
    console.error(error)
    return false
  }
}

let shouldRebuild = true

if (process.platform === 'win32' && verifyNodePtyPrebuild()) {
  console.log('[postinstall] using bundled node-pty Windows prebuilds.')
  shouldRebuild = false
}

if (shouldRebuild) {
  const rebuild = run('electron-rebuild', ['-f', '-w', 'node-pty'], {
    shell: process.platform === 'win32'
  })

  if (rebuild.status !== 0) {
    console.warn('[postinstall] electron-rebuild failed; checking bundled node-pty prebuilds.')
    if (!verifyNodePtyPrebuild()) {
      process.exit(rebuild.status || 1)
    }
  }
}

const fixPerms = run(process.execPath, ['./scripts/fix-node-pty-prebuild-perms.cjs'])
if (fixPerms.status !== 0) {
  process.exit(fixPerms.status || 1)
}
