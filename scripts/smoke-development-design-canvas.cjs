#!/usr/bin/env node
'use strict'

// Design canvas chrome smoke on an isolated profile: real Electron, the Kun
// runtime and an offline model fixture. A Code turn opens Design, the Design
// pass lays out four HTML screens, and the run screenshots the canvas chrome:
// top toolbar, board labels, the bottom inspector tabs and the board focus view.
//   npm run build && node scripts/smoke-development-design-canvas.cjs [--locale zh] [--keep-dirs]
// Screenshots and report.json land under dist/design-canvas-smoke (or --evidence <dir>).

const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const {
  createIsolatedEnvironment, desktopSmokeSettings, desktopSmokeWorkspaceParent, desktopUserDataCandidates,
  platformDesktopArguments, stopIsolatedServiceManager, stopIsolatedSharedRuntime, releaseChildProcessHandles, withTimeout
} = require('./smoke-packaged-extension-desktop-runtime.cjs')
const { availablePort, argumentValue, positiveIntegerArgument, terminateProcessTree } = require('./smoke-packaged-extension-desktop-process.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')
const { startDesignCanvasModelFixture, SCREENS } = require('./smoke-development-design-canvas-model.cjs')

const MODEL = 'deepseek-chat'
const diagnostics = {}

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
  return page.evaluate(async () => {
    const read = async (path) => {
      const response = await globalThis.kunGui.runtimeRequest(path, 'GET')
      if (!response.ok) throw new Error(`${path} (${response.status})`)
      return JSON.parse(response.body)
    }
    const list = await read('/v1/threads?limit=5')
    return list.threads[0] ? read(`/v1/threads/${list.threads[0].id}`) : null
  })
}

async function approvePending(application, page) {
  const allow = page.locator('[data-approval-choice="1"]').first()
  if (!(await allow.isVisible().catch(() => false))) return false
  const opened = application.waitForEvent('window', { timeout: 15_000 }).catch(() => null)
  await allow.click()
  const dialog = await opened
  if (dialog) {
    await dialog.locator('[data-protected-confirmation]').waitFor({ timeout: 10_000 }).catch(() => undefined)
    await Promise.all([dialog.waitForEvent('close').catch(() => undefined), dialog.locator('#confirm').click().catch(() => undefined)])
  }
  return true
}

async function screenFiles(workspaceRoot) {
  const found = []
  const visit = async (directory, depth) => {
    if (depth > 5) return
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { await visit(path, depth + 1); continue }
      if (!/^v\d+\.html$/u.test(entry.name)) continue
      const html = await readFile(path, 'utf8').catch(() => '')
      if (html.includes('</html>') && SCREENS.some((screen) => html.includes(screen.name))) found.push(path)
    }
  }
  await visit(join(workspaceRoot, '.kun-design'), 0)
  return found
}

