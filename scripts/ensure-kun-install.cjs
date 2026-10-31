const { existsSync, readFileSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { dirname, join } = require('node:path')

const REQUIRED_PATHS = [
  'kun/package-lock.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/semver/package.json',
  'kun/node_modules/smol-toml/package.json',
  'kun/node_modules/yauzl/package.json',
  'kun/node_modules/yazl/package.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/typescript/package.json',
  'kun/node_modules/typescript/lib/typescript.js',
  'kun/node_modules/typescript-language-server/package.json',
  'kun/node_modules/typescript-language-server/lib/cli.mjs',
  'kun/node_modules/@cursor/sdk/package.json',
  'kun/node_modules/@opentui/core/package.json',
  'kun/node_modules/@opentui/solid/package.json',
  'kun/node_modules/solid-js/package.json',
  'kun/node_modules/@xmldom/xmldom/package.json',
  'kun/node_modules/highlight.js/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json',
  'kun/node_modules/@kun/extension-api/package.json',
  'kun/node_modules/@kun/remote-protocol/package.json',
  'kun/node_modules/@kun/provider-catalog/package.json',
  'kun/node_modules/@kun/provider-catalog/dist/index.js',
  'kun/node_modules/create-kun-extension/package.json'
]
const KUN_SQLITE_MODULE_PATH = 'kun/node_modules/better-sqlite3'

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    }
  })
}

function npmInvocation(args) {
  if (process.platform !== 'win32') return { command: 'npm', args }
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter((candidate) => candidate && existsSync(candidate))
  const npmCli = candidates[0]
  if (!npmCli) {
    throw new Error('Unable to locate npm-cli.js for a shell-free Windows npm invocation.')
  }
  return { command: process.execPath, args: [npmCli, ...args] }
}

// Root npm ci does not replace an existing nested runtime node_modules directory.
// The vendored protocol must follow the runtime lock, not merely exist on disk.
function remoteProtocolMatchesLock() {
  try {
    const manifest = JSON.parse(readFileSync('kun/package.json', 'utf8'))
    const lock = JSON.parse(readFileSync('kun/package-lock.json', 'utf8'))
    const installed = JSON.parse(readFileSync('kun/node_modules/@kun/remote-protocol/package.json', 'utf8'))
    const declared = manifest.dependencies?.['@kun/remote-protocol']
    const locked = lock.packages?.['node_modules/@kun/remote-protocol']
    return typeof declared === 'string' && declared === lock.packages?.['']?.dependencies?.['@kun/remote-protocol'] &&
      typeof locked?.version === 'string' && installed.version === locked.version
  } catch {
    // Missing/legacy/incomplete installations still take the existing npm ci path.
    return false
  }
}

function ensureKunInstall() {
  if (!REQUIRED_PATHS.every((path) => existsSync(path)) || !remoteProtocolMatchesLock()) {
    const npm = npmInvocation(['--prefix', 'kun', 'ci'])
    const installKun = run(npm.command, npm.args)
    if (installKun.status !== 0) {
      process.exit(installKun.status || 1)
    }
  }

  if (existsSync(KUN_SQLITE_MODULE_PATH)) {
    rmSync(KUN_SQLITE_MODULE_PATH, { recursive: true, force: true })
    return
  }
}

ensureKunInstall()
