#!/usr/bin/env node
'use strict'

// Unified Code + ADE desktop smoke on an isolated profile. Real Electron,
// preload, main, and Kun runtime are exercised with offline model/Agent stubs.
//   node scripts/smoke-development-ade.cjs [--compiled-renderer] [--timeout-ms 120000]
// Screenshots and report.json land under dist/ade-desktop-smoke.
// The worker fixture exercises cancel and allow in the real protected
// application window; no gate, bridge confirmation, or consent token is mocked.

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFile, spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } = require('node:fs/promises')
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
const { runAgentModeFlow, writeDevinAcpStub } = require('./smoke-development-agent-mode.cjs')
const { runNativeModelFlow, writeCodexModelStub } = require('./smoke-development-native-models.cjs')
const { writeInstallerFixture, runAgentInstallFlow } = require('./smoke-development-agent-install.cjs')
const { writeDevinModelStub, runDevinModelFlow } = require('./smoke-development-devin-models.cjs')
const { runProtectedApprovalFlow } = require('./smoke-development-protected-approval.cjs')
const { runUnifiedCodeFlow } = require('./smoke-development-ade-flow.cjs')
const { runUnifiedCodeVisuals } = require('./smoke-development-ade-visuals.cjs')
const { startModelFixture } = require('./smoke-development-ade-model.cjs')
const { writeRoomsHarnessStub, configureRoomsHarnessFixture } = require('./smoke-rooms-harness-fixture.cjs')
const { runRoomsHarnessFlow, verifyRoomsHarnessReadiness } = require('./smoke-rooms-harness-controls.cjs')

