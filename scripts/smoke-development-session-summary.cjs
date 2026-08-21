#!/usr/bin/env node

'use strict'

/**
 * Desktop end-to-end evidence for the sidebar "Summarize" action (issue #1200).
 *
 * Boots the development renderer against the built Main process and an offline
 * OpenAI-compatible model fixture, seeds one real conversation through the Kun
 * runtime, then drives the sidebar context menu three times:
 *   1. a successful summary, which must be shown to the user;
 *   2. a provider failure, which must name the real reason;
 *   3. a thread the runtime no longer stores, which must reconcile the sidebar.
 */

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { createServer: createHttpServer } = require('node:http')
const { createConnection, createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const { makeTreeWritable } = require('./smoke-packaged-extensions.cjs')
const {
  createIsolatedEnvironment,
  desktopSmokeSettings,
  desktopSmokeWorkspaceParent,
  desktopUserDataCandidates,
  platformDesktopArguments,
  stopIsolatedServiceManager,
  stopIsolatedSharedRuntime,
  terminateProcessTree
} = require('./smoke-packaged-extension-desktop.cjs')
const { developmentRendererEnvironment } = require('./development-renderer-environment.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')
const { openAiTextFrames } = require('./smoke-packaged-video-editor-desktop-guest.cjs')

const DEFAULT_TIMEOUT_MS = 180_000
const MAX_OPERATION_TIMEOUT_MS = 60_000
const MAX_CLEANUP_TIMEOUT_MS = 15_000
const GRACEFUL_CLOSE_TIMEOUT_MS = 3_000
const MODEL_NAME = 'deepseek-chat'
const THREAD_TITLE = 'Session summary E2E'
const TURN_PROMPT = 'Why did last night deploy fail?'
const ASSISTANT_REPLY = 'The deploy failed because the release job could not read the signing secret.'
const SUMMARY_TEXT =
  'The user asked why the nightly deploy failed and learned the release job could not read the signing secret.'
const PROVIDER_ERROR_TEXT = 'Insufficient Balance'

async function main() {
  const repositoryRoot = resolve(join(__dirname, '..'))
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const evidenceRoot = resolve(
    argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'session-summary-smoke')
  )
  const electronExecutable = require('electron')
  const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const rendererConfig = join(repositoryRoot, 'scripts', 'vite-development-renderer.config.mjs')
  const mainEntry = join(repositoryRoot, 'out', 'main', 'index.js')
  const runtimeEntry = join(repositoryRoot, 'kun', 'dist', 'cli', 'serve-entry.js')
  for (const [label, path] of [
    ['Electron executable', electronExecutable],
    ['Vite CLI', viteCli],
    ['renderer config', rendererConfig],
    ['built Main entry', mainEntry],
    ['built Kun runtime entry', runtimeEntry]
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}. Run npm run build first.`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-session-summary-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'session-summary-'))
  const runtimePort = await availablePort()
  let rendererPort = await availablePort()
  while (rendererPort === runtimePort) rendererPort = await availablePort()

  let modelFixture
  let rendererProcess
  let electronApplication
  let electronProcess
  let result
  let primaryError
  let rendererOutput = ''
  let electronOutput = ''
  try {
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(profile, { recursive: true }),
      mkdir(userData, { recursive: true }),
      mkdir(appData, { recursive: true }),
      mkdir(localAppData, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true }),
      mkdir(evidenceRoot, { recursive: true })
    ])
    modelFixture = await startSummaryModelFixture()

    const settings = {
      ...desktopSmokeSettings(runtimePort, workspaceRoot, profile),
      locale: 'en',
      theme: 'light'
    }
    settings.agents.kun.baseUrl = modelFixture.baseUrl
    settings.agents.kun.apiKey = 'session-summary-smoke-key'
    const serializedSettings = `${JSON.stringify(settings, null, 2)}\n`
    await Promise.all(desktopUserDataCandidates({
      platform: process.platform,
      home,
      appData,
      explicitUserData: userData
    }).map(async (directory) => {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'kun-settings.json'), serializedSettings)
    }))

    const isolatedEnvironment = developmentRendererEnvironment(
      createIsolatedEnvironment(process.env, {
        home,
        appData,
        localAppData,
        temporaryDirectory
      }),
      { rendererPort, temporaryRoot }
    )
    isolatedEnvironment.NODE_ENV = 'development'
    rendererProcess = spawn(
      process.execPath,
      [viteCli, '--config', rendererConfig, '--logLevel', 'warn'],
      {
        cwd: repositoryRoot,
        env: isolatedEnvironment,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    rendererProcess.stdout?.on('data', (chunk) => {
      rendererOutput = `${rendererOutput}${String(chunk)}`.slice(-64 * 1024)
    })
    rendererProcess.stderr?.on('data', (chunk) => {
      rendererOutput = `${rendererOutput}${String(chunk)}`.slice(-64 * 1024)
    })
    await waitForPortOpen(rendererPort, timeoutMs, rendererProcess)

    electronApplication = await _electron.launch({
      executablePath: electronExecutable,
      args: [
        `--user-data-dir=${userData}`,
        '--no-first-run',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        ...platformDesktopArguments(process.platform),
        repositoryRoot
      ],
      cwd: repositoryRoot,
      env: isolatedEnvironment,
      chromiumSandbox: true,
      timeout: timeoutMs
    })
    electronProcess = electronApplication.process()
    electronProcess.stdout?.on('data', (chunk) => {
      electronOutput = `${electronOutput}${String(chunk)}`.slice(-64 * 1024)
    })
    electronProcess.stderr?.on('data', (chunk) => {
      electronOutput = `${electronOutput}${String(chunk)}`.slice(-64 * 1024)
    })
    const operationTimeoutMs = Math.min(timeoutMs, MAX_OPERATION_TIMEOUT_MS)
    await withTimeout(
      electronApplication.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
        window?.setBounds({ x: 20, y: 20, width: 1360, height: 900 })
      }),
      operationTimeoutMs,
      'resizing the session summary window'
    )
    const page = await findWorkbenchWindow(electronApplication, timeoutMs)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1_500)

    const seeded = await withTimeout(
      seedConversation(page, workspaceRoot, operationTimeoutMs),
      operationTimeoutMs,
      'seeding the summarize E2E conversation'
    )
    if (modelFixture.snapshot().conversationRequests < 1) {
      throw new Error('The offline model fixture never received the seeded conversation turn')
    }

    // The sidebar hydrates its thread list on load; reload once so the seeded
    // conversation is a real row the user could right-click.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2_500)
    const row = page.locator('.ds-sidebar-tree-row', { hasText: THREAD_TITLE }).first()
    await row.waitFor({ state: 'visible', timeout: operationTimeoutMs })

    await openThreadMenu(page, row, operationTimeoutMs)
    const menuItems = await page.getByRole('menuitem').allInnerTexts()
    for (const expected of ['Summarize', 'Copy session ID']) {
      if (!menuItems.some((label) => label.trim() === expected)) {
        throw new Error(`Thread context menu is missing "${expected}": ${JSON.stringify(menuItems)}`)
      }
    }
    await page.screenshot({ path: join(evidenceRoot, '1-thread-context-menu.png') })

    await page.getByRole('menuitem', { name: 'Copy session ID' }).click()
    await page.waitForTimeout(400)
    const copiedThreadId = await readClipboard(electronApplication)
    if (copiedThreadId !== seeded.threadId) {
      throw new Error(`Copy session ID wrote ${JSON.stringify(copiedThreadId)}, expected ${seeded.threadId}`)
    }

    await openThreadMenu(page, row, operationTimeoutMs)
    await page.getByRole('menuitem', { name: 'Summarize' }).click()
    const summaryDialog = page.getByRole('dialog', { name: 'Session summary' })
    await summaryDialog.waitFor({ state: 'visible', timeout: operationTimeoutMs })
    const summaryDialogText = (await summaryDialog.innerText()).replace(/\s+/gu, ' ').trim()
    if (!summaryDialogText.includes(SUMMARY_TEXT)) {
      throw new Error(`Summary dialog did not show the generated summary: ${summaryDialogText}`)
    }
    await page.screenshot({ path: join(evidenceRoot, '2-summary-success.png') })
    await summaryDialog.getByRole('button', { name: 'Copy summary' }).click()
    await page.waitForTimeout(400)
    const copiedSummary = await readClipboard(electronApplication)
    if (copiedSummary !== SUMMARY_TEXT) {
      throw new Error(`Copy summary wrote ${JSON.stringify(copiedSummary)}`)
    }
    await summaryDialog.waitFor({ state: 'hidden', timeout: operationTimeoutMs })

    // Failure path: the provider rejects the summary call. The banner has to
    // name that rejection instead of the old blanket "could not summarize".
    modelFixture.setSummaryMode('provider-error')
    await openThreadMenu(page, row, operationTimeoutMs)
    await page.getByRole('menuitem', { name: 'Summarize' }).click()
    const providerBanner = page.getByText(/Could not summarize this conversation:/u).first()
    await providerBanner.waitFor({ state: 'visible', timeout: operationTimeoutMs })
    const providerBannerText = (await providerBanner.innerText()).replace(/\s+/gu, ' ').trim()
    for (const fragment of [PROVIDER_ERROR_TEXT, 'status 402', MODEL_NAME]) {
      if (!providerBannerText.includes(fragment)) {
        throw new Error(`Summarize failure banner omits ${fragment}: ${providerBannerText}`)
      }
    }
    await page.screenshot({ path: join(evidenceRoot, '3-summary-provider-error.png') })

    // Ghost session: the row survives in the sidebar after the runtime dropped
    // the thread. Summarize must say so and reconcile the list.
    modelFixture.setSummaryMode('ok')
    await deleteThreadInRuntime(page, seeded.threadId)
    await openThreadMenu(page, row, operationTimeoutMs)
    await page.getByRole('menuitem', { name: 'Summarize' }).click()
    const ghostBanner = page.getByText(/no longer stored by the runtime/u).first()
    await ghostBanner.waitFor({ state: 'visible', timeout: operationTimeoutMs })
    await page.screenshot({ path: join(evidenceRoot, '4-summary-ghost-thread.png') })
    await row.waitFor({ state: 'detached', timeout: operationTimeoutMs })

    result = {
      ok: true,
      platform: process.platform,
      threadId: seeded.threadId,
      evidenceRoot,
      copiedThreadId,
      summaryDialogText,
      providerBannerText,
      ghostBannerText: (await ghostBanner.innerText()).replace(/\s+/gu, ' ').trim(),
      modelFixture: modelFixture.snapshot(),
      screenshots: [
        join(evidenceRoot, '1-thread-context-menu.png'),
        join(evidenceRoot, '2-summary-success.png'),
        join(evidenceRoot, '3-summary-provider-error.png'),
        join(evidenceRoot, '4-summary-ghost-thread.png')
      ]
    }
    await writeFile(join(evidenceRoot, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    const diagnostics = [
      rendererOutput.trim() ? `Renderer output:\n${rendererOutput.trim()}` : '',
      electronOutput.trim() ? `Electron output:\n${electronOutput.trim()}` : ''
    ].filter(Boolean).join('\n\n')
    primaryError = new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}${
      diagnostics ? `\n\n${diagnostics}` : ''
    }`)
  } finally {
    const cleanupErrors = []
    let electronClosePromise
    if (electronApplication) {
      electronClosePromise = electronApplication.close()
      await withTimeout(
        electronClosePromise,
        GRACEFUL_CLOSE_TIMEOUT_MS,
        'closing the session summary Electron application'
      ).catch(() => undefined)
    }
    if (electronProcess) {
      await terminateProcessTree(electronProcess, process.platform, {
        timeoutMs: MAX_CLEANUP_TIMEOUT_MS,
        detached: process.platform !== 'win32'
      }).catch((error) => cleanupErrors.push(error))
    }
    await withTimeout(
      stopIsolatedSharedRuntime(repositoryRoot, profile),
      MAX_CLEANUP_TIMEOUT_MS + 5_000,
      'stopping the isolated session summary Kun runtime'
    ).catch((error) => cleanupErrors.push(error))
    await withTimeout(
      stopIsolatedServiceManager(home, profile),
      MAX_CLEANUP_TIMEOUT_MS + 5_000,
      'stopping the isolated session summary Kun Service Manager'
    ).catch((error) => cleanupErrors.push(error))
    if (electronClosePromise) {
      await withTimeout(electronClosePromise, 1_000, 'settling the Electron connection')
        .catch(() => undefined)
    }
    releaseChildProcessHandles(electronProcess)
    if (rendererProcess) {
      await terminateProcessTree(rendererProcess, process.platform, {
        timeoutMs: MAX_CLEANUP_TIMEOUT_MS,
        detached: process.platform !== 'win32'
      }).catch((error) => cleanupErrors.push(error))
    }
    releaseChildProcessHandles(rendererProcess)
    if (modelFixture) {
      await modelFixture.close().catch((error) => cleanupErrors.push(error))
    }
    await withTimeout(
      Promise.all([makeTreeWritable(temporaryRoot), makeTreeWritable(workspaceRoot)]),
      MAX_CLEANUP_TIMEOUT_MS,
      'making session summary smoke directories writable'
    ).catch((error) => cleanupErrors.push(error))
    await withTimeout(
      Promise.all([
        rm(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }),
        rm(workspaceRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
      ]),
      MAX_CLEANUP_TIMEOUT_MS,
      'removing session summary smoke directories'
    ).catch((error) => cleanupErrors.push(error))
    if (cleanupErrors.length > 0) {
      const cleanupDiagnostics = cleanupErrors
        .map((error) => `- ${error instanceof Error ? error.message : String(error)}`)
        .join('\n')
      primaryError = primaryError
        ? new Error(`${primaryError.stack ?? primaryError.message}\n\nCleanup failures:\n${cleanupDiagnostics}`)
        : new Error(`Session summary smoke cleanup failed:\n${cleanupDiagnostics}`)
    }
  }
  if (primaryError) throw primaryError
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

