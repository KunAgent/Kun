#!/usr/bin/env node
'use strict'

// Side panel smoke on an isolated profile: real Electron and Kun runtime, a
// seeded workspace with a 9-slide deck. Opens a text file and the deck from
// the Files rail, checks that each open file is its own right-panel tab, that
// the deck renders in the browser (Wasm parser + worker under the packaged
// CSP), and that slide navigation, zoom and closing a file tab work.
//   npm run build && node scripts/smoke-side-panel-deck.cjs [--theme dark] [--locale zh] [--evidence dir]
// Screenshots and report.json land under dist/side-panel-deck-smoke (or --evidence <dir>).

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
const { buildSmokePptx } = require('./smoke-artifacts-office-fixtures.cjs')

const diagnostics = {}
const DECK_TITLES = ['Roadmap 2027', 'Why now', 'Users', 'Product', 'Architecture', 'Pricing', 'Team', 'Milestones', 'Thanks']
const tree = '[role="tree"]:visible'
const row = (name) => `${tree} [data-tree-row$="/${name}"]`
const tabs = '.ds-code-right-tabs'
const deck = '.kun-pptx'

async function seedWorkspace(root) {
  const write = async (path, content) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await write('README.md', '# Kun deck smoke\n\nThe deck lives in presentations/.\n')
  await write('presentations/roadmap.pptx', await buildSmokePptx(DECK_TITLES))
}

async function poll(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 250))
  }
  throw new Error(`Timed out waiting for ${description}${last ? `: ${last.message}` : ''}`)
}

async function ensureTree(page, timeoutMs) {
  if ((await page.locator(tree).count()) > 0) return
  const toggle = page.locator('.ds-code-sidebar button:has(svg.lucide-folder-tree)')
  if (await toggle.count()) await toggle.first().click()
  else await page.locator('button:has(svg.lucide-folders)').first().click()
  await page.locator(tree).first().waitFor({ timeout: timeoutMs })
}

async function closeExplorerOverlay(page) {
  const backdrop = page.locator('.ds-file-preview-explorer-backdrop:visible')
  if (!(await backdrop.count())) return
  const box = await backdrop.first().boundingBox()
  if (box) await page.mouse.click(box.x + box.width - 24, box.y + box.height / 2)
}

async function summary(page) {
  return (await page.locator(`${deck} .kun-pptx-toolbar [aria-live="polite"]`).innerText()).trim()
}

