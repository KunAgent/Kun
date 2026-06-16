const { spawnSync } = require('node:child_process')

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  })
}

require('./ensure-kun-install.cjs')

const buildKun = run('npm', ['--prefix', 'kun', 'run', 'build'])
if (buildKun.status !== 0) {
  process.exit(buildKun.status || 1)
}

// Kun is spawned with the Electron binary (ELECTRON_RUN_AS_NODE) and resolves
// better-sqlite3 from the root node_modules, so the native module must match
// Electron's ABI — the node-ABI prebuild that `npm install` fetches cannot be
// loaded there and Kun would silently fall back to JSONL scanning. Best
// effort: a failure (e.g. offline) keeps the JSONL fallback working.
const { join } = require('node:path')
try {
  const electronVersion = require('electron/package.json').version
  const result = run('npx', [
    '--yes',
    'prebuild-install',
    `--runtime=electron`,
    `--target=${electronVersion}`
  ], { cwd: join(__dirname, '..', 'node_modules', 'better-sqlite3') })
  if (result.status !== 0) {
    console.warn('[postinstall] better-sqlite3 electron prebuild failed; Kun will use the JSONL fallback')
  }
} catch (error) {
  console.warn('[postinstall] skipped better-sqlite3 electron prebuild:', error.message)
}

// node-pty is a native module used by the built-in terminal and is always
// loaded inside the Electron main process. It ships its own prebuilt
// `pty.node` + `spawn-helper` binaries under prebuilds/<plat>-<arch>/, but
// npm does not always preserve the executable bit on `spawn-helper`, which
// node-pty execs to fork the child — without it `posix_spawnp` fails. Best
// effort: re-chmod the helper for every bundled platform so the terminal
// works out of the box. A failure is non-fatal.
try {
  const { existsSync, readdirSync, chmodSync } = require('node:fs')
  const prebuildsDir = join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
  if (existsSync(prebuildsDir)) {
    for (const folder of readdirSync(prebuildsDir)) {
      const helper = join(prebuildsDir, folder, 'spawn-helper')
      if (existsSync(helper)) {
        try {
          chmodSync(helper, 0o755)
        } catch (error) {
          console.warn(`[postinstall] could not chmod node-pty spawn-helper (${folder}):`, error.message)
        }
      }
    }
  }
} catch (error) {
  console.warn('[postinstall] skipped node-pty spawn-helper chmod:', error.message)
}

// Some environments also need an Electron-ABI rebuild (no Node prebuild
// matches). This is best-effort; the bundled prebuilds already target an
// ABI-compatible Node build for current Electron versions, so a failure here
// is usually harmless and leaves the terminal working.
try {
  const electronVersion = require('electron/package.json').version
  const result = run('npx', [
    '--yes',
    'prebuild-install',
    `--runtime=electron`,
    `--target=${electronVersion}`
  ], { cwd: join(__dirname, '..', 'node_modules', 'node-pty') })
  if (result.status !== 0) {
    console.warn('[postinstall] node-pty electron prebuild fell back to bundled binaries')
  }
} catch (error) {
  console.warn('[postinstall] skipped node-pty electron prebuild:', error.message)
}