async function openThreadMenu(page, row, operationTimeoutMs) {
  const menu = page.getByRole('menu', { name: THREAD_TITLE })
  await row.click({ button: 'right' })
  await menu.waitFor({ state: 'visible', timeout: operationTimeoutMs })
  return menu
}

async function readClipboard(electronApplication) {
  return electronApplication.evaluate(({ clipboard }) => clipboard.readText())
}

async function seedConversation(page, workspaceRoot, operationTimeoutMs) {
  const seeded = await page.evaluate(async ({ workspace, model, title, prompt }) => {
    const request = async (path, method, body) => {
      const response = await globalThis.kunGui.runtimeRequest(
        path,
        method,
        body === undefined ? undefined : JSON.stringify(body)
      )
      if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${response.body}`)
      return response.body ? JSON.parse(response.body) : undefined
    }
    const thread = await request('/v1/threads', 'POST', {
      title,
      workspace,
      model,
      mode: 'agent',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access'
    })
    const turn = await request(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, 'POST', {
      prompt,
      model,
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      disableUserInput: true
    })
    return { threadId: thread.id, turnId: turn.turnId }
  }, { workspace: workspaceRoot, model: MODEL_NAME, title: THREAD_TITLE, prompt: TURN_PROMPT })

  const deadline = Date.now() + operationTimeoutMs
  for (;;) {
    const status = await page.evaluate(async ({ threadId, turnId }) => {
      const response = await globalThis.kunGui.runtimeRequest(
        `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}`,
        'GET'
      )
      if (!response.ok) return `http_${response.status}`
      return JSON.parse(response.body).status
    }, seeded)
    if (status === 'completed') return seeded
    if (status === 'failed' || status === 'aborted') {
      throw new Error(`Seeded summarize E2E turn ended as ${status}`)
    }
    if (Date.now() > deadline) throw new Error(`Seeded summarize E2E turn stalled in ${status}`)
    await page.waitForTimeout(250)
  }
}

async function deleteThreadInRuntime(page, threadId) {
  const status = await page.evaluate(async (id) => {
    const response = await globalThis.kunGui.runtimeRequest(
      `/v1/threads/${encodeURIComponent(id)}`,
      'DELETE'
    )
    return response.status
  }, threadId)
  if (status >= 400) throw new Error(`Could not delete the seeded thread (${status})`)
}

/**
 * Offline OpenAI-compatible endpoint. Session-summary calls are recognised by
 * the summary role prompt so the smoke can flip only that call to a failure.
 */
async function startSummaryModelFixture() {
  const state = { conversationRequests: 0, summaryRequests: 0, summaryMode: 'ok' }
  const server = createHttpServer(async (request, response) => {
    if (request.method === 'GET' && /\/models(?:\?|$)/u.test(request.url ?? '')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_NAME, object: 'model' }] }))
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'unsupported fixture route' } }))
      return
    }
    let body = ''
    for await (const chunk of request) body = `${body}${String(chunk)}`.slice(-4 * 1024 * 1024)
    const isSummary = body.includes('Write the one-paragraph summary now.')
    if (!isSummary) {
      state.conversationRequests += 1
      writeSseFrames(response, openAiTextFrames(ASSISTANT_REPLY))
      return
    }
    state.summaryRequests += 1
    if (state.summaryMode === 'provider-error') {
      response.writeHead(402, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: PROVIDER_ERROR_TEXT, type: 'quota_exceeded' } }))
      return
    }
    writeSseFrames(response, openAiTextFrames(SUMMARY_TEXT))
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  if (!port) throw new Error('Could not start the session summary model fixture')
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    setSummaryMode(mode) {
      state.summaryMode = mode
    },
    snapshot() {
      return { ...state }
    },
    close() {
      return new Promise((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise())
        server.closeAllConnections?.()
      })
    }
  }
}

function writeSseFrames(response, frames) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
  for (const frame of frames) response.write(frame)
  response.end()
}

function releaseChildProcessHandles(child) {
  child?.stdout?.destroy()
  child?.stderr?.destroy()
  child?.unref?.()
}

async function withTimeout(operation, timeoutMs, description) {
  let timeout
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out while ${description}`)), timeoutMs)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise())
  })
  if (!port) throw new Error('Could not allocate a session summary smoke port')
  return port
}

async function waitForPortOpen(port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Renderer exited before port ${port} opened`)
    }
    if (await isPortOpen(port)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for renderer port ${port}`)
}

function isPortOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(open)
    }
    socket.setTimeout(250, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.unref()
  })
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function positiveIntegerArgument(name, fallback) {
  const value = argumentValue(name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
