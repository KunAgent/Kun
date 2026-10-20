#!/usr/bin/env node
'use strict'

// Code-agent Design smoke on an isolated profile: real Electron, the Kun
// runtime and an offline model fixture. A Code turn calls design_open; the
// workbench must show the transcript card, open the Design canvas beside the
// conversation and run one Design pass on the same thread afterwards.
//   npm run build && node scripts/smoke-development-agent-design.cjs [--keep-dirs]
// Screenshots and report.json land under dist/agent-design-smoke (or --evidence <dir>).

const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const {
  createIsolatedEnvironment, desktopSmokeSettings, desktopSmokeWorkspaceParent, desktopUserDataCandidates,
  platformDesktopArguments, stopIsolatedServiceManager, stopIsolatedSharedRuntime, releaseChildProcessHandles, withTimeout
} = require('./smoke-packaged-extension-desktop-runtime.cjs')
const { availablePort, argumentValue, positiveIntegerArgument, terminateProcessTree } = require('./smoke-packaged-extension-desktop-process.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')
const { startAgentDesignModelFixture } = require('./smoke-development-agent-design-model.cjs')

const MODEL = 'deepseek-chat'
const diagnostics = {}

function runtimeRequest(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await globalThis.kunGui.runtimeRequest(path, method, body === undefined ? undefined : JSON.stringify(body))
    if (!response.ok) throw new Error(`${method} ${path} (${response.status}): ${response.body}`)
    return JSON.parse(response.body)
  }, { path, method, body })
}

