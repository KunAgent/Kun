#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtemp, mkdir, readFile, writeFile, rm, chmod, readdir } = require('node:fs/promises')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const { createIsolatedEnvironment } = require('./smoke-packaged-extension-desktop-runtime.cjs')

const root = resolve(__dirname, '..')
const alive = (pid) => {
  try { process.kill(pid, 0); return true } catch { return false }
}
const sleep = (ms) => new Promise((accept) => setTimeout(accept, ms))
async function removeFixture(directory) {
  // Installed extensions intentionally have read-only directories. Only walk
  // this test's mkdtemp tree, and never follow symlinks outside the fixture.
  await chmod(directory, 0o700)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await removeFixture(join(directory, entry.name))
    else if (entry.isFile()) await chmod(join(directory, entry.name), 0o600)
  }
  await rm(directory, { recursive: true, force: true })
}
async function until(check, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await sleep(100)
  }
  throw new Error(`App lifetime condition exceeded ${timeout}ms`)
}
async function unusedPort() {
  const server = createServer()
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept) })
  const port = server.address().port
  await new Promise((accept) => server.close(accept))
  return port
}
function descendants(pid) {
  const rows = process.platform === 'win32'
    ? JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'],
    { encoding: 'utf8', timeout: 5_000 })).map((row) => [Number(row.ProcessId), Number(row.ParentProcessId)])
    : execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
      .trim().split('\n').map((row) => row.trim().split(/\s+/).map(Number))
  const result = new Set([pid])
  let changed = true
  while (changed) {
    changed = false
    for (const [child, parent] of rows) {
      if (result.has(parent) && !result.has(child)) { result.add(child); changed = true }
    }
  }
  return [...result]
}
async function profile(temporary, name) {
  const path = join(temporary, name)
  const paths = { home: join(path, 'home'), appData: join(path, 'app-data'),
    localAppData: join(path, 'local-app-data'), temporaryDirectory: join(path, 'tmp') }
  await Promise.all(Object.values(paths).map((directory) => mkdir(directory, { recursive: true })))
  const control = join(path, 'control')
  const settingsPath = join(paths.appData, 'Kun', 'kun-settings.json')
  await mkdir(join(paths.appData, 'Kun'), { recursive: true })
  const dataDir = join(paths.home, '.kun', 'data')
  const port = await unusedPort()
  await writeFile(settingsPath, JSON.stringify({ version: 1, locale: 'en',
    agents: { kun: { autoStart: true, dataDir, port, runtimeToken: 'isolated-lifetime-test' } },
    schedule: { internal: { port: await unusedPort(), secret: 'isolated-schedule-test' } },
    claw: { im: { port: await unusedPort() } },
    appBehavior: { closeAction: 'tray', closeToTray: true }
  }))
  return { path, paths, control, dataDir, settingsPath, port,
    env: { ...createIsolatedEnvironment(process.env, paths),
      KUN_APP_FLAVOR: 'development', KUN_RUNTIME_FLAVOR: 'development',
      KUN_MANAGER_CONTROL_DIR: control, KUN_MANAGER_SETTINGS_PATH: settingsPath,
      KUN_ALLOW_DEVELOPMENT_MANAGER_BOOTSTRAP: '1', KUN_STARTUP_TRACE: '1' } }
}

