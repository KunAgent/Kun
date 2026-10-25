#!/usr/bin/env node
'use strict'

// Changes panel commit flow on an isolated profile: real Electron and Kun runtime,
// a seeded git repository with a local bare remote and a loopback model that
// writes the commit message. Walks the source menu, discard, stage, generate,
// commit & push with a first-push upstream, a rejected push and the branch view.
//   npm run build && node scripts/smoke-development-changes-commit.cjs [--keep-dirs] [--locale zh]
// Screenshots and report.json land under dist/changes-commit-smoke (or --evidence <dir>).

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { createServer } = require('node:http')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const {
  createIsolatedEnvironment, desktopSmokeSettings, desktopSmokeWorkspaceParent, desktopUserDataCandidates,
  platformDesktopArguments, stopIsolatedServiceManager, stopIsolatedSharedRuntime, releaseChildProcessHandles, withTimeout
} = require('./smoke-packaged-extension-desktop-runtime.cjs')
const { availablePort, argumentValue, positiveIntegerArgument, terminateProcessTree } = require('./smoke-packaged-extension-desktop-process.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')

const BRANCH = 'kun/smoke-commit-flow'
const GENERATED = 'feat(app): bump a to 2 and note the release step\n\nStage the app constant change together with the README note.'
const diagnostics = { modelCalls: [] }
const gitEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnvironment, stdio: ['ignore', 'pipe', 'pipe'] })

/** Loopback chat-completions fixture: answers commit-message requests, `ok` otherwise. */
async function startModelFixture() {
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }))
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const system = JSON.stringify(body.messages?.[0]?.content ?? '')
    const commit = system.includes('You write the git commit message')
    diagnostics.modelCalls.push(commit ? 'commit-message' : 'other')
    const text = commit ? GENERATED : 'ok'
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(() => done())) }
}

async function seedRepository(workspaceRoot, remote) {
  const write = async (path, content) => {
    await mkdir(join(workspaceRoot, path, '..'), { recursive: true })
    await writeFile(join(workspaceRoot, path), content)
  }
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { env: gitEnvironment })
  git(workspaceRoot, 'init', '-q', '-b', 'main')
  git(workspaceRoot, 'config', 'user.email', 'smoke@example.com')
  git(workspaceRoot, 'config', 'user.name', 'Kun Smoke')
  await write('README.md', '# Smoke app\n\nRelease steps live here.\n')
  await write('src/app.ts', 'export const a = 1\n')
  await write('docs/guide.md', 'Original guide.\n')
  git(workspaceRoot, 'add', '.')
  git(workspaceRoot, 'commit', '-q', '-m', 'chore: seed smoke repository')
  git(workspaceRoot, 'remote', 'add', 'origin', remote)
  git(workspaceRoot, 'push', '-q', '-u', 'origin', 'main')
  git(workspaceRoot, 'switch', '-q', '-c', BRANCH)
  await write('README.md', '# Smoke app\n\nRelease steps live here.\nRun the smoke before tagging.\n')
  git(workspaceRoot, 'add', 'README.md')
  await write('src/app.ts', 'export const a = 2\n')
  await write('docs/guide.md', 'Scratch edit to throw away.\n')
  await write('notes/todo.md', '- check the push error card\n')
}

async function poll(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`Timed out waiting for ${description}${last ? `: ${last.message}` : ''}`)
}

