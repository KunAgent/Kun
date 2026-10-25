#!/usr/bin/env node
'use strict'

// Code whiteboard chrome smoke on an isolated profile: real Electron, the Kun
// runtime and an offline model fixture. One plain Code turn creates a thread,
// then the run opens the right-rail whiteboard, switches the empty board to
// Excalidraw, draws with the shared tool pill and walks every view mode
// (docked, fill workspace, focus fullscreen) including Escape handling.
//   npm run build && node scripts/smoke-development-code-whiteboard.cjs [--locale zh] [--keep-dirs]
// Screenshots and report.json land under dist/code-whiteboard-smoke (or --evidence <dir>).

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
const { startDesignCanvasModelFixture } = require('./smoke-development-design-canvas-model.cjs')

const MODEL = 'deepseek-chat'
const diagnostics = {}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function poll(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      last = error
    }
    await pause(250)
  }
  throw new Error(`Timed out waiting for ${description}${last ? `: ${last.message}` : ''}`)
}

async function visibleCount(page, selector) {
  return page.evaluate((query) => [...document.querySelectorAll(query)].filter((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none'
  }).length, selector)
}

async function view(page) {
  return page.locator('[data-whiteboard-header]').first().getAttribute('data-whiteboard-view')
}

async function chooseView(page, index) {
  await page.locator('[data-whiteboard-view-menu-trigger]').first().click()
  await page.locator('[data-whiteboard-header] [role="menuitemradio"]').nth(index).click()
  await pause(900)
}

