#!/usr/bin/env node
'use strict'

// Gen UI + MCP Apps desktop smoke on an isolated profile. Real Electron, the
// app sandbox webviews, the Kun runtime and the built-in canvas MCP server run
// against an offline model fixture.
//   npm run build && node scripts/smoke-development-app-surfaces.cjs [--keep-dirs]
// Pass --app-executable <Kun.app/Contents/MacOS/Kun> to run the same flow
// against a packaged build. Screenshots and report.json land under
// dist/app-surfaces-smoke (or --evidence <dir>).

const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const {
  createIsolatedEnvironment, desktopSmokeSettings, desktopSmokeWorkspaceParent, desktopUserDataCandidates,
  platformDesktopArguments, stopIsolatedServiceManager, stopIsolatedSharedRuntime, releaseChildProcessHandles, withTimeout
} = require('./smoke-packaged-extension-desktop-runtime.cjs')
const { availablePort, argumentValue, positiveIntegerArgument, terminateProcessTree } = require('./smoke-packaged-extension-desktop-process.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')
const { startAppSurfacesModelFixture } = require('./smoke-development-app-surfaces-model.cjs')

const MODEL = 'deepseek-chat'
const diagnostics = {}

async function layout(application, instanceId, webview, guestScript) {
  const host = await webview.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: Math.round(rect.width), height: Math.round(rect.height) }
  })
  const guest = await guestEvaluate(application, instanceId, guestScript)
  return { host, guest }
}

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

/** Run script inside the framed page of the sandbox webview with this instance id. */
function guestEvaluate(application, instanceId, script) {
  return application.evaluate(async ({ webContents }, { instanceId, script }) => {
    const shell = webContents.getAllWebContents().find((contents) =>
      contents.getType() === 'webview' && contents.getURL().includes(`shell-${instanceId}`))
    if (!shell) throw new Error('sandbox webview not found')
    const frame = shell.mainFrame.frames[0]
    if (!frame) throw new Error('guest frame not found')
    return frame.executeJavaScript(script)
  }, { instanceId, script })
}

async function sendPrompt(page, text) {
  const composer = page.locator('.ds-composer-textarea')
  await composer.fill(text)
  await page.locator('.ds-composer-primary-action').click()
}

async function latestThread(page) {
  const list = await runtimeRequest(page, '/v1/threads?limit=20')
  const thread = list.threads[0]
  return thread ? runtimeRequest(page, `/v1/threads/${thread.id}`) : null
}

async function waitForTurns(page, count, timeoutMs, description) {
  let thread
  await poll(async () => {
    thread = await latestThread(page)
    return Boolean(thread && thread.turns.filter((turn) => turn.status === 'completed').length >= count)
  }, timeoutMs, description)
  return thread
}

/** Approve pending tool calls through the real composer card and protected window. */
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

async function waitForTurnsApproving(application, page, count, timeoutMs, description) {
  let thread
  await poll(async () => {
    await approvePending(application, page)
    thread = await latestThread(page)
    return Boolean(thread && thread.turns.filter((turn) => turn.status === 'completed').length >= count)
  }, timeoutMs, description)
  return thread
}

