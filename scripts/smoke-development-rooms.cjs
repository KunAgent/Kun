#!/usr/bin/env node
'use strict'

// Exercise the real Electron renderer/preload/main/Manager/Runtime composition.
// All model responses are deterministic and offline. Application settings, data,
// discovery/control files, Git repositories and processes belong to this run.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFile, spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
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
const { exerciseRoomHardening } = require('./smoke-rooms-hardening-controls.cjs')
const { roomPeerModelFixture, exercisePeerRoom } = require('./smoke-rooms-peer-controls.cjs')
const { exerciseRoomsUi } = require('./smoke-rooms-ui-controls.cjs')
const { exerciseTaskRoomRuns } = require('./smoke-rooms-run-inspector.cjs')
const { roomExperienceModelFixture, exerciseRoomsExperience } = require('./smoke-rooms-experience-controls.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')

const exec = promisify(execFile)
const ROOM_NAME = 'Rooms desktop smoke'
const TASK_TITLE = 'Create desktop evidence file'
const TASK_PROMPT = 'Create desktop-smoke.txt containing isolated desktop runtime and have it reviewed.'
const FILE_CONTENT = 'isolated desktop runtime\n'
const MODEL = 'deepseek-chat'
const VALIDATION_COMMAND = `node -e "console.log('rooms verification proof')"`

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 180_000)
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'rooms-desktop-smoke'))
  for (const entry of ['out/main/index.js', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronPathFile = join(electronPackage, 'path.txt')
  assert(existsSync(electronPathFile), 'Electron binary is not installed; install dependencies before this offline smoke')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(electronPathFile, 'utf8')).trim())
  assert(existsSync(electronExecutable), 'Electron executable is missing; install dependencies before this offline smoke')
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-rooms-desktop-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'rooms with spaces-'))
  let rendererProcess, electronApplication, electronProcess, page, modelFixture, result, primaryError
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
    const runtimePort = await availablePort()
    let rendererPort = await availablePort()
    while (rendererPort === runtimePort) rendererPort = await availablePort()
    const isolatedEnvironment = developmentRendererEnvironment(createIsolatedEnvironment(process.env, {
      home, appData, localAppData, temporaryDirectory
    }), { rendererPort, temporaryRoot })
    isolatedEnvironment.NODE_ENV = 'development'
    // Exclude ambient Git hooks, signing and global config from the disposable repository.
    const gitConfig = join(temporaryRoot, 'git-config')
    await writeFile(gitConfig, '')
    Object.assign(isolatedEnvironment, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig })
    const git = (args) => exec('git', ['-C', workspaceRoot, ...args], { env: isolatedEnvironment })
    await git(['init', '-b', 'develop'])
    await git(['config', 'user.name', 'Rooms Desktop Smoke'])
    await git(['config', 'user.email', 'rooms-desktop@example.test'])
    await writeFile(join(workspaceRoot, 'baseline.txt'), 'baseline\n')
    await git(['add', 'baseline.txt'])
    await git(['commit', '-m', 'test: seed isolated rooms repository'])
    const baselineSha = (await git(['rev-parse', 'HEAD'])).stdout.trim()

    modelFixture = await startModelFixture()
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, profile), locale: 'en', theme: 'light' }
    settings.agents.kun.baseUrl = modelFixture.baseUrl
    settings.agents.kun.apiKey = 'rooms-desktop-offline-fixture'
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
    page.on('console', (message) => { if (message.type() === 'error' && message.text().includes('same key')) pageErrors.push(message.text()) })
    await page.waitForLoadState('domcontentloaded')
    await page.locator('[data-workspace-mode-trigger]').first().waitFor()
    const { room } = await runtimeRequest(page, '/v1/rooms', 'POST', {
      clientRequestId: 'desktop-create-room', name: ROOM_NAME, collaborationMode: 'autonomous',
      repositories: [{ id: 'repo', displayPath: workspaceRoot, defaultBaseRef: 'develop' }]
    })
    assert.equal(room.collaborationMode, 'autonomous')
    await switchMode(page, 'rooms')
    await page.getByRole('heading', { name: ROOM_NAME, exact: true }).waitFor()
    await capture('1-room-ready')
    const uiScenario = () => exerciseRoomsUi({ page, request: runtimeRequest, poll, capture,
      fixture: modelFixture, home, profile, workspaceRoot,
      resize: (width, height) => resize(electronApplication, width, height) })
    const experienceScenario = () => exerciseRoomsExperience({ page, request: runtimeRequest, poll, capture,
      fixture: modelFixture, home, profile, workspaceRoot, application: electronApplication,
      resize: (width, height) => resize(electronApplication, width, height) })
    if (process.argv.includes('--experience-only')) {
      const experience = await experienceScenario()
      assert.deepEqual(pageErrors, [])
      result = { ok: true, scenario: 'experience-only', experience, modelFixture: modelFixture.snapshot(), pageErrors, screenshots }
      await writeFile(join(evidenceRoot, 'report.json'), JSON.stringify(result, null, 2) + '\n')
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      return
    }
    if (process.argv.includes('--ui-only')) {
      const ui = await uiScenario()
      assert.deepEqual(pageErrors, [])
      result = { ok: true, scenario: 'ui-only', ui, modelFixture: modelFixture.snapshot(), pageErrors, screenshots }
      await writeFile(join(evidenceRoot, 'report.json'), JSON.stringify(result, null, 2) + '\n')
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      return
    }
    if (process.argv.includes('--peer-only')) {
      const peer = await exercisePeerRoom({ page, request: runtimeRequest, poll, capture, fixture: modelFixture,
        resize: (width, height) => resize(electronApplication, width, height) })
      assert.deepEqual(pageErrors, [])
      result = { ok: true, scenario: 'peer-only', peer, modelFixture: modelFixture.snapshot(), pageErrors, screenshots }
      await writeFile(join(evidenceRoot, 'report.json'), JSON.stringify(result, null, 2) + '\n')
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      return
    }
    await page.getByLabel('Automatic intent', { exact: true }).selectOption('execute')
    await page.getByRole('textbox', { name: 'Discuss a question or describe the work to do…' }).fill(TASK_PROMPT)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await poll(() => modelFixture.snapshot().executionRequests > 0, timeoutMs, 'real task model dispatch')
    await openRoomDetails(page, 'Tasks')
    await page.locator('[aria-label="Tasks"]').getByRole('button', { name: new RegExp(TASK_TITLE) }).waitFor()
    await capture('2-task-running')
    const agreement = await exerciseRoomProductControls(page, room.id, capture)
    assert.equal(agreement.version, 4)

    // Hold the real write response until the room has unmounted, proving that
    // neither scheduling nor execution depends on a Rooms React component.
    await switchMode(page, 'chat')
    assert.equal(await page.locator('[data-rooms-workspace]').count(), 0)
    await capture('3-code-while-running')
    await switchMode(page, 'write')
    assert.equal(await page.locator('[data-rooms-workspace]').count(), 0)
    await capture('4-work-while-running')
    modelFixture.releaseExecution()
    let task, approvalsResolved = 0, inputsResolved = 0, integrationInputsResolved = 0, integrationApprovalsResolved = 0
    await poll(async () => {
      const { tasks } = await runtimeRequest(page, `/v1/rooms/${room.id}/tasks`)
      assert.equal(tasks.length, 1, 'One UI send must create exactly one task')
      task = tasks[0]
      assert(!['failed', 'recovery_required'].includes(task.status), `${task.status}: ${task.latestProgress}`)
      if (task.status === 'needs_approval' && approvalsResolved === 0) {
        assert(!existsSync(join(workspaceRoot, 'desktop-smoke.txt')), 'Unapproved write changed source repository')
        await switchMode(page, 'rooms')
        await openTask(page)
        await capture('approval-required')
        const allow = page.getByRole('dialog', { name: 'Room details', exact: true }).getByRole('button', { name: 'Allow', exact: true })
        await allow.waitFor()
        await capture('approval-in-room')
        const thread = await runtimeRequest(page, `/v1/threads/${task.executionThreadId}`)
        const pending = thread.turns.flatMap((turn) => turn.items ?? []).filter((item) =>
          item.kind === 'approval' && thread.pendingApprovalIds.includes(item.approvalId))
        assert.equal(pending.length, 1)
        assert.equal(pending[0].toolName, 'write')
        assert.equal(pending[0].summary, 'Review file action write: file="desktop-smoke.txt"')
        const approvalRef = 'sha256:' + createHash('sha256').update(pending[0].approvalId).digest('hex').slice(0, 16)
        await installNativeConsentFixture(electronApplication, approvalRef)
        await allow.click()
        await poll(() => electronApplication.evaluate(() => globalThis.__roomsSmokeNativeConsent?.calls === 1),
          10_000, 'the fixture-scoped protected native consent')
        approvalsResolved += 1
        await switchMode(page, 'write')
      }
      if (task.status === 'needs_input' && inputsResolved === 0) {
        await switchMode(page, 'rooms')
        await openTask(page)
        const question = page.getByRole('dialog', { name: 'Room details', exact: true })
        await question.getByLabel('Proceed').check()
        await question.getByRole('button', { name: 'Submit answers', exact: true }).click()
        inputsResolved += 1
        await capture('structured-answer-in-room')
        await question.getByRole('button', { name: 'Close', exact: true }).click()
        await switchMode(page, 'write')
      }
      return task.status === 'awaiting_acceptance'
    }, timeoutMs, 'offscreen task development and review')
    assert(!existsSync(join(workspaceRoot, 'desktop-smoke.txt')), 'Task wrote the source checkout before explicit application')
    assert.equal((await git(['rev-parse', 'HEAD'])).stdout.trim(), baselineSha)
    await switchMode(page, 'rooms')
    await openTask(page)
    const detailBeforeReload = await runtimeRequest(page, `/v1/rooms/${room.id}/tasks/${task.id}`)
    assert.equal(detailBeforeReload.reviews[0]?.verdict, 'passed')
    assert(detailBeforeReload.diff.includes(FILE_CONTENT.trim()), 'Delivery must include the actual write tool diff')
    const panel = page.getByRole('dialog', { name: 'Room details', exact: true })
    await panel.getByRole('heading', { name: 'Delivery', exact: true }).waitFor()
    await panel.getByRole('combobox', { name: 'Delivery history' }).selectOption(detailBeforeReload.delivery.id)
    await panel.getByText(detailBeforeReload.delivery.versionHash, { exact: true }).waitFor()
    await panel.getByRole('combobox', { name: 'Delivery history' }).selectOption('')
    const diffSummary = panel.locator('summary').filter({ hasText: /^Diff/ }).first()
    await diffSummary.click()
    await panel.getByRole('button', { name: 'desktop-smoke.txt', exact: true }).click()
    await panel.locator('summary').filter({ hasText: /^desktop-smoke.txt$/ }).click()
    await poll(async () => (await panel.innerText()).includes('+isolated desktop runtime'), 10000, 'per-file immutable diff')
    await capture('hardening-file-diff')
    await diffSummary.click()
    await capture('5-reviewed-delivery')

    // Reload the actual Electron page and restore durable room state.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-workspace-mode-trigger]').first().waitFor()
    if (!(await page.locator('[data-rooms-workspace]').count())) await switchMode(page, 'rooms')
    await page.getByRole('heading', { name: ROOM_NAME, exact: true }).waitFor()
    await openTask(page)
    const restored = await runtimeRequest(page, `/v1/rooms/${room.id}/tasks/${task.id}`)
    assert.equal(restored.task.latestDeliveryId, detailBeforeReload.task.latestDeliveryId)
    assert.equal(restored.task.status, 'awaiting_acceptance')
    const restoredMessages = await runtimeRequest(page, `/v1/rooms/${room.id}/messages`)
    assert.equal(restoredMessages.messages.filter((message) => message.authorKind === 'user' &&
      message.body === TASK_PROMPT).length, 1, 'Reload duplicated the user request')
    await capture('6-restored-delivery')
    await panel.getByRole('button', { name: 'Accept delivery', exact: true }).click()
    await panel.getByRole('button', { name: 'Apply changes', exact: true }).waitFor()
    assert(!existsSync(join(workspaceRoot, 'desktop-smoke.txt')), 'Accepting delivery applied changes prematurely')
    await writeFile(join(workspaceRoot, 'target-advance.txt'), 'new target commit\n')
    await git(['add', 'target-advance.txt'])
    await git(['commit', '-m', 'test: advance integration target'])
    const targetSha = (await git(['rev-parse', 'HEAD'])).stdout.trim()
    await panel.getByRole('textbox', { name: 'Validation commands', exact: true }).fill(VALIDATION_COMMAND)
    await panel.getByRole('button', { name: 'Prepare integration', exact: true }).click()
    await capture('integration-preparing')
    await poll(async () => {
      const alerts = await panel.getByRole('alert').allTextContents()
      assert.equal(alerts.length, 0, alerts.join('\n'))
      const { integrations } = await runtimeRequest(page, `/v1/rooms/${room.id}/tasks/${task.id}/integrations`)
      assert(!integrations.some((item) => ['failed', 'recovery_required'].includes(item.status)), JSON.stringify(integrations))
      if (integrations[0]?.userInputs?.length && !integrationInputsResolved) {
        await panel.getByLabel('Run verification').check()
        await panel.getByRole('button', { name: 'Submit answers', exact: true }).click()
        integrationInputsResolved += 1
        await capture('integration-structured-answer')
      }
      if (integrations[0]?.approvals?.length && !integrationApprovalsResolved) {
        const approval = integrations[0].approvals[0]
        const ref = 'sha256:' + createHash('sha256').update(approval.id).digest('hex').slice(0, 16)
        await installNativeConsentFixture(electronApplication, ref)
        await panel.getByRole('button', { name: 'Allow', exact: true }).click()
        integrationApprovalsResolved += 1
        await capture('integration-protected-approval')
      }
      if (integrations[0]?.status === 'ready') assert.equal(integrations[0].validation[0]?.exitCode, 0)
      return integrations[0]?.status === 'ready'
    }, timeoutMs, 'immutable integration candidate review')
    assert.equal(await panel.getByLabel('I reviewed this candidate and agree to apply it without recorded verification.').count(), 0)
    await panel.locator('summary').filter({ hasText: VALIDATION_COMMAND }).click()
    await panel.locator('summary').filter({ hasText: 'View verification log' }).click()
    await poll(async () => (await panel.innerText()).includes('rooms verification proof'), 10000, 'canonical verification log view')
    const logDownload = join(temporaryRoot, 'verification-download.log')
    await electronApplication.evaluate(({ dialog }, filePath) => {
      const original = dialog.showSaveDialog
      globalThis.__roomsLogSaveCalls = 0
      dialog.showSaveDialog = async (...args) => {
        const options = args.at(-1) ?? {}
        if (!globalThis.__roomsLogSaveCalls && options.title === 'Save generated file' && options.defaultPath === 'verification.log') {
          globalThis.__roomsLogSaveCalls++; dialog.showSaveDialog = original
          return { canceled: false, filePath }
        }
        return original.apply(dialog, args)
      }
    }, logDownload)
    await panel.getByRole('button', { name: 'Download output', exact: true }).click()
    await poll(() => existsSync(logDownload), 10000, 'scoped native verification log export')
    assert((await readFile(logDownload, 'utf8')).includes('rooms verification proof'))
    await capture('hardening-log-export')
    await capture('integration-reviewed-verified-candidate')
    await panel.getByRole('button', { name: 'Apply integration candidate', exact: true }).click()
    await poll(async () => {
      const detail = await runtimeRequest(page, `/v1/rooms/${room.id}/tasks/${task.id}`)
      return detail.task.applicationStatus === 'applied'
    }, timeoutMs, 'explicit application to the isolated repository')
    assert.equal(await readFile(join(workspaceRoot, 'desktop-smoke.txt'), 'utf8'), FILE_CONTENT)
    assert.equal((await git(['status', '--porcelain'])).stdout.trim(), '')
    await panel.getByText('Applied', { exact: true }).first().waitFor()
    assert.equal(await readFile(join(workspaceRoot, 'target-advance.txt'), 'utf8'), 'new target commit\n')
    await panel.getByRole('button', { name: 'Review disk usage and cleanup', exact: true }).click()
    await installCleanupConsentFixture(electronApplication)
    await panel.getByRole('button', { name: 'Clean up directories', exact: true }).click()
    await poll(() => !existsSync(detailBeforeReload.workspace.path), timeoutMs, 'explicit safe task cleanup')
    assert.equal(await readFile(join(workspaceRoot, 'desktop-smoke.txt'), 'utf8'), FILE_CONTENT)
    const retained = await runtimeRequest(page, `/v1/rooms/${room.id}/tasks/${task.id}/deliveries/${detailBeforeReload.delivery.id}`)
    assert.equal(retained.delivery.versionHash, detailBeforeReload.delivery.versionHash)
    await capture('cleanup-retains-history')
    const integrationsWithLogs = (await runtimeRequest(page, `/v1/rooms/${room.id}/tasks/${task.id}/integrations`)).integrations
    const logId = integrationsWithLogs[0].validation[0].output
    const retainedLog = await runtimeRequest(page, `/v1/rooms/${room.id}/tasks/${task.id}/logs/${logId}`)
    assert.equal(retainedLog.missing, undefined)
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    const hardening = await exerciseRoomHardening({ page, request: runtimeRequest, switchMode, poll, capture, fixture: modelFixture })
    await page.getByRole('button', { name: new RegExp(ROOM_NAME) }).click()
    await openTask(page)
    await capture('7-applied-delivery')
    const taskRuns = await exerciseTaskRoomRuns({ page, request: runtimeRequest,
      roomId: room.id, taskId: task.id, poll, capture })
    await resize(electronApplication, 760, 780)
    await page.waitForTimeout(400)
    await capture('8-narrow-task-details')
    const narrowBounds = await panel.boundingBox()
    const narrowViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    assert(narrowBounds.x >= 0 && narrowBounds.x + narrowBounds.width <= narrowViewport.width + 1,
      'Narrow task details overflow the window')
    assert(await page.locator('[data-workspace-mode-trigger]').first().evaluate((trigger) => {
      const bounds = trigger.getBoundingClientRect()
      return Boolean(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        ?.closest('aside[aria-label="Room details"]'))
    }), 'Underlying mode trigger paints above the narrow task overlay')
    const peer = await exercisePeerRoom({ page, request: runtimeRequest, poll, capture, fixture: modelFixture,
      resize: (width, height) => resize(electronApplication, width, height) })
    const experience = await experienceScenario()
    const ui = process.argv.includes('--ui-visual') ? await uiScenario() : undefined
    assert.deepEqual(pageErrors, [], 'Renderer emitted an uncaught exception')
    assert.equal(approvalsResolved, 1, 'Expected the on-request tool approval path')
    assert.equal(inputsResolved, 1, 'Expected the in-room structured answer path')
    assert.equal(integrationInputsResolved, 1, 'Expected integration execution-specific structured input')
    result = { ok: true, platform: process.platform, arch: process.arch, roomId: room.id, taskId: task.id,
      executionThreadId: task.executionThreadId, deliveryId: task.latestDeliveryId,
      baselineSha, targetSha, agreement, hardening, peer, experience, ui, taskRuns, inputsResolved, integrationInputsResolved, integrationApprovalsResolved, appliedSha: (await git(['rev-parse', 'HEAD'])).stdout.trim(),
      modelFixture: modelFixture.snapshot(), approvalsResolved,
      nativeConsent: 'fixture response through real trusted IPC; native OS click not exercised',
      narrowViewport, pageErrors, screenshots,
      assertions: ['real Electron bridge and Manager-backed Runtime', 'UI send dispatches real write tool',
        'Code and Work mode switches preserve background task', 'approval resolved within room through protected IPC', 'structured input answered within room', 'integration question answered on actual integration thread', 'versioned rules and search', 'durable read cursor',
        'immutable delivery and review',
        'renderer reload restores delivery', 'accept does not apply', 'target advances then declared validation and fixed-version review pass before applying the candidate', 'explicit cleanup retains immutable delivery history',
        'clean source repository', 'narrow task panel', 'default peer mode and activity drawer',
        'peer stop suppresses late publication', 'peer continuation and independent new topic', 'peer discussion creates no tasks'] }
    await writeFile(join(evidenceRoot, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    await capture('failure').catch(() => undefined)
    await captureIsolatedLogs(temporaryRoot, evidenceRoot).catch(() => undefined)
    if (page) await writeFile(join(evidenceRoot, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => undefined)
    primaryError = new Error(`${error.stack ?? error}\nFixture: ${JSON.stringify(modelFixture?.snapshot())}\nRenderer:\n${rendererOutput}\nElectron:\n${electronOutput}`)
    await writeFile(join(evidenceRoot, 'failure.txt'), primaryError.stack).catch(() => undefined)
  } finally {
    modelFixture?.releaseExecution()
    modelFixture?.releaseCoordination()
    modelFixture?.releasePeer()
    modelFixture?.releaseUi()
    const errors = []
    const cleanup = async (operation) => {
      try { await withTimeout(operation, 20_000, 'cleaning isolated Rooms smoke') }
      catch (error) { errors.push(error.message) }
    }
    let closing
    if (electronApplication) {
      await electronApplication.evaluate(({ dialog }) => {
        const fixture = globalThis.__roomsSmokeNativeConsent
        if (fixture) dialog.showMessageBox = fixture.original
      }).catch(() => undefined)
      closing = electronApplication.close()
      await withTimeout(closing, 3000, 'closing isolated Electron').catch(() => undefined)
    }
    if (electronProcess) await cleanup(terminateProcessTree(electronProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }))
    await cleanup(stopIsolatedSharedRuntime(repositoryRoot, profile))
    await cleanup(stopIsolatedServiceManager(home, profile))
    if (closing) await withTimeout(closing, 1000, 'settling Electron').catch(() => undefined)
    releaseChildProcessHandles(electronProcess)
    if (rendererProcess) await cleanup(terminateProcessTree(rendererProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }))
    releaseChildProcessHandles(rendererProcess)
    if (modelFixture) await cleanup(modelFixture.close())
    await cleanup(Promise.all([makeTreeWritable(temporaryRoot), makeTreeWritable(workspaceRoot)]))
    await cleanup(Promise.all([temporaryRoot, workspaceRoot]
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }))))
    if (errors.length) primaryError = new Error(`${primaryError?.stack ?? ''}\nCleanup failures: ${errors.join('; ')}`)
  }
  if (primaryError) throw primaryError
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

