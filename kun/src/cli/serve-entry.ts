#!/usr/bin/env node
import process from 'node:process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseServeOptionsSafe, SERVE_USAGE, ServeExitCode } from './serve.js'
import {
  KUN_CLI_USAGE,
  runAgentCommand,
  splitKunCliCommand
} from './agent-cli.js'
import { startKunServe, type KunServeHandle } from '../server/runtime-factory.js'
import {
  resolveEventLoopHardStallThresholdMs,
  resolveEventLoopStallThresholdMs,
  startEventLoopMonitor
} from '../server/event-loop-monitor.js'
import { installServeCrashHandlers } from './serve-crash-handlers.js'
import { runExtensionCommand } from './extension-cli.js'
import { inspectSharedRuntime, resolveSharedRuntime, runRuntimeCommand } from './shared-runtime.js'
import { withRuntimeStartLock } from '../server/runtime-discovery.js'
import { RuntimeBuildIdSchema } from '../contracts/runtime-info.js'
import { readRuntimeBuildIdForEntry } from '../server/runtime-build-identity.js'
import { KUN_VERSION } from '../version.js'
import { runSelfUpdateCommand } from './self-update.js'
import { RuntimeFlavorSchema } from '../contracts/runtime-flavor.js'
import {
  KUN_RUNTIME_CLIENT_OWNER_KIND_ENV,
  RuntimeClientOwnerKindSchema
} from '../contracts/runtime-owner.js'
import {
  monitorRuntimeClientOwnerChannel,
  type RuntimeClientOwnerMonitor
} from './client-owner-channel.js'
import { runtimeDiscoveryDirectory } from './shared-runtime.js'
import { defaultKunControlDir } from '../manager/manager-discovery.js'
import {
  ManagerRuntimeSlotBusyError,
  registerRuntimeWithManager,
  ensureServiceManager,
  resolveServiceManager,
  unregisterRuntimeWithManager,
  heartbeatRuntimeWithManager
} from '../manager/manager-client.js'
import {
  allowsDevelopmentManagerBootstrap,
  resolveCliRuntimeFlavor,
  runtimeBuildIdForFlavor
} from './runtime-flavor.js'
import { settleCleanupBeforeDeadline } from '../server/runtime-factory-cleanup.js'
import { installLiveProcessLog } from './live-process-log.js'

export const KUN_READY_PREFIX = 'KUN_READY '
// Replacement clients wait 15 seconds before escalating to a hard kill. Keep
// the in-process deadline shorter so serve mode can still exit on its own when
// an adapter's graceful cleanup never settles.
const SERVE_SHUTDOWN_TIMEOUT_MS = 10_000

/**
 * Serve-mode command. Kept separate from the dispatcher so GUI startup
 * still has the exact same KUN_READY handshake behavior.
 */