async function runFlow({ application, page, capture, timeoutMs, workspaceRoot }) {
  const checks = []
  const composer = page.locator('.ds-composer-textarea')
  await composer.fill('[design-canvas-smoke] Redesign the composer tray. Show me the states on a design canvas first.')
  await page.locator('.ds-composer-primary-action').click()
  await page.locator('[data-code-canvas-titlebar]').first().waitFor({ timeout: timeoutMs })
  let files = []
  await poll(async () => {
    await approvePending(application, page)
    files = await screenFiles(workspaceRoot)
    return files.length >= SCREENS.length
  }, timeoutMs * 2, 'four screen HTML files')
  diagnostics.screenFiles = files.map((path) => path.slice(workspaceRoot.length + 1))
  await poll(async () => (await page.locator('webview').count()) >= SCREENS.length, timeoutMs, 'screen webviews')
  await new Promise((resolve) => setTimeout(resolve, 2_500))
  const thread = await latestThread(page)
  diagnostics.turns = thread?.turns?.length ?? null
  assert.equal(diagnostics.turns, 1, 'the agent designs in its own turn; no design pass or per-screen turns')
  checks.push(`One Code turn wrote ${files.length} HTML screens onto the canvas`)

  const svg = page.locator('svg[data-canvas-surface="design"]').first()
  const box = await svg.boundingBox()
  assert(box, 'design canvas svg is visible')
  await page.mouse.click(box.x + box.width - 24, box.y + box.height - 24)
  await page.keyboard.press('Shift+1')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await capture('canvas-0-overview')
  diagnostics.toolbar = await page.locator('.design-canvas-toolbar').first().getAttribute('role').catch(() => null)
  diagnostics.flowConnectors = await page.locator('[data-prototype-flows]').count()
  assert.equal(diagnostics.flowConnectors, 0, 'reading-order guesses are not drawn as flow lines')
  checks.push('No guessed prototype-flow lines are drawn between boards')

  const label = page.locator('[data-canvas-board-label]').first()
  if (await label.count()) {
    await label.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await capture('canvas-1-board-selected')
    checks.push('Clicking a board label selects the board')
    assert.equal(await page.locator('[data-canvas-selection-toolbar]').count(), 1, 'a selected board shows the floating toolbar')
    await page.locator('[data-canvas-comment-on-element]').first().click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await page.keyboard.type('make the header tighter')
    await page.mouse.click(box.x + 40, box.y + box.height - 40)
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(await page.locator('[data-canvas-sticky="draft"]').count(), 1, 'commenting on a board drops a draft note')
    await capture('canvas-1b-comment-on-element')
    checks.push('The floating toolbar comments on the selected board')
    await label.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const toggle = page.locator('[data-canvas-inspector-toggle]').first()
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    for (const tab of ['properties', 'outline', 'code', 'tweaks', 'notes']) {
      const button = page.locator(`[data-canvas-inspector-tab="${tab}"]`).first()
      if (!(await button.count())) continue
      await button.click()
      await new Promise((resolve) => setTimeout(resolve, tab === 'code' ? 1_200 : 400))
      await capture(`canvas-2-inspector-${tab}`)
      checks.push(`Inspector ${tab} tab renders`)
      if (tab !== 'tweaks') continue
      const panel = page.locator('[data-canvas-inspector-panel="tweaks"]').first()
      const scrollState = () => panel.evaluate((element) => ({
        top: element.scrollTop,
        max: element.scrollHeight - element.clientHeight
      }))
      const before = await scrollState()
      const panelBox = await panel.boundingBox()
      assert(panelBox, 'tweaks panel is visible')
      await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2)
      await page.mouse.wheel(0, 600)
      await new Promise((resolve) => setTimeout(resolve, 500))
      const after = await scrollState()
      diagnostics.tweaksScroll = { before, after }
      assert(before.max > 0, 'tweaks content overflows the drawer at the default height')
      assert(after.top > before.top, 'the wheel scrolls the tweaks panel')
      await capture('canvas-2-inspector-tweaks-scrolled')
      checks.push('The wheel scrolls the Tweaks panel inside the drawer')
    }
    // Pages: a new page hides the first page's screens; switching back restores them.
    const switcher = page.locator('[data-canvas-page-switcher] > button').first()
    await switcher.click()
    await page.getByRole('menuitem', { name: 'New page' }).click()
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.match((await switcher.textContent()) ?? '', /Page 2/, 'the new page opens')
    await capture('canvas-6-new-page')
    await switcher.click()
    await page.getByRole('menuitemradio', { name: /Page 1/ }).click()
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert((await page.locator('webview').count()) >= SCREENS.length, 'screens return with their page')
    checks.push('Pages switch and restore their screens')
    // Sticky note: N then a click drops a note that starts in editing.
    const canvasBox = await svg.boundingBox()
    await page.keyboard.press('n')
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + 120)
    await new Promise((resolve) => setTimeout(resolve, 300))
    await page.keyboard.type('@Kun tighten the header')
    await page.mouse.click(canvasBox.x + 40, canvasBox.y + canvasBox.height - 40)
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(await page.locator('[data-canvas-sticky="draft"]').count(), 2, 'a second draft sticky note is on the canvas')
    await capture('canvas-7-sticky')
    checks.push('A sticky note can be dropped and edited')
    await label.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await page.locator('[data-canvas-board-expand]').first().click()
    await page.locator('[data-canvas-board-focus]').first().waitFor({ timeout: timeoutMs })
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await capture('canvas-3-focus-fit')
    const fill = page.locator('[data-canvas-focus-fit="fill"]').first()
    if (await fill.count()) {
      await fill.click()
      await new Promise((resolve) => setTimeout(resolve, 600))
      await capture('canvas-4-focus-fill')
      await page.locator('[data-canvas-focus-fit="fit"]').first().click()
    }
    checks.push('The board focus view opens with Fit/Fill')
    await page.locator('[data-canvas-focus-back]').first().click()
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await new Promise((resolve) => setTimeout(resolve, 600))
    await capture('canvas-5-dark')
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  } else {
    const firstWebview = page.locator('webview').first()
    const frame = await firstWebview.boundingBox()
    if (frame) {
      await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2)
      await new Promise((resolve) => setTimeout(resolve, 400))
      await capture('canvas-1-board-selected')
      const trigger = page.locator('[data-canvas-inspector-trigger]').first()
      if (await trigger.count()) {
        await trigger.click()
        await new Promise((resolve) => setTimeout(resolve, 400))
        await capture('canvas-2-inspector-properties')
      }
    }
  }
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const locale = argumentValue('--locale') ?? 'en'
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'design-canvas-smoke'))
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-design-canvas-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'design-canvas-'))
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
    environment.NODE_ENV = 'development'
    fixture = await startDesignCanvasModelFixture(MODEL)
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile), locale, initialSetupCompleted: true }
    Object.assign(settings.agents.kun, {
      baseUrl: fixture.baseUrl, apiKey: 'design-canvas-offline-fixture', model: MODEL, approvalPolicy: 'auto'
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
        '--disable-component-update', ...platformDesktopArguments(process.platform), repositoryRoot],
      cwd: repositoryRoot, env: environment, chromiumSandbox: true, timeout: timeoutMs
    })
    electronProcess = application.process()
    for (const stream of [electronProcess.stdout, electronProcess.stderr]) {
      stream?.on('data', (chunk) => { electronOutput = `${electronOutput}${chunk}`.slice(-64 * 1024) })
    }
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.setBounds({ x: 20, y: 20, width: 1600, height: 1000 })
    })
    page = await findWorkbenchWindow(application, timeoutMs)
    page.setDefaultTimeout(30_000)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 })
    await page.locator('.ds-composer-textarea').waitFor({ timeout: timeoutMs })
    const assertions = await runFlow({ application, page, capture, timeoutMs, workspaceRoot: await realpath(workspaceRoot) })
    assert.deepEqual(pageErrors, [], 'Renderer emitted an uncaught exception')
    result = { ok: true, status: 'passed', completedAt: new Date().toISOString(), screenshots, assertions, diagnostics,
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
    await withTimeout(stopIsolatedSharedRuntime(repositoryRoot, realProfile), 20_000, 'runtime').catch(() => undefined)
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
