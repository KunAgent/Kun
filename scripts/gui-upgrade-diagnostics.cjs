'use strict'

const { execFile } = require('node:child_process')
const { createWriteStream } = require('node:fs')
const { copyFile, mkdir, readdir, writeFile } = require('node:fs/promises')
const { homedir, tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { promisify } = require('node:util')

const run = promisify(execFile)

function attachGuiDiagnostics(gui, root) {
  const output = createWriteStream(join(root, 'gui-process.log'), { flags: 'a' })
  output.on('error', (error) => console.warn('GUI log capture:', error.message))
  const sources = [gui.app.process().stdout, gui.app.process().stderr].filter(Boolean)
  const onData = (chunk) => output.write(chunk)
  for (const source of sources) source.on('data', onData)
  const onConsole = (message) => output.write(`[renderer ${message.type()}] ${message.text()}\n`)
  gui.page.on('console', onConsole)
  gui.app.once('close', () => {
    for (const source of sources) source.removeListener('data', onData)
    gui.page.removeListener('console', onConsole)
    output.end()
  })
}

async function captureMacUpdateDiagnostics(root, bundle) {
  if (process.platform !== 'darwin') return
  const directory = join(root, 'mac-updater')
  await mkdir(directory, { recursive: true })
  const capture = async (name, command, args, filter = (value) => value) => {
    try {
      const result = await run(command, args, { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })
      await writeFile(join(directory, name), filter(result.stdout + result.stderr))
    } catch (error) {
      await writeFile(join(directory, `${name}.error`), String(error.stderr || error.message))
    }
  }
  await capture('processes.txt', 'ps', ['-axo', 'pid,ppid,pgid,command'],
    (value) => value.split('\n').filter(line => /Kun\.app|ShipIt|kun.*(?:serve|manager)/i.test(line)).join('\n'))
  await capture('shipit-system.log', 'log', ['show', '--style', 'compact', '--last', '15m',
    '--predicate', 'process == "ShipIt"'])
  const info = await run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier',
    join(bundle, 'Contents', 'Info.plist')], { timeout: 5000 })
  const bundleId = info.stdout.trim()
  if (!/^[a-zA-Z0-9.-]+$/.test(bundleId)) throw new Error('Invalid installed bundle identifier')
  const cache = join(homedir(), 'Library', 'Caches', `${bundleId}.ShipIt`)
  for (const file of ['ShipIt_stderr.log', 'ShipIt_stdout.log', 'ShipItState.plist']) {
    await copyFile(join(cache, file), join(directory, file)).catch(async (error) => {
      await writeFile(join(directory, `${file}.error`), `${error.code}: ${error.message}`)
    })
  }
}

async function archiveGuiUpgradeEvidence(parent, output) {
  const roots = (await readdir(parent, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('kun-gui-upgrade-'))
    .map(entry => entry.name).sort()
  await writeFile(`${output}.json`, JSON.stringify({ parent, roots }, null, 2))
  if (!roots.length) return
  // tar stores links without following them. Chromium leaves dangling
  // SingletonSocket links after exit, which break upload-artifact's glob walk.
  await run('tar', ['-czf', output, '--exclude=*/installed', '--exclude=*.exe',
    '--exclude=Singleton*', '-C', parent, ...roots], { timeout: 120_000 })
}

if (require.main === module) {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('GUI upgrade evidence collection requires a disposable CI account')
  }
  const parent = process.env.GUI_UPGRADE_EVIDENCE ||
    (process.platform === 'win32' ? process.env.APPDATA : tmpdir())
  archiveGuiUpgradeEvidence(parent, resolve('gui-upgrade-evidence.tar.gz'))
    .catch(error => { console.error(error); process.exitCode = 1 })
}

module.exports = { attachGuiDiagnostics, captureMacUpdateDiagnostics, archiveGuiUpgradeEvidence }
