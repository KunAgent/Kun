#!/usr/bin/env node
'use strict'

// Exercise the real Electron renderer/preload/main/Manager/Runtime composition.
// All model responses are deterministic and offline. Application settings, data,
// discovery/control files, Git repositories and processes belong to this run.
const { startDirectModel } = require('./smoke-direct-model.cjs')
const { exerciseDirectChat } = require('./smoke-direct-controls.cjs')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFile, spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { createServer } = require('node:http')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { promisify } = require('node:util')
const { _electron } = require('playwright-core')
const { makeTreeWritable } = require('./smoke-packaged-extensions.cjs')
const {
  createIsolatedEnvironment, desktopSmokeSettings, desktopSmokeWorkspaceParent,
  desktopUserDataCandidates, platformDesktopArguments, stopIsolatedServiceManager,
  stopIsolatedSharedRuntime, releaseChildProcessHandles, withTimeout
} = require('./smoke-packaged-extension-desktop-runtime.cjs')
const {
  availablePort, argumentValue, positiveIntegerArgument, terminateProcessTree
} = require('./smoke-packaged-extension-desktop-process.cjs')
const { developmentRendererEnvironment } = require('./development-renderer-environment.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')

const exec = promisify(execFile)
const ROOM_NAME = 'Rooms desktop smoke'
const TASK_TITLE = 'Create desktop evidence file'
const TASK_PROMPT = 'Create desktop-smoke.txt containing isolated desktop runtime and have it reviewed.'
const FILE_CONTENT = 'isolated desktop runtime\n'
const MODEL = 'deepseek-chat'
const VALIDATION_COMMAND = `node -e "console.log('rooms verification proof')"`

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 180_000)
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'rooms-direct-smoke'))
  for (const entry of ['out/main/index.js', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronPathFile = join(electronPackage, 'path.txt')
  assert(existsSync(electronPathFile), 'Electron binary is not installed; install dependencies before this offline smoke')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(electronPathFile, 'utf8')).trim())
  assert(existsSync(electronExecutable), 'Electron executable is missing; install dependencies before this offline smoke')
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-rooms-desktop-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'rooms with spaces-'))
  let rendererProcess, electronApplication, electronProcess, page, modelFixture, result, primaryError
  let rendererOutput = '', electronOutput = ''
  const pageErrors = []
  const screenshots = []
  const capture = async (name) => {
    const path = join(evidenceRoot, `${name}.png`)
    await page.screenshot({ path })
    screenshots.push(path)
  }
  try {
    await Promise.all([home, profile, userData, appData, localAppData, temporaryDirectory, evidenceRoot]
      .map((directory) => mkdir(directory, { recursive: true })))
    const runtimePort = await availablePort()
    let rendererPort = await availablePort()
    while (rendererPort === runtimePort) rendererPort = await availablePort()
    const isolatedEnvironment = developmentRendererEnvironment(createIsolatedEnvironment(process.env, {
      home, appData, localAppData, temporaryDirectory
    }), { rendererPort, temporaryRoot })
    isolatedEnvironment.NODE_ENV = 'development'
    // Exclude ambient Git hooks, signing and global config from the disposable repository.
    const gitConfig = join(temporaryRoot, 'git-config')
    await writeFile(gitConfig, '')
    Object.assign(isolatedEnvironment, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig })
    const git = (args) => exec('git', ['-C', workspaceRoot, ...args], { env: isolatedEnvironment })
    await git(['init', '-b', 'develop'])
    await git(['config', 'user.name', 'Rooms Desktop Smoke'])
    await git(['config', 'user.email', 'rooms-desktop@example.test'])
    await writeFile(join(workspaceRoot, 'baseline.txt'), 'baseline\n')
    await git(['add', 'baseline.txt'])
    await git(['commit', '-m', 'test: seed isolated rooms repository'])
    const baselineSha = (await git(['rev-parse', 'HEAD'])).stdout.trim()

    modelFixture = await startDirectModel({ real: process.argv.includes('--real-model') })
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, profile), locale: 'en', theme: 'light', initialSetupCompleted: true }
    settings.agents.kun.baseUrl = modelFixture.baseUrl
    settings.agents.kun.apiKey = 'rooms-desktop-offline-fixture'
    settings.agents.kun.model = modelFixture.snapshot().model
    const allocatedPorts = new Set([runtimePort, rendererPort, new URL(modelFixture.baseUrl).port].map(Number))
    const nextPort = async () => {
      let port
      do { port = await availablePort() } while (allocatedPorts.has(port))
      allocatedPorts.add(port)
      return port
    }
    settings.claw = { im: { enabled: false, port: await nextPort() } }
    settings.schedule = { internal: { port: await nextPort() } }
    const serializedSettings = `${JSON.stringify(settings, null, 2)}\n`
    await Promise.all(desktopUserDataCandidates({ platform: process.platform, home, appData, explicitUserData: userData })
      .map(async (directory) => {
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'kun-settings.json'), serializedSettings)
      }))
    rendererProcess = spawn(process.execPath, [join(repositoryRoot, 'node_modules/vite/bin/vite.js'),
      '--config', join(repositoryRoot, 'scripts/vite-development-renderer.config.mjs'), '--logLevel', 'warn'], {
      cwd: repositoryRoot, env: isolatedEnvironment, detached: process.platform !== 'win32',
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    })
    for (const stream of [rendererProcess.stdout, rendererProcess.stderr]) {
      stream.on('data', (chunk) => { rendererOutput = `${rendererOutput}${chunk}`.slice(-64 * 1024) })
    }
    await poll(async () => {
      assert.equal(rendererProcess.exitCode, null, 'Development renderer exited')
      try { return (await fetch(`http://127.0.0.1:${rendererPort}`, { signal: AbortSignal.timeout(1000) })).ok }
      catch { return false }
    }, timeoutMs, 'renderer server startup')
    electronApplication = await _electron.launch({
      executablePath: electronExecutable, args: [`--user-data-dir=${userData}`, '--no-first-run',
        '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
        ...platformDesktopArguments(process.platform), repositoryRoot],
      cwd: repositoryRoot, env: isolatedEnvironment, chromiumSandbox: true, timeout: timeoutMs
    })
    electronProcess = electronApplication.process()
    for (const stream of [electronProcess.stdout, electronProcess.stderr]) {
      stream?.on('data', (chunk) => { electronOutput = `${electronOutput}${chunk}`.slice(-64 * 1024) })
    }
    await resize(electronApplication, 1360, 900)
    page = await findWorkbenchWindow(electronApplication, timeoutMs)
    page.setDefaultTimeout(30_000)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error' && message.text().includes('same key')) pageErrors.push(message.text()) })
    await page.waitForLoadState('domcontentloaded')
    await page.locator('[data-workspace-mode-trigger]').first().waitFor()
    const direct = await exerciseDirectChat({ page, request: runtimeRequest, poll, capture, fixture: modelFixture,
      application: electronApplication, workspaceRoot, real: process.argv.includes('--real-model'),
      resize: (width, height) => resize(electronApplication, width, height), switchRooms: () => switchMode(page, 'rooms'),
      approve: (ref) => installNativeConsentFixture(electronApplication, ref) })
    assert.deepEqual(pageErrors, [], 'Renderer uncaught exceptions')
    result = { ok: true, direct, model: modelFixture.snapshot(), pageErrors, screenshots }
    await writeFile(join(evidenceRoot, 'report.json'), JSON.stringify(result, null, 2) + '\n')
  } catch (error) {
    await capture('failure').catch(() => undefined)
    await captureIsolatedLogs(temporaryRoot, evidenceRoot).catch(() => undefined)
    if (page) await writeFile(join(evidenceRoot, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => undefined)
    primaryError = new Error(`${error.stack ?? error}\nFixture: ${JSON.stringify(modelFixture?.snapshot())}\nRenderer:\n${rendererOutput}\nElectron:\n${electronOutput}`)
    await writeFile(join(evidenceRoot, 'failure.txt'), primaryError.stack).catch(() => undefined)
  } finally {
    modelFixture?.release()
    const errors = []
    const cleanup = async (operation) => {
      try { await withTimeout(operation, 20_000, 'cleaning isolated Rooms smoke') }
      catch (error) { errors.push(error.message) }
    }
    let closing
    if (electronApplication) {
      await electronApplication.evaluate(({ dialog }) => {
        const fixture = globalThis.__roomsSmokeNativeConsent
        if (fixture) dialog.showMessageBox = fixture.original
      }).catch(() => undefined)
      closing = electronApplication.close()
      await withTimeout(closing, 3000, 'closing isolated Electron').catch(() => undefined)
    }
    if (electronProcess) await cleanup(terminateProcessTree(electronProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }))
    await cleanup(stopIsolatedSharedRuntime(repositoryRoot, profile))
    await cleanup(stopIsolatedServiceManager(home, profile))
    if (closing) await withTimeout(closing, 1000, 'settling Electron').catch(() => undefined)
    releaseChildProcessHandles(electronProcess)
    if (rendererProcess) await cleanup(terminateProcessTree(rendererProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }))
    releaseChildProcessHandles(rendererProcess)
    if (modelFixture) await cleanup(modelFixture.close())
    await cleanup(Promise.all([makeTreeWritable(temporaryRoot), makeTreeWritable(workspaceRoot)]))
    await cleanup(Promise.all([temporaryRoot, workspaceRoot]
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }))))
    if (errors.length) primaryError = new Error(`${primaryError?.stack ?? ''}\nCleanup failures: ${errors.join('; ')}`)
  }
  if (primaryError) throw primaryError
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