async function serveMain(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(SERVE_USAGE)
    return ServeExitCode.ok
  }
  const parsed = parseServeOptionsSafe(argv, process.env)
  if (!parsed.ok) {
    process.stderr.write(`kun serve: ${parsed.message}\n`)
    if (parsed.issues) {
      process.stderr.write(`${JSON.stringify(parsed.issues, null, 2)}\n`)
    }
    return parsed.exitCode
  }
  const launchModeValue = process.env.KUN_RUNTIME_LAUNCH_MODE
  const launchMode = launchModeValue === 'shared' || launchModeValue === 'gui'
    ? launchModeValue
    : 'foreground'
  const runtimeFlavor = RuntimeFlavorSchema.parse(
    process.env.KUN_RUNTIME_FLAVOR?.trim() || 'production'
  )
  const ownerKindValue = process.env[KUN_RUNTIME_CLIENT_OWNER_KIND_ENV]?.trim()
  const ownerKind = ownerKindValue
    ? RuntimeClientOwnerKindSchema.parse(ownerKindValue)
    : undefined
  let ownerMonitor: RuntimeClientOwnerMonitor | undefined
  if (ownerKind) {
    try {
      ownerMonitor = monitorRuntimeClientOwnerChannel(ownerKind)
    } catch (error) {
      process.stderr.write(
        `kun serve: ${error instanceof Error ? error.message : String(error)}\n`
      )
      return ServeExitCode.runtime
    }
  }
  const controlDir = process.env.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir()
  const discoveryDir = process.env.KUN_RUNTIME_DISCOVERY_DIR?.trim() ||
    runtimeDiscoveryDirectory(parsed.options.dataDir, runtimeFlavor, controlDir)
  const manifestBuildId = await readRuntimeBuildIdForEntry(import.meta.url)
  const environmentBuildId = RuntimeBuildIdSchema.safeParse(
    process.env.KUN_RUNTIME_BUILD_ID?.trim()
  )
  const buildId = runtimeBuildIdForFlavor(
    manifestBuildId ?? (environmentBuildId.success ? environmentBuildId.data : undefined),
    runtimeFlavor
  )
  const allowDevelopmentBootstrap = allowsDevelopmentManagerBootstrap({
    flavor: runtimeFlavor,
    env: process.env
  })
  const manager = await ensureServiceManager({
    flavor: runtimeFlavor,
    allowDevelopmentBootstrap,
    ...(buildId ? { buildId } : {}),
    controlDir,
    dataDir: parsed.options.dataDir,
    ...(process.env.KUN_MANAGER_SETTINGS_PATH?.trim()
      ? { settingsPath: process.env.KUN_MANAGER_SETTINGS_PATH.trim() }
      : {})
  })
  process.env.KUN_MANAGER_BASE_URL = manager.discovery.baseUrl
  process.env.KUN_MANAGER_TOKEN = manager.discovery.managerToken
  process.env.KUN_MANAGER_DATA_DIR = manager.discovery.dataDir
  const start = async (): Promise<
    { kind: 'existing'; existing: NonNullable<Awaited<ReturnType<typeof resolveSharedRuntime>>> } |
    { kind: 'started'; server: KunServeHandle }
  > => {
    const inspected = await inspectSharedRuntime(parsed.options.dataDir, fetch, {
      runtimeFlavor,
      controlDir,
      manager
    })
    const existing = inspected?.connection ?? null
    if (existing) return { kind: 'existing', existing }
    if (inspected) {
      throw new Error(
        `Kun shared runtime process ${inspected.discovery.pid} is still alive but is not responding; ` +
        'preserving the manager owner instead of starting a second runtime'
      )
    }
    return {
      kind: 'started',
      server: await startKunServe({
        ...parsed.options,
        launchMode,
        runtimeFlavor,
        ...(ownerKind ? { clientOwnerKind: ownerKind } : {}),
        discoveryDir,
        serviceManager: manager,
        ...(buildId ? { buildId } : {}),
        sharedMcpConfigPath: process.env.KUN_MCP_CONFIG_PATH || join(homedir(), '.kun', 'mcp.json'),
        ...(process.env.KUN_RUNTIME_LOG_PATH ? { logPath: process.env.KUN_RUNTIME_LOG_PATH } : {})
      })
    }
  }
  // Detached startup is already elected by the parent shared-runtime manager.
  // Foreground `kun serve` performs the same data-dir election itself.
  const elected = launchMode === 'foreground'
    ? await withRuntimeStartLock(discoveryDir, start, runtimeFlavor)
    : await start()
  if (elected.kind === 'existing') {
    process.stderr.write(
      `kun serve: runtime already running at ${elected.existing.discovery.baseUrl} (PID ${elected.existing.discovery.pid}); ` +
      'use `kun runtime stop` first or choose another --data-dir.\n'
    )
    return ServeExitCode.runtime
  }
  let handle: KunServeHandle | null = null
  installServeCrashHandlers(() => handle)
  const server = elected.server
  handle = server
  process.title = runtimeFlavor === 'development' ? 'kun-dv-runtime' : 'kun-runtime'
  const info = server.runtime.info()
  let managerHeartbeat: ReturnType<typeof setInterval> | null = null
  const registration = {
    flavor: runtimeFlavor,
    instanceId: server.instanceId,
    pid: process.pid,
    startedAt: info.startedAt,
    host: server.host,
    port: server.port,
    baseUrl: `http://${server.host}:${server.port}`,
    runtimeToken: parsed.options.runtimeToken,
    ...(ownerKind ? { clientOwnerKind: ownerKind } : {}),
    ...(buildId ? { buildId } : {}),
    ...(process.env.KUN_RUNTIME_LOG_PATH ? { logPath: process.env.KUN_RUNTIME_LOG_PATH } : {})
  }
  let ownershipShutdownSignaled = false
  let requestOwnershipShutdown!: () => void
  const ownershipShutdownRequested = new Promise<void>((resolve) => {
    requestOwnershipShutdown = resolve
  })
  const signalOwnershipShutdown = (ownerInstanceId?: string): void => {
    if (ownershipShutdownSignaled) return
    ownershipShutdownSignaled = true
    process.stderr.write(
      `kun serve: ${runtimeFlavor} runtime registration is owned by ` +
      `${ownerInstanceId ?? 'another instance'}; stopping duplicate PID ${process.pid}.\n`
    )
    requestOwnershipShutdown()
  }
  let managerRecovery: Promise<void> | null = null
  const applyManagerConnection = (connection: typeof manager): void => {
    manager.discovery = connection.discovery
    process.env.KUN_MANAGER_BASE_URL = connection.discovery.baseUrl
    process.env.KUN_MANAGER_TOKEN = connection.discovery.managerToken
    process.env.KUN_MANAGER_DATA_DIR = connection.discovery.dataDir
  }
  const recoverManagerConnection = async (): Promise<void> => {
    let recovered = await resolveServiceManager(controlDir)
    if (!recovered && (runtimeFlavor === 'production' || allowDevelopmentBootstrap)) {
      recovered = await ensureServiceManager({
        flavor: runtimeFlavor,
        allowDevelopmentBootstrap,
        controlDir,
        dataDir: parsed.options.dataDir,
        settingsPath: manager.discovery.settingsPath
      })
    }
    if (!recovered) throw new Error('Kun Service Manager is unavailable')
    applyManagerConnection(recovered)
    await registerRuntimeWithManager({ manager, registration })
  }
  const heartbeatManager = async (): Promise<void> => {
    try {
      const accepted = await heartbeatRuntimeWithManager({
        manager,
        flavor: runtimeFlavor,
        instanceId: server.instanceId
      })
      if (!accepted) {
        signalOwnershipShutdown()
        return
      }
    } catch (error) {
      if (error instanceof ManagerRuntimeSlotBusyError) {
        signalOwnershipShutdown(error.owner.instanceId)
        return
      }
      if (!managerRecovery) {
        managerRecovery = recoverManagerConnection().finally(() => { managerRecovery = null })
      }
      try {
        await managerRecovery
      } catch (recoveryError) {
        if (recoveryError instanceof ManagerRuntimeSlotBusyError) {
          signalOwnershipShutdown(recoveryError.owner.instanceId)
          return
        }
        throw recoveryError
      }
    }
  }
  try {
    await registerRuntimeWithManager({
      manager,
      registration
    })
    managerHeartbeat = setInterval(() => {
      void heartbeatManager().catch(() => undefined)
    }, 5_000)
    managerHeartbeat.unref?.()
  } catch (error) {
    await server.close().catch(() => undefined)
    throw error
  }
  // The startup bridge refreshed this registration immediately before
  // discovery publication. Install steady liveness before self-verification
  // so even a slow local health probe cannot reopen a heartbeat gap.
  await selfVerifyHealth(server.host, server.port)
  const startupInfo = {
    service: 'kun',
    mode: 'serve',
    host: server.host,
    port: server.port,
    configPath: info.configPath,
    dataDir: info.dataDir,
    model: info.model,
    approvalPolicy: info.approvalPolicy,
    sandboxMode: info.sandboxMode,
    approvalReviewer: info.approvalReviewer,
    insecure: info.insecure,
    instanceId: info.instanceId ?? server.instanceId,
    ...(info.buildId ? { buildId: info.buildId } : {}),
    startedAt: info.startedAt,
    pid: info.pid,
    message: `kun runtime listening on http://${server.host}:${server.port}`
  }
  process.stdout.write(`${KUN_READY_PREFIX}${JSON.stringify(startupInfo)}\n`)
  process.stdout.write(JSON.stringify(startupInfo, null, 2) + '\n')
  // Watch for event-loop stalls so a hang that starves /health (and trips the
  // GUI watchdog) is attributable to CPU starvation vs a hard deadlock (#621).
  // Attach non-sensitive identity so multi-instance log streams stay traceable.
  const loopMonitor = startEventLoopMonitor({
    stallThresholdMs: resolveEventLoopStallThresholdMs(process.env),
    hardStallThresholdMs: resolveEventLoopHardStallThresholdMs(process.env),
    context: () => {
      const counters = server.runtime.liveCounters?.()
      return [
        `instance ${startupInfo.instanceId}`,
        ...(startupInfo.buildId ? [`build ${startupInfo.buildId.slice(0, 12)}`] : []),
        ...(counters
          ? [`active inflight ${counters.inflight}`, `active captures ${counters.activeCaptures}`]
          : [])
      ]
    }
  })
  await new Promise<void>((resolve) => {
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      if (managerHeartbeat) clearInterval(managerHeartbeat)
      loopMonitor.stop()
      // Keep the manager slot owned until the server has closed its stores and
      // released filesystem handles. A concurrent client must not elect a
      // replacement in the gap between unregister and process teardown.
      void settleCleanupBeforeDeadline(
        () => server.close().finally(() => unregisterRuntimeWithManager({
          manager,
          flavor: runtimeFlavor,
          instanceId: server.instanceId
        })),
        SERVE_SHUTDOWN_TIMEOUT_MS
      ).then((closed) => {
        if (!closed) {
          process.stderr.write(
            `kun serve: graceful shutdown exceeded ${SERVE_SHUTDOWN_TIMEOUT_MS}ms; forcing process exit\n`
          )
        }
      }).catch((error) => {
        process.stderr.write(
          `kun serve: failed to close runtime cleanly: ${error instanceof Error ? error.message : String(error)}\n`
        )
      }).finally(resolve)
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    void server.shutdownRequested.then(stop)
    void ownershipShutdownRequested.then(stop)
    if (ownerMonitor) void ownerMonitor.disconnected.then(stop)
  })
  ownerMonitor?.dispose()
  return ServeExitCode.ok
}

