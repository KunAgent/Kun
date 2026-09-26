import { rememberManagerStartupInput } from './runtime/kun-startup-manager-recovery'
import { desktopProcessStack } from './runtime/desktop-process-stack'
import { app } from 'electron'
import { spawnOwnedProcess, stopOwnedProcess } from '../../kun/src/process/owned-process.js'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  isKunRuntimeInsecure,
  getKunRuntimeSettings,
  getModelProviderSettings,
  resolveProviderProxyUrl,
  resolveKunRuntimeSettings,
  normalizeAppSettings,
  type ModelProviderProfileV1,
  type KunRuntimeSettingsV1, type AppSettingsV1
} from '../shared/app-settings'
import { normalizeWritePaperModeSettings } from '../shared/app-settings-paper-mode'
import {
  buildKunServeArgs,
  resolveKunExecutable,
  resolveKunRuntimeBuildId
} from './resolve-kun-binary'
import { resolveCodexOAuthApiKey } from './codex-auth'
import { ensureFreshGrokCredentials } from './grok-auth'
import { fetchWithOptionalProxy } from './proxy-fetch'
import {
  KunConfigSchema,
  type KunConfig,
  KunServeConfigSchema,
  ModelConfigSchema,
  ContextCompactionConfigSchema,
  QualityConfigSchema,
  RuntimeTuningConfigSchema,
  RolesConfigSchema
} from '../../kun/src/config/kun-config.js'
import { HooksConfigSchema } from '../../kun/src/hooks/hook-config.js'
import {
  AttachmentsCapabilityConfig,
  ComputerUseCapabilityConfig,
  ImageGenCapabilityConfig,
  InstructionsCapabilityConfig,
  McpCapabilityConfig,
  McpServerConfig,
  MemoryCapabilityConfig,
  MusicGenCapabilityConfig,
  SkillsCapabilityConfig,
  SpeechGenCapabilityConfig,
  SubagentsCapabilityConfig,
  VideoGenCapabilityConfig,
  WebCapabilityConfig
} from '../../kun/src/contracts/capabilities.js'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { defaultKunDataDir } from './runtime/kun-adapter'
import { resolveClaudeBinary } from './agent-sdk-installer'
import type { KunUnexpectedExitInfo } from './runtime/kun-process-controller'
import {
  waitForKunStartup
} from './runtime/kun-runtime-health-monitor'
import {
  contextCompactionConfigForRuntime,
  modelConfigForRuntime,
  providersConfigForRuntime,
  rolesConfigForRuntime,
  storageConfigForRuntime,
  tokenEconomyConfigForRuntime,
  toolOutputLimitsConfigForRuntime
} from './runtime/kun-runtime-model-config'
import {
  computerUseConfigForRuntime,
  imageGenConfigForRuntime,
  musicGenConfigForRuntime,
  qualityConfigForRuntime,
  runtimeTuningConfigForRuntime,
  speechGenConfigForRuntime,
  videoGenConfigForRuntime
} from './runtime/kun-runtime-capability-config'
import {
  KUN_BROWSER_USE_APPROVAL_SIGNING_KEY_ENV,
  KUN_BROWSER_USE_BRIDGE_TOKEN_ENV,
  KUN_BROWSER_USE_BRIDGE_URL_ENV
} from '../../kun/src/contracts/browser-use.js'
import { prepareBrowserUseHostForKunLaunch } from './browser-use/browser-use-host'
import {
  KUN_COMPUTER_USE_BRIDGE_TOKEN_ENV,
  KUN_COMPUTER_USE_BRIDGE_URL_ENV
} from '../../kun/src/contracts/computer-use-bridge.js'
import { prepareComputerUseHostForKunLaunch } from './computer-use/computer-use-host'
import {
  buildGuiScheduleKunMcpServer,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  readGuiManagedMcpServers,
  readJsonObjectIfExists,
  skillCapabilityConfigForRuntime
} from './runtime/kun-runtime-mcp-config'
import { availableBundledExtensionsDirectory } from './bundled-extension-resources'
import { bundledSkillsDirectory } from './bundled-skill-resources'
import { resolveOfficeCliBinary } from './officecli-resources'
import { subagentProfilesForRuntime } from './runtime/kun-runtime-subagent-config'
import { syncGuiManagedKunConfig } from './runtime/kun-runtime-config-service'
import { assertManagedKunDataDirIsCurrent } from './kun-data-dir-paths'
import {
  ensureSharedRuntime,
  resolveSharedRuntime,
  type SharedRuntimeConnection
} from '../../kun/src/cli/shared-runtime.js'
import { withClientOwnedRuntimeElection } from '../../kun/src/cli/client-owned-runtime.js'
import {
  allowsDevelopmentManagerBootstrap,
  resolveCliRuntimeFlavor
} from '../../kun/src/cli/runtime-flavor.js'
import { KUN_RUNTIME_CLIENT_OWNER_KIND_ENV } from '../../kun/src/contracts/runtime-owner.js'
import {
  ensureServiceManager,
  type LegacyRuntimeHandoverStatus,
  type ServiceManagerConnection
} from '../../kun/src/manager/manager-client.js'
import {
  defaultKunControlDir
} from '../../kun/src/manager/manager-discovery.js'
import { configureManagerAtomicJsonClient } from '../../kun/src/extensions/atomic-json.js'
import { kunManagerLaunchEnvironment } from './runtime/kun-manager-launch-environment'
import { handoffExistingKunServiceManagerForDataDir } from './runtime/service-manager-build-handoff'
import type { HandoffEventListener } from './runtime/kun-handoff-events'
import { assertSupportedSettingsVersion } from './settings-store-foundation'

