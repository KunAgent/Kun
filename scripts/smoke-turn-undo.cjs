#!/usr/bin/env node
'use strict'

// Per-turn file undo smoke on an isolated profile: real Electron and Kun
// runtime, an offline model that edits files with Kun's tools, and a seeded
// git workspace with an unrelated uncommitted user edit. Undoes a turn,
// reapplies it, hits a blocked preflight after an external edit, and resets
// files from an edited message. Screenshots every dialog state.
//   npm run build && node scripts/smoke-turn-undo.cjs [--locale zh] [--theme dark] [--keep-dirs]
// Screenshots and report.json land under dist/turn-undo-smoke (or --evidence <dir>).

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const {
  createIsolatedEnvironment, desktopSmokeSettings, desktopSmokeWorkspaceParent, desktopUserDataCandidates,
  platformDesktopArguments, stopIsolatedServiceManager, stopIsolatedSharedRuntime, releaseChildProcessHandles, withTimeout
} = require('./smoke-packaged-extension-desktop-runtime.cjs')
const { availablePort, argumentValue, positiveIntegerArgument, terminateProcessTree } = require('./smoke-packaged-extension-desktop-process.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')
const { startTurnUndoModelFixture } = require('./smoke-turn-undo-model.cjs')

const MODEL = 'deepseek-chat'
const ORIGINAL = {
  app: 'export const greeting = "hello"\n',
  util: 'export function add(a, b) {\n  return a + b\n}\n',
  readmeDraft: '# Demo\n\nUser draft, not committed yet.\n'
}
const diagnostics = {}

async function seedWorkspace(root) {
  const write = async (path, content) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await write('src/app.ts', ORIGINAL.app)
  await write('src/util.ts', ORIGINAL.util)
  await write('README.md', '# Demo\n')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=smoke@kun.local', '-c', 'user.name=Kun', 'add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=smoke@kun.local', '-c', 'user.name=Kun', 'commit', '-q', '-m', 'init'], { cwd: root })
  // An unrelated uncommitted edit: a workspace-wide reset would destroy it.
  await write('README.md', ORIGINAL.readmeDraft)
}