async function runFlow({ application, page, capture, timeoutMs }) {
  const checks = []
  // 1. Gen UI widget rendered from render_widget in an isolated webview.
  await sendPrompt(page, '[gen-ui-smoke-1] Show an amplitude explorer')
  const thread = await waitForTurns(page, 1, timeoutMs, 'Gen UI turn')
  const card = page.locator('[data-gen-ui-widget]').first()
  await card.waitFor({ timeout: timeoutMs })
  const webview = card.locator('webview[data-app-sandbox-instance]')
  await webview.waitFor({ timeout: timeoutMs })
  const genUiInstance = await webview.getAttribute('data-app-sandbox-instance')
  await poll(async () => (await guestEvaluate(application, genUiInstance,
    "document.getElementById('amp-explorer')?.dataset.ready === 'true'")) === true, timeoutMs, 'widget script ready')
  const guestInfo = await guestEvaluate(application, genUiInstance, `({
    origin: location.origin, hasKunBridge: typeof window.kun?.setWidgetState === 'function',
    hasWorkbenchBridge: typeof window.kunGui !== 'undefined', paths: document.querySelectorAll('#amp-wave path').length
  })`)
  const fetchBlocked = await guestEvaluate(application, genUiInstance,
    "fetch('https://example.com').then(() => false, () => true)")
  assert.match(guestInfo.origin, /^kun-app:\/\/genui-[a-f0-9]{32}$/u)
  assert.equal(guestInfo.hasKunBridge, true)
  assert.equal(guestInfo.hasWorkbenchBridge, false)
  assert.equal(guestInfo.paths, 1)
  assert.equal(fetchBlocked, true)
  // A pinned CDN script resolves to the bundled offline copy, never the network.
  await poll(async () => (await guestEvaluate(application, genUiInstance,
    "document.getElementById('amp-explorer')?.dataset.d3")) === '7.9.0', timeoutMs, 'offline d3 loaded in the widget')
  await poll(async () => (await webview.evaluate((element) => element.getBoundingClientRect().height)) > 150,
    timeoutMs, 'widget reported its content height')
  await poll(async () => (await guestEvaluate(application, genUiInstance,
    "document.getElementById('amp-ask').getBoundingClientRect().bottom <= innerHeight")) === true,
    timeoutMs, 'widget content fully visible inside its card')
  diagnostics.genUi = await layout(application, genUiInstance, webview, `({ innerWidth, innerHeight,
    body: Math.round(document.body.getBoundingClientRect().height), scrollHeight: document.documentElement.scrollHeight })`)
  await capture('gen-ui-1-widget')
  checks.push('render_widget output renders in a kun-app:// sandbox page with the window.kun bridge, no network and offline d3')

  // 2. Widget state persists through the runtime and becomes a composer context chip.
  await guestEvaluate(application, genUiInstance, `(() => {
    document.getElementById('amp').value = '4'; document.getElementById('amp').dispatchEvent(new Event('input'))
    document.getElementById('amp-save').click(); return true })()`)
  await poll(async () => {
    const state = await runtimeRequest(page, `/v1/threads/${thread.id}/gen-ui/state`)
    return state.entries.some((entry) => entry.state.modelContent?.amplitude === 4)
  }, timeoutMs, 'widget state persisted')
  await page.getByText(/Amplitude explorer state|Amplitude explorer 状态/u).first().waitFor({ timeout: timeoutMs })
  await capture('gen-ui-2-state-chip')
  checks.push('setWidgetState persists per thread and attaches modelContent as a removable composer context chip')

  // 3. A follow-up from the page goes through the confirmation gate and sends to the same thread.
  const dialog = application.waitForEvent('window', { timeout: 15_000 }).catch(() => null)
  await guestEvaluate(application, genUiInstance, "document.getElementById('amp-ask').click(); true")
  const protectedWindow = await dialog
  if (protectedWindow) {
    await protectedWindow.waitForLoadState('domcontentloaded')
    await protectedWindow.locator('button').filter({ hasText: /Confirm|确认|OK/u }).first().click()
  }
  const followed = await waitForTurns(page, 2, timeoutMs, 'follow-up turn')
  const followUp = followed.turns.find((turn) => JSON.stringify(turn).includes('[gen-ui-followup] Explain amplitude 4'))
  assert(followUp, 'follow-up prompt reached the runtime')
  const userItem = followUp.items.find((item) => item.kind === 'user')
  assert(JSON.stringify(userItem?.composerContexts ?? followUp.composerContexts ?? []).includes('amplitude'),
    `follow-up carried the widget state context: ${JSON.stringify(followUp).slice(0, 3000)}`)
  checks.push(`sendFollowUpMessage sends to the owning thread (${protectedWindow ? 'after protected confirmation' : 'by native gesture'}) with widget state`)

  // The widget turn stays mounted across the send, so its page is not reloaded.
  assert.equal(await webview.getAttribute('data-app-sandbox-instance'), genUiInstance, 'widget page survived the follow-up send')
  assert.equal(await guestEvaluate(application, genUiInstance, "document.getElementById('amp').value"), '4')
  checks.push('The widget page keeps its instance and live state while new turns arrive')

  // 3b. A real click inside the page. Clicks in the framed guest are not seen as
  // workbench input events, so this is expected to fall back to confirmation.
  const point = await guestEvaluate(application, genUiInstance, `(() => {
    const rect = document.getElementById('amp-ask').getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, innerWidth }
  })()`)
  const box = await webview.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width }
  })
  const scale = box.width / point.innerWidth
  let gestureDialog = false
  const unexpectedDialog = application.waitForEvent('window', { timeout: 8_000 }).then(async (dialogWindow) => {
    gestureDialog = true
    await dialogWindow.locator('button').filter({ hasText: /Confirm|确认|OK/u }).first().click().catch(() => undefined)
  }).catch(() => undefined)
  await page.mouse.click(box.left + point.x * scale, box.top + point.y * scale)
  await waitForTurns(page, 3, timeoutMs, 'native-gesture follow-up turn')
  await unexpectedDialog
  diagnostics.nativeGestureFollowUp = gestureDialog ? 'confirmation shown' : 'sent directly'
  checks.push(`A real click inside the page reaches the follow-up gate (${diagnostics.nativeGestureFollowUp})`)

  // 4. Canvas MCP App: tool result opens the App panel with the live Excalidraw page.
  await sendPrompt(page, '[canvas-smoke-1] Draw API, cache and database')
  await waitForTurnsApproving(application, page, 4, timeoutMs, 'canvas create turn')
  assert.equal(await webview.getAttribute('data-app-sandbox-instance'), genUiInstance, 'widget page survived a composer send')
  const panel = page.locator('[data-app-surface-panel="mcp-app"]')
  await panel.waitFor({ timeout: timeoutMs })
  const canvasWebview = panel.locator('webview[data-app-sandbox-instance]')
  await canvasWebview.waitFor({ timeout: timeoutMs })
  const canvasInstance = await canvasWebview.getAttribute('data-app-sandbox-instance')
  const created = (await latestThread(page)).turns.at(-1).items.find((item) => item.kind === 'tool_result')
  const boardId = created.output.result.structuredContent.boardId
  let board
  await poll(async () => {
    const response = await runtimeRequest(page, '/v1/mcp-apps/tool', 'POST', {
      serverId: 'kun_canvas', name: 'canvas_get', arguments: { boardId }, threadId: thread.id
    })
    board = response.result.structuredContent?.board
    return board && board.pending === false && board.revision >= 2
  }, timeoutMs, 'canvas page normalized and committed the model skeleton')
  assert(board.elements.some((element) => element.type === 'text' && element.text === 'Cache'), 'labels became text elements')
  await poll(async () => (await guestEvaluate(application, canvasInstance,
    "Boolean(document.querySelector('.excalidraw canvas'))")) === true, timeoutMs, 'Excalidraw canvas mounted')
  diagnostics.canvas = await layout(application, canvasInstance, canvasWebview, `(() => {
    const stage = document.querySelector('.kun-canvas-stage')?.getBoundingClientRect()
    return { innerWidth, innerHeight, stageHeight: stage && Math.round(stage.height),
      toolbar: Boolean(document.querySelector('.App-toolbar')) }
  })()`)
  await poll(async () => (await guestEvaluate(application, canvasInstance,
    "[...document.fonts].some((font) => font.status === 'loaded' && /excalifont|virgil/i.test(font.family))")) === true,
  timeoutMs, 'Excalidraw hand-drawn font loaded from the bundled font directory')
  assert(diagnostics.canvas.guest.stageHeight > 400, 'canvas editor fills the App panel')
  assert.equal(diagnostics.canvas.guest.toolbar, true, 'Excalidraw toolbar rendered')
  await capture('canvas-1-panel')
  const guestPng = await application.evaluate(async ({ webContents }, instanceId) => {
    const shell = webContents.getAllWebContents().find((contents) => contents.getURL().includes(`shell-${instanceId}`))
    return shell ? (await shell.capturePage()).toPNG().toString('base64') : null
  }, canvasInstance).catch(() => null)
  if (guestPng) await writeFile(join(process.cwd(), 'dist', 'app-surfaces-smoke', 'canvas-guest.png'), Buffer.from(guestPng, 'base64'))
  checks.push('canvas_create opens the App panel; the sandboxed Excalidraw page converts skeletons, saves revision 2 and uses the bundled fonts')

  // 5. The agent edits by element id; the open page reloads the new revision in place.
  await sendPrompt(page, `[canvas-edit-smoke-1] Make the cache two nodes on ${boardId}`)
  await waitForTurnsApproving(application, page, 5, timeoutMs, 'canvas edit turn')
  await poll(async () => {
    const response = await runtimeRequest(page, '/v1/mcp-apps/tool', 'POST', {
      serverId: 'kun_canvas', name: 'canvas_get', arguments: { boardId }, threadId: thread.id
    })
    board = response.result.structuredContent?.board
    return board && board.pending === false &&
      board.elements.some((element) => element.text === 'Cache x2') &&
      board.elements.some((element) => element.text === 'Cache replica')
  }, timeoutMs, 'edited canvas normalized by the live page')
  assert.equal(await canvasWebview.getAttribute('data-app-sandbox-instance'), canvasInstance, 'panel kept the same live page')
  await capture('canvas-2-edited')
  checks.push('canvas_read + canvas_apply edit the board by id and the live page reloads without remounting')

  // 6. Referencing the canvas adds an App context chip for the next message.
  await guestEvaluate(application, canvasInstance,
    "[...document.querySelectorAll('.kun-canvas-toolbar button')][0].click(); true")
  await page.getByText(/kun_canvas · canvas (context|上下文)/u).first().waitFor({ timeout: timeoutMs })
  await capture('canvas-3-context-chip')
  checks.push('updateModelContext from the canvas page becomes a composer context chip')
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'app-surfaces-smoke'))
  const appExecutable = argumentValue('--app-executable')
  const packaged = Boolean(appExecutable)
  let electronExecutable, unpackedRoot = repositoryRoot
  if (packaged) {
    electronExecutable = resolve(appExecutable)
    assert(existsSync(electronExecutable), `Missing packaged executable ${electronExecutable}`)
    unpackedRoot = resolve(electronExecutable, '..', '..', 'Resources', 'app.asar.unpacked')
  } else {
    for (const entry of ['out/main/index.js', 'out/main/canvas-mcp-node-entry.js', 'out/renderer/index.html', 'out/canvas-app/index.html', 'kun/dist/cli/serve-entry.js']) {
      assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
    }
    const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
    electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-app-surfaces-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'app-surfaces-'))
  const screenshots = []
  const pageErrors = []
  let application, electronProcess, page, fixture, result, primaryError, realProfile = profile, electronOutput = ''
  // Capture the composited window so sandbox webviews appear exactly as on screen.
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
    fixture = await startAppSurfacesModelFixture(MODEL)
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile), locale: 'en', initialSetupCompleted: true }
    Object.assign(settings.agents.kun, {
      baseUrl: fixture.baseUrl, apiKey: 'app-surfaces-offline-fixture', model: MODEL, approvalPolicy: 'auto',
      lab: { genUi: { enabled: true }, mcpApps: { enabled: true } }
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
    const assertions = await runFlow({ application, page, capture, timeoutMs })
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