import {
  appendTail,
  createKunChildLogCapture,
  normalizeCapturedChunk,
  processController,
  waitForKunChildExit
} from './kun-process-state'

export {
  parseListeningPidsFromNetstat,
  reclaimKunPort,
  resolveAvailableKunPort
} from './kun-process-ports'

export { subagentProfilesForRuntime } from './runtime/kun-runtime-subagent-config'
export { syncGuiManagedKunConfig } from './runtime/kun-runtime-config-service'

export type { KunUnexpectedExitInfo } from './runtime/kun-process-controller'
export { resolveKunStartupTimeoutMs } from './runtime/kun-runtime-health-monitor'
export { handoffExistingKunServiceManagerForDataDir } from './runtime/service-manager-build-handoff'
export { preparePackagedKunBuildHandoff } from './runtime/kun-packaged-build-handoff'

let serviceManagerSettingsPath: string | undefined
let mainManagerBinding: ServiceManagerConnection | undefined

/** Read-only authority selection performed before the Manager opens settings. */
export async function resolveKunManagerDataDirFromSettings(
  settingsPath: string
): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultKunDataDir()
    assertSupportedSettingsVersion(parsed, settingsPath)
    const settings = normalizeAppSettings(parsed as AppSettingsV1)
    return resolveKunDataDir(resolveKunRuntimeSettings(settings))
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' || error instanceof SyntaxError) {
      return defaultKunDataDir()
    }
    throw error
  }
}

export async function ensureKunServiceManager(input: {
  dataDir?: string
  settingsPath: string
  onLegacyHandoverStatus?: (status: LegacyRuntimeHandoverStatus) => void
  onHandoffEvent?: HandoffEventListener
}): Promise<ServiceManagerConnection> {
  desktopProcessStack.assertCanStart()
  serviceManagerSettingsPath = input.settingsPath
  const dataDir = input.dataDir ?? defaultKunDataDir()
  const resolution = resolveKunExecutable(appRoot(), '')
  const serveEntry = resolution.args[0]
  if (!serveEntry || !existsSync(serveEntry)) {
    throw new Error(
      `Kun Service Manager build is missing next to ${serveEntry || 'the bundled runtime entry'}. Run \`npm run build:kun\` first.`
    )
  }
  const buildId = await resolveKunRuntimeBuildId(resolution)
  const managerEntry = join(dirname(serveEntry), '..', 'manager', 'manager-entry.js')
  const flavor = resolveCliRuntimeFlavor({ env: process.env })
  const controlDir = process.env.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir()
  const managerInput = {
    flavor,
    controlDir,
    allowDevelopmentBootstrap: true,
    ...(buildId ? { buildId } : {}),
    dataDir,
    settingsPath: input.settingsPath,
    launch: {
      command: resolveNodeScriptCommand(process.execPath),
      args: [managerEntry],
      runAsNode: true
    },
    ...(input.onLegacyHandoverStatus ? { onLegacyHandoverStatus: input.onLegacyHandoverStatus } : {})
  }
  rememberManagerStartupInput(managerInput)
  const manager = await desktopProcessStack.ensureManager(managerInput)
  return configureKunManagerDataPlaneForCurrentProcess(manager)
}

