const { execFileSync } = require('node:child_process')
const {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { join } = require('node:path')

const KUN_RUNTIME_REQUIRED_PATHS = [
  'kun/dist/cli/serve-entry.js',
  'kun/dist/cli/extension-cli.js',
  'kun/dist/extensions/host-runner.js',
  'kun/package.json',
  'kun/package-lock.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/semver/package.json',
  'kun/node_modules/yauzl/package.json',
  'kun/node_modules/yazl/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json',
  'kun/node_modules/@kun/extension-api/package.json',
  'kun/node_modules/@kun/extension-api/dist/index.js',
  'kun/node_modules/create-kun-extension/package.json',
  'kun/node_modules/create-kun-extension/src/cli.mjs',
  'node_modules/better-sqlite3/package.json',
  'node_modules/bindings/package.json',
  'node_modules/file-uri-to-path/package.json',
  'packages/extension-api/dist/index.js',
  'packages/extension-api/schema/kun-extension.schema.json',
  'packages/extension-api/fixtures/api-major-negotiation.json',
  'packages/create-kun-extension/src/cli.mjs',
  'packages/create-kun-extension/src/scaffold.mjs',
  'packages/create-kun-extension/templates/node/kun-extension.json',
  'packages/create-kun-extension/templates/node/src/extension.ts',
  'packages/create-kun-extension/templates/react/kun-extension.json',
  'packages/create-kun-extension/templates/react/src/host/extension.ts',
  'packages/create-kun-extension/templates/react/src/webview/main.tsx',
  'packages/create-kun-extension/templates/webview/kun-extension.json',
  'packages/create-kun-extension/templates/webview/src/webview/main.ts'
]
const LINUX_SANDBOX_LAUNCHER_FLAG = '--disable-setuid-sandbox'
const LINUX_REAL_EXECUTABLE_SUFFIX = '.electron-bin'

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function appBundlePath(context) {
  return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
}

function packedResourcesDir(context) {
  if (normalizePlatform(context.electronPlatformName) === 'darwin') {
    return join(appBundlePath(context), 'Contents', 'Resources')
  }
  return join(context.appOutDir, 'resources')
}

function unpackedAppRoot(context) {
  return join(packedResourcesDir(context), 'app.asar.unpacked')
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`[after-pack] Missing ${label}: ${path}`)
  }
}

function npmCommand(args, platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args]
    }
  }
  return { command: 'npm', args }
}

function prunePackedKunDependencies(context) {
  const root = unpackedAppRoot(context)
  const kunDir = join(root, 'kun')
  if (!existsSync(kunDir)) return

  assertExists(join(kunDir, 'package.json'), 'Kun package manifest')
  assertExists(join(kunDir, 'node_modules'), 'Kun node_modules')

  const prune = npmCommand(['prune', '--omit=dev', '--ignore-scripts'])
  execFileSync(prune.command, prune.args, {
    cwd: kunDir,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    },
    stdio: 'inherit'
  })

  // Keep native SQLite on the app root dependency so electron-builder's
  // native-module rebuild owns the target arch and Electron ABI.
  assertExists(
    join(root, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
  rmSync(join(kunDir, 'node_modules', 'better-sqlite3'), { recursive: true, force: true })
}

function materializePackedWorkspaceDependencies(context) {
  const root = unpackedAppRoot(context)
  for (const [sourceRelative, targetRelative] of [
    ['packages/extension-api', 'kun/node_modules/@kun/extension-api'],
    ['packages/create-kun-extension', 'kun/node_modules/create-kun-extension']
  ]) {
    const source = join(root, sourceRelative)
    const target = join(root, targetRelative)
    assertExists(source, `workspace package source ${sourceRelative}`)
    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, { recursive: true, force: true })
    const details = lstatSync(target)
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`[after-pack] Workspace dependency was not materialized: ${targetRelative}`)
    }
  }
}

function validateBundledKunRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of KUN_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
  assertExists(
    join(root, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
}

function maybeAdhocSignMacApp(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'darwin') {
    return
  }

  if (
    process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
  ) {
    console.log('[after-pack] Developer ID signing is enabled, skipping ad-hoc signing.')
    return
  }

  const appBundle = appBundlePath(context)
  if (!existsSync(appBundle)) {
    throw new Error(`[after-pack] App bundle not found for ad-hoc signing: ${appBundle}`)
  }

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appBundle],
    { stdio: 'inherit' }
  )
}

// node-pty execs a bundled `spawn-helper` binary to fork the child shell.
// asar unpacking can drop the executable bit, which makes every PTY spawn
// fail with `posix_spawnp`. Re-chmod every bundled helper after packing so
// the built-in terminal works in the shipped app. Non-fatal: best effort.
function ensureNodePtyHelpersExecutable(context) {
  const root = unpackedAppRoot(context)
  const prebuildsDir = join(root, 'node_modules', 'node-pty', 'prebuilds')
  if (!existsSync(prebuildsDir)) return
  for (const folder of readdirSync(prebuildsDir)) {
    const helper = join(prebuildsDir, folder, 'spawn-helper')
    if (!existsSync(helper)) continue
    try {
      chmodSync(helper, 0o755)
    } catch (error) {
      console.warn(`[after-pack] could not chmod node-pty spawn-helper (${folder}):`, error.message)
    }
  }
}