async function exerciseRoomProductControls(page, roomId, capture) {
  await page.getByRole('dialog', { name: 'Room details', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  const sent = (await runtimeRequest(page, `/v1/rooms/${roomId}/messages?limit=200`)).messages
    .filter((message) => message.authorKind === 'user' && message.body === TASK_PROMPT)
  assert.equal(sent.length, 1, 'Expected one exact original user task request')
  const userMessage = page.locator('#room-message-' + sent[0].id)
  await userMessage.hover()
  await userMessage.getByRole('button', { name: 'Pin as project agreement', exact: true }).click()
  await openRoomDetails(page, 'Room overview')
  await page.getByRole('button', { name: /Pinned project agreements \(1\)/ }).click()
  await page.getByRole('button', { name: 'Edit agreement', exact: true }).click()
  await page.getByRole('textbox', { name: 'Edit agreement', exact: true }).fill('Use LF line endings for this project.')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('v1 · Enabled · ' + TASK_PROMPT, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Disable', exact: true }).click()
  await page.getByRole('button', { name: 'Enable', exact: true }).click()
  let rule
  await poll(async () => { rule = (await runtimeRequest(page, `/v1/rooms/${roomId}/rules`)).rules[0]; return rule?.version === 4 }, 10000, 'versioned agreement edit/disable/restore')
  assert.equal(rule.active, true)
  await capture('agreement-history')
  await page.getByRole('button', { name: /Pinned project agreements \(1\)/ }).click()
  await page.getByRole('dialog', { name: 'Room details', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  const search = page.getByRole('textbox', { name: 'Search messages (2+ characters)', exact: true })
  await page.getByRole('button', { name: 'Search messages (2+ characters)', exact: true }).click()
  await search.fill('desktop-smoke.txt')
  await userMessage.waitFor()
  await capture('message-search')
  await search.fill('')
  await search.press('Escape')
  await poll(async () => {
    const { rooms } = await runtimeRequest(page, '/v1/rooms')
    const current = rooms.find((item) => item.id === roomId)
    return current?.readSeq > 0
  }, 10000, 'durable visible-message read cursor')
  return { id: rule.id, version: rule.version, active: rule.active }
}

async function installCleanupConsentFixture(application) {
  await application.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox
    const state = { original, calls: 0 }
    globalThis.__roomsSmokeNativeConsent = state
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1) ?? {}
      if (state.calls === 0 && options.message === 'Remove these task directories?' && options.detail?.includes('rooms')) {
        state.calls += 1
        dialog.showMessageBox = original
        return { response: 0, checkboxChecked: false }
      }
      return original.apply(dialog, args)
    }
  })
}

async function installNativeConsentFixture(application, approvalRef) {
  await application.evaluate(({ dialog }, expectedRef) => {
    const original = dialog.showMessageBox
    const state = { original, calls: 0 }
    globalThis.__roomsSmokeNativeConsent = state
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1) ?? {}
      if (state.calls === 0 && options.title === 'Approve tool action' &&
        options.message === 'Allow this pending Kun tool action once?' &&
        options.detail?.startsWith(`Approval reference: ${expectedRef}\n\n`) &&
        JSON.stringify(options.buttons) === JSON.stringify(['Allow once', 'Cancel'])) {
        state.calls += 1
        dialog.showMessageBox = original
        return { response: 0, checkboxChecked: false }
      }
      return original.apply(dialog, args)
    }
  }, approvalRef)
}