/**
 * Makes Main-process AtomicJson consumers join the Manager-owned data plane.
 * This must run before constructing a Main Registry or credential store.
 */
export function configureKunManagerDataPlaneForCurrentProcess(
  manager: ServiceManagerConnection
): ServiceManagerConnection {
  if (mainManagerBinding) mainManagerBinding.discovery = manager.discovery
  else mainManagerBinding = { discovery: manager.discovery }
  configureManagerAtomicJsonClient({
    baseUrl: mainManagerBinding.discovery.baseUrl,
    token: mainManagerBinding.discovery.managerToken,
    dataDir: mainManagerBinding.discovery.dataDir
  })
  return mainManagerBinding
}

/** Current Main-owned Manager binding for authoritative Runtime discovery. */
export function getKunServiceManagerBinding(): ServiceManagerConnection | undefined {
  return mainManagerBinding
}

/**
 * Called when a READY kun child exits without the GUI asking for it.
 * Startup failures are excluded: those are already reported to the
 * caller of startKunChild via the thrown error.
 */
export function setKunUnexpectedExitHandler(
  handler: ((info: KunUnexpectedExitInfo) => void) | null
): void {
  processController.setUnexpectedExitHandler(handler)
}

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

export function resolveKunExecutableForCurrentApp(): ReturnType<typeof resolveKunExecutable> {
  return resolveKunExecutable(appRoot(), '')
}

function resolveNodeScriptCommand(command: string): string {
  if (command !== process.execPath) return command
  if (process.platform !== 'darwin') return command
  return resolveClawScheduleMcpCommand({
    appPath: app.getAppPath(),
    execPath: command,
    isPackaged: app.isPackaged
  })
}
export function resolveKunDataDir(runtime: { dataDir: string }): string {
  const trimmed = runtime.dataDir?.trim()
  const dataDir = trimmed ? expandHomePath(trimmed) : defaultKunDataDir()
  assertManagedKunDataDirIsCurrent(dataDir)
  return dataDir
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2).replace(/\\/g, '/'))
  }
  return path
}
export function isKunChildRunning(): boolean {
  return processController.isRunning()
}
function isCurrentKunChildPid(pid: number): boolean {
  return processController.isCurrentPid(pid)
}

/**
 * Resolve once any in-flight kun launch has settled — whether it became
 * ready or failed. The settings/MCP-apply paths use this to avoid
 * SIGTERM-ing a child that is still inside its (deliberately generous)
 * startup window: interrupting a slow-but-healthy boot only restarts the
 * clock and is what turns one slow start into the #544 restart storm.
 *
 * Deadlock-safe by construction: `kunStartPromise` is only set once a launch
 * has already passed the settings-apply gate, so an apply that awaits it can
 * never be the thing that launch is itself waiting on.
 */
export function waitForKunStartupSettled(): Promise<void> {
  return processController.waitForStartupSettled()
}

export function startKunChild(settings: AppSettingsV1): Promise<void> {
  desktopProcessStack.assertCanStart()
  return processController.start(async () => {
    desktopProcessStack.assertCanStart()
    const manager = await desktopProcessStack.recoverManager(() => stopKunChildAndWait())
    if (manager) configureKunManagerDataPlaneForCurrentProcess(manager)
    const runtime = resolveKunRuntimeSettings(settings)
    if (isKunChildRunning() || !runtime.autoStart) return
    const dataDir = resolveKunDataDir(runtime)
    const runtimeFlavor = resolveCliRuntimeFlavor({ env: process.env })
    await withClientOwnedRuntimeElection({
      dataDir,
      runtimeFlavor,
      ownerKind: 'gui',
      ...(mainManagerBinding ? { manager: mainManagerBinding } : {})
    }, async (scope) => {
      desktopProcessStack.assertCanStart()
      if (scope.manager) configureKunManagerDataPlaneForCurrentProcess(scope.manager)
      await startKunChildOnce(settings, runtime)
    })
  })
}

/**
 * Legacy detached-launch compatibility helper. Normal GUI and TUI lifecycle
 * paths must use their client-owned launchers and must not attach through this
 * function.
 */