async function poll(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      last = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${description}${last ? `: ${last.message}` : ''}`)
}

async function latestThread(page) {
  const list = await runtimeRequest(page, '/v1/threads?limit=20')
  const thread = list.threads[0]
  return thread ? runtimeRequest(page, `/v1/threads/${thread.id}`) : null
}

async function approvePending(application, page) {
  const allow = page.locator('[data-approval-choice="1"]').first()
  if (!(await allow.isVisible().catch(() => false))) return false
  const opened = application.waitForEvent('window', { timeout: 15_000 })
  await allow.click()
  const dialog = await opened
  await dialog.locator('[data-protected-confirmation]').waitFor()
  await Promise.all([dialog.waitForEvent('close'), dialog.locator('#confirm').click()])
  return true
}

async function waitForTurns(application, page, count, timeoutMs, description) {
  let thread
  await poll(async () => {
    await approvePending(application, page)
    thread = await latestThread(page)
    return Boolean(thread && thread.turns.filter((turn) => turn.status === 'completed').length >= count)
  }, timeoutMs, description)
  return thread
}

/** Persisted boards under .kun-design whose objects include a shape with this name. */
async function boardFilesContaining(workspaceRoot, shapeName) {
  const matches = []
  const visit = async (directory, depth) => {
    if (depth > 4) return
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { await visit(path, depth + 1); continue }
      if (entry.name !== 'canvas.json') continue
      const board = JSON.parse(await readFile(path, 'utf8').catch(() => '{}'))
      if (Object.values(board.objects ?? {}).some((shape) => shape?.name === shapeName)) matches.push(path)
    }
  }
  await visit(join(workspaceRoot, '.kun-design'), 0)
  return matches
}

async function runFlow({ application, page, capture, timeoutMs, workspaceRoot }) {
  const checks = []
  // 1. The composer no longer offers a Code/Design switch.
  const agentTrigger = page.locator('[data-agent-mode-trigger]').first()
  if (await agentTrigger.isVisible().catch(() => false)) {
    await agentTrigger.click()
    await page.locator('[data-agent-mode-menu]').waitFor({ timeout: timeoutMs })
    assert.equal(await page.locator('[data-agent-mode-option="kun-design"]').count(), 0, 'Kun Design mode is gone')
    assert.equal(await page.locator('[data-agent-mode-option="kun-code"]').count(), 1, 'Kun Code mode is offered')
    await page.keyboard.press('Escape')
  }
  assert.equal(await page.locator('[data-task-surface-option="design"]').count(), 0, 'no task surface Design option')
  await capture('agent-design-0-composer')
  checks.push('The composer has no Code/Design switch; Kun is offered as a single Code mode')

  // 2. A Code turn calls design_open; the transcript shows the design card.
  const composer = page.locator('.ds-composer-textarea')
  await composer.fill('[agent-design-smoke] Move the update button into the sidebar footer. Show me a design first.')
  await page.locator('.ds-composer-primary-action').click()
  const card = page.locator('[data-design-open-card]').first()
  await card.waitFor({ timeout: timeoutMs })
  diagnostics.firstCardState = await card.getAttribute('data-design-open-state')
  checks.push(`design_open renders a transcript card (first state: ${diagnostics.firstCardState})`)

  // 3. After the reply ends, one Design pass runs on the same conversation.
  const thread = await waitForTurns(application, page, 2, timeoutMs, 'Code turn plus Design pass')
  const [codeTurn, designTurn] = thread.turns
  assert(JSON.stringify(codeTurn).includes('design_open'), 'the Code turn called design_open')
  const designTurnText = JSON.stringify(designTurn)
  assert(designTurnText.includes('Design request from the coding agent'), 'the second turn is the agent-started Design pass')
  assert(designTurnText.includes('design_continuation'), 'the Design pass is marked as a continuation notice')
  diagnostics.designTurnSurface = designTurn.agentSurface ?? null
  diagnostics.threadDesignProfile = thread.designProfile ?? thread.thread?.designProfile ?? null
  await poll(async () => (await card.getAttribute('data-design-open-state')) === 'ready', timeoutMs, 'card ready')
  checks.push('The Design pass starts automatically after the reply and runs on the same thread')

  // 4. The Design canvas is open beside the conversation and shows the drawing.
  const titlebar = page.locator('[data-code-canvas-titlebar]').first()
  await titlebar.waitFor({ timeout: timeoutMs })
  diagnostics.canvasEngine = await page.locator('[data-canvas-engine]').first().getAttribute('data-canvas-engine').catch(() => null)
  let boardFiles = []
  await poll(async () => (boardFiles = await boardFilesContaining(workspaceRoot, 'Update ready pill')).length > 0,
    timeoutMs, 'Design pass shapes persisted on the bound board')
  diagnostics.boardFiles = boardFiles.map((path) => path.slice(workspaceRoot.length + 1))
  const titleText = await titlebar.innerText()
  assert(titleText.includes('Footer update entry'), `drawing is named from the request title: ${titleText}`)
  await capture('agent-design-1-canvas')
  checks.push('The Design canvas opens in the right panel without switching modes, named after the request and holding the drawn shapes')

  // 5. The card reopens the canvas after it is closed.
  const collapse = page.locator('[data-code-canvas-titlebar] button[aria-label]').last()
  diagnostics.collapseLabel = await collapse.getAttribute('aria-label').catch(() => null)
  await page.locator('[data-design-open-open]').first().click()
  await titlebar.waitFor({ timeout: timeoutMs })
  await capture('agent-design-2-card-ready')
  checks.push('The ready card opens the bound Design canvas')

  // 6. No second Design pass is started on idle re-renders.
  await new Promise((resolve) => setTimeout(resolve, 2_500))
  const settled = await latestThread(page)
  assert.equal(settled.turns.length, 2, 'exactly one Design pass ran')
  checks.push('Exactly one Design pass ran for the request')
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'agent-design-smoke'))
  const appExecutable = argumentValue('--app-executable')
  const packaged = Boolean(appExecutable)
  let electronExecutable, unpackedRoot = repositoryRoot
  if (packaged) {
    electronExecutable = resolve(appExecutable)
    assert(existsSync(electronExecutable), `Missing packaged executable ${electronExecutable}`)
    unpackedRoot = resolve(electronExecutable, '..', '..', 'Resources', 'app.asar.unpacked')
  } else {
    for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
      assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
    }
    const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
    electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-agent-design-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'agent-design-'))
  const screenshots = []
  const pageErrors = []
  let application, electronProcess, page, fixture, result, primaryError, realProfile = profile, electronOutput = ''
  const capture = async (name) => {
    const path = join(evidenceRoot, `${name}.png`)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const png = await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.isVisible())
      return window ? (await window.capturePage()).toPNG().toString('base64') : null
    }).catch(() => null)
    if (png) await writeFile(path, Buffer.from(png, 'base64'))
    else await page.screenshot({ path, animations: 'disabled' })
    screenshots.push(path)
  }
  try {
    await Promise.all([home, profile, userData, appData, localAppData, temporaryDirectory, evidenceRoot]
      .map((directory) => mkdir(directory, { recursive: true })))
    realProfile = await realpath(profile)
    const runtimePort = await availablePort()
    const environment = createIsolatedEnvironment(process.env, { home, appData, localAppData, temporaryDirectory })
    delete environment.ELECTRON_RENDERER_URL
    if (!packaged) environment.NODE_ENV = 'development'
    fixture = await startAgentDesignModelFixture(MODEL)
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile), locale: 'en', initialSetupCompleted: true }
    Object.assign(settings.agents.kun, {
      baseUrl: fixture.baseUrl, apiKey: 'agent-design-offline-fixture', model: MODEL, approvalPolicy: 'auto'
    })
    settings.schedule = { internal: { port: await availablePort() } }
    const serialized = `${JSON.stringify(settings, null, 2)}\n`
    await Promise.all(desktopUserDataCandidates({ platform: process.platform, home, appData, explicitUserData: userData })
      .map(async (directory) => {
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'kun-settings.json'), serialized)
      }))
    application = await _electron.launch({
      executablePath: electronExecutable,
      args: [`--user-data-dir=${userData}`, '--no-first-run', '--disable-background-networking',
        '--disable-component-update', ...platformDesktopArguments(process.platform), ...(packaged ? [] : [repositoryRoot])],
      cwd: packaged ? home : repositoryRoot, env: environment, chromiumSandbox: true, timeout: timeoutMs
    })
    electronProcess = application.process()
    for (const stream of [electronProcess.stdout, electronProcess.stderr]) {
      stream?.on('data', (chunk) => { electronOutput = `${electronOutput}${chunk}`.slice(-64 * 1024) })
    }
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.setBounds({ x: 20, y: 20, width: 1440, height: 920 })
    })
    page = await findWorkbenchWindow(application, timeoutMs)
    page.setDefaultTimeout(30_000)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 })
    await page.locator('.ds-composer-textarea').waitFor({ timeout: timeoutMs })
    const assertions = await runFlow({ application, page, capture, timeoutMs, workspaceRoot: await realpath(workspaceRoot) })
    assert.deepEqual(pageErrors, [], 'Renderer emitted an uncaught exception')
    result = { ok: true, status: 'passed', completedAt: new Date().toISOString(), packaged, screenshots, assertions, diagnostics,
      modelFixture: fixture.snapshot(), ...(keepDirs ? { temporaryRoot, workspaceRoot } : {}) }
  } catch (error) {
    if (page) {
      await capture('failure').catch(() => undefined)
      await writeFile(join(evidenceRoot, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => undefined)
    }
    primaryError = new Error(`${error.stack ?? error}\nElectron:\n${electronOutput}`)
    result = { ok: false, status: 'failed', failure: primaryError.message, screenshots, pageErrors, diagnostics, modelFixture: fixture?.snapshot() }
  } finally {
    if (application) await withTimeout(application.close(), 3_000, 'closing Electron').catch(() => undefined)
    if (electronProcess) await terminateProcessTree(electronProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }).catch(() => undefined)
    await withTimeout(stopIsolatedSharedRuntime(unpackedRoot, realProfile), 20_000, 'runtime').catch(() => undefined)
    await withTimeout(stopIsolatedServiceManager(home, realProfile), 20_000, 'manager').catch(() => undefined)
    releaseChildProcessHandles(electronProcess)
    if (fixture) await fixture.close()
    if (!keepDirs) {
      await Promise.all([temporaryRoot, workspaceRoot].map((path) =>
        rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined)))
    }
  }
  await writeFile(join(evidenceRoot, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
  if (primaryError) throw primaryError
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
