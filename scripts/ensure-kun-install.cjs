const { existsSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { dirname, join } = require('node:path')

const REQUIRED_PATHS = [
  'kun/package-lock.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/semver/package.json',
  'kun/node_modules/yauzl/package.json',
  'kun/node_modules/yazl/package.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/typescript/package.json',
  'kun/node_modules/typescript/lib/typescript.js',
  'kun/node_modules/typescript-language-server/package.json',
  'kun/node_modules/typescript-language-server/lib/cli.mjs',
  'kun/node_modules/@cursor/sdk/package.json',
  'kun/node_modules/@earendil-works/pi-tui/package.json',
  'kun/node_modules/@xmldom/xmldom/package.json',
  'kun/node_modules/highlight.js/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json',
  'kun/node_modules/@kun/extension-api/package.json',
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

function ensureKunInstall() {
  if (!REQUIRED_PATHS.every((path) => existsSync(path))) {
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