export async function startKunSharedRuntime(
  settings: AppSettingsV1,
  options: { forceReplace?: boolean } = {}
): Promise<SharedRuntimeConnection | null> {
  const runtime = resolveKunRuntimeSettings(settings)
  if (!runtime.autoStart) return null
  const dataDir = resolveKunDataDir(runtime)
  const runtimeFlavor = resolveCliRuntimeFlavor({ env: process.env })
  if (await hasUnpublishedKunWriter(runtime, dataDir, runtimeFlavor)) {
    throw new Error(
      'An older GUI-private Kun runtime is already writing this data directory without shared discovery. Close or update that GUI once before starting the shared runtime.'
    )
  }
  // A shared runtime is elected under the data-directory start lock. Let the
  // elected server bind an ephemeral loopback port and publish the real
  // port/token through discovery instead of treating the GUI preference as a
  // live connection contract.
  const launch = await prepareKunLaunch(settings, runtime, { port: 0 })
  const serveEntry = launch.args.find((argument) => /serve-entry\.js$/u.test(argument))
  if (!serveEntry) throw new Error('Kun service-manager entry could not be resolved from the runtime launch')
  const managerEntry = join(dirname(serveEntry), '..', 'manager', 'manager-entry.js')
  const discoveredManager = await ensureServiceManager({
    flavor: runtimeFlavor,
    allowDevelopmentBootstrap: allowsDevelopmentManagerBootstrap({
      flavor: runtimeFlavor,
      env: process.env,
      isPackaged: app.isPackaged
    }),
    dataDir: launch.dataDir,
    ...(serviceManagerSettingsPath ? { settingsPath: serviceManagerSettingsPath } : {}),
    launch: {
      command: resolveNodeScriptCommand(process.execPath),
      args: [managerEntry],
      runAsNode: true
    }
  })
  const manager = configureKunManagerDataPlaneForCurrentProcess(discoveredManager)
  return ensureSharedRuntime({
    dataDir: launch.dataDir,
    runtimeFlavor,
    manager,
    ...(launch.expectedBuildId ? { expectedBuildId: launch.expectedBuildId } : {}),
    ...(options.forceReplace ? { forceReplace: true } : {}),
    launch: {
      command: launch.command,
      args: launch.args,
      env: launch.env,
      runAsNode: launch.runAsNode
    }
  })
}