function runtimeRequest(page, path) {
  return page.evaluate(async (target) => {
    const response = await globalThis.kunGui.runtimeRequest(target, 'GET')
    if (!response.ok) throw new Error(`GET ${target} (${response.status}): ${response.body}`)
    return JSON.parse(response.body)
  }, path)
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

async function waitForCompletedTurns(application, page, count, timeoutMs, description) {
  await poll(async () => {
    await approvePending(application, page)
    const list = await runtimeRequest(page, '/v1/threads?limit=20')
    const thread = list.threads[0] ? await runtimeRequest(page, `/v1/threads/${list.threads[0].id}`) : null
    const busy = await page.locator('.ds-composer-primary-action[aria-label]').evaluate(
      (button) => /stop|停止/i.test(button.getAttribute('aria-label') ?? '')
    ).catch(() => false)
    return Boolean(thread && thread.turns.filter((turn) => turn.status === 'completed').length >= count && !busy)
  }, timeoutMs, description)
}

async function sendPrompt(page, text) {
  await page.locator('.ds-composer-textarea').fill(text)
  await page.locator('.ds-composer-primary-action').click()
}

const read = (root, path) => readFile(join(root, path), 'utf8')
const exists = (root, path) => stat(join(root, path)).then(() => true, () => false)
const dialog = '[data-turn-undo-dialog]'
const card = '[data-turn-change-summary]'

async function dialogPaths(page, group) {
  return page.locator(`${dialog} [data-turn-undo-group="${group}"] li .font-mono`).allInnerTexts()
}

async function openUndo(page, cardIndex, timeoutMs) {
  await page.locator(card).nth(cardIndex).locator('[data-turn-undo-action="undo"]').click()
  await page.locator(dialog).waitFor({ timeout: timeoutMs })
  await poll(async () => (await page.locator(`${dialog} [data-turn-undo-group]`).count()) > 0, timeoutMs, 'preflight groups')
}

async function startEdit(page, messageIndex) {
  const message = page.locator('.ds-user-message').nth(messageIndex)
  await message.scrollIntoViewIfNeeded()
  await message.hover()
  await message.locator('[data-user-message-edit]').click()
}

async function runFlow({ application, page, capture, timeoutMs, workspaceRoot: root }) {
  const checks = []
  await sendPrompt(page, '[undo-smoke-1] 把 greeting 改一下，写一份笔记，再生成一个文件')
  await waitForCompletedTurns(application, page, 1, timeoutMs, 'turn 1')
  assert.match(await read(root, 'src/app.ts'), /hello from Kun/)
  assert.ok(await exists(root, 'docs/notes.md'))
  assert.ok(await exists(root, 'generated.txt'))
  await sendPrompt(page, '[undo-smoke-2] 让 add 先把参数转成数字')
  await waitForCompletedTurns(application, page, 2, timeoutMs, 'turn 2')
  const turnTwoUtil = await read(root, 'src/util.ts')
  assert.match(turnTwoUtil, /Number\(a\)/)
  await poll(async () => (await page.locator(`${card} [data-turn-undo-action="undo"]`).count()) === 2, timeoutMs, 'undo buttons on both turn cards')
  await capture('undo-00-turn-cards')

  await openUndo(page, 0, timeoutMs)
  diagnostics.turnOnePreflight = {
    safe: await dialogPaths(page, 'safe'),
    ignored: await dialogPaths(page, 'ignored')
  }
  assert.deepEqual(diagnostics.turnOnePreflight.safe, ['docs/notes.md', 'src/app.ts'])
  assert.deepEqual(diagnostics.turnOnePreflight.ignored, ['generated.txt'])
  await capture('undo-01-preflight-safe')
  checks.push('Preflight lists the turn\'s edited and created files as safe and the shell-generated file as ignored')

  await page.locator(`${dialog} [data-turn-undo-confirm]`).click()
  await page.locator(dialog).waitFor({ state: 'detached', timeout: timeoutMs })
  await page.locator(card).first().locator('[data-turn-undo-action="reapply"]').waitFor({ timeout: timeoutMs })
  assert.equal(await read(root, 'src/app.ts'), ORIGINAL.app)
  assert.equal(await exists(root, 'docs/notes.md'), false)
  assert.equal(await read(root, 'README.md'), ORIGINAL.readmeDraft)
  assert.ok(await exists(root, 'generated.txt'))
  assert.equal(await read(root, 'src/util.ts'), turnTwoUtil)
  await capture('undo-02-card-undone')
  checks.push('Undo restored only the turn\'s files; the uncommitted README edit and the later turn survived')

  await page.locator(card).first().locator('[data-turn-undo-action="reapply"]').click()
  await page.locator(card).first().locator('[data-turn-undo-action="undo"]').waitFor({ timeout: timeoutMs })
  assert.match(await read(root, 'src/app.ts'), /hello from Kun/)
  assert.ok(await exists(root, 'docs/notes.md'))
  await capture('undo-03-reapplied')
  checks.push('Reapply put the turn\'s version back')

  await writeFile(join(root, 'src/util.ts'), 'export function add(a, b) {\n  return a - b // user edit\n}\n')
  await openUndo(page, 1, timeoutMs)
  assert.deepEqual(await dialogPaths(page, 'unsafe'), ['src/util.ts'])
  assert.equal(await page.locator(`${dialog} [data-turn-undo-confirm]`).isDisabled(), true)
  await capture('undo-04-preflight-blocked')
  await page.keyboard.press('Escape')
  await page.locator(dialog).waitFor({ state: 'detached', timeout: timeoutMs })
  assert.match(await read(root, 'src/util.ts'), /user edit/)
  checks.push('A file edited after its turn blocks undo and nothing is written')

  await startEdit(page, 0)
  await page.locator('[data-rewind-file-reset="blocked"]').waitFor({ timeout: timeoutMs })
  await capture('undo-05-edit-conflict')
  await page.locator('.ds-user-message textarea').press('Escape')
  checks.push('Editing an earlier message falls back to conversation-only when a later file conflicts')

  await writeFile(join(root, 'src/util.ts'), turnTwoUtil)
  await startEdit(page, 0)
  await page.locator('[data-rewind-file-reset="ready"]').waitFor({ timeout: timeoutMs })
  await capture('undo-06-edit-reset-files')
  await page.locator('.ds-user-message textarea').fill('[undo-smoke-9] 从头再来')
  await page.locator('[data-rewind-resend]').click()
  await poll(async () => (await read(root, 'src/app.ts')) === ORIGINAL.app &&
    !(await exists(root, 'docs/notes.md')) && (await read(root, 'src/util.ts')) === ORIGINAL.util,
  timeoutMs, 'files reset by the edited message')
  await waitForCompletedTurns(application, page, 1, timeoutMs, 'resent turn')
  assert.equal(await read(root, 'README.md'), ORIGINAL.readmeDraft)
  await capture('undo-07-after-reset')
  checks.push('Resending with "reset conversation and files" restored both turns\' files and kept the README edit')
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const locale = argumentValue('--locale') ?? 'zh'
  const theme = argumentValue('--theme') ?? 'light'
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'turn-undo-smoke'))
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-turn-undo-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await realpath(await mkdtemp(join(workspaceParent, 'turn-undo-')))
  await seedWorkspace(workspaceRoot)
  const screenshots = []
  const pageErrors = []
  let application, electronProcess, page, fixture, result, primaryError, realProfile = profile, electronOutput = ''
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
    fixture = await startTurnUndoModelFixture(MODEL)
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile), locale, theme, initialSetupCompleted: true }
    Object.assign(settings.agents.kun, {
      baseUrl: fixture.baseUrl, apiKey: 'turn-undo-offline-fixture', model: MODEL, approvalPolicy: 'auto'
    })
    // Checkpoints are off by default; the undo flow needs the pre-send snapshot.
    settings.checkpointCleanup = { createEnabled: true, createEnabledResetAt: new Date().toISOString() }
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
    const assertions = await runFlow({ application, page, capture, timeoutMs, workspaceRoot })
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
