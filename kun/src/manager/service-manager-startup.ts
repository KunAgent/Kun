import { join } from 'node:path'
import { acquireRuntimeDataDirLease } from '../server/runtime-data-dir-lease.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from '../server/node-http-server.js'
import { KUN_VERSION } from '../version.js'
import {
  publishManagerDiscovery,
  removeManagerDiscovery,
  type ManagerDiscoveryRecord
} from './manager-discovery.js'
import { readForcedRuntimeRecovery } from './forced-runtime-recovery.js'
import { RevisionedDocumentStore } from './revisioned-document-store.js'
import { buildServiceManagerRouter } from './service-manager-router.js'
import {
  reconcileVerifiedForcedRuntimeRecovery,
  ServiceManagerState,
  type ServiceManagerHandle
} from './service-manager-state.js'
import {
  readPersistedManagerState
} from './service-manager-state-persistence.js'
import {
  ManagerStateWriteQueue,
  type ManagerStateWriter
} from './service-manager-state-write-queue.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { sameAppSessionOwner, type AppSessionOwner } from '../contracts/app-session-owner.js'
import { assertManagerSessionReservation, assertNoAppSessionReservation, recordAppSessionParticipant } from './app-session-reservation.js'
import { runtimeProcessIsAlive } from '../server/runtime-process-identity.js'

export const MANAGER_STATE_DEFERRED_FLUSH_SAFE_MS = 2_000

