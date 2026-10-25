#!/usr/bin/env node

'use strict'

/**
 * Desktop end-to-end evidence for issue #1202: the GUI plan checklist must stop
 * reporting itself as live execution progress while a Graph run owns the thread.
 *
 * Boots the development renderer against the built Main process, seeds a real
 * thread carrying a 19-item plan checklist through the Kun runtime, then:
 *   1. captures the stale reading the reporter saw (tray segment step "1/19");
 *   2. puts a Graph run (11 nodes, 7 accepted, 1 running) on the thread;
 *   3. asserts the checklist demotes to "Plan outline · 19 steps" while the
 *      Graph tray segment reports the authoritative "7/11" accepted nodes.
 *
 * The Graph projection is seeded straight into the renderer Graph store through
 * the Vite dev module graph. Driving 11 real subagent nodes would need a live
 * model and hours of wall clock; every component, selector, translation, and
 * style under test here is the production one.
 */

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { copyFile, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
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

const DEFAULT_TIMEOUT_MS = 180_000
const MAX_OPERATION_TIMEOUT_MS = 60_000
const MAX_CLEANUP_TIMEOUT_MS = 15_000
const GRACEFUL_CLOSE_TIMEOUT_MS = 5_000
const MODEL_NAME = 'deepseek-chat'
const THREAD_TITLE = 'Graph plan progress E2E'
const PLAN_RELATIVE_PATH = '.kunsdd/plan/graph-plan-progress.md'
const PLAN_ID = 'plan_graph_progress'
const CHECKLIST_ITEMS = 19
const GRAPH_NODES = 11
const GRAPH_ACCEPTED = 7
const WINDOW_WIDTH = 1360
const WINDOW_HEIGHT = 900
const STALE_LABEL = `1/${CHECKLIST_ITEMS}`
const OUTLINE_LABEL = 'Plan outline'
const GRAPH_LABEL = `${GRAPH_ACCEPTED}/${GRAPH_NODES}`

async function main() {
  const repositoryRoot = resolve(join(__dirname, '..'))
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const evidenceRoot = resolve(
    argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'graph-plan-progress-smoke')
  )
  const electronExecutable = require('electron')
  const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const rendererConfig = join(repositoryRoot, 'scripts', 'vite-development-renderer.config.mjs')
  const mainEntry = join(repositoryRoot, 'out', 'main', 'index.js')
  const runtimeEntry = join(repositoryRoot, 'kun', 'dist', 'cli', 'serve-entry.js')
  const prerequisites = [
    ['Electron executable', electronExecutable], ['Vite CLI', viteCli],
    ['renderer config', rendererConfig], ['built Main entry', mainEntry],
    ['built Kun runtime entry', runtimeEntry]
  ]
  for (const [label, path] of prerequisites) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}. Run npm run build first.`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-graph-plan-progress-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const videoDirectory = join(temporaryRoot, 'video')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'graph-plan-progress-'))
  // The runtime resolves plan-sourced todos against a real GUI plan file.
  await mkdir(join(workspaceRoot, '.kunsdd', 'plan'), { recursive: true })
  await writeFile(join(workspaceRoot, PLAN_RELATIVE_PATH), planMarkdown())
  const runtimePort = await availablePort()
  let rendererPort = await availablePort()
  while (rendererPort === runtimePort) rendererPort = await availablePort()

  let rendererProcess
  let electronApplication
  let electronProcess
  let recordedVideo
  let result
  let primaryError
  let rendererOutput = ''
  let electronOutput = ''
  try {
    await Promise.all([
      home, profile, userData, appData, localAppData,
      temporaryDirectory, videoDirectory, evidenceRoot
    ].map((directory) => mkdir(directory, { recursive: true })))

    const settings = {
      ...desktopSmokeSettings(runtimePort, workspaceRoot, profile),
      locale: 'en',
      theme: 'light'
    }
    // Graph Mode is experimental and off by default; the composer only offers a
    // Graph progress surface when it is enabled.
    settings.agents.kun.graph = { enabled: true }
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
      recordVideo: {
        dir: videoDirectory,
        size: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT }
      },
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
      electronApplication.evaluate(({ BrowserWindow }, bounds) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
        window?.setBounds(bounds)
      }, { x: 20, y: 20, width: WINDOW_WIDTH, height: WINDOW_HEIGHT }),
      operationTimeoutMs,
      'resizing the graph plan progress window'
    )
    const page = await findWorkbenchWindow(electronApplication, timeoutMs)
    recordedVideo = page.video()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1_500)

    const threadId = await withTimeout(
      seedPlanChecklistThread(page, workspaceRoot),
      operationTimeoutMs,
      'seeding the plan checklist thread'
    )

    // The sidebar hydrates its thread list on load; reload so the seeded thread
    // (and its persisted checklist) is a real row the user could open.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2_500)
    const row = page.locator('.ds-sidebar-tree-row', { hasText: THREAD_TITLE }).first()
    await row.waitFor({ state: 'visible', timeout: operationTimeoutMs })
    await row.click()

    // Stage 1 — exactly what the reporter saw: an untouched plan checklist
    // presenting itself as live step progress.
    const todoChip = page.locator('[data-composer-stack-item="todo"] button')
    await todoChip.waitFor({ state: 'visible', timeout: operationTimeoutMs })
    const staleLabel = normalize(await todoChip.innerText())
    if (!staleLabel.includes(STALE_LABEL)) {
      throw new Error(`Plan checklist chip did not start at "${STALE_LABEL}": ${staleLabel}`)
    }
    if (await todoChip.getAttribute('data-todo-plan-outline') !== null) {
      throw new Error('Plan checklist chip was demoted before any Graph run existed')
    }
    await page.waitForTimeout(1_500)
    await page.screenshot({ path: join(evidenceRoot, '1-plan-checklist-before-graph.png') })

    // Stage 2 — a Graph run takes over execution for this thread.
    const seededGraph = await withTimeout(
      seedGraphRun(page, threadId),
      operationTimeoutMs,
      'seeding the Graph run projection'
    )
    if (seededGraph.accepted !== GRAPH_ACCEPTED || seededGraph.total !== GRAPH_NODES) {
      throw new Error(`Graph fixture is wrong: ${JSON.stringify(seededGraph)}`)
    }

    await page.locator('[data-todo-plan-outline="true"]').waitFor({
      state: 'visible',
      timeout: operationTimeoutMs
    })
    const outlineLabel = normalize(await todoChip.innerText())
    if (!outlineLabel.includes(OUTLINE_LABEL) || !outlineLabel.includes(`${CHECKLIST_ITEMS}`)) {
      throw new Error(`Plan checklist chip did not demote to an outline: ${outlineLabel}`)
    }
    if (outlineLabel.includes(STALE_LABEL)) {
      throw new Error(`Plan checklist chip still claims step progress: ${outlineLabel}`)
    }
    const graphChip = page.locator('[data-composer-stack-item="graph"] button')
    await graphChip.waitFor({ state: 'visible', timeout: operationTimeoutMs })
    const graphLabel = normalize(await graphChip.innerText())
    if (await graphChip.getAttribute('data-graph-progress') !== GRAPH_LABEL || !graphLabel.includes(GRAPH_LABEL)) {
      throw new Error(`Graph segment did not report ${GRAPH_LABEL} accepted nodes: ${graphLabel}`)
    }
    await page.waitForTimeout(1_500)
    await page.screenshot({ path: join(evidenceRoot, '2-plan-outline-and-graph-progress.png') })

    // Stage 3 — the outline sheet (opened by a click) says why the checklist stopped moving.
    await todoChip.click()
    const hint = page.locator('[data-todo-plan-outline-hint]')
    await hint.waitFor({ state: 'visible', timeout: operationTimeoutMs })
    const hintText = normalize(await hint.innerText())
    for (const fragment of ['Graph orchestration is running', 'not live execution progress']) {
      if (!hintText.includes(fragment)) {
        throw new Error(`Plan outline hint omits "${fragment}": ${hintText}`)
      }
    }
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: join(evidenceRoot, '3-plan-outline-sheet-hint.png') })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1_000)

    // Stage 4 — once every Graph run is terminal the checklist owns its own
    // reading again, so the demotion is scoped to live orchestration.
    await withTimeout(
      completeGraphRun(page),
      operationTimeoutMs,
      'completing the seeded Graph run'
    )
    await page.locator('[data-todo-plan-outline="true"]').waitFor({
      state: 'detached',
      timeout: operationTimeoutMs
    })
    const restoredLabel = normalize(await todoChip.innerText())
    if (!restoredLabel.includes(STALE_LABEL)) {
      throw new Error(`Plan checklist chip did not return to step progress: ${restoredLabel}`)
    }
    await page.waitForTimeout(1_500)
    await page.screenshot({ path: join(evidenceRoot, '4-checklist-restored-after-run.png') })

    result = {
      ok: true,
      issue: 1202,
      platform: process.platform,
      threadId,
      evidenceRoot,
      graphStateSource:
        'seeded into the renderer Graph store via the Vite dev module graph (no live model run)',
      checklistItems: CHECKLIST_ITEMS,
      graph: seededGraph,
      labels: {
        beforeGraph: staleLabel,
        duringGraph: outlineLabel,
        graphChip: graphLabel,
        outlineHint: hintText,
        afterGraph: restoredLabel
      },
      screenshots: [
        join(evidenceRoot, '1-plan-checklist-before-graph.png'),
        join(evidenceRoot, '2-plan-outline-and-graph-progress.png'),
        join(evidenceRoot, '3-plan-outline-sheet-hint.png'),
        join(evidenceRoot, '4-checklist-restored-after-run.png')
      ]
    }
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
        'closing the graph plan progress Electron application'
      ).catch(() => undefined)
    }
    // The video is only flushed once the recording context is gone.
    if (recordedVideo) {
      const videoTarget = join(evidenceRoot, 'graph-plan-progress.webm')
      await withTimeout(
        recordedVideo.saveAs(videoTarget),
        MAX_CLEANUP_TIMEOUT_MS,
        'saving the graph plan progress recording'
      ).catch(async (error) => {
        const fallback = await recordedVideo.path().catch(() => undefined)
        if (!fallback || !existsSync(fallback)) throw error
        await copyFile(fallback, videoTarget)
      }).then(async () => {
        if (result) result.video = videoTarget
        const mp4 = await transcodeToMp4(videoTarget).catch(() => undefined)
        if (result && mp4) result.videoMp4 = mp4
      }).catch((error) => cleanupErrors.push(error))
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
      'stopping the isolated graph plan progress Kun runtime'
    ).catch((error) => cleanupErrors.push(error))
    await withTimeout(
      stopIsolatedServiceManager(home, profile),
      MAX_CLEANUP_TIMEOUT_MS + 5_000,
      'stopping the isolated graph plan progress Kun Service Manager'
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
    if (result) {
      await writeFile(join(evidenceRoot, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
        .catch((error) => cleanupErrors.push(error))
    }
    await withTimeout(
      Promise.all([makeTreeWritable(temporaryRoot), makeTreeWritable(workspaceRoot)]),
      MAX_CLEANUP_TIMEOUT_MS,
      'making graph plan progress smoke directories writable'
    ).catch((error) => cleanupErrors.push(error))
    await withTimeout(
      Promise.all([
        rm(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }),
        rm(workspaceRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
      ]),
      MAX_CLEANUP_TIMEOUT_MS,
      'removing graph plan progress smoke directories'
    ).catch((error) => cleanupErrors.push(error))
    if (cleanupErrors.length > 0) {
      const cleanupDiagnostics = cleanupErrors
        .map((error) => `- ${error instanceof Error ? error.message : String(error)}`)
        .join('\n')
      primaryError = primaryError
        ? new Error(`${primaryError.stack ?? primaryError.message}\n\nCleanup failures:\n${cleanupDiagnostics}`)
        : new Error(`Graph plan progress smoke cleanup failed:\n${cleanupDiagnostics}`)
    }
  }
  if (primaryError) throw primaryError
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function normalize(value) {
  return String(value).replace(/\s+/gu, ' ').trim()
}

/**
 * Playwright only records WebM. Most issue trackers and reviewers want H.264,
 * so hand the run an MP4 too whenever ffmpeg is on PATH.
 */
async function transcodeToMp4(webmPath) {
  const mp4Path = webmPath.replace(/\.webm$/u, '.mp4')
  const code = await new Promise((resolvePromise) => {
    const child = spawn('ffmpeg', [
      '-y', '-i', webmPath, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-movflags', '+faststart', mp4Path
    ], { stdio: 'ignore', windowsHide: true })
    child.once('error', () => resolvePromise(null))
    child.once('exit', resolvePromise)
  })
  if (code !== 0 || !existsSync(mp4Path)) throw new Error('ffmpeg could not transcode the recording')
  return mp4Path
}

function checklistContent(index) {
  return `Plan step ${index + 1}: ship the compiled implementation task`
}

function checklistContents() {
  return Array.from({ length: CHECKLIST_ITEMS }, (_unused, index) => checklistContent(index))
}

/** The 19-item GUI implementation plan, every box still unchecked. */
function planMarkdown() {
  const tasks = checklistContents().map((content) => `- [ ] ${content}`).join('\n')
  return `# Compiled implementation plan\n\n## Tasks\n\n${tasks}\n`
}