async function captureIsolatedLogs(root, destination) {
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
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

async function openRoomDetails(page, section) {
  const drawer = page.getByRole('dialog', { name: 'Room details', exact: true })
  if (!(await drawer.count())) await page.getByRole('button', { name: 'Room details', exact: true }).click()
  while (await drawer.count() && !await drawer.locator('.rooms-details-tabs').count()) {
    await drawer.getByRole('button', { name: 'Back to previous view', exact: true }).click()
  }
  if (!(await drawer.count())) await page.getByRole('button', { name: 'Room details', exact: true }).click()
  await drawer.getByRole('button', { name: section, exact: true }).click()
}

async function openTask(page) {
  await openRoomDetails(page, 'Tasks')
  await page.locator('[aria-label="Tasks"]').getByRole('button', { name: new RegExp(TASK_TITLE) }).click()
  await page.getByRole('dialog', { name: 'Room details', exact: true }).waitFor()
}

function resize(application, width, height) {
  return application.evaluate(({ BrowserWindow }, bounds) => {
    BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.setBounds({ x: 20, y: 20, ...bounds })
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

async function startModelFixture() {
  const peerFixture = roomPeerModelFixture(), experienceFixture = roomExperienceModelFixture()
  let releaseExecution
  const gate = new Promise((resolve) => { releaseExecution = resolve })
  let releaseCoordination
  const coordinationGate = new Promise((resolve) => { releaseCoordination = resolve })
  let releaseUi
  const uiGate = new Promise((resolve) => { releaseUi = resolve })
  const state = { coordinationRequests: 0, executionRequests: 0, reviewRequests: 0, inputRequests: 0, otherRequests: 0 }
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && /\/models(?:\?|$)/u.test(request.url ?? '')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }))
        return
      }
      assert.equal(request.method, 'POST', 'Unexpected offline model request')
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const messageText = (message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
      const principal = body.messages.findLastIndex((message) => message.role === 'user' && /You coordinate a personal Kun room|Complete this authorized room task|Review this immutable|Run exactly the declared|Compress project agreements|Participate as this Kun room member/.test(messageText(message)))
      const messages = body.messages.slice(Math.max(0, principal))
      const prompt = JSON.stringify(messages)
      let content = 'Completed.', toolCalls
      const called = (name) => messages.some((message) => message.tool_calls?.some((tool) => tool.function?.name === name))
      const tool = (name, args) => [{ index: 0, id: 'smoke-' + name, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
      const peerResponse = experienceFixture.respond({ body, prompt, called, tool }) ??
        await peerFixture.respond({ body, prompt, called, tool })
      if (peerResponse) { content = peerResponse.content; toolCalls = peerResponse.toolCalls }
      else if (prompt.includes('Compress project agreements')) {
        state.compressionRequests = (state.compressionRequests ?? 0) + 1
        const texts = messages.flatMap((message) => typeof message.content === 'string' ? [message.content] : (message.content ?? []).map((part) => part.text ?? ''))
        const input = JSON.parse(texts.flatMap((text) => text.split('\n')).findLast((line) => line.startsWith('{"sources":')))
        content = JSON.stringify({ sources: input.sources, summary: 'Keep limit 12. Never upload secrets. Exception: local fixtures only.' })
      } else if (prompt.includes('You coordinate a personal Kun room') && prompt.includes('ROOM_UI_VISUAL')) {
        state.uiCoordinationRequests = (state.uiCoordinationRequests ?? 0) + 1
        await uiGate
        if (!called('submit_room_plan')) { content = ''; toolCalls = tool('submit_room_plan', { kind: 'answer', response: 'The isolated UI fixture is complete.' }) }
      } else if (prompt.includes('You coordinate a personal Kun room') && /ROOM_HARDENING_/.test(prompt)) {
        state.coordinationRequests += 1
        if (prompt.includes('ROOM_HARDENING_STOP')) { state.stoppingRequests = (state.stoppingRequests ?? 0) + 1; await coordinationGate }
        const plan = prompt.includes('ROOM_HARDENING_REQUEST') && !prompt.includes('CONFIRMED_HARDENING_ANSWER') ? { kind: 'clarify', response: 'Which compatibility option should be used?' } : { kind: 'answer', response: 'The conservative compatibility option is confirmed. No files were changed.' }
        if (!called('submit_room_plan')) { content = ''; toolCalls = tool('submit_room_plan', plan) }
      } else if (prompt.includes('You coordinate a personal Kun room')) {
        state.coordinationRequests += 1
        if (!called('submit_room_plan')) { content = ''; toolCalls = tool('submit_room_plan', { kind: 'execute', response: 'Development and review assigned.', participants: [],
          assignments: [{ key: 'desktop-smoke', memberId: 'developer', repositoryId: 'repo',
            title: TASK_TITLE, prompt: TASK_PROMPT, dependsOn: [], reviewerMemberId: 'reviewer' }] }) }
      } else if (prompt.includes('Run exactly the declared verification commands without changing candidate source code')) {
        state.validationRequests = (state.validationRequests ?? 0) + 1
        if (!called('user_input')) {
          content = ''; toolCalls = tool('user_input', { prompt: 'Integration validation choice', questions: [{ id: 'validation', question: 'Run the declared verification command?', options: [{ label: 'Run verification', description: 'Execute the isolated candidate check.' }, { label: 'Stop verification', description: 'Do not continue.' }] }] })
        } else if (!called('declare_room_checks')) { content = ''; toolCalls = tool('declare_room_checks', { checks: [{ id: 'candidate-exit-code', command: VALIDATION_COMMAND }] }) }
        else if (!called('bash')) { content = ''; toolCalls = tool('bash', { command: VALIDATION_COMMAND }) }
        else content = 'Declared verification completed successfully.'
      } else if (prompt.includes('Review this immutable delivered version') || prompt.includes('Review this immutable integrated candidate')) {
        state.reviewRequests += 1
        if (!called('submit_room_review')) { content = ''; toolCalls = tool('submit_room_review', { verdict: 'passed', findings: [], limitations: ['Only declared checks are covered.'] }) }
      } else if (prompt.includes('Complete this authorized room task')) {
        state.executionRequests += 1
        await gate
        if (!called('write')) {
          content = ''
          toolCalls = [{ index: 0, id: 'desktop-smoke-write', type: 'function', function: { name: 'write',
            arguments: JSON.stringify({ path: 'desktop-smoke.txt', content: FILE_CONTENT }) } }]
        } else if (!called('user_input')) {
          state.inputRequests += 1
          content = ''; toolCalls = tool('user_input', { prompt: 'Confirm the smoke fixture delivery', questions: [{ id: 'delivery', question: 'Deliver this file?', options: [{ label: 'Proceed', description: 'Finish the requested file.' }, { label: 'Stop', description: 'Cancel delivery.' }] }] })
        } else content = 'Created desktop-smoke.txt; no test commands were run.'
      } else state.otherRequests += 1
      const message = { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }
      const finish_reason = toolCalls ? 'tool_calls' : 'stop'
      if (body.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: ' + JSON.stringify({ id: 'desktop-smoke', choices: [{ index: 0, delta: message, finish_reason: null }] }) + '\n\n')
        response.write('data: ' + JSON.stringify({ id: 'desktop-smoke', choices: [{ index: 0, delta: {}, finish_reason }] }) + '\n\n')
        response.end('data: [DONE]\n\n')
      } else {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ id: 'desktop-smoke', choices: [{ index: 0, message, finish_reason }],
          usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } }))
      }
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: String(error) } }))
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, releaseExecution, releaseCoordination, releaseUi, releasePeer: peerFixture.release,
    snapshot: () => ({ ...state, ...peerFixture.snapshot(), ...experienceFixture.snapshot() }), close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections?.()
    }) }
}

main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1 })