async function runFlow({ page, capture, timeoutMs, workspaceRoot, remote, temporaryRoot }) {
  const checks = []
  const changes = page.locator('[data-code-changes-panel]')
  const chooseSource = async (id) => {
    await changes.locator('[data-change-source-picker]').click()
    await changes.locator(`[data-change-source-option="${id}"]`).click()
  }
  const row = (path) => changes.locator(`[data-git-change-path="${path}"]`)
  await page.getByRole('button', { name: 'Changes', exact: true }).click()
  await changes.waitFor({ timeout: timeoutMs })
  await changes.locator('[data-change-source-picker]').click()
  await changes.locator('[data-change-source-option="git-unstaged"]').waitFor({ timeout: timeoutMs })
  await capture('commit-1-source-menu')
  await changes.locator('[data-change-source-option="git-unstaged"]').click()
  checks.push('The source menu lists this conversation, last turn, unstaged, staged and whole branch')

  for (const path of ['src/app.ts', 'docs/guide.md', 'notes/todo.md']) await row(path).waitFor({ timeout: timeoutMs })
  await row('src/app.ts').getByRole('button').first().click()
  await poll(async () => (await changes.innerText()).includes('export const a = 2'), timeoutMs, 'the unstaged diff preview')
  assert((await changes.locator('[data-git-branch-status]').innerText()).includes('No upstream'))
  await capture('commit-2-unstaged')
  checks.push('Unstaged lists modified and untracked files with a diff preview and a no-upstream branch row')

  await row('docs/guide.md').hover()
  await row('docs/guide.md').getByRole('button', { name: 'Discard changes' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ timeout: timeoutMs })
  await capture('commit-3-discard-confirm')
  await dialog.getByRole('button', { name: 'Discard 1 file' }).click()
  await poll(async () => (await readFile(join(workspaceRoot, 'docs/guide.md'), 'utf8')) === 'Original guide.\n', timeoutMs, 'the discarded file')
  await poll(async () => (await row('docs/guide.md').count()) === 0, timeoutMs, 'the discarded row leaving the list')
  checks.push('Discard asks for confirmation, then restores the tracked file')

  await row('src/app.ts').hover()
  await row('src/app.ts').getByRole('button', { name: 'Stage', exact: true }).click()
  await poll(async () => (await row('src/app.ts').count()) === 0, timeoutMs, 'staging src/app.ts')
  await chooseSource('git-staged')
  for (const path of ['README.md', 'src/app.ts']) await row(path).waitFor({ timeout: timeoutMs })
  const box = page.locator('[data-commit-box]')
  await box.getByRole('button', { name: 'Generate message' }).click()
  await poll(async () => (await box.locator('textarea').inputValue()).startsWith('feat(app): bump a to 2'), timeoutMs, 'the generated message')
  assert((await box.innerText()).includes(`git push -u origin ${BRANCH}`))
  await capture('commit-4-staged-generated')
  checks.push('Per-file stage moves a file to Staged; the model writes the message through the runtime; the first-push note names the -u command')

  await box.getByRole('button', { name: 'Commit & push' }).click()
  await poll(async () => (await box.innerText()).includes('set it as the upstream'), timeoutMs, 'commit and first push')
  const local = git(workspaceRoot, 'rev-parse', 'HEAD').trim()
  assert.equal(git(remote, 'rev-parse', `refs/heads/${BRANCH}`).trim(), local)
  assert.equal(git(workspaceRoot, 'rev-parse', '--abbrev-ref', '@{upstream}').trim(), `origin/${BRANCH}`)
  assert.equal(git(workspaceRoot, 'log', '-1', '--format=%B').trim(), GENERATED)
  await poll(async () => (await changes.locator('[data-git-branch-status]').innerText()).includes(`origin/${BRANCH}`), timeoutMs, 'the tracking row')
  await capture('commit-5-pushed')
  checks.push('Commit & push records the generated message and sets the upstream on the first push')

  const clone = join(temporaryRoot, 'other-clone')
  execFileSync('git', ['clone', '-q', '--branch', BRANCH, remote, clone], { env: gitEnvironment })
  git(clone, 'config', 'user.email', 'other@example.com')
  git(clone, 'config', 'user.name', 'Other')
  await writeFile(join(clone, 'remote.txt'), 'theirs\n')
  git(clone, 'add', '.')
  git(clone, 'commit', '-q', '-m', 'chore: remote-only change')
  git(clone, 'push', '-q', 'origin', BRANCH)
  await writeFile(join(workspaceRoot, 'src/app.ts'), 'export const a = 3\n')
  await chooseSource('git-unstaged')
  await row('src/app.ts').waitFor({ timeout: timeoutMs })
  await box.locator('textarea').fill('fix(app): local follow-up')
  await box.getByRole('button', { name: 'Commit all & push' }).click()
  await poll(async () => (await box.innerText()).includes('Push failed'), timeoutMs, 'the rejected push')
  assert((await box.innerText()).includes('rejected'))
  // Capture the copy in the page instead of touching the system clipboard.
  await page.evaluate(() => {
    window.__kunSmokeCopied = ''
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__kunSmokeCopied = text } } })
  })
  await box.getByRole('button', { name: 'Copy error' }).click()
  await box.getByRole('button', { name: 'Copied' }).waitFor({ timeout: timeoutMs })
  const copied = await page.evaluate(() => window.__kunSmokeCopied)
  assert(copied.includes('rejected') && copied.includes(`$ git push origin HEAD:refs/heads/${BRANCH}`), 'Copied error carries git output and the command')
  await capture('commit-6-push-rejected')
  checks.push('A rejected push keeps the commit, explains the fix and copies git output with the command')

  await chooseSource('git-branch')
  const branchView = changes.locator('[data-git-branch-view]')
  await branchView.waitFor({ timeout: timeoutMs })
  assert.equal(await branchView.getAttribute('data-git-branch-view'), 'main')
  await poll(async () => (await branchView.innerText()).includes('fix(app): local follow-up'), timeoutMs, 'the branch commits')
  assert((await branchView.innerText()).includes('Not pushed'))
  await capture('commit-7-branch')
  checks.push('Whole branch compares with main and marks the unpushed commit')
  diagnostics.finalLog = git(workspaceRoot, 'log', '--oneline', '-4')
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const locale = argumentValue('--locale') === 'zh' ? 'zh' : 'en'
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'changes-commit-smoke'))
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'kun-changes-commit-smoke-')))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const remote = join(temporaryRoot, 'remote.git')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await realpath(await mkdtemp(join(workspaceParent, 'changes-commit-')))
  await seedRepository(workspaceRoot, remote)
  const screenshots = []
  const pageErrors = []
  let application, electronProcess, page, result, primaryError, model, realProfile = profile, electronOutput = ''
  const capture = async (name) => {
    const path = join(evidenceRoot, `${name}.png`)
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
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
    model = await startModelFixture()
    const runtimePort = await availablePort()
    const environment = createIsolatedEnvironment(process.env, { home, appData, localAppData, temporaryDirectory })
    delete environment.ELECTRON_RENDERER_URL
    environment.NODE_ENV = 'development'
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile), locale, initialSetupCompleted: true }
    settings.agents.kun.baseUrl = model.baseUrl
    settings.agents.kun.apiKey = 'changes-commit-offline-fixture'
    settings.provider = { apiKey: settings.agents.kun.apiKey, baseUrl: model.baseUrl, providers: [{ id: 'deepseek', models: ['deepseek-chat'] }] }
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
    const assertions = await runFlow({ page, capture, timeoutMs, workspaceRoot, remote, temporaryRoot })
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
    if (electronProcess) await terminateProcessTree(electronProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }).catch(() => undefined)
    await withTimeout(stopIsolatedSharedRuntime(repositoryRoot, realProfile), 20_000, 'runtime').catch(() => undefined)
    await withTimeout(stopIsolatedServiceManager(home, realProfile), 20_000, 'manager').catch(() => undefined)
    releaseChildProcessHandles(electronProcess)
    await model?.close().catch(() => undefined)
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