/**
 * Creates a real thread and writes the plan checklist the GUI plan flow would
 * persist: every item plan-sourced, every item still pending.
 */
async function seedPlanChecklistThread(page, workspaceRoot) {
  return page.evaluate(async (input) => {
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
      title: input.title,
      workspace: input.workspace,
      model: input.model,
      mode: 'agent',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access'
    })
    const todos = input.contents.map((content, index) => ({
      content,
      status: 'pending',
      source: {
        kind: 'plan',
        planId: input.planId,
        relativePath: input.relativePath,
        ordinal: index,
        contentHash: `hash_${index}`
      }
    }))
    await request(`/v1/threads/${encodeURIComponent(thread.id)}/todos`, 'POST', { todos })
    return thread.id
  }, {
    workspace: workspaceRoot,
    model: MODEL_NAME,
    title: THREAD_TITLE,
    contents: checklistContents(),
    planId: PLAN_ID,
    relativePath: PLAN_RELATIVE_PATH
  })
}

/**
 * Publishes a Graph run projection for the thread: 11 compiled nodes, 7 already
 * accepted by the Lead, 1 executing, 1 ready, 2 blocked on dependencies — the
 * exact distribution in the report.
 */
async function seedGraphRun(page, threadId) {
  return page.evaluate(async (input) => {
    const graphStore = await import('/src/graph/graph-store.ts')
    const statuses = [
      ...Array.from({ length: input.accepted }, () => 'accepted'),
      'running', 'ready', 'blocked', 'blocked'
    ].slice(0, input.total)
    const now = new Date().toISOString()
    const planNodes = statuses.map((_status, index) => ({
      id: `node_${index + 1}`,
      phaseId: `phase_${Math.min(3, Math.floor(index / 4) + 1)}`,
      kind: 'work',
      title: `Compiled node ${index + 1}`,
      objective: `Deliver compiled execution node ${index + 1}.`,
      priority: 1,
      required: true,
      riskClass: 'low',
      assignment: { kind: 'ephemeral', name: `Executor ${index + 1}`, systemPrompt: 'Execute.' },
      readScopes: [],
      writeScopes: []
    }))
    const nodes = {}
    statuses.forEach((status, index) => {
      const planNode = planNodes[index]
      nodes[planNode.id] = {
        node: planNode,
        status,
        attempts: status === 'blocked' ? [] : [{
          id: `attempt_${index + 1}`,
          attemptNumber: 1,
          status: status === 'accepted' ? 'accepted' : status,
          assignment: {
            profileId: `executor-${index + 1}`, profileVersion: 1, profileOrigin: 'ephemeral',
            name: `Executor ${index + 1}`, model: 'k3', providerId: 'provider',
            allowedModelProviderIds: ['provider'], allowedModels: ['k3'],
            allowedProviderIds: ['builtin'], reasoningEffort: 'medium',
            systemPrompt: 'Execute.', toolPolicy: 'readOnly',
            allowedTools: [], blockedTools: [], allowedSkills: [], blockedSkills: [],
            allowedMcpServers: [], blockedMcpServers: [],
            approvalPolicy: 'never', sandboxMode: 'read-only', workspaceRoot: '/repo',
            readScopes: [], writeScopes: [], networkAllowed: false,
            maxWallTimeMs: 86_400_000, capturedAt: now
          },
          queuedAt: now, startedAt: now, tokenUsage: 0, elapsedMs: 0
        }],
        loopIteration: 0
      }
    })
    const run = {
      version: 1,
      id: 'run_plan_progress',
      projectId: 'project_plan_progress',
      threadId: input.threadId,
      sourceTurnId: 'turn_plan_progress',
      status: 'running',
      currentRevision: 1,
      plans: [{
        version: 1,
        revision: 1,
        title: 'Compiled implementation plan',
        goal: 'Execute the compiled plan.',
        workspaceRoot: '/repo',
        phases: [
          { id: 'phase_1', title: 'Backend', order: 1 },
          { id: 'phase_2', title: 'CLI', order: 2 },
          { id: 'phase_3', title: 'UI', order: 3 }
        ],
        nodes: planNodes,
        edges: [],
        completionNodeIds: planNodes.map((planNode) => planNode.id),
        createdAt: now
      }],
      nodes,
      reviews: [], messages: [], artifacts: [], cleanup: [], steering: [],
      budget: {
        limits: { maxWallTimeMs: 86_400_000, maxAttemptsPerNode: 3 },
        attempts: input.total,
        revisions: 0,
        loopIterations: 0,
        elapsedMs: 0,
        totalTokens: 0,
        messages: 0,
        artifactBytes: 0,
        warningKinds: [],
        closed: false
      },
      lastEventSeq: 42,
      createdAt: now,
      updatedAt: now
    }
    graphStore.useGraphStore.setState({
      threadId: input.threadId,
      runs: [run],
      selectedRunId: run.id,
      childRuns: {},
      // Holds the seeded projection still: a live refresh would replace it with
      // the empty runtime state, since no real Graph run exists on disk.
      refreshThread: async () => undefined
    })
    return {
      runId: run.id,
      total: planNodes.length,
      accepted: statuses.filter((status) => status === 'accepted').length,
      running: statuses.filter((status) => status === 'running').length
    }
  }, { threadId, total: GRAPH_NODES, accepted: GRAPH_ACCEPTED })
}

async function completeGraphRun(page) {
  await page.evaluate(async () => {
    const graphStore = await import('/src/graph/graph-store.ts')
    const state = graphStore.useGraphStore.getState()
    graphStore.useGraphStore.setState({
      runs: state.runs.map((run) => ({ ...run, status: 'completed' }))
    })
  })
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
  if (!port) throw new Error('Could not allocate a graph plan progress smoke port')
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