const exec = promisify(execFile)
const MODEL = 'deepseek-chat'

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 120_000)
  const nativeApprovalTimeoutMs = positiveIntegerArgument('--native-approval-timeout-ms', 180_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const roomsHarnessOnly = process.argv.includes('--rooms-harness-only')
  const visualOnly = process.argv.includes('--visual-only')
  const agentModeOnly = process.argv.includes('--agent-mode-only')
  const nativeModelOnly = process.argv.includes('--native-model-only')
  const installOnly = process.argv.includes('--install-only')
  const devinModelsOnly = process.argv.includes('--devin-models-only')
  const protectedApprovalOnly = process.argv.includes('--protected-approval-only')
  const compiledRenderer = process.argv.includes('--compiled-renderer')
  const startedAt = new Date().toISOString()
  const visualLocale = argumentValue('--locale') ?? 'en'
  const visualTheme = argumentValue('--theme') ?? 'light'
  const visualScale = positiveIntegerArgument('--scale', 1)
  assert([1, 2].includes(visualScale), '--scale must be 1 or 2 for desktop visual coverage')
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'ade-desktop-smoke'))
  for (const entry of ['out/main/index.js', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const [mainBundle, rendererIndex, runtimeManifest] = await Promise.all([
    readFile(join(repositoryRoot, 'out/main/index.js')),
    readFile(join(repositoryRoot, 'out/renderer/index.html')),
    readFile(join(repositoryRoot, 'kun/dist/runtime-build.json'), 'utf8')
  ])
  const build = {
    mainEntrySha256: createHash('sha256').update(mainBundle).digest('hex'),
    rendererIndexSha256: createHash('sha256').update(rendererIndex).digest('hex'),
    runtimeBuildId: JSON.parse(runtimeManifest).buildId
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronPathFile = join(electronPackage, 'path.txt')
  assert(existsSync(electronPathFile), 'Electron binary is not installed; install dependencies before this offline smoke')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(electronPathFile, 'utf8')).trim())
  assert(existsSync(electronExecutable), 'Electron executable is missing; install dependencies before this offline smoke')
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-ade-desktop-smoke-'))
  const releaseFile = join(temporaryRoot, 'rooms-harness-release')
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'ade with spaces-'))
  let rendererProcess, electronApplication, electronProcess, page, modelFixture, result, primaryError
  let roomsHarnessReadiness
  let realProfile = profile
  let rendererOutput = '', electronOutput = ''
  const pageErrors = []
  const screenshots = []
  const layouts = []
  const capture = async (name, surface = page) => {
    const path = join(evidenceRoot, `${name}.png`)
    await surface.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await surface.screenshot({ path, animations: 'disabled' })
    const viewport = await surface.evaluate(() => ({
      width: innerWidth, height: innerHeight, scale: devicePixelRatio,
      documentWidth: document.documentElement.scrollWidth
    }))
    screenshots.push(path)
    layouts.push({ name, ...viewport })
  }
  try {
    await Promise.all([home, profile, userData, appData, localAppData, temporaryDirectory, evidenceRoot]
      .map((directory) => mkdir(directory, { recursive: true })))
    await writeFile(join(evidenceRoot, 'report.json'), JSON.stringify({
      ok: false, status: 'running', startedAt, build, compiledRenderer, visualOnly, agentModeOnly, roomsHarnessOnly, protectedApprovalOnly, locale: visualLocale, theme: visualTheme, scale: visualScale
    }, null, 2) + '\n')
    for (const name of ['failure.txt', 'failure-page.txt', 'failure.png', 'failure-runtime-fixture.json',
      'failure-workbench-fixture.json', 'failure-workspaces-fixture.json']) {
      await rm(join(evidenceRoot, name), { force: true })
    }
    // The runtime records the realpath'd dataDir; macOS tmpdir symlinks /var.
    realProfile = await realpath(profile)
    const runtimePort = await availablePort()
    let rendererPort = await availablePort()
    while (rendererPort === runtimePort) rendererPort = await availablePort()
    const isolatedEnvironment = developmentRendererEnvironment(createIsolatedEnvironment(process.env, {
      home, appData, localAppData, temporaryDirectory
    }), { rendererPort, temporaryRoot })
    if (compiledRenderer) delete isolatedEnvironment.ELECTRON_RENDERER_URL
    isolatedEnvironment.NODE_ENV = 'development'
    const gitConfig = join(temporaryRoot, 'git-config')
    await writeFile(gitConfig, '')
    Object.assign(isolatedEnvironment, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig })
    const git = (args) => exec('git', ['-C', workspaceRoot, ...args], { env: isolatedEnvironment })
    await git(['init', '-b', 'develop'])
    await git(['config', 'user.name', 'ADE Desktop Smoke'])
    await git(['config', 'user.email', 'ade-desktop@example.test'])
    await writeFile(join(workspaceRoot, 'baseline.txt'), 'baseline\n')
    await git(['add', 'baseline.txt'])
    await git(['commit', '-m', 'test: seed isolated ade workspace'])

    // Stub harness binaries inside the disposable root: `claude` answers a
    // version probe, `smoke-acp` answers the ACP initialize handshake.
    const stubDir = join(temporaryRoot, 'stubs')
    const claudeStub = await writeVersionStub(stubDir, 'claude', '2.1.0')
    const claudeStubUpdated = await writeVersionStub(stubDir, 'claude-alt', '2.2.0')
    const oldGeminiStub = await writeVersionStub(stubDir, 'gemini-old', '0.0.1')
    const acpStub = await writeAcpStub(stubDir, 'smoke-acp')
    const devinStub = roomsHarnessOnly ? await writeRoomsHarnessStub(stubDir, releaseFile) : devinModelsOnly ? await writeDevinModelStub(stubDir) : await writeDevinAcpStub(stubDir)
    const devinInstallTarget = installOnly ? await writeInstallerFixture(stubDir, devinStub) : undefined
    if (installOnly) isolatedEnvironment.PATH = `${stubDir}${require('node:path').delimiter}${isolatedEnvironment.PATH ?? ''}`
    const codexStub = nativeModelOnly ? await writeCodexModelStub(stubDir) : undefined
    // Claude Code login detection reads ~/.claude/.credentials.json.
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'ade-smoke' } }))

    modelFixture = await startModelFixture(MODEL, roomsHarnessOnly ? { workspaceRoot } : {})
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile),
      locale: visualLocale, theme: visualTheme, initialSetupCompleted: true }
    settings.agents.kun.baseUrl = modelFixture.baseUrl
    settings.agents.kun.apiKey = 'ade-desktop-offline-fixture'
    settings.agents.kun.model = MODEL
    if (protectedApprovalOnly) Object.assign(settings.agents.kun, {
      approvalPolicy: 'always', approvalReviewer: 'user', sandboxMode: 'workspace-write'
    })
    settings.agents.kun.ade = { ...(settings.agents.kun.ade ?? {}), enabled: true }
    settings.agents.kun.harnesses = {
      ...(settings.agents.kun.harnesses ?? {}),
      binaryPaths: {
        ...(codexStub ? { codex: codexStub } : {}),
        'claude-code': claudeStub,
        devin: devinInstallTarget ?? devinStub,
        // Force one repair path regardless of host-global CLI installations.
        'gemini-cli': oldGeminiStub
      },
      custom: [{ id: 'smoke-acp', displayName: 'Smoke ACP', command: acpStub, args: [], env: {} }],
      // P4-13: a configured terminal-only agent — the node binary always
      // resolves, and no `--version` probe is required for `terminal` defs.
      terminalAgents: [{
        id: 'smoke-term',
        displayName: 'Smoke Term',
        command: process.execPath,
        args: [],
        taskFlag: '-e',
        hooks: 'none'
      }]
    }
    if (roomsHarnessOnly) configureRoomsHarnessFixture(settings, isolatedEnvironment)
    // External Agents are opt-in; the offline Devin catalog fixture needs its consented profile.
    if (devinModelsOnly || agentModeOnly) {
      settings.agents.kun.harnesses.enabledProfiles = [{ harnessId: 'devin', credentialMode: 'native-login' }]
      // Local-stub credential evidence only; never a real account or service.
      isolatedEnvironment.WINDSURF_API_KEY = 'devin-models-offline-fixture-no-service-access'
    }
    if (nativeModelOnly) {
      settings.agents.kun.harnesses.enabledProfiles = [{ harnessId: 'codex', credentialMode: 'native-login' }]
      // Local-stub credential evidence only; the Codex stub never contacts a service.
      isolatedEnvironment.OPENAI_API_KEY = 'codex-models-offline-fixture-no-service-access'
    }
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
    if (!compiledRenderer) {
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
    }
    electronApplication = await _electron.launch({
      executablePath: electronExecutable, args: [`--user-data-dir=${userData}`, '--no-first-run',
        `--force-device-scale-factor=${visualScale}`,
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
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('Maximum update depth exceeded') && pageErrors.length < 10) pageErrors.push(message.text())
    })
    // The smoke run uses a fresh vite cache each time, so the first module
    // graph transform can exceed the default 30s window on a busy machine.
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 })
    await page.locator('[data-workspace-mode-trigger]').first().waitFor()

    let assertions
    if (roomsHarnessOnly) {
      roomsHarnessReadiness = await verifyRoomsHarnessReadiness({ page, poll, runtimeRequest })
      assertions = await runRoomsHarnessFlow({ page, capture, poll, runtimeRequest, workspaceRoot, releaseFile, modelFixture,
        resize: (width, height) => resize(electronApplication, width, height) })
    } else if (protectedApprovalOnly) {
      assertions = await runProtectedApprovalFlow({ application: electronApplication, page, capture, poll, runtimeRequest })
    } else if (devinModelsOnly) {
      assertions = await runDevinModelFlow({ page, capture, poll, resize: (width, height) => resize(electronApplication, width, height) })
    } else if (installOnly) {
      assertions = await runAgentInstallFlow({ page, capture, poll, runtimeRequest })
    } else if (nativeModelOnly) {
      assertions = await runNativeModelFlow({ page, capture, poll })
    } else if (agentModeOnly) {
      assertions = await runAgentModeFlow({ page, capture, poll, runtimeRequest })
    } else if (visualOnly) {
      assertions = await runUnifiedCodeVisuals({ page, capture, poll, runtimeRequest,
        resize: (width, height) => resize(electronApplication, width, height) })
    } else {
      assertions = await runUnifiedCodeFlow({
        page, capture, poll, runtimeRequest, expectedSetupCommand,
        claudeStubUpdated, acpStub, temporaryRoot, application: electronApplication, nativeApprovalTimeoutMs
      })
    }

    const runtimeDiagnostics = await captureIsolatedLogs(temporaryRoot, evidenceRoot)
    assert.deepEqual(runtimeDiagnostics.httpFailures, [], 'Runtime emitted an unexpected HTTP failure')
    assert.deepEqual(runtimeDiagnostics.unhandledRejections, [], 'Runtime emitted an unhandled rejection')
    assert.deepEqual(runtimeDiagnostics.staleTurnFences, [], 'Runtime emitted a stale turn fence rejection')
    assert.deepEqual(pageErrors, [], 'Renderer emitted an uncaught exception')
    result = { ok: true, status: 'passed', startedAt, build, completedAt: new Date().toISOString(),
      renderer: compiledRenderer ? 'compiled' : 'development', visualOnly, agentModeOnly, nativeModelOnly, roomsHarnessOnly, protectedApprovalOnly, locale: visualLocale, theme: visualTheme, scale: visualScale,
      platform: process.platform, arch: process.arch, pageErrors, layouts, runtimeDiagnostics,
      ...(keepDirs ? { retainedDirectories: { temporaryRoot, workspaceRoot } } : {}),
      modelFixture: modelFixture.snapshot(), screenshots,
      ...(roomsHarnessReadiness ? { roomsHarnessReadiness } : {}),
      assertions }
  } catch (error) {
    await capture('failure').catch(() => undefined)
    await captureIsolatedLogs(temporaryRoot, evidenceRoot).catch(() => undefined)
    if (page) await writeFile(join(evidenceRoot, 'failure-page.txt'),
      await page.locator('body').innerText().catch(() => '')).catch(() => undefined)
    if (page) {
      const inventory = await runtimeRequest(page, '/v1/threads?limit=100').catch(() => null)
      if (inventory) {
        const threads = await Promise.all(inventory.threads.map((thread) =>
          runtimeRequest(page, `/v1/threads/${thread.id}`).catch(() => null)))
        await writeFile(join(evidenceRoot, 'failure-runtime-fixture.json'), JSON.stringify(threads, null, 2))
          .catch(() => undefined)
      }
      for (const [name, path] of [
        ['workbench', '/v1/threads?workbench_scope=code&limit=100'],
        ['workspaces', '/v1/task-workspaces']
      ]) {
        const value = await runtimeRequest(page, path).catch((error) => ({ error: String(error) }))
        await writeFile(join(evidenceRoot, `failure-${name}-fixture.json`), JSON.stringify(value, null, 2))
          .catch(() => undefined)
      }
    }
    primaryError = new Error(`${error.stack ?? error}\nRenderer:\n${rendererOutput}\nElectron:\n${electronOutput}`)
    await writeFile(join(evidenceRoot, 'failure.txt'), primaryError.stack).catch(() => undefined)
  } finally {
    const errors = []
    const cleanup = async (operation) => {
      try { await withTimeout(operation, 20_000, 'cleaning isolated ADE smoke') }
      catch (error) { errors.push(error.message) }
    }
    let closing
    if (electronApplication) {
      closing = electronApplication.close()
      await withTimeout(closing, 3000, 'closing isolated Electron').catch(() => undefined)
    }
    if (electronProcess) await cleanup(terminateProcessTree(electronProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }))
    await cleanup(stopIsolatedSharedRuntime(repositoryRoot, realProfile))
    await cleanup(stopIsolatedServiceManager(home, realProfile))
    if (closing) await withTimeout(closing, 1000, 'settling Electron').catch(() => undefined)
    releaseChildProcessHandles(electronProcess)
    if (rendererProcess) await cleanup(terminateProcessTree(rendererProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }))
    releaseChildProcessHandles(rendererProcess)
    if (modelFixture) await cleanup(modelFixture.close())
    await cleanup(Promise.all([temporaryRoot, workspaceRoot]
      .map((path) => makeTreeWritable(path))))
    if (!keepDirs) {
      await cleanup(Promise.all([temporaryRoot, workspaceRoot]
        .map((path) => rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }))))
    }
    if (errors.length) primaryError = new Error(`${primaryError?.stack ?? ''}\nCleanup failures: ${errors.join('; ')}`)
  }
  if (primaryError) {
    result = { ok: false, status: 'failed', startedAt, build, completedAt: new Date().toISOString(),
      renderer: compiledRenderer ? 'compiled' : 'development', visualOnly, agentModeOnly, roomsHarnessOnly, protectedApprovalOnly, locale: visualLocale, theme: visualTheme, scale: visualScale,
      pageErrors, layouts, screenshots, modelFixture: modelFixture?.snapshot(), failure: primaryError.message,
      ...(roomsHarnessReadiness ? { roomsHarnessReadiness } : {}),
      ...(keepDirs ? { retainedDirectories: { temporaryRoot, workspaceRoot } } : {}) }
  }
  await writeFile(join(evidenceRoot, 'report.json'), JSON.stringify(result, null, 2) + '\n')
  if (primaryError) throw primaryError
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