async function launch(profile) {
  const packagedExecutable = process.env.KUN_LIFETIME_APP_EXECUTABLE?.trim()
  const app = await _electron.launch({ executablePath: packagedExecutable || require('electron'),
    args: [...(packagedExecutable ? [] : [root]), '--kun-app-flavor=development'], env: profile.env, timeout: 60_000 })
  const appProcess = app.process()
  let output = ''
  appProcess.stderr?.on('data', (chunk) => { output = (output + chunk).slice(-100_000) })
  appProcess.stdout?.on('data', (chunk) => { output = (output + chunk).slice(-100_000) })
  try {
    const manager = await until(async () => {
      try {
        const value = JSON.parse(await readFile(join(profile.control, 'manager.json'), 'utf8'))
        if (!value.appOwner || value.appOwner.ownerPid !== appProcess.pid) return false
        return value
      } catch { return false }
    })
    const runtime = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${profile.port}/v1/runtime/info`, {
        headers: { authorization: 'Bearer isolated-lifetime-test' }, signal: AbortSignal.timeout(1000)
      }).catch(() => null)
      return response?.ok ? response.json() : false
    })
    assert.equal(manager.appOwner.ownerKind, 'gui')
    const settings = JSON.parse(await readFile(profile.settingsPath, 'utf8'))
    assert.equal(settings.appBehavior.closeAction, 'quit')
    return { app, process: appProcess, manager, runtime, profile, output: () => output }
  } catch (error) {
    await writeFile(join(profile.path, 'startup-failure.log'), output)
    await app.close().catch(() => undefined)
    throw error
  }
}

async function stop(instance, crash = false) {
  const pids = descendants(instance.process.pid)
  if (!pids.includes(instance.manager.pid)) pids.push(instance.manager.pid)
  if (Number.isInteger(instance.runtime.pid) && !pids.includes(instance.runtime.pid)) pids.push(instance.runtime.pid)
  const started = Date.now()
  if (crash) instance.process.kill('SIGKILL')
  else await instance.app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
    const main = windows.find((window) => window.webContents.getURL().includes('/renderer/index.html'))
      ?? windows.find((window) => window.isVisible())
    if (!main) throw new Error('No main window to close')
    main.close()
  }).catch((error) => {
    if (alive(instance.process.pid)) throw error
  })
  try {
    await until(() => pids.every((pid) => !alive(pid)), 31_000)
    assert.equal(await fetch(instance.manager.baseUrl + '/health', { signal: AbortSignal.timeout(500) })
      .then(() => true, () => false), false)
    assert.equal(await fetch(`http://127.0.0.1:${instance.profile.port}/health`, { signal: AbortSignal.timeout(500) })
      .then(() => true, () => false), false)
    return { crash, elapsedMs: Date.now() - started, processCount: pids.length }
  } catch (error) {
    await writeFile(join(instance.profile.path, 'exit-failure.log'), instance.output())
    throw new Error(`${error.message}; surviving fixture PIDs: ${pids.filter(alive).join(', ')}`)
  } finally { await instance.app.close().catch(() => undefined) }
}

async function recoverManager(instance) {
  const previous = instance.manager
  const previousRuntime = instance.runtime.instanceId
  process.kill(previous.pid, 'SIGKILL')
  instance.manager = await until(async () => {
    const current = await readFile(join(instance.profile.control, 'manager.json'), 'utf8')
      .then(JSON.parse, () => null)
    return current && current.instanceId !== previous.instanceId ? current : false
  })
  assert.equal(instance.manager.appOwner.ownerSessionId, previous.appOwner.ownerSessionId)
  assert.ok(instance.manager.appOwner.generation > previous.appOwner.generation)
  instance.runtime = await until(async () => {
    const current = await fetch(`http://127.0.0.1:${instance.profile.port}/v1/runtime/info`, {
      headers: { authorization: 'Bearer isolated-lifetime-test' }, signal: AbortSignal.timeout(1000)
    }).then((response) => response.ok ? response.json() : null, () => null)
    return current && current.instanceId !== previousRuntime ? current : false
  })
  assert.ok(alive(instance.process.pid))
  assert.equal(alive(previous.pid), false)
}

async function main() {
  const temporary = await mkdtemp(join(tmpdir(), 'kun-app-lifetime-'))
  const instances = []
  let success = false
  try {
    const config = await profile(temporary, 'desktop')
    const first = await launch(config)
    instances.push(first)
    await recoverManager(first)
    const normal = await stop(first)
    const second = await launch(config)
    instances.push(second)
    assert.notEqual(second.manager.instanceId, first.manager.instanceId)
    const crash = await stop(second, true)
    const third = await launch(config)
    instances.push(third)
    const reopened = await stop(third)
    success = true
    console.log(JSON.stringify({ status: 'passed', platform: process.platform,
      packaged: Boolean(process.env.KUN_LIFETIME_APP_EXECUTABLE),
      checks: ['actual-electron-window-close', 'legacy-close-setting-migration', 'manager-and-runtime-exit',
        'helper-processes-exit', 'manager-crash-recovery', 'owner-SIGKILL', 'same-profile-reopen'], normal, crash, reopened }))
  } finally {
    for (const instance of instances) await instance.app.close().catch(() => undefined)
    if (success) await removeFixture(temporary)
    else console.error(`App lifetime failure evidence: ${temporary}`)
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