async function installNativeConsentFixture(application, approvalRef) {
  await application.evaluate(({ dialog }, expectedRef) => {
    const original = dialog.showMessageBox
    const state = { original, calls: 0 }
    globalThis.__roomsSmokeNativeConsent = state
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1) ?? {}
      if (state.calls === 0 && options.title === 'Approve tool action' &&
        options.message === 'Allow this pending Kun tool action once?' &&
        options.detail?.startsWith(`Approval reference: ${expectedRef}\n\n`) &&
        JSON.stringify(options.buttons) === JSON.stringify(['Allow once', 'Cancel'])) {
        state.calls += 1
        dialog.showMessageBox = original
        return { response: 0, checkboxChecked: false }
      }
      return original.apply(dialog, args)
    }
  }, approvalRef)
}


async function captureIsolatedLogs(root, destination) {
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && (entry.name === 'manager.log' || /^kun-.*\.log$/u.test(entry.name))) {
      const path = join(entry.parentPath ?? entry.path, entry.name)
      const name = path.slice(root.length + 1).replace(/[^A-Za-z0-9_.-]/g, '_')
      await writeFile(join(destination, name), await readFile(path))
    }
  }
}


function runtimeRequest(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await globalThis.kunGui.runtimeRequest(path, method,
      body === undefined ? undefined : JSON.stringify(body))
    if (!response.ok) throw new Error(`${method} ${path} (${response.status}): ${response.body}`)
    return JSON.parse(response.body)
  }, { path, method, body })
}

async function switchMode(page, mode) {
  await page.locator('[data-workspace-mode-trigger]').first().click()
  await page.locator(`[role="menuitemradio"][data-workspace-mode="${mode}"]`).click()
  await page.locator(`[data-workspace-mode-trigger][data-workspace-mode="${mode}"]`).first().waitFor()
}


function resize(application, width, height) {
  return application.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
    window?.setMinimumSize(480, 480)
    window?.setBounds({ x: 20, y: 20, ...bounds })
  }, { width, height })
}

async function poll(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${description}`)
}


main().catch((error) => { process.stderr.write(String(error.stack ?? error) + "\n"); process.exitCode = 1 })
