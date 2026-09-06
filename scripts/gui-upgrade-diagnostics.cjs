'use strict'

const { execFile } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { createWriteStream } = require('node:fs')
const { copyFile, lstat, mkdir, readFile, readdir, writeFile } = require('node:fs/promises')
const { homedir, tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const { promisify } = require('node:util')

const run = promisify(execFile)
const { poll } = require('./smoke-packaged-update-handoff-support.cjs')

async function attachGuiDiagnostics(app, journal, label) {
  const child = app.process()
  const streams = []
  for (const name of ['stdout', 'stderr']) {
    if (!child[name]) continue
    const output = createWriteStream(join(journal.record.evidence, `gui.${name}.log`), { flags: 'a' })
    output.on('error', error => journal.event('log_capture_error', { stream: name, error: error.message }))
    const onData = chunk => output.write(chunk)
    child[name].on('data', onData)
    streams.push({ source: child[name], output, onData })
  }
  child.once('exit', (exitCode, signal) => {
    journal.record[`${label}LauncherExit`] = { pid: child.pid, exitCode, signal }
    journal.event('launcher_exited', { label, pid: child.pid, exitCode, signal })
  })
  app.once('close', () => {
    for (const { source, output, onData } of streams) {
      source.removeListener('data', onData)
      output.end()
    }
  })
  return app.evaluate(({ app, autoUpdater }, { eventPath, label, captureId }) => {
    const fs = process.getBuiltinModule('fs')
    const metadata = { pid: process.pid, version: app.getVersion(), executable: process.execPath, captureId }
    const write = (event, details = {}) => {
      try {
        fs.appendFileSync(eventPath, JSON.stringify({ time: new Date().toISOString(), event, label,
          ...metadata, ...details }) + '\n')
      } catch (error) { console.error('Upgrade event log:', error.message) }
    }
    app.on('before-quit', () => write('app_before_quit'))
    app.on('will-quit', () => write('app_will_quit'))
    autoUpdater.on('before-quit-for-update', () => write('before_quit_for_update'))
    autoUpdater.on('update-downloaded', () => write('native_update_downloaded'))
    autoUpdater.on('error', error => write('native_updater_error', { error: error.message }))
    process.once('exit', exitCode => write('gui_exited', { exitCode }))
    return metadata
  }, { eventPath: journal.eventPath, label, captureId: randomUUID() })
}

async function closeGuiWithExitEvidence(gui, eventPath, timeoutMs = 180_000) {
  const metadata = gui.processInfo
  if (!metadata?.captureId) throw new Error('GUI close requires its native capture identity')
  const child = gui.app.process()
  let closeError
  let terminalFailure
  // Electron/Playwright may wait on a pipe inherited by the independent Manager
  // after both original GUI processes exit. Do not wait for that transport here.
  void Promise.resolve().then(() => gui.app.close()).catch(error => { closeError = error })
  const proof = await poll(async () => {
    if (child.signalCode || (child.exitCode != null && child.exitCode !== 0)) {
      terminalFailure = new Error(`GUI launcher exited abnormally: ${child.signalCode || child.exitCode}`)
      throw terminalFailure
    }
    const contents = await readFile(eventPath, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    // Ignore only the incomplete final append, not malformed complete records.
    const events = contents.split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line))
    const exited = events.find(event => event.event === 'gui_exited' &&
      event.captureId === metadata.captureId && event.pid === metadata.pid)
    if (exited && exited.exitCode !== 0) {
      terminalFailure = new Error(`GUI exited abnormally: ${exited.exitCode}`)
      throw terminalFailure
    }
    if (exited && child.exitCode === 0) {
      return { captureId: metadata.captureId, pid: metadata.pid, exitCode: 0,
        launcherPid: child.pid, launcherExitCode: child.exitCode }
    }
    if (closeError) throw closeError
    return undefined
  }, timeoutMs, 'original GUI and launcher exit', () => { if (terminalFailure) throw terminalFailure })
  return proof
}

async function captureMacProcesses(root, stage) {
  if (process.platform !== 'darwin') return
  const result = await run('ps', ['-axo', 'pid,ppid,pgid,command'], { timeout: 10_000 })
  await writeFile(join(root, `processes-${stage}.txt`), result.stdout.split('\n')
    .filter(line => /Kun\.app|ShipIt|kun.*(?:serve|manager)/i.test(line)).join('\n'))
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

async function collectGuiUpgradeEvidence(parent, output, operations = {}) {
  const copy = operations.copyFile || copyFile
  const warnings = []
  const skipped = []
  const warning = (path, error) => warnings.push({ path, code: error.code, error: error.message })
  await mkdir(output, { recursive: true })
  const entries = await readdir(parent, { withFileTypes: true }).catch(error => { warning(parent, error); return [] })
  const roots = entries.filter(entry => entry.isDirectory() && entry.name.startsWith('kun-gui-upgrade-'))
    .map(entry => entry.name).sort()
  const collect = async (source, destination) => {
    try {
      const info = await lstat(source)
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        skipped.push({ path: source, reason: 'special file or symbolic link' })
        return
      }
      if (info.isDirectory()) {
        await mkdir(destination, { recursive: true })
        for (const entry of await readdir(source)) {
          if (entry === 'installed' || entry.endsWith('.exe')) continue
          await collect(join(source, entry), join(destination, entry))
        }
      } else {
        await mkdir(dirname(destination), { recursive: true })
        await copy(source, destination)
      }
    } catch (error) { warning(source, error) }
  }
  for (const root of roots) await collect(join(parent, root), join(output, root))
  const index = { parent, roots, warnings, skipped }
  await writeFile(join(output, 'index.json'), JSON.stringify(index, null, 2))
  return index
}

if (require.main === module) {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('GUI upgrade evidence collection requires a disposable CI account')
  }
  const parent = process.env.GUI_UPGRADE_EVIDENCE ||
    (process.platform === 'win32' ? process.env.APPDATA : tmpdir())
  collectGuiUpgradeEvidence(parent, resolve('gui-upgrade-evidence'))
    .catch(error => { console.error(error); process.exitCode = 1 })
}

module.exports = { closeGuiWithExitEvidence, attachGuiDiagnostics, captureMacProcesses, captureMacUpdateDiagnostics, collectGuiUpgradeEvidence }
