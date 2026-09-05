#!/usr/bin/env node

'use strict'

const { mkdir, mkdtemp, readFile, realpath, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const {
  createDesktopLaunchPlan,
  createIsolatedEnvironment,
  desktopUserDataCandidates,
  platformDesktopArguments,
  resolveDesktopLaunchSelection,
  terminateProcessTree
} = require('./smoke-packaged-extension-desktop.cjs')
const {
  CdpConnection,
  isWorkbenchTarget,
  sendToWorkbenchSession,
  waitForCdpEndpoint,
  waitForTarget
} = require('./smoke-packaged-extension-desktop-cdp.cjs')
const {
  availablePort,
  processState
} = require('./smoke-packaged-extension-desktop-process.cjs')
const {
  makeTreeWritable,
  resolvePackagedRuntimeExecutable
} = require('./smoke-packaged-extensions.cjs')
const {
  CHAT_MARKER,
  NEGATIVE_SCENARIOS,
  POSITIVE_SCENARIOS,
  RECYCLED_PID_SCENARIOS,
  SAVED_THREAD_TITLE,
  buildSmokeSettings,
  childState,
  createSmokeThread,
  launchPredecessorOwners,
  parseSmokeMarker,
  poll,
  preparePredecessorRuntime,
  processIsAlive,
  readPackagedBuild,
  runtimeBuildIdForFlavor,
  runtimeJson,
  spawnTracked,
  startModelFixture,
  startSmokeTurn,
  waitForJson,
  waitForProcessExit,
  waitForTurn,
  writeSmokeSettings
} = require('./smoke-packaged-update-handoff-support.cjs')
const {
  managerJson,
  runRecycledPidScenario,
  stopCurrentOwners
} = require('./smoke-packaged-update-handoff-recycled.cjs')

const DEFAULT_TIMEOUT_MS = 120_000
const READY_PREFIX = 'KUN_UPDATE_HANDOFF_SMOKE_READY '
const FAILED_PREFIX = 'KUN_UPDATE_HANDOFF_SMOKE_FAILED '

async function main() {
  const resourcesDir = requiredPath('--resources')
  const oldResourcesDir = optionalPath('--old-resources')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const candidateRuntimeExecutable = resolvePackagedRuntimeExecutable(
    resourcesDir,
    argumentValue('--runtime-executable')
  )
  if (!candidateRuntimeExecutable) {
    throw new Error(`Candidate package is not executable on ${process.platform}/${process.arch}`)
  }
  const desktop = resolveDesktopLaunchSelection({
    resourcesDir,
    runtimeExecutable: candidateRuntimeExecutable,
    packagedRuntimeExecutable: candidateRuntimeExecutable,
    desktopExecutable: argumentValue('--desktop-executable')
  })
  const candidate = await readPackagedBuild(resourcesDir)
  const selection = argumentValue('--cases') ?? 'all'
  const runPositive = selection === 'all' || selection === 'positive'
  const runRecycled = runPositive || selection === 'recycled'
  const runNegative = selection === 'all' || selection === 'negative'
  if (!runPositive && !runRecycled && !runNegative) {
    throw new Error('--cases must be all, positive, recycled, or negative')
  }

  for (const scenario of runPositive ? POSITIVE_SCENARIOS : []) {
    await runPositiveScenario({
      scenario,
      resourcesDir,
      oldResourcesDir,
      candidateRuntimeExecutable,
      desktop,
      candidateBuildId: candidate.buildId,
      timeoutMs
    })
  }
  for (const scenario of runRecycled ? RECYCLED_PID_SCENARIOS : []) {
    await runRecycledPidScenario({
      scenario,
      resourcesDir,
      oldResourcesDir,
      candidateRuntimeExecutable,
      desktop,
      candidateBuildId: candidate.buildId,
      timeoutMs
    }, {
      assertChatRoundTrip,
      cleanupProfile,
      cleanupTracked,
      createProfileRoot,
      desktopExitGuard,
      initializeProfile,
      launchCandidate,
      quitDesktopNormally,
      waitForCurrentOwners
    })
  }
  for (const scenario of runNegative ? NEGATIVE_SCENARIOS : []) {
    await runNegativeScenario({
      scenario,
      candidateBuildId: candidate.buildId,
      desktop,
      timeoutMs
    })
  }
  process.stdout.write(
    `Packaged update handoff smoke OK (${process.platform}/${process.arch}): ` +
    `${(runPositive ? POSITIVE_SCENARIOS.length : 0) + (runRecycled ? RECYCLED_PID_SCENARIOS.length : 0)} update paths and ` +
    `${runNegative ? NEGATIVE_SCENARIOS.length : 0} fail-closed owner cases passed.\n`
  )
}

async function runPositiveScenario(input) {
  const root = await createProfileRoot(`kun-packaged-handoff-${input.scenario.name}-`)
  const modelFixture = await startModelFixture()
  const tracked = []
  let primaryError
  let cleanupErrors = []
  try {
    const profile = await initializeProfile(root, modelFixture.baseUrl, input.scenario.autoStart)
    const predecessor = await preparePredecessorRuntime({
      resourcesDir: input.resourcesDir,
      oldResourcesDir: input.oldResourcesDir,
      temporaryRoot: root.temporaryRoot
    })
    if (predecessor.buildId === input.candidateBuildId) {
      throw new Error('Old and candidate packaged Runtime build IDs must differ')
    }
    const owners = await launchPredecessorOwners({
      runtimeExecutable: input.candidateRuntimeExecutable,
      kunRoot: predecessor.kunRoot,
      buildId: predecessor.buildId,
      environment: profile.environment,
      controlDir: profile.controlDir,
      dataDir: profile.dataDir,
      settingsPath: profile.settingsPath,
      workspaceRoot: profile.workspaceRoot,
      productionPort: profile.productionPort,
      developmentPort: profile.developmentPort,
      baseUrl: modelFixture.baseUrl,
      timeoutMs: input.timeoutMs,
      onSpawn: (process) => tracked.push(process)
    })
    const production = owners.runtimes.find((entry) => entry.flavor === 'production').discovery
    const saved = await createSmokeThread(production, profile.workspaceRoot)
    let activeTurn
    if (input.scenario.activeWork) {
      modelFixture.state.mode = 'hang'
      activeTurn = await startSmokeTurn(production, saved.id, 'remain active until the update handoff')
      await waitForTurn(
        production,
        saved.id,
        activeTurn.turnId,
        (turn) => turn.status === 'running',
        input.timeoutMs
      )
      await poll(
        () => modelFixture.state.requests > 0,
        input.timeoutMs,
        'the predecessor model request to become active'
      )
    }

    if (input.scenario.path === 'in-app') {
      const preflight = launchCandidate(input.desktop, profile, {
        preflight: true,
        timeoutMs: input.timeoutMs
      })
      tracked.push(preflight)
      const result = await waitForChild(preflight, input.timeoutMs)
      tracked.splice(tracked.indexOf(preflight), 1)
      if (result.code !== 0) {
        throw new Error(`Packaged in-app handoff preflight failed: ${result.output}`)
      }
      const marker = parseSmokeMarker(result.output, READY_PREFIX)
      if (marker?.postcondition !== 'drained' || marker?.targetBuildId !== input.candidateBuildId) {
        throw new Error(`Packaged in-app handoff omitted its drained acceptance marker: ${result.output}`)
      }
    }

    const debuggingPort = await availablePort()
    const candidateDesktop = launchCandidate(input.desktop, profile, {
      debuggingPort,
      timeoutMs: input.timeoutMs
    })
    tracked.push(candidateDesktop)
    const current = await waitForCurrentOwners({
      profile,
      candidateBuildId: input.candidateBuildId,
      autoStart: input.scenario.autoStart,
      oldOwners: owners,
      desktop: candidateDesktop,
      timeoutMs: input.timeoutMs
    })

    for (const owner of [owners.manager, ...owners.runtimes]) {
      const pid = owner.discovery.pid
      if (processIsAlive(pid)) throw new Error(`Candidate left predecessor PID ${pid} alive`)
    }
    if (input.scenario.autoStart) {
      modelFixture.state.mode = 'complete'
      const listed = await runtimeJson(current.runtime, '/v1/threads?include_archived=true&include=side')
      if (!listed.threads?.some((thread) => thread.id === saved.id && thread.title === SAVED_THREAD_TITLE)) {
        throw new Error('Candidate Runtime could not read the conversation saved by the predecessor')
      }
      if (activeTurn) {
        const settled = await runtimeJson(
          current.runtime,
          `/v1/threads/${encodeURIComponent(saved.id)}/turns/${encodeURIComponent(activeTurn.turnId)}`
        )
        if (settled.status === 'running' || settled.status === 'queued') {
          throw new Error(`Predecessor active turn remained ${settled.status} after handoff`)
        }
      }
      await assertChatRoundTrip(current.runtime, profile.workspaceRoot, input.timeoutMs)
    } else {
      await assertNoRuntimeDiscovery(profile)
      const savedMetadata = await readFile(
        join(profile.dataDir, 'threads', saved.id, 'metadata.jsonl'),
        'utf8'
      )
      if (!savedMetadata.includes(saved.id)) {
        throw new Error('autoStart=false handoff lost the saved conversation metadata')
      }
    }

    await quitDesktopNormally(candidateDesktop, debuggingPort, input.timeoutMs)
    tracked.splice(tracked.indexOf(candidateDesktop), 1)
    if (current.runtime &&
      !await waitForProcessExit(current.runtime.pid, Math.min(input.timeoutMs, 20_000))) {
      throw new Error('Ordinary GUI quit left the GUI-owned Runtime running')
    }
    const managerStatus = await managerJson(current.manager, '/v1/manager/status')
    if (managerStatus.instanceId !== current.manager.instanceId ||
      managerStatus.pid !== current.manager.pid) {
      throw new Error('Ordinary GUI quit unexpectedly stopped the current Service Manager')
    }
    await stopCurrentOwners(current, input.timeoutMs)
  } catch (error) {
    primaryError = error
  } finally {
    await modelFixture.close().catch(() => undefined)
    cleanupErrors = await cleanupTracked(tracked)
    await cleanupProfile(root).catch((error) => cleanupErrors.push(error.message ?? String(error)))
  }
  if (primaryError) {
    const detail = tracked.map((entry) => entry.output?.() ?? '').filter(Boolean).join('\n')
    throw new Error(`${primaryError.stack ?? primaryError}${detail ? `\nProcess output:\n${detail}` : ''}`)
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Packaged handoff cleanup failed: ${cleanupErrors.join('; ')}`)
  }
}

async function runNegativeScenario(input) {
  const root = await createProfileRoot(`kun-packaged-handoff-negative-${input.scenario}-`)
  const tracked = []
  let primaryError
  let cleanupErrors = []
  try {
    const profile = await initializeProfile(root, 'http://127.0.0.1:9', false)
    const fixture = spawnTracked(process.execPath, [
      join(__dirname, 'fixtures', 'update-handoff', 'serve-entry.cjs'),
      'serve',
      '--data-dir', profile.dataDir,
      '--scenario', input.scenario,
      '--build-id', 'a'.repeat(64)
    ], { cwd: profile.workspaceRoot, env: profile.environment })
    tracked.push(fixture)
    const owner = await Promise.race([
      waitForJson(
        join(profile.dataDir, 'runtime.json'),
        (value) => value?.pid === fixture.child.pid,
        input.timeoutMs,
        () => childState(fixture.child, fixture.output())
      ),
      desktopExitGuard(fixture.child)
    ])
    const preflight = launchCandidate(input.desktop, profile, {
      preflight: true,
      denyInspection: input.scenario === 'inspection-denied',
      timeoutMs: input.timeoutMs
    })
    tracked.push(preflight)
    const result = await waitForChild(preflight, input.timeoutMs)
    tracked.splice(tracked.indexOf(preflight), 1)
    if (result.code === 0) throw new Error(`Unsafe ${input.scenario} owner was accepted`)
    const failure = parseSmokeMarker(result.output, FAILED_PREFIX)
    const expectedRetryable = input.scenario === 'inspection-denied'
    if (!failure || failure.retryable !== expectedRetryable || failure.owner?.pid !== owner.pid) {
      throw new Error(`Unsafe ${input.scenario} did not expose actionable fail-closed metadata: ${result.output}`)
    }
    if (!processIsAlive(owner.pid)) {
      throw new Error(`Candidate terminated unsafe ${input.scenario} PID ${owner.pid}`)
    }
    const preserved = JSON.parse(await readFile(join(profile.dataDir, 'runtime.json'), 'utf8'))
    if (input.scenario === 'changed-discovery-identity') {
      if (preserved.instanceId === owner.instanceId) {
        throw new Error('Changed-identity fixture did not publish its replacement identity')
      }
    } else if (preserved.pid !== owner.pid) {
      throw new Error(`Candidate rewrote unsafe ${input.scenario} discovery ownership`)
    }
  } catch (error) {
    primaryError = error
  } finally {
    cleanupErrors = await cleanupTracked(tracked)
    await cleanupProfile(root).catch((error) => cleanupErrors.push(error.message ?? String(error)))
  }
  if (primaryError) throw primaryError
  if (cleanupErrors.length > 0) {
    throw new Error(`Negative handoff cleanup failed: ${cleanupErrors.join('; ')}`)
  }
}

async function createProfileRoot(prefix) {
  // Keep every discovery/settings path on the same spelling. In particular,
  // macOS may return /var from tmpdir() while Electron reports /private/var;
  // the handoff intentionally rejects different canonical settings scopes.
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  const home = join(temporaryRoot, 'home')
  const explicitUserData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceRoot = join(temporaryRoot, 'workspace')
  await Promise.all([
    home,
    explicitUserData,
    appData,
    localAppData,
    temporaryDirectory,
    workspaceRoot
  ].map((path) => mkdir(path, { recursive: true })))
  return {
    temporaryRoot,
    home,
    explicitUserData,
    appData,
    localAppData,
    temporaryDirectory,
    workspaceRoot
  }
}

async function initializeProfile(root, baseUrl, autoStart) {
  const dataDir = join(root.home, '.kun', 'data')
  const controlDir = join(root.home, '.kun', 'control')
  const productionPort = await availablePort()
  let developmentPort = await availablePort()
  while (developmentPort === productionPort) developmentPort = await availablePort()
  const environment = createIsolatedEnvironment(process.env, root)
  const userDataPaths = desktopUserDataCandidates({
    platform: process.platform,
    home: root.home,
    appData: root.appData,
    explicitUserData: root.explicitUserData
  })
  const settings = buildSmokeSettings({
    dataDir,
    port: productionPort,
    runtimeToken: 'candidate-packaged-handoff-token',
    workspaceRoot: root.workspaceRoot,
    baseUrl,
    autoStart
  })
  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(controlDir, { recursive: true })])
  await writeSmokeSettings(userDataPaths, settings)
  return {
    ...root,
    dataDir,
    controlDir,
    productionPort,
    developmentPort,
    environment,
    // The smoke passes --user-data-dir to the packaged desktop so every
    // platform uses this exact profile as app.getPath('userData'). The
    // predecessor Manager must advertise the same canonical settings scope.
    settingsPath: join(root.explicitUserData, 'kun-settings.json')
  }
}

function launchCandidate(desktop, profile, options = {}) {
  const applicationArguments = [
    ...(desktop.applicationEntry ? [desktop.applicationEntry] : []),
    ...(options.preflight ? ['--kun-packaged-update-handoff-smoke'] : []),
    ...(options.debuggingPort ? [
      `--remote-debugging-port=${options.debuggingPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*'
    ] : []),
    `--user-data-dir=${profile.explicitUserData}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    ...platformDesktopArguments(process.platform)
  ]
  const environment = {
    ...profile.environment,
    ...(options.preflight ? { KUN_PACKAGED_UPDATE_HANDOFF_SMOKE: '1' } : {}),
    ...(options.denyInspection ? { KUN_PACKAGED_UPDATE_HANDOFF_DENY_INSPECTION: '1' } : {})
  }
  const plan = createDesktopLaunchPlan({
    executable: desktop.desktopExecutable,
    applicationArguments,
    environment,
    platform: process.platform,
    hasDisplay: Boolean(environment.DISPLAY),
    xvfbExecutable: argumentValue('--xvfb-run') ?? 'xvfb-run'
  })
  return spawnTracked(plan.command, plan.args, {
    cwd: profile.workspaceRoot,
    env: plan.env
  })
}

async function quitDesktopNormally(desktop, debuggingPort, timeoutMs) {
  const readProcessState = () => processState(desktop.child)
  const endpoint = await waitForCdpEndpoint({
    port: debuggingPort,
    timeoutMs,
    processState: readProcessState
  })
  const cdp = await CdpConnection.connect(
    endpoint.webSocketDebuggerUrl,
    globalThis.WebSocket,
    Math.min(timeoutMs, 15_000)
  )
  try {
    await cdp.send('Target.setDiscoverTargets', { discover: true })
    const workbench = await waitForTarget(
      cdp,
      isWorkbenchTarget,
      'packaged Kun workbench for normal quit',
      timeoutMs,
      readProcessState
    )
    const evaluated = await sendToWorkbenchSession({
      cdp,
      session: { targetId: workbench.targetId, sessionId: undefined },
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => {
          if (typeof window.kunGui?.runDesktopCommand !== 'function') return false
          setTimeout(() => void window.kunGui.runDesktopCommand('quit'), 0)
          return true
        })()`,
        returnByValue: true
      },
      timeoutMs,
      processState: readProcessState,
      operation: 'requesting an ordinary GUI quit'
    })
    if (evaluated.exceptionDetails || evaluated.result?.value !== true) {
      throw new Error('Packaged workbench could not request an ordinary GUI quit')
    }
  } finally {
    cdp.close()
  }
  if (!await waitForProcessExit(desktop.child.pid, Math.min(timeoutMs, 30_000))) {
    throw new Error(`Packaged GUI PID ${desktop.child.pid} did not exit after its ordinary quit request`)
  }
}

