import {
  randomUUID,
  buildRouter,
  startNodeHttpServer,
  type NodeHttpServerHandle,
  isLoopbackHost,
  KUN_SERVICE_VERSION,
  publishRuntimeDiscovery,
  removeRuntimeDiscovery,
  registerRuntimeWithManager,
  unregisterRuntimeWithManager
} from './runtime-factory-dependencies.js'
import { createKunServeRuntime } from './runtime-composition.js'
import { settleCleanupSteps } from './runtime-factory-cleanup.js'
import { startMemoryPressureMonitor } from './memory-pressure-monitor.js'
import type { KunServeHandle, KunServeRuntimeOptions } from './runtime-factory-types.js'
import { reconcileRuntimeAfterRestart } from './runtime-restart-reconciliation.js'
import { startRuntimeStartupManagerHeartbeat } from './runtime-startup-manager-heartbeat.js'

const MANAGER_SETTLEMENT_RECOVERY_WINDOW_MS = 5 * 60_000

export async function startKunServe(
  options: KunServeRuntimeOptions
): Promise<KunServeHandle> {
  if (options.insecure && !isLoopbackHost(options.host)) {
    throw new Error('insecure serve requires a loopback host')
  }
  // Generate this once so the authenticated live-info endpoint and the
  // discovery rendezvous identify the exact same process incarnation.
  const startedAt = options.startedAt ?? new Date().toISOString()
  const startedAtMs = Date.parse(startedAt)
  const managerSettledAfter = new Date(
    (Number.isFinite(startedAtMs) ? startedAtMs : Date.now()) -
    MANAGER_SETTLEMENT_RECOVERY_WINDOW_MS
  ).toISOString()
  const instanceId = options.instanceId ?? randomUUID()
  process.env.KUN_RUNTIME_INSTANCE_ID = instanceId
  const serveOptions = { ...options, startedAt, instanceId }
  // The composition owns the writer lease for all local stores. Keeping lease
  // ownership below the HTTP layer also covers direct CLI runtimes and avoids
  // a second claim for serve mode.
  const runtime = await createKunServeRuntime(serveOptions)
  try {
    // Usage events are cumulative. Seed the historical baseline before any
    // request can record a new cumulative event, otherwise delayed carryover
    // can overwrite or double-count startup traffic.
    await runtime.prepareForRequests?.()
  } catch (error) {
    console.warn('[kun] startup usage carryover failed:', error)
  }
  let requestShutdown!: () => void
  const shutdownRequested = new Promise<void>((resolve) => { requestShutdown = resolve })
  runtime.requestShutdown = async (requestedInstanceId) => {
    if (requestedInstanceId !== instanceId) return false
    const timer = setTimeout(requestShutdown, 25)
    timer.unref?.()
    return true
  }
  const router = buildRouter(runtime)
  let server: NodeHttpServerHandle
  try {
    server = await startNodeHttpServer({
      router,
      host: options.host,
      port: options.port,
      ...(options.faultInjection ? { faultInjection: options.faultInjection } : {})
    })
  } catch (error) {
    await runtime.shutdown?.().catch(() => undefined)
    throw error
  }
  let discovery: Awaited<ReturnType<typeof publishRuntimeDiscovery>>
  const runtimeFlavor = options.runtimeFlavor ?? 'production'
  let registeredWithManager = false
  let startupManagerHeartbeat: ReturnType<typeof startRuntimeStartupManagerHeartbeat> | null = null
  const registration = {
    flavor: runtimeFlavor,
    instanceId,
    pid: process.pid,
    startedAt,
    host: server.host,
    port: server.port,
    baseUrl: runtimeBaseUrl(server.host, server.port),
    runtimeToken: options.runtimeToken,
    ...(options.clientOwnerKind ? { clientOwnerKind: options.clientOwnerKind } : {}),
    ...(options.buildId ? { buildId: options.buildId } : {}),
    ...(options.logPath ? { logPath: options.logPath } : {})
  }
  try {
    if (options.serviceManager) {
      await registerRuntimeWithManager({
        manager: options.serviceManager,
        registration
      })
      registeredWithManager = true
      startupManagerHeartbeat = startRuntimeStartupManagerHeartbeat({
        manager: options.serviceManager,
        registration
      })
      // Manager startup has already settled leases from a verified forced
      // predecessor. Finish orphan/subagent/turn recovery before publishing
      // discovery, so clients never attach to a current build with stuck work.
      await reconcileRuntimeAfterRestart(runtime, {
        managerSettledAfter
      })
      await startupManagerHeartbeat.revalidate()
    }
    discovery = await publishRuntimeDiscovery(options.discoveryDir ?? options.dataDir, {
      pid: process.pid,
      startedAt,
      host: server.host,
      port: server.port,
      baseUrl: runtimeBaseUrl(server.host, server.port),
      runtimeToken: options.runtimeToken,
      insecure: options.insecure,
      serviceVersion: KUN_SERVICE_VERSION,
      ...(runtimeFlavor === 'development' ? { flavor: runtimeFlavor } : {}),
      ...(options.buildId ? { buildId: options.buildId } : {}),
      launchMode: options.launchMode ?? 'foreground',
      ...(options.clientOwnerKind ? { clientOwnerKind: options.clientOwnerKind } : {}),
      ...(options.logPath ? { logPath: options.logPath } : {}),
      instanceId
    })
  } catch (error) {
    await settleCleanupSteps([
      async () => {
        await startupManagerHeartbeat?.stop()
        startupManagerHeartbeat = null
      },
      async () => {
        if (!registeredWithManager || !options.serviceManager) return
        try {
          await unregisterRuntimeWithManager({
            manager: options.serviceManager,
            flavor: runtimeFlavor,
            instanceId
          })
        } finally {
          registeredWithManager = false
        }
      },
      () => server.close(),
      async () => { await runtime.shutdown?.() }
    ]).catch(() => undefined)
    throw error
  }
  await startupManagerHeartbeat?.stop()
  startupManagerHeartbeat = null
  runtime.startBackgroundMaintenance?.()
  // Background sweep after listen: settle turns orphaned by a crash so
  // clients stop spinning on them, without delaying readiness. Then resume
  // goals that were interrupted mid-run so an active goal doesn't sit "in
  // progress" forever with nothing running (KunAgent/Kun#370).
  if (!options.serviceManager) void reconcileRuntimeAfterRestart(runtime, { managerSettledAfter })
    .catch((error) => {
      console.warn('[kun] orphaned turn reconciliation failed:', error)
    })
  // Memory-pressure monitor: fold idle histories at the warning watermark and
  // request a graceful (resumable) shutdown at the critical watermark instead
  // of letting the OS hard-kill the runtime with OOM.
  const memoryMonitor = runtime.threadStore && options.runtime?.memoryPressure?.enabled !== false
    ? startMemoryPressureMonitor({
        config: options.runtime?.memoryPressure,
        threadStore: runtime.threadStore,
        sessionStore: runtime.sessionStore,
        turnService: runtime.turnService,
        events: runtime.events,
        instanceId,
        requestShutdown: async () => {
          await runtime.requestShutdown?.(instanceId).catch(() => false)
          return true
        },
        setAdmissionParallelLimit: (limit) => {
          runtime.delegationRuntime?.setMemoryPressureParallelLimit(limit)
          runtime.turnService.updateRuntimeConfig({
            maxConcurrentTurns: limit === undefined
              ? options.runtime?.turnLimits?.maxConcurrentTurns
              : Math.min(options.runtime?.turnLimits?.maxConcurrentTurns ?? limit, limit)
          })
        }
      })
    : null
  return {
    ...server,
    runtime,
    instanceId,
    shutdownRequested,
    close: async () => {
      memoryMonitor?.stop()
      await settleCleanupSteps([
        async () => { await runtime.shutdown?.() },
        () => server.close(),
        async () => {
          if (!registeredWithManager || !options.serviceManager) return
          try {
            await unregisterRuntimeWithManager({
              manager: options.serviceManager,
              flavor: runtimeFlavor,
              instanceId
            })
          } finally {
            registeredWithManager = false
          }
        },
        async () => {
          await removeRuntimeDiscovery(
            options.discoveryDir ?? options.dataDir,
            discovery.instanceId,
            options.runtimeFlavor ?? 'production'
          )
        }
      ])
    }
  }
}

function runtimeBaseUrl(host: string, port: number): string {
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${urlHost}:${port}`
}