async function hasUnpublishedKunWriter(
  runtime: KunRuntimeSettingsV1,
  dataDir: string,
  runtimeFlavor = resolveCliRuntimeFlavor({ env: process.env })
): Promise<boolean> {
  if (await resolveSharedRuntime(dataDir, fetch, { runtimeFlavor }).catch(() => null)) return false
  try {
    const headers = new Headers()
    if (runtime.runtimeToken.trim()) {
      headers.set('authorization', `Bearer ${runtime.runtimeToken.trim()}`)
    }
    const response = await fetch(`http://127.0.0.1:${runtime.port}/v1/runtime/info`, {
      headers,
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return false
    const body = await response.json() as { dataDir?: unknown }
    return typeof body.dataDir === 'string' && sameRuntimePath(body.dataDir, dataDir)
  } catch {
    return false
  }
}

function sameRuntimePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

type PreparedKunLaunch = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  dataDir: string
  runAsNode: boolean
  expectedBuildId?: string
}

async function prepareKunLaunch(
  settings: AppSettingsV1,
  runtime: KunRuntimeSettingsV1,
  options: { port?: number } = {}
): Promise<PreparedKunLaunch> {
  const root = appRoot()
  const resolution = resolveKunExecutable(root, runtime.binaryPath)
  if (resolution.command === process.execPath && !existsSync(resolution.args[0])) {
    throw new Error(
      `Kun runtime build is missing at ${resolution.args[0]}. Run \`npm run build:kun\` before starting the GUI.`
    )
  }
  const expectedBuildId = await resolveKunRuntimeBuildId(resolution)
  const dataDir = resolveKunDataDir(runtime)
  await syncGuiManagedKunConfig(dataDir, runtime, {
    scheduleMcp: {
      settings,
      launch: {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
    },
    builtinSkillsRoot: bundledSkillsDirectory()
  })
  processController.lastResolvedBinary = resolution.command === process.execPath
    ? resolution.args.join(' ')
    : resolution.command
  const args = buildKunServeArgs({
    resolution,
    host: '127.0.0.1',
    port: options.port ?? runtime.port,
    dataDir,
    approvalPolicy: runtime.approvalPolicy,
    sandboxMode: runtime.sandboxMode,
    approvalReviewer: runtime.approvalReviewer,
    tokenEconomyMode: runtime.tokenEconomyMode,
    insecure: isKunRuntimeInsecure(runtime)
  })
  const command = resolveNodeScriptCommand(resolution.command)
  const runtimeApiKey = (await ensureFreshGrokCredentials(runtime.apiKey, {
    fetcher: fetchWithOptionalProxy,
    proxyUrl: resolveProviderProxyUrl(settings, runtime.providerId)
  })).apiKey
  const defaultClientApiKey = resolveCodexOAuthApiKey(runtimeApiKey).apiKey
  const activeProviderKind = (getModelProviderSettings(settings).providers as ModelProviderProfileV1[]).find(
    (provider) => provider.id?.trim() === getKunRuntimeSettings(settings).providerId.trim()
  )?.kind
  const claudeBinary = resolveClaudeBinary(app.getPath('userData'), [join(appRoot(), 'kun')])
  const officeCliBinary = resolveOfficeCliBinary({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: root,
    explicitPath: process.env.KUN_OFFICECLI_BINARY
  })
  const pptToolchainDirectory = app.isPackaged
    ? join(process.resourcesPath, 'ppt-toolchain')
    : resolve(root, 'resources', 'ppt-toolchain')
  const browserUseBridge = await prepareBrowserUseHostForKunLaunch(settings)
  const computerUseBridge = runtime.computerUse.enabled
    ? await prepareComputerUseHostForKunLaunch()
    : undefined
  const paperSearch = normalizeWritePaperModeSettings(settings.write?.paperMode)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...kunManagerLaunchEnvironment({
      manager: mainManagerBinding,
      controlDir: process.env.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir(),
      settingsPath: serviceManagerSettingsPath
    }),
    DEEPSEEK_API_KEY: defaultClientApiKey || process.env.DEEPSEEK_API_KEY || '',
    // Paper-search credentials: env passes them to `kun serve` without touching kun.config.json.
    KUN_SEMANTIC_SCHOLAR_API_KEY:
      paperSearch.search.semanticScholarApiKey || paperSearch.scholar.semanticScholarApiKey || process.env.KUN_SEMANTIC_SCHOLAR_API_KEY || '',
    KUN_CORE_API_KEY: paperSearch.search.coreApiKey || process.env.KUN_CORE_API_KEY || '',
    KUN_OPENALEX_MAILTO: paperSearch.search.openAlexMailto || paperSearch.scholar.crossrefMailto || '',
    KUN_UNPAYWALL_EMAIL: paperSearch.search.unpaywallEmail || '',
    KUN_PPT_TOOLCHAIN_DIR: pptToolchainDirectory,
    ...(activeProviderKind ? { KUN_RUNTIME_PROVIDER_KIND: activeProviderKind } : {}),
    ...(claudeBinary ? { KUN_CLAUDE_BINARY: claudeBinary } : {}),
    ...(officeCliBinary ? { KUN_OFFICECLI_BINARY: officeCliBinary } : {}),
    ...(browserUseBridge
      ? {
          [KUN_BROWSER_USE_BRIDGE_URL_ENV]: browserUseBridge.url,
          [KUN_BROWSER_USE_BRIDGE_TOKEN_ENV]: browserUseBridge.token,
          [KUN_BROWSER_USE_APPROVAL_SIGNING_KEY_ENV]:
            browserUseBridge.approvalSigningKey
        }
      : {}),
    ...(computerUseBridge
      ? {
          [KUN_COMPUTER_USE_BRIDGE_URL_ENV]: computerUseBridge.url,
          [KUN_COMPUTER_USE_BRIDGE_TOKEN_ENV]: computerUseBridge.token
        }
      : {})
  }
  if (!browserUseBridge) {
    delete env[KUN_BROWSER_USE_BRIDGE_URL_ENV]
    delete env[KUN_BROWSER_USE_BRIDGE_TOKEN_ENV]
    delete env[KUN_BROWSER_USE_APPROVAL_SIGNING_KEY_ENV]
  }
  if (!computerUseBridge) {
    delete env[KUN_COMPUTER_USE_BRIDGE_URL_ENV]
    delete env[KUN_COMPUTER_USE_BRIDGE_TOKEN_ENV]
  }
  const bundledExtensionsDirectory = availableBundledExtensionsDirectory({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: root
  })
  if (bundledExtensionsDirectory) env.KUN_BUNDLED_EXTENSIONS_DIR = bundledExtensionsDirectory
  env.ELECTRON_RUN_AS_NODE = '1'
  return {
    command,
    args,
    env,
    dataDir,
    runAsNode: true,
    ...(expectedBuildId ? { expectedBuildId } : {})
  }
}

async function startKunChildOnce(
  settings: AppSettingsV1,
  runtime: KunRuntimeSettingsV1
): Promise<void> {
  if (processController.logCapture) {
    await processController.logCapture.close()
    processController.logCapture = null
  }
  const launch = await prepareKunLaunch(settings, runtime)
  desktopProcessStack.assertCanStart()
  const startedChild = await spawnOwnedProcess(launch.command, launch.args, {
    env: {
      ...launch.env,
      KUN_RUNTIME_TOKEN: runtime.runtimeToken,
      KUN_RUNTIME_LAUNCH_MODE: 'gui',
      [KUN_RUNTIME_CLIENT_OWNER_KIND_ENV]: 'gui'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    ownerLossGraceMs: 20_000
  })
  processController.child = startedChild
  try { desktopProcessStack.assertCanStart() } catch (error) {
    await stopOwnedProcess(startedChild, { graceMs: 0, timeoutMs: 3_000 })
    processController.clearChild(startedChild)
    throw error
  }
  startedChild.channel?.unref()
  processController.childPort = runtime.port
  const startedLogCapture = createKunChildLogCapture(startedChild.pid)
  processController.logCapture = startedLogCapture
  processController.stderrTail = ''
  startedLogCapture.logLifecycle(`spawned on port ${runtime.port} using data dir ${launch.dataDir}`)
  startedChild.stdout?.on('data', startedLogCapture.captureStdout)
  startedChild.stderr?.on('data', (chunk: Buffer | string) => {
    processController.stderrTail = appendTail(
      processController.stderrTail,
      normalizeCapturedChunk(chunk)
    )
    startedLogCapture.captureStderr(chunk)
  })
  startedChild.on('exit', (code, signal) => {
    startedLogCapture.logLifecycle(
      signal
        ? `exited with signal ${signal}`
        : `exited with code ${code ?? 'unknown'}`
    )
    void startedLogCapture.close()
    processController.clearChild(startedChild)
    if (processController.shouldReportUnexpectedExit(startedChild)) {
      processController.reportUnexpectedExit({
        code: code ?? null,
        signal: signal ?? null,
        stderrTail: processController.stderrTail
      })
    }
  })
  startedChild.on('error', (error) => {
    startedLogCapture.logLifecycle(
      `process error: ${error instanceof Error ? error.message : String(error)}`
    )
  })
  try {
    await waitForKunStartup(startedChild, runtime.port)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    startedLogCapture.logLifecycle(`startup failed before ready: ${message}`)
    if (processController.child === startedChild) {
      await stopKunChildAndWait()
    }
    throw error
  }
  processController.markReady(startedChild)
  startedLogCapture.logLifecycle(`ready marker received on port ${runtime.port}`)
}

export async function stopKunChildAndWait(options: { deadline?: number } = {}): Promise<void> {
  if (!processController.child) {
    if (processController.logCapture) {
      const capture = processController.logCapture
      processController.logCapture = null
      await capture.close()
    }
    return
  }
  const stoppingChild = processController.child
  processController.markIntentionalStop(stoppingChild)
  const capture = processController.logCapture
  const deadline = options.deadline ?? Date.now() + 15_000
  if (stoppingChild.exitCode === null && stoppingChild.signalCode === null) {
    try {
      if (stoppingChild.connected) {
        stoppingChild.send({ type: 'kun-runtime-stop' }, () => undefined)
      }
      if (process.platform !== 'win32') stoppingChild.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  await waitForKunChildExit(stoppingChild, Math.max(0, Math.min(10_000, deadline - Date.now() - 1_000)))
  // A direct child's exit is not proof that its shell/helper descendants died.
  await stopOwnedProcess(stoppingChild, { graceMs: 0, timeoutMs: Math.max(1, deadline - Date.now()) })
  processController.clearChild(stoppingChild)
  if (capture) {
    processController.logCapture = null
    await capture.close()
  }
}