function desktopExitGuard(child) {
  return new Promise((_, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      reject(new Error(
        `Tracked smoke process exited before its discovery completed: ` +
        `code=${code}, signal=${signal}`
      ))
    })
  })
}

function handoffExitGuard(desktop) {
  let onError
  let onExit
  const promise = new Promise((_, reject) => {
    onError = (error) => {
      reject(new Error(`Tracked smoke process failed before discovery: ${error.message}\n${desktop.output()}`))
    }
    onExit = (code, signal) => {
      const output = desktop.output()
      process.stderr.write(
        `Tracked smoke process exited before discovery: code=${code}, signal=${signal}\n${output}\n`
      )
      reject(new Error(
        `Tracked smoke process exited before its discovery completed: ` +
        `code=${code}, signal=${signal}\n${output}`
      ))
    }
    desktop.child.once('error', onError)
    desktop.child.once('exit', onExit)
  })
  return {
    promise,
    dispose: () => {
      desktop.child.off('error', onError)
      desktop.child.off('exit', onExit)
    }
  }
}

async function waitForCurrentOwners(input) {
  const processExit = handoffExitGuard(input.desktop)
  try {
    const manager = await Promise.race([
      waitForJson(
        join(input.profile.controlDir, 'manager.json'),
        (value) => value?.buildId === input.candidateBuildId &&
          value?.pid !== input.oldOwners.manager.discovery.pid,
        input.timeoutMs,
        () => childState(input.desktop.child, input.desktop.output())
      ),
      processExit.promise
    ])
    let runtime
    if (input.autoStart) {
      runtime = await Promise.race([
        waitForJson(
          join(input.profile.dataDir, 'runtime.json'),
          (value) => value?.buildId === runtimeBuildIdForFlavor(input.candidateBuildId, 'production'),
          input.timeoutMs,
          () => childState(input.desktop.child, input.desktop.output())
        ),
        processExit.promise
      ])
      await runtimeJson(runtime, '/v1/runtime/info')
    } else {
      await poll(
        () => input.oldOwners.runtimes.every((entry) => !processIsAlive(entry.discovery.pid)),
        input.timeoutMs,
        'all predecessor Runtimes to exit with autoStart disabled'
      )
    }
    await poll(
      () => !processIsAlive(input.oldOwners.manager.discovery.pid),
      input.timeoutMs,
      'the predecessor Manager to exit'
    )
    return { manager, runtime }
  } finally {
    processExit.dispose()
  }
}