export async function startServiceManager(input: {
  controlDir: string
  managerToken: string
  host?: string
  port?: number
  instanceId: string
  startedAt: string
  buildId?: string
  appOwner?: AppSessionOwner
  reservationPath?: string
  logPath?: string
  state?: ServiceManagerState
  dataDir: string
  sharedData?: ManagerSharedDataStore
  settingsPath: string
  documents?: RevisionedDocumentStore
  /** Test seam: override the durable writer backing the state queue. */
  stateWriter?: ManagerStateWriter
  /** Test seam: tune the write-failure retry budget. */
  stateWriteRetry?: { attempts: number; baseDelayMs: number }
}): Promise<ServiceManagerHandle> {
  if (input.appOwner) {
    if (!input.reservationPath) throw new Error('Owned Manager requires an application session reservation')
    await assertManagerSessionReservation(input.reservationPath, input.appOwner, input)
  } else await assertNoAppSessionReservation(input)
  const dataDirLease = await acquireRuntimeDataDirLease(input.dataDir)
  const managerStatePath = join(input.controlDir, 'manager-state.json')
  let state: ServiceManagerState
  let forcedRecovery: Awaited<ReturnType<typeof readForcedRuntimeRecovery>>
  try {
    ;[state, forcedRecovery] = await Promise.all([
      input.state ?? readPersistedManagerState(managerStatePath),
      readForcedRuntimeRecovery(input.controlDir)
    ])
    if (input.appOwner && state.snapshot().some(({ registration }) =>
      runtimeProcessIsAlive(registration.pid, registration) && !sameAppSessionOwner(registration.appOwner, input.appOwner))) {
      throw new Error('A previous Manager generation still has a live Runtime; its application must stop it before Manager recovery')
    }
  } catch (error) {
    await dataDirLease.release().catch(() => undefined)
    throw error
  }
  let requestShutdown!: () => void
  const shutdownRequested = new Promise<void>((resolve) => { requestShutdown = resolve })
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined
  let draining = false
  const deferShutdown = () => {
    if (shutdownTimer) return
    shutdownTimer = setTimeout(requestShutdown, 25)
    shutdownTimer.unref?.()
  }
  const stateQueue = new ManagerStateWriteQueue(managerStatePath, {
    ...(input.stateWriter ? { writer: input.stateWriter } : {}),
    ...(input.stateWriteRetry ? { retry: input.stateWriteRetry } : {}),
    onPermanentFailure: () => deferShutdown()
  })
  state.onMutation(() => {
    stateQueue.enqueue(state.durableSnapshot())
  })
  const flushState = async () => {
    await stateQueue.flush()
  }
  // Lease renewals (runtime heartbeat, thread lease, resource lease/commit)
  // only extend a deadline inside its safe TTL window. They must not queue
  // behind every full snapshot write, or a slow disk can starve renewal until
  // the lease expires. The mutation is still durably persisted by the latest
  // snapshot write; only the *response* stops waiting for it within the safe
  // window.
  const flushStateForRenewal = async (ttlMs: number) => {
    const safeWindow = Math.max(0, ttlMs - MANAGER_STATE_DEFERRED_FLUSH_SAFE_MS)
    if (Date.now() - stateQueue.lastDurableFlushAt >= safeWindow) {
      await flushState()
      return
    }
    // Wait only for already-completed durability; an in-flight snapshot write
    // must not block the renewal response inside the safe window. Durability
    // is reported solely by the queue (durable revision / timestamp) once the
    // write actually completes; the timeout path records nothing.
    await Promise.race([stateQueue.flush(), new Promise<void>((resolve) => {
      setTimeout(resolve, 25).unref?.()
    })])
  }
  const statePersistence = () => {
    const stats = stateQueue.stats()
    return { degraded: stats.degraded, durableLag: stats.durableLag, stats }
  }
  let sharedData: ManagerSharedDataStore
  try {
    sharedData = input.sharedData ?? await ManagerSharedDataStore.create(input.dataDir)
  } catch (error) {
    state.onMutation(undefined)
    await dataDirLease.release().catch(() => undefined)
    throw error
  }
  if (forcedRecovery) {
    try {
      await reconcileVerifiedForcedRuntimeRecovery({
        controlDir: input.controlDir,
        dataDir: input.dataDir,
        record: forcedRecovery,
        state,
        sharedData,
        flushState: () => stateQueue.flush()
      })
    } catch (error) {
      state.onMutation(undefined)
      await stateQueue.flush().catch(() => undefined)
      await sharedData.close().catch(() => undefined)
      await dataDirLease.release().catch(() => undefined)
      throw error
    }
  }
  let reconciliationTimer: ReturnType<typeof setInterval> | undefined
  let reconciliationWork = Promise.resolve()
  let reconciliationInFlight = false
  let server!: NodeHttpServerHandle
  let discovery!: ManagerDiscoveryRecord
  try {
    const documents = input.documents ?? new RevisionedDocumentStore({
      settingsPath: input.settingsPath,
      clientStatePath: `${input.controlDir}/shared-client-state.json`
    })
    reconciliationTimer = setInterval(() => {
      if (reconciliationInFlight) return
      const expired = state.expireStale()
      if (expired.length === 0) return
      reconciliationInFlight = true
      reconciliationWork = (async () => {
        await flushState()
        for (const lease of expired) {
          try {
            await sharedData.reconcileExpiredLease(lease)
            state.completeExpiredLeaseReconciliation(lease)
            await flushState()
          } catch (error) {
            console.warn('[kun-manager] failed to reconcile expired thread lease:', error)
          }
        }
      })().catch((error) => {
        console.warn('[kun-manager] lease reconciliation cycle failed:', error)
      }).finally(() => { reconciliationInFlight = false })
    }, 1_000)
    reconciliationTimer.unref?.()
    const router = buildServiceManagerRouter({
      managerToken: input.managerToken,
      instanceId: input.instanceId,
      startedAt: input.startedAt,
      ...(input.buildId ? { buildId: input.buildId } : {}),
      ...(input.appOwner ? { appOwner: input.appOwner } : {}),
      isDraining: () => draining,
      beginDrain: () => { draining = true },
      ...(input.appOwner && input.reservationPath ? {
        recordParticipant: (participant) => recordAppSessionParticipant(input.reservationPath!, input.appOwner!, participant)
      } : {}),
      state,
      sharedData,
      documents,
      requestShutdown: deferShutdown,
      flushState,
      flushStateForRenewal,
      statePersistence
    })
    server = await startNodeHttpServer({
      router,
      host: input.host ?? '127.0.0.1',
      port: input.port ?? 0
    })
    discovery = await publishManagerDiscovery(input.controlDir, {
      instanceId: input.instanceId,
      pid: process.pid,
      startedAt: input.startedAt,
      host: server.host,
      port: server.port,
      baseUrl: `http://${server.host}:${server.port}`,
      managerToken: input.managerToken,
      serviceVersion: KUN_VERSION,
      ...(input.buildId ? { buildId: input.buildId } : {}),
      ...(input.appOwner ? { appOwner: input.appOwner } : {}),
      dataDir: input.dataDir,
      settingsPath: input.settingsPath,
      ...(input.logPath ? { logPath: input.logPath } : {})
    })
  } catch (error) {
    if (reconciliationTimer) clearInterval(reconciliationTimer)
    await server?.close().catch(() => undefined)
    await stateQueue.flush().catch(() => undefined)
    state.onMutation(undefined)
    await sharedData.close().catch(() => undefined)
    await dataDirLease.release().catch(() => undefined)
    throw error
  }
  let closed = false
  return {
    ...server,
    instanceId: input.instanceId,
    discovery,
    state,
    beginDrain: () => { draining = true },
    shutdownRequested,
    statePersistence,
    close: async () => {
      if (closed) return
      closed = true
      if (shutdownTimer) clearTimeout(shutdownTimer)
      if (reconciliationTimer) clearInterval(reconciliationTimer)
      let firstError: unknown
      const settle = async (action: () => Promise<unknown>): Promise<void> => {
        try { await action() } catch (error) {
          if (firstError === undefined) firstError = error
        }
      }
      await settle(() => reconciliationWork)
      state.onMutation(undefined)
      await settle(() => server.close())
      await settle(() => stateQueue.flush())
      state.onMutation(undefined)
      await settle(() => sharedData.close())
      await settle(() => removeManagerDiscovery(input.controlDir, input.instanceId, discovery))
      await settle(() => dataDirLease.release())
      if (firstError !== undefined) throw firstError
    }
  }
}