async function runFlow({ page, capture, timeoutMs, pageErrors, diagnostics }) {
  const checks = []
  await capture('deck-01-workbench')

  await page.locator('button:has(svg.lucide-folders)').first().click()
  await page.locator(row('README.md')).first().waitFor({ timeout: timeoutMs })
  await page.locator(row('README.md')).first().click()
  await closeExplorerOverlay(page)
  await page.locator('.ds-code-sidebar').first().waitFor({ timeout: timeoutMs })
  await ensureTree(page, timeoutMs)
  // Recently changed files are listed above the tree too, so the deck may already be visible.
  if (!(await page.locator(row('roadmap.pptx')).count())) await page.locator(row('presentations')).first().click()
  await page.locator(row('roadmap.pptx')).first().click()
  await closeExplorerOverlay(page)

  await page.locator(`${deck} .rpv-normalized-slide`).first().waitFor({ timeout: timeoutMs })
  await poll(async () => (await page.locator(`${deck} .rpv-thumbnail[data-thumbnail-state="ready"]`).count()) > 0,
    timeoutMs, 'rendered slide thumbnails')
  assert.equal(await page.locator(`${deck} .kun-pptx-deck__status[role="alert"]`).count(), 0, 'The deck reported an error')
  await poll(async () => /9/.test(await summary(page)), timeoutMs, 'the slide count')
  checks.push(`The deck renders in the browser renderer with a thumbnail rail: "${await summary(page)}"`)

  const fileTabs = page.locator(`${tabs} .ds-right-tab[data-kind="file"]`)
  assert.equal(await fileTabs.count(), 2, 'Each open file should be its own right-panel tab')
  assert.equal(await page.locator('.ds-code-sidebar-topbar:visible').count(), 0, 'The preview kept its own tab row')
  assert.match(await page.locator(`${tabs} .ds-right-tab[data-active="true"]`).innerText(), /roadmap\.pptx/)
  await capture('deck-02-first-slide')
  checks.push('README.md and roadmap.pptx show as two tabs in the right panel strip; the preview has no second tab row')

  await page.locator(`${deck} .kun-pptx-toolbar button[aria-label]`).nth(1).click()
  await poll(async () => /2/.test((await summary(page)).replace(/9/g, '')), timeoutMs, 'the next slide')
  await page.locator(`${deck} .rpv-thumbnail`).nth(4).click()
  await poll(async () => /5/.test((await summary(page)).replace(/9/g, '')), timeoutMs, 'a rail-picked slide')
  await page.locator(`${deck} .kun-pptx-toolbar select`).selectOption('fit-width')
  assert.equal(await page.locator(`${deck} .kun-pptx-toolbar select`).inputValue(), 'fit-width')
  await capture('deck-03-slide-5-fit-width')
  checks.push(`Next and the rail move the deck: "${await summary(page)}"; zoom switched to fit width`)

  await fileTabs.filter({ hasText: 'README.md' }).locator('[role="tab"]').click()
  await page.locator('.ds-code-sidebar .ds-file-preview-markdown, .ds-code-sidebar .ds-file-preview-code-html').first()
    .waitFor({ timeout: timeoutMs })
  assert.match(await page.locator(`${tabs} .ds-right-tab[data-active="true"]`).innerText(), /README\.md/)
  await fileTabs.filter({ hasText: 'README.md' }).locator('.ds-right-tab__close').click()
  await poll(async () => (await fileTabs.count()) === 1, timeoutMs, 'closing the README tab')
  await page.locator(`${deck} .rpv-normalized-slide`).first().waitFor({ timeout: timeoutMs })
  await capture('deck-04-after-close')
  checks.push('Switching to README.md and closing its tab leaves the deck open')

  // Left sidebar: one text column for nav rows, section labels and projects.
  diagnostics.sidebarColumns = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-workbench-left-sidebar]')?.getBoundingClientRect()
    const left = (selector) => {
      const node = document.querySelector(selector)
      if (!node || !sidebar) return null
      const range = document.createRange()
      range.selectNodeContents(node)
      return Math.round(range.getBoundingClientRect().left - sidebar.left)
    }
    return {
      navIcon: left('.ds-sidebar-shell .sidebar-menu-row-icon'),
      navLabel: left('.ds-sidebar-shell .sidebar-menu-row-label'),
      newTaskLabel: left('.ds-sidebar-shell .sidebar-new-task span'),
      chatsTitle: left('.ds-sidebar-shell .sidebar-agent-chats-title'),
      projectsTitle: left('.ds-sidebar-shell .sidebar-projects-title span')
    }
  })
  await page.locator('.ds-sidebar-shell .sidebar-menu-row').filter({ hasText: /产物|Artifacts/ }).first().click()
  await page.locator('.ds-sidebar-shell .sidebar-menu-row.is-active').first().waitFor({ timeout: timeoutMs })
  await capture('deck-05-sidebar-active-row')
  checks.push(`Sidebar columns ${JSON.stringify(diagnostics.sidebarColumns)}; a selected nav row takes the fill`)

  assert.deepEqual(pageErrors, [], 'Renderer emitted an uncaught exception')
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const locale = argumentValue('--locale') ?? 'zh'
  const theme = argumentValue('--theme') ?? 'light'
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'side-panel-deck-smoke'))
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-side-panel-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await realpath(await mkdtemp(join(workspaceParent, 'side-panel-')))
  await seedWorkspace(workspaceRoot)
  const screenshots = []
  const pageErrors = []
  const consoleErrors = []
  let application, electronProcess, page, result, primaryError, realProfile = profile, electronOutput = ''
  const capture = async (name) => {
    const path = join(evidenceRoot, `${name}.png`)
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
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
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile), locale, theme, initialSetupCompleted: true }
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
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.setBounds({ x: 20, y: 20, width: 1440, height: 920 })
    })
    page = await findWorkbenchWindow(application, timeoutMs)
    page.setDefaultTimeout(30_000)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500))
    })
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 })
    await page.locator('.ds-composer-textarea').waitFor({ timeout: timeoutMs })
    const assertions = await runFlow({ page, capture, timeoutMs, pageErrors, diagnostics })
    result = { ok: true, status: 'passed', completedAt: new Date().toISOString(), screenshots, assertions, diagnostics, consoleErrors,
      ...(keepDirs ? { temporaryRoot, workspaceRoot } : {}) }
  } catch (error) {
    if (page) {
      await capture('failure').catch(() => undefined)
      await writeFile(join(evidenceRoot, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => undefined)
    }
    primaryError = new Error(`${error.stack ?? error}\nElectron:\n${electronOutput}`)
    result = { ok: false, status: 'failed', failure: primaryError.message, screenshots, pageErrors, consoleErrors }
  } finally {
    if (application) await withTimeout(application.close(), 3_000, 'closing Electron').catch(() => undefined)
    if (electronProcess) await terminateProcessTree(electronProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }).catch(() => undefined)
    await withTimeout(stopIsolatedSharedRuntime(repositoryRoot, realProfile), 20_000, 'runtime').catch(() => undefined)
    await withTimeout(stopIsolatedServiceManager(home, realProfile), 20_000, 'manager').catch(() => undefined)
    releaseChildProcessHandles(electronProcess)
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