async function runFlow({ page, capture, timeoutMs }) {
  const checks = []
  await page.locator('.ds-composer-textarea').fill('Say hello so this task has a thread.')
  await page.locator('.ds-composer-primary-action').click()
  await page.getByText('Done.').first().waitFor({ timeout: timeoutMs })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('kun:code-canvas-open-request', {
    detail: { target: 'code', reason: 'manual' }
  })))
  const header = page.locator('[data-whiteboard-header]').first()
  await header.waitFor({ timeout: timeoutMs })
  await pause(1_200)
  assert.equal(await view(page), 'docked')
  assert.equal(await visibleCount(page, '[data-canvas-engine-switcher]'), 0,
    'no engine switcher floats over the board')
  await capture('wb-0-kun-docked')
  checks.push('The docked whiteboard opens under its own header row')

  await page.locator('[data-whiteboard-board-menu-trigger]').first().click()
  await capture('wb-1-board-menu-empty')
  await page.locator('[data-canvas-engine-option="excalidraw"]').first().click()
  await page.locator('[data-excalidraw-tool-pill]').first().waitFor({ timeout: timeoutMs })
  await page.locator('.kun-excalidraw-host .excalidraw').first().waitFor({ timeout: timeoutMs })
  await pause(1_500)
  diagnostics.excalidrawToolbarVisible = await visibleCount(page, '.kun-excalidraw-host .App-toolbar-container, .kun-excalidraw-host .shapes-section')
  assert.equal(diagnostics.excalidrawToolbarVisible, 0, 'Excalidraw shape toolbar is replaced by the Kun pill')
  const pill = await page.locator('[data-excalidraw-tool-pill]').first().boundingBox()
  const headerBox = await header.boundingBox()
  assert(pill && headerBox && pill.y >= headerBox.y + headerBox.height, 'tool pill sits below the header')
  diagnostics.dockedPill = pill
  await capture('wb-2-excalidraw-docked')
  checks.push('Switching an empty board to Excalidraw swaps in the shared tool pill')

  await page.locator('[data-excalidraw-pill-tool="rectangle"]').first().click()
  const surface = await page.locator('.kun-excalidraw-host').first().boundingBox()
  assert(surface, 'excalidraw host visible')
  const cx = surface.x + surface.width / 2
  const cy = surface.y + surface.height / 2
  await page.mouse.move(cx - 120, cy - 60)
  await page.mouse.down()
  await page.mouse.move(cx + 40, cy + 40, { steps: 8 })
  await page.mouse.up()
  await pause(400)
  diagnostics.activeAfterDraw = await page.locator('[data-excalidraw-pill-tool][aria-pressed="true"]').first()
    .getAttribute('data-excalidraw-pill-tool')
  await page.locator('[data-excalidraw-pill-tool="ellipse"]').first().click()
  await page.mouse.move(cx + 80, cy - 40)
  await page.mouse.down()
  await page.mouse.move(cx + 200, cy + 60, { steps: 8 })
  await page.mouse.up()
  await pause(300)
  await capture('wb-3-drawn-selected')
  await page.keyboard.press('Escape')
  await pause(300)
  checks.push(`Drew with the pill; active tool after a rectangle stroke: ${diagnostics.activeAfterDraw}`)

  await page.locator('[data-whiteboard-board-menu-trigger]').first().click()
  await pause(300)
  assert.equal(await page.locator('[data-canvas-engine-option="kun"]').first().isDisabled(), true,
    'engine is locked once the board has content')
  await capture('wb-4-board-menu-locked')
  await page.keyboard.press('Escape')
  await pause(200)
  checks.push('The board menu locks the engine once the board has content')

  await page.locator('[data-whiteboard-view-menu-trigger]').first().click()
  await capture('wb-5-view-menu')
  await page.keyboard.press('Escape')
  await pause(200)
  assert.equal(await view(page), 'docked', 'Escape on the menu only closes the menu')

  await chooseView(page, 1)
  await page.locator('[data-focused-canvas-workspace]').first().waitFor({ timeout: timeoutMs })
  await poll(async () => (await view(page)) === 'focused', timeoutMs, 'focused view')
  await pause(1_200)
  diagnostics.focusedPill = await page.locator('[data-excalidraw-tool-pill]').first().boundingBox()
  diagnostics.focusedLayout = await page.evaluate(() => Object.fromEntries([
    '.kun-excalidraw-host', '.kun-excalidraw-host .excalidraw', '.layer-ui__wrapper__footer', '.App-menu_top',
    '.layer-ui__wrapper__footer-left', '.layer-ui__wrapper__footer-right', '.HelpButton', '.App-bottom-bar',
    '[data-focused-canvas-workspace]'
  ].map((selector) => {
    const element = document.querySelector(selector)
    if (!element) return [selector, null]
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return [selector, { x: rect.x, y: rect.y, w: rect.width, h: rect.height, position: style.position, top: style.top,
      bottom: style.bottom, zoom: style.zoom, scrollTop: element.scrollTop, cls: element.className }]
  })))
  await capture('wb-6-fill-workspace')
  checks.push('Fill workspace moves the board onto the stage with the floating conversation')

  await chooseView(page, 2)
  await poll(async () => (await view(page)) === 'fullscreen', timeoutMs, 'fullscreen view')
  const root = await page.locator('[data-whiteboard-view="fullscreen"][data-canvas-engine]').first().boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  diagnostics.fullscreen = { root, viewport }
  assert(root && root.x <= 1 && root.y <= 1 && root.width >= viewport.width * 0.98, 'fullscreen covers the window')
  await capture('wb-7-fullscreen')
  checks.push('Focus fullscreen covers the whole window')

  const host = await page.locator('.kun-excalidraw-host').first().boundingBox()
  await page.mouse.click(host.x + 40, host.y + host.height - 40)
  await pause(200)
  await page.keyboard.press('Escape')
  await pause(500)
  assert.equal(await view(page), 'focused', 'Escape from an idle fullscreen board returns to fill workspace')
  await page.keyboard.press('Escape')
  await pause(800)
  assert.equal(await page.locator('[data-focused-canvas-workspace]').count(), 0, 'second Escape docks the board')
  assert.equal(await view(page), 'docked')
  await capture('wb-8-docked-again')
  checks.push('Escape steps back fullscreen → fill workspace → docked')

  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await pause(800)
  await capture('wb-9-dark')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const locale = argumentValue('--locale') ?? 'en'
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'code-whiteboard-smoke'))
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-code-whiteboard-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'code-whiteboard-'))
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
      baseUrl: fixture.baseUrl, apiKey: 'code-whiteboard-offline-fixture', model: MODEL, approvalPolicy: 'auto'
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
    const assertions = await runFlow({ page, capture, timeoutMs })
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
