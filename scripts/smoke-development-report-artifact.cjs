#!/usr/bin/env node
'use strict'

// Data report artifact smoke on an isolated profile: real Electron and Kun
// runtime with a stand-in model that calls `report_open`. Checks the report
// card in the conversation, the saved `.kun-reports` file, the Artifacts
// library's Charts kind and the report viewer.
//   npm run build && node scripts/smoke-development-report-artifact.cjs [--keep-dirs]
// Screenshots and report.json land under dist/report-artifact-smoke (or --evidence <dir>).

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
const { SMOKE_REPORT, startReportArtifactModel } = require('./smoke-report-artifact-model.cjs')

const diagnostics = {}

async function poll(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${description}${last ? `: ${last.message}` : ''}`)
}

async function runFlow({ page, capture, timeoutMs, model, workspaceRoot }) {
  const checks = []
  await page.locator('.ds-composer-textarea').fill('How many users do we have, and chart the daily actives for the last week')
  await page.locator('.ds-composer-primary-action').click()
  const card = page.locator('[data-report-open-card][data-report-open-state="ready"]')
  await card.waitFor({ timeout: timeoutMs })
  await poll(async () => (await card.locator('[data-chart-renderer]').count()) === 2, timeoutMs, 'two charts in the card')
  assert.equal(await card.locator('[data-report-stat]').count(), 3, 'The card shows the three stat tiles')
  diagnostics.toolNames = model.toolNames()
  assert(diagnostics.toolNames.includes('report_open'), 'report_open is offered to the model on a GUI Code turn')
  diagnostics.cardText = (await card.innerText()).slice(0, 1_000)
  assert(diagnostics.cardText.includes('Saved to Artifacts'), 'The card says the report was saved')
  await page.getByText('About 71% of registered accounts are active').waitFor({ timeout: timeoutMs })
  await card.scrollIntoViewIfNeeded()
  await capture('report-1-conversation-card')
  checks.push('A report_open call renders stats and both charts inline in the conversation, followed by the summary')

  const files = (await readdir(join(workspaceRoot, '.kun-reports'))).filter((name) => name.endsWith('.json'))
  assert.equal(files.length, 1, 'One saved report file')
  const saved = JSON.parse(await readFile(join(workspaceRoot, '.kun-reports', files[0]), 'utf8'))
  assert.equal(saved.title, SMOKE_REPORT.title)
  assert.equal(saved.revision, 1)
  assert(typeof saved.threadId === 'string' && saved.threadId, 'The saved report records its conversation')
  diagnostics.savedFile = `.kun-reports/${files[0]}`
  checks.push('The report is saved under .kun-reports with its source conversation')

  await card.locator('[data-report-open-open]').click()
  const stage = page.locator('[data-artifact-stage="report"]')
  await stage.waitFor({ timeout: timeoutMs })
  await poll(async () => (await stage.locator('[data-chart-renderer]').count()) === 2, timeoutMs, 'charts in the viewer')
  await capture('report-2-artifact-viewer')
  checks.push('"Open in Artifacts" opens the saved report in the Artifacts viewer')

  await page.getByRole('button', { name: 'Back to artifacts' }).click()
  await page.locator('[data-artifact-card="report"]').waitFor({ timeout: timeoutMs })
  await page.getByRole('tab', { name: /^Charts/ }).click()
  assert.equal(await page.locator('[data-artifact-card]').count(), 1, 'The Charts tab lists only the report')
  await page.locator('[data-artifact-card="report"] [data-report-thumbnail]').waitFor({ timeout: timeoutMs })
  await capture('report-3-library-charts')
  checks.push('The library lists the report under its own Charts kind with a cover drawn from its data')
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'report-artifact-smoke'))
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-report-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await realpath(await mkdtemp(join(workspaceParent, 'report-')))
  const screenshots = []
  const pageErrors = []
  let application, electronProcess, page, result, primaryError, realProfile = profile, electronOutput = ''
  const model = await startReportArtifactModel()
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
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile), locale: 'en', initialSetupCompleted: true }
    settings.agents.kun.baseUrl = model.baseUrl
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
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 })
    await page.locator('.ds-composer-textarea').waitFor({ timeout: timeoutMs })
    const assertions = await runFlow({ page, capture, timeoutMs, model, workspaceRoot })
    assert.deepEqual(pageErrors, [], 'Renderer emitted an uncaught exception')
    result = { ok: true, status: 'passed', completedAt: new Date().toISOString(), screenshots, assertions, diagnostics,
      ...(keepDirs ? { temporaryRoot, workspaceRoot } : {}) }
  } catch (error) {
    if (page) {
      await capture('failure').catch(() => undefined)
      await writeFile(join(evidenceRoot, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => undefined)
    }
    primaryError = new Error(`${error.stack ?? error}\nElectron:\n${electronOutput}`)
    result = { ok: false, status: 'failed', failure: primaryError.message, screenshots, pageErrors, diagnostics }
  } finally {
    if (application) await withTimeout(application.close(), 3_000, 'closing Electron').catch(() => undefined)
    await model.close().catch(() => undefined)
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