const SELF_VERIFY_TIMEOUT_MS = 5_000
const SELF_VERIFY_POLL_MS = 100

async function selfVerifyHealth(host: string, port: number): Promise<void> {
  const url = `http://${host}:${port}/health`
  const deadline = Date.now() + SELF_VERIFY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(1_000)
      })
      if (res.ok) {
        const body = (await res.json()) as { status?: string }
        if (body?.status === 'ok') return
      }
    } catch {
      // retry
    }
    await new Promise<void>((r) => setTimeout(r, SELF_VERIFY_POLL_MS))
  }
  process.stderr.write(
    `[kun] warning: self-health-probe on http://${host}:${port}/health did not pass within ${SELF_VERIFY_TIMEOUT_MS}ms — proceeding anyway\n`
  )
}

export async function main(argv: readonly string[]): Promise<number> {
  process.env.KUN_RUNTIME_FLAVOR = resolveCliRuntimeFlavor({
    env: process.env,
    executablePath: process.argv[1]
  })
  process.title = process.env.KUN_RUNTIME_FLAVOR === 'development' ? 'kun-dv' : 'kun'
  if (argv[0] === 'extension') {
    return runExtensionCommand(argv.slice(1), {
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env,
      cwd: () => process.cwd()
    })
  }
  const command = splitKunCliCommand(argv)
  if (command.command === 'help') {
    if (command.error) {
      process.stderr.write(`kun: ${command.error}\n`)
      process.stderr.write(KUN_CLI_USAGE)
      return ServeExitCode.usage
    }
    process.stdout.write(KUN_CLI_USAGE)
    return ServeExitCode.ok
  }
  if (command.command === 'serve') {
    return serveMain(command.args)
  }
  if (command.command === 'version') {
    process.stdout.write(`kun ${KUN_VERSION}\n`)
    return ServeExitCode.ok
  }
  if (command.command === 'runtime') {
    return runRuntimeCommand(command.args, {
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env
    })
  }
  if (command.command === 'update') {
    return runSelfUpdateCommand(command.args, {
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env
    })
  }
  return runAgentCommand(command.command, command.args, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: () => process.cwd()
  })
}

const liveLog = process.env.KUN_RUNTIME_LOG_PATH?.trim()
  ? installLiveProcessLog({ logPath: process.env.KUN_RUNTIME_LOG_PATH.trim() })
  : undefined
main(process.argv.slice(2)).finally(() => liveLog?.close()).then(
  (code) => {
    process.exit(code)
  },
  (error) => {
    process.stderr.write(
      `kun serve: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    )
    process.exit(ServeExitCode.runtime)
  }
)
