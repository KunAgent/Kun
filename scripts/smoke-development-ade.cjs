#!/usr/bin/env node
'use strict'

// ADE desktop smoke (docs/ade/impl/p4-usable-ade.md P4-06). Exercises the real
// Electron renderer/preload/main/Runtime composition on an isolated data
// directory: ADE enabled, the one-on-one harness picker refreshed through live
// detection, unavailable rows carrying a localized reason plus a settings deep
// link, a settings command-path edit hot-applying into `GET /v1/harnesses`, a
// one-on-one thread created with a stub Claude binary, the composer harness
// picker rendering through a body portal, and the Kun gateway model group
// listing provider models. A stub `claude` binary and a stub newline-JSON-RPC
// ACP agent make two harnesses resolve as installed; every model response is a
// deterministic offline fixture.
//   node scripts/smoke-development-ade.cjs [--timeout-ms 120000]
// Screenshots and report.json land under dist/ade-desktop-smoke (the
// --evidence directory) while the disposable roots are cleaned.

const assert = require('node:assert/strict')
const { execFile, spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } = require('node:fs/promises')
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
const MODEL = 'deepseek-chat'

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 120_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'ade-desktop-smoke'))
  for (const entry of ['out/main/index.js', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronPathFile = join(electronPackage, 'path.txt')
  assert(existsSync(electronPathFile), 'Electron binary is not installed; install dependencies before this offline smoke')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(electronPathFile, 'utf8')).trim())
  assert(existsSync(electronExecutable), 'Electron executable is missing; install dependencies before this offline smoke')
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-ade-desktop-smoke-'))
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
  let realProfile = profile
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
    // The runtime records the realpath'd dataDir; macOS tmpdir symlinks /var.
    realProfile = await realpath(profile)
    const runtimePort = await availablePort()
    let rendererPort = await availablePort()
    while (rendererPort === runtimePort) rendererPort = await availablePort()
    const isolatedEnvironment = developmentRendererEnvironment(createIsolatedEnvironment(process.env, {
      home, appData, localAppData, temporaryDirectory
    }), { rendererPort, temporaryRoot })
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
    const acpStub = await writeAcpStub(stubDir, 'smoke-acp')
    // Claude Code login detection reads ~/.claude/.credentials.json.
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'ade-smoke' } }))

    modelFixture = await startModelFixture()
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile),
      locale: 'en', theme: 'light', initialSetupCompleted: true }
    settings.agents.kun.baseUrl = modelFixture.baseUrl
    settings.agents.kun.apiKey = 'ade-desktop-offline-fixture'
    settings.agents.kun.model = MODEL
    settings.agents.kun.ade = { ...(settings.agents.kun.ade ?? {}), enabled: true }
    settings.agents.kun.harnesses = {
      ...(settings.agents.kun.harnesses ?? {}),
      binaryPaths: { 'claude-code': claudeStub },
      custom: [{ id: 'smoke-acp', displayName: 'Smoke ACP', command: acpStub, args: [], env: {} }]
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
    await page.waitForLoadState('domcontentloaded')
    await page.locator('[data-workspace-mode-trigger]').first().waitFor()

    // 1) Enter ADE; the Mission Control empty state renders.
    await switchMode(page, 'ade')
    await page.locator('[data-mission-control]').waitFor()
    await capture('1-ade-home')

    // 2) One-on-one picker refreshes while detection runs (P4-02): the stub
    //    Claude row turns selectable, the custom ACP stub completes its
    //    handshake, and a blocking row carries the localized reason + an
    //    "Open settings" deep link (P4-05).
    await page.getByRole('button', { name: 'One-on-one', exact: true }).click()
    const picker = page.locator('[data-ade-agent-picker]')
    await picker.waitFor()
    const claudeRow = picker.getByRole('button', { name: 'Claude Code', exact: true })
    await poll(async () => (await claudeRow.count()) > 0, 60_000, 'Claude Code row becoming selectable')
    await poll(async () => (await picker.getByRole('button', { name: 'Smoke ACP', exact: true }).count()) > 0,
      60_000, 'Smoke ACP readiness handshake')
    const unavailableRows = picker.locator('[data-ade-agent-unavailable]')
    assert((await unavailableRows.count()) > 0, 'Expected at least one unavailable harness row')
    // A row still mid-detection has no settings link; wait for a settled
    // blocking row, then use its "Open settings" deep link.
    const settingsLink = picker.getByRole('button', { name: 'Open settings', exact: true }).first()
    await poll(async () => (await picker.getByRole('button', { name: 'Open settings', exact: true })
      .count()) > 0, 60_000, 'unavailable harness row surfacing a settings link')
    await capture('2-one-on-one-picker')

    // 3) The deep link lands on Settings → Agents → Agent harness; changing a
    //    command path hot-applies into the runtime's harness catalog.
    await settingsLink.click()
    const harnessPanel = page.locator('#agents-settings-panel-harnesses')
    await harnessPanel.waitFor()
    await capture('3-agent-harness-settings')
    const claudeCard = harnessPanel.locator('[data-agent-card="claude-code"]')
    await claudeCard.locator('button[aria-expanded]').first().click()
    await claudeCard.locator('input').first().fill(claudeStubUpdated)
    await poll(async () => {
      const probe = await runtimeRequest(page, '/v1/harnesses/claude-code/probe', 'POST')
      return probe.status?.resolvedCommand === claudeStubUpdated
    }, 30_000, 'runtime receiving the harness command path update')
    await capture('4-harness-command-path-applied')

    // 3b) P4-12: a custom ACP definition must pass `probe-definition` before
    //     it can be saved; a bound secret travels only as a credential-store
    //     ref, and an imported JSON definition needs the same handshake.
    const customForm = harnessPanel.locator('[data-agent-custom-form]')
    await customForm.getByPlaceholder(/Display name/u).fill('Smoke Form Agent')
    await customForm.getByPlaceholder(/Command path/u).fill(acpStub)
    await customForm.getByPlaceholder('ENV_NAME').fill('SMOKE_KEY')
    await customForm.getByPlaceholder('Secret value').fill('smoke-secret-value')
    await customForm.getByRole('button', { name: 'Bind', exact: true }).click()
    await customForm.locator('[data-secret-env-chip="SMOKE_KEY"]').waitFor()
    const addButton = customForm.getByRole('button', { name: 'Add agent', exact: true })
    assert(await addButton.isDisabled(), 'Add must stay disabled before a probe')
    await customForm.getByRole('button', { name: 'Test connection', exact: true }).click()
    await customForm.locator('[data-probe-result="ok"]').waitFor({ timeout: 60_000 })
    await capture('4c-custom-acp-probe-ok')
    await addButton.click()
    await poll(async () => {
      const list = await runtimeRequest(page, '/v1/harnesses', 'GET')
      return (list.harnesses ?? []).some(
        (row) => row.definition.id === 'custom-smoke-form-agent')
    }, 30_000, 'saved custom agent reaching the runtime catalog')
    await harnessPanel.locator('[data-agent-card="custom-smoke-form-agent"]').waitFor()

    const importFile = join(temporaryRoot, 'import-agent.json')
    await writeFile(importFile, JSON.stringify({
      displayName: 'Imported Agent', command: acpStub, args: ['--acp']
    }))
    await customForm.locator('input[type="file"]').setInputFiles(importFile)
    await poll(async () => (await customForm.getByPlaceholder(/Display name/u)
      .inputValue()) === 'Imported Agent', 10_000, 'imported JSON filling the form')
    assert(await addButton.isDisabled(),
      'An imported definition must be tested again before saving')
    await customForm.getByRole('button', { name: 'Test connection', exact: true }).click()
    await customForm.locator('[data-probe-result="ok"]').waitFor({ timeout: 60_000 })
    await addButton.click()
    await poll(async () => {
      const list = await runtimeRequest(page, '/v1/harnesses', 'GET')
      return (list.harnesses ?? []).some(
        (row) => row.definition.id === 'custom-imported-agent')
    }, 30_000, 'imported custom agent reaching the runtime catalog')
    await harnessPanel.locator('[data-agent-card="custom-imported-agent"]').waitFor()
    await capture('4d-custom-acp-imported')

    // 3c) P4-09: an install/login card action prefills a fresh Kun terminal
    //     (never auto-executes) and leaves Settings for the workbench. The
    //     isolated HOME means every non-Claude builtin is either missing or
    //     signed out, so at least one card carries a command action.
    const catalog = await runtimeRequest(page, '/v1/harnesses', 'GET')
    const cardLocators = await harnessPanel.locator('[data-agent-card]').all()
    let setupCard = null
    for (const card of cardLocators) {
      for (const [name, kind] of [['Install adapter', 'adapter'], ['Install', 'install'], ['Sign in', 'login']]) {
        const commandButton = card.getByRole('button', { name, exact: true })
        if ((await commandButton.count()) > 0) {
          setupCard = { card, button: commandButton.first(), kind }
          break
        }
      }
      if (setupCard) break
    }
    assert(setupCard, 'Expected at least one harness card with a setup command action')
    const setupHarnessId = await setupCard.card.getAttribute('data-agent-card')
    const setupRow = (catalog.harnesses ?? []).find((row) => row.definition.id === setupHarnessId)
    const expectedCommand = expectedSetupCommand(setupRow?.definition, process.platform, setupCard.kind)
    assert(expectedCommand, `No builtin setup command resolved for ${setupHarnessId} (${setupCard.kind})`)
    await setupCard.button.click()
    await page.locator('[data-mission-control]').waitFor()
    await page.locator('[data-terminal-open="true"]').waitFor()
    await poll(async () => (await page.locator('.xterm-rows').innerText())
      .includes(expectedCommand.command), 30_000,
      `terminal showing the prefilled ${setupHarnessId} command`)
    await capture('4b-setup-command-prefilled-terminal')

    // 4) A one-on-one thread with Claude Code shows the composer; its harness
    //    picker menu renders through a body portal, not inside the clipped
    //    toolbar container (P4-01).
    await page.getByRole('button', { name: 'One-on-one', exact: true }).click()
    await picker.waitFor()
    await picker.getByRole('button', { name: 'Claude Code', exact: true }).click()
    const harnessTrigger = page.getByRole('button', { name: 'Harness', exact: true })
    await harnessTrigger.waitFor({ timeout: 60_000 })
    await harnessTrigger.click()
    const menu = page.locator('[data-harness-picker-menu]')
    await menu.waitFor()
    assert(await menu.evaluate((node) => node.parentElement === document.body),
      'Harness picker menu must render through a body portal')
    await capture('5-composer-harness-picker')
    await menu.locator('[data-harness-id="claude-code"]').click()

    // 5) Model groups expose the Kun gateway route with provider models
    //    (deterministic fixture provider seeded as the active connection).
    const groups = await runtimeRequest(page,
      '/v1/harnesses/claude-code/models?credential_mode=kun-gateway')
    const gatewayGroup = (groups.groups ?? []).find((group) => group.providerId === 'deepseek')
    assert(gatewayGroup, `Expected a DeepSeek gateway model group: ${JSON.stringify(groups)}`)
    assert((gatewayGroup.models ?? []).length > 0,
      `Expected provider models in the gateway group: ${JSON.stringify(gatewayGroup)}`)
    const gatewayModel = gatewayGroup.models[0]
    const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await page.locator('.ds-composer-model-picker button[aria-haspopup="menu"]').first().click()
    await page.getByText(/Kun gateway/iu).first().waitFor()
    // Provider groups are submenu rows: hover opens the model flyout.
    await page.getByRole('menuitem', {
      name: new RegExp(`^Kun gateway · ${escapeRe(gatewayGroup.label)}`, 'u')
    }).hover()
    await page.getByRole('menuitemradio', {
      name: new RegExp(`^${escapeRe(gatewayModel)}`, 'u')
    }).waitFor()
    await capture('6-model-gateway-group')
    await page.keyboard.press('Escape')

    assert.deepEqual(pageErrors, [], 'Renderer emitted an uncaught exception')
    result = { ok: true, platform: process.platform, arch: process.arch, pageErrors,
      modelFixture: modelFixture.snapshot(), screenshots,
      assertions: [
        'ADE enabled through isolated settings and entered through the Agents surface',
        'one-on-one picker refreshes while detection is inflight; installed harness selectable',
        'unavailable harness rows carry a localized reason plus a settings deep link',
        'settings command path hot-applies and re-probes through /v1/harnesses/:id/probe',
        'custom ACP definition probes before saving; secrets bind by ref only',
        'imported JSON definitions must be tested again before saving',
        'setup command prefills a fresh terminal without executing and leaves Settings',
        'composer harness picker menu renders through a body portal',
        'Kun gateway model group exposes provider models'] }
    await writeFile(join(evidenceRoot, 'report.json'), JSON.stringify(result, null, 2) + '\n')
  } catch (error) {
    await capture('failure').catch(() => undefined)
    await captureIsolatedLogs(temporaryRoot, evidenceRoot).catch(() => undefined)
    if (page) await writeFile(join(evidenceRoot, 'failure-page.txt'),
      await page.locator('body').innerText().catch(() => '')).catch(() => undefined)
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
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true }).catch(() => [])) {
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

async function startModelFixture() {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && /\/models(?:\?|$)/u.test(request.url ?? '')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }))
      return
    }
    if (request.method === 'POST' && /\/chat\/completions$/u.test(request.url ?? '')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'ade-smoke', object: 'chat.completion', created: 1,
        model: MODEL, choices: [{ index: 0, message: { role: 'assistant', content: 'Done.' },
          finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  return {
    baseUrl,
    snapshot: () => ({ baseUrl }),
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