async function assertChatRoundTrip(runtime, workspaceRoot, timeoutMs) {
  const thread = await createSmokeThread(runtime, workspaceRoot, 'candidate chat round-trip')
  const turn = await startSmokeTurn(runtime, thread.id, 'return the deterministic fixture response')
  await waitForTurn(
    runtime,
    thread.id,
    turn.turnId,
    (value) => ['completed', 'failed', 'aborted'].includes(value.status),
    timeoutMs
  )
  const snapshot = await runtimeJson(runtime, `/v1/threads/${encodeURIComponent(thread.id)}`)
  if (!JSON.stringify(snapshot).includes(CHAT_MARKER)) {
    throw new Error('Candidate Runtime health passed but its chat round-trip did not complete')
  }
}

async function assertNoRuntimeDiscovery(profile) {
  for (const path of [
    join(profile.dataDir, 'runtime.json'),
    join(profile.controlDir, 'runtime.development.json')
  ]) {
    try {
      const record = JSON.parse(await readFile(path, 'utf8'))
      if (record && processIsAlive(record.pid)) {
        throw new Error(`autoStart=false left Runtime PID ${record.pid} alive`)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
  }
}

async function waitForChild(tracked, timeoutMs) {
  let timer
  const result = await Promise.race([
    new Promise((resolvePromise) => {
      tracked.child.once('exit', (code, signal) => resolvePromise({ code, signal }))
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out waiting for packaged handoff process')), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
  return { ...result, output: tracked.output() }
}

async function cleanupTracked(tracked) {
  const errors = []
  for (const entry of [...tracked].reverse()) {
    if (!entry?.child || entry.child.exitCode !== null || entry.child.signalCode !== null) continue
    await terminateProcessTree(entry.child, process.platform, { timeoutMs: 10_000 })
      .catch((error) => errors.push(error.message ?? String(error)))
  }
  return errors
}

async function cleanupProfile(root) {
  if (process.env.KUN_KEEP_PACKAGED_UPDATE_HANDOFF_SMOKE === '1') {
    process.stderr.write(`Preserved packaged update handoff profile: ${root.temporaryRoot}\n`)
    return
  }
  await makeTreeWritable(root.temporaryRoot).catch(() => undefined)
  await rm(root.temporaryRoot, { recursive: true, force: true })
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function requiredPath(name) {
  const value = argumentValue(name)
  if (!value) throw new Error(`${name} is required`)
  return resolve(value)
}

function optionalPath(name) {
  const value = argumentValue(name)
  return value ? resolve(value) : undefined
}

function positiveIntegerArgument(name, fallback) {
  const value = argumentValue(name)
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`)
  return number
}

module.exports = {
  FAILED_PREFIX,
  READY_PREFIX,
  assertNoRuntimeDiscovery,
  positiveIntegerArgument,
  waitForCurrentOwners
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