/** Executable stub that prints a version string for the detector's probe. */
async function writeVersionStub(root, name, version) {
  const file = join(root, name)
  await mkdir(root, { recursive: true })
  await writeFile(file, `#!${process.execPath}\nconsole.log(${JSON.stringify(version)})\n`)
  await chmod(file, 0o755)
  return file
}

/**
 * Minimal newline-JSON-RPC ACP agent: answers `initialize` so the readiness
 * probe reports a completed handshake. `session/*` requests get empty results.
 */
async function writeAcpStub(root, name) {
  const file = join(root, name)
  await mkdir(root, { recursive: true })
  await writeFile(file, `#!${process.execPath}
const rl = require('node:readline').createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (typeof message.id === 'number') {
    const result = message.method === 'initialize'
      ? { protocolVersion: 1, agentCapabilities: { loadSession: true } }
      : {}
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
  }
})
`)
  await chmod(file, 0o755)
  return file
}

async function captureIsolatedLogs(root, destination) {
  const diagnostics = { files: [], httpFailures: [], unhandledRejections: [], staleTurnFences: [] }
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true }).catch(() => [])) {
    if (entry.isFile() && (entry.name === 'manager.log' || /^kun-.*\.log$/u.test(entry.name))) {
      const path = join(entry.parentPath ?? entry.path, entry.name)
      const name = path.slice(root.length + 1).replace(/[^A-Za-z0-9_.-]/g, '_')
      const contents = await readFile(path, 'utf8')
      await writeFile(join(destination, name), contents)
      diagnostics.files.push(name)
      diagnostics.httpFailures.push(...contents.split('\n').filter((line) => line.includes('[kun-http] unexpected request failure')))
      diagnostics.unhandledRejections.push(...contents.split('\n').filter((line) => line.includes('unhandledRejection')))
      diagnostics.staleTurnFences.push(...contents.split('\n').filter((line) => line.includes('stale_turn_fence')))
    }
  }
  return diagnostics
}

function runtimeRequest(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await globalThis.kunGui.runtimeRequest(path, method,
      body === undefined ? undefined : JSON.stringify(body))
    if (!response.ok) throw new Error(`${method} ${path} (${response.status}): ${response.body}`)
    return JSON.parse(response.body)
  }, { path, method, body })
}

function resize(application, width, height) {
  return application.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
    window?.setMinimumSize(960, 640)
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

// Mirrors agent-center-actions.ts: 'install' prefers an exact platform match
// over 'any', 'login' is `command + args`, 'adapter' is setup.adapter.install.
function expectedSetupCommand(definition, platform, kind) {
  const setup = definition?.setup
  if (!setup) return null
  if (kind === 'login' && setup.login?.command) {
    const args = (setup.login.args ?? []).join(' ').trim()
    return { command: args ? `${setup.login.command} ${args}` : setup.login.command }
  }
  if (kind === 'adapter' && setup.adapter?.install) return { command: setup.adapter.install }
  if (kind === 'install') {
    const entries = setup.install ?? []
    const picked = entries.find((entry) => entry.platform === platform)
      ?? entries.find((entry) => entry.platform === 'any')
    if (picked) return { command: picked.command }
  }
  return null
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