function linuxRealExecutableName(executableName) {
  return `${executableName}${LINUX_REAL_EXECUTABLE_SUFFIX}`
}

function linuxElectronLauncherContent(executableName) {
  if (typeof executableName !== 'string' || !/^[0-9A-Za-z._-]+$/u.test(executableName)) {
    throw new Error(`[after-pack] Unsafe Linux executable name: ${String(executableName)}`)
  }
  const realExecutableName = linuxRealExecutableName(executableName)
  return `#!/bin/sh
set -eu

case "$0" in
  /*) launcher_path=$0 ;;
  *) launcher_path=$PWD/$0 ;;
esac
launcher_dir=\${launcher_path%/*}
launcher_dir=$(CDPATH= cd -P "$launcher_dir" && pwd -P)
real_executable="$launcher_dir/${realExecutableName}"

if [ "\${ELECTRON_RUN_AS_NODE:-}" = "1" ]; then
  exec "$real_executable" "$@"
fi

exec "$real_executable" ${LINUX_SANDBOX_LAUNCHER_FLAG} "$@"
`
}

function assertElfExecutable(path) {
  const header = Buffer.alloc(4)
  const descriptor = openSync(path, 'r')
  let bytesRead
  try {
    bytesRead = readSync(descriptor, header, 0, header.length, 0)
  } finally {
    closeSync(descriptor)
  }
  if (bytesRead !== 4 || !header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error(`[after-pack] Linux Electron executable is not an ELF payload: ${path}`)
  }
}

function installLinuxElectronLauncher(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'linux') return
  if (context.packager?.config?.electronFuses != null) {
    throw new Error(
      '[after-pack] electronFuses cannot be applied after installing the Linux shell launcher'
    )
  }
  const executableName = context.packager?.executableName
  const launcherContent = linuxElectronLauncherContent(executableName)
  const executable = join(context.appOutDir, executableName)
  const realExecutable = join(context.appOutDir, linuxRealExecutableName(executableName))
  const details = lstatSync(executable)
  if (details.isSymbolicLink() || !details.isFile() || (details.mode & 0o111) === 0) {
    throw new Error(`[after-pack] Linux Electron executable must be a non-symlink executable file: ${executable}`)
  }
  assertElfExecutable(executable)
  if (existsSync(realExecutable)) {
    throw new Error(`[after-pack] Refusing to overwrite Linux Electron payload: ${realExecutable}`)
  }

  renameSync(executable, realExecutable)
  chmodSync(realExecutable, 0o755)
  // The running Electron process reports the renamed payload as process.execPath.
  // Any future app.relaunch()/new Linux target must re-enter this launcher or
  // explicitly preserve LINUX_SANDBOX_LAUNCHER_FLAG.
  writeFileSync(executable, launcherContent, { encoding: 'utf8', flag: 'wx', mode: 0o755 })
  chmodSync(executable, 0o755)
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 1) return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  throw new Error(`[after-pack] Unsupported Whisper runner arch: ${arch}`)
}

function prunePackedWhisperResources(context) {
  const whisperDir = join(packedResourcesDir(context), 'whisper')
  if (!existsSync(whisperDir)) return

  const keep = `${normalizePlatform(context.electronPlatformName)}-${normalizeArch(context.arch)}`
  for (const entry of readdirSync(whisperDir)) {
    if (entry === keep || entry === 'LICENSE.whisper.cpp') continue
    rmSync(join(whisperDir, entry), { recursive: true, force: true })
    console.log(`[after-pack] Removed non-target Whisper resource: ${entry}`)
  }
}

async function afterPack(context) {
  prunePackedKunDependencies(context)
  materializePackedWorkspaceDependencies(context)
  validateBundledKunRuntime(context)
  prunePackedWhisperResources(context)
  ensureNodePtyHelpersExecutable(context)
  installLinuxElectronLauncher(context)
  maybeAdhocSignMacApp(context)
}

exports.KUN_RUNTIME_REQUIRED_PATHS = KUN_RUNTIME_REQUIRED_PATHS
exports.LINUX_SANDBOX_LAUNCHER_FLAG = LINUX_SANDBOX_LAUNCHER_FLAG
exports._internals = {
  appBundlePath,
  packedResourcesDir,
  unpackedAppRoot,
  npmCommand,
  prunePackedKunDependencies,
  materializePackedWorkspaceDependencies,
  validateBundledKunRuntime,
  normalizeArch,
  prunePackedWhisperResources,
  ensureNodePtyHelpersExecutable,
  assertElfExecutable,
  installLinuxElectronLauncher,
  linuxElectronLauncherContent,
  linuxRealExecutableName
}
exports.default = afterPack
