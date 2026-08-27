import { timingSafeEqual } from 'node:crypto'
import { chmod, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import {
  RuntimeFlavorSchema,
  RuntimeRegistrationSchema,
  ThreadExecutionLeaseSchema,
  type RuntimeFlavor,
  type RuntimeRegistration,
  type ThreadExecutionLease
} from '../contracts/runtime-flavor.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from '../server/node-http-server.js'
import { acquireRuntimeDataDirLease } from '../server/runtime-data-dir-lease.js'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse, type JsonResponse } from '../server/response.js'
import { Router } from '../server/router.js'
import { KUN_VERSION } from '../version.js'
import {
  KUN_MANAGER_PROTOCOL_VERSION,
  publishManagerDiscovery,
  removeManagerDiscovery,
  type ManagerDiscoveryRecord
} from './manager-discovery.js'
import {
  ManagerSharedDataStore,
  type ManagerAttachmentStoreOperation,
  type ManagerArtifactStoreOperation,
  type ManagerGraphStoreOperation,
  type ManagerMemoryStoreOperation,
  type ManagerSessionStoreOperation,
  type ManagerThreadStoreOperation
} from './shared-data-store.js'
import { MANAGER_THREAD_STORE_OPERATIONS } from './shared-data-store-contracts.js'
import {
  RevisionConflictError,
  RevisionedDocumentStore
} from './revisioned-document-store.js'

import {
  buildServiceManagerRouter
} from './service-manager-router.js'
import {
  consumeForcedRuntimeRecoveryOwners,
  forcedOwnerKey,
  readForcedRuntimeRecovery,
  type ForcedRuntimeRecoveryOwner,
  type VerifiedForcedRuntimeOwner
} from './forced-runtime-recovery.js'
import { sameCanonicalPath } from './canonical-path.js'
import {
  LegacyManagerResourceLeaseSchema,
  ManagerResourceLeaseRegistry,
  ManagerResourceLeaseSchema,
  ManagerResourceFenceSchema,
  ResourceFenceStaleError,
  RESOURCE_COMMIT_TTL_MS,
  RESOURCE_LEASE_TTL_MS,
  type ManagerResourceFence,
  type ManagerResourceLease
} from './resource-lease-state.js'

export { RESOURCE_LEASE_TTL_MS }
export type { ManagerResourceFence, ManagerResourceLease }

export const KUN_MANAGER_CAPABILITIES = [
  'runtime-slots-v1',
  'shared-data-v1',
  'artifact-memory-data-v1',
  'atomic-json-v1',
  'thread-leases-v1',
  'durable-leases-v1',
  'item-page-v1'
] as const

export const ThreadStoreOperationSchema = z.enum(MANAGER_THREAD_STORE_OPERATIONS)
export const SessionStoreOperationSchema = z.enum([
  'appendEvent', 'appendItem', 'rewriteItems', 'loadItemSnapshot',
  'rewriteItemsIfRevision', 'updateItem', 'compactItems', 'loadEventsSince',
  'loadItems', 'searchItemText', 'loadItemPage', 'loadSession', 'upsertSession',
  'highestSeq', 'allocateEventSeq',
  'loadUsageRecords', 'loadLatestUsageSnapshots', 'resetMemory', 'clearThreadMemory'
])
export const ArtifactStoreOperationSchema = z.enum([
  'put', 'releaseOwner', 'delete', 'list', 'get', 'readRange', 'stat'
])
export const MemoryStoreOperationSchema = z.enum([
  'create', 'createWithId', 'update', 'delete', 'purge', 'list', 'retrieve', 'diagnostics'
])
export const GraphStoreOperationSchema = z.enum([
  'create', 'append', 'get', 'list', 'events', 'eventReplay', 'snapshot', 'remove', 'diagnostics'
])
export const AttachmentStoreOperationSchema = z.enum([
  'create', 'get', 'bindScope', 'bindScopes', 'delete', 'releaseLease',
  'pruneExpiredLeases', 'replaceMetadata', 'resolveContent', 'diagnostics'
])
export const MAX_MANAGER_DATA_BODY_BYTES = 64 * 1024 * 1024

export type RuntimeSlot = {
  registration: RuntimeRegistration
  lastHeartbeatAt: string
}

export const RUNTIME_HEARTBEAT_TTL_MS = 20_000
export const THREAD_EXECUTION_LEASE_TTL_MS = 15_000

const StateSnapshotFields = {
  slots: z.array(z.object({
    registration: RuntimeRegistrationSchema,
    lastHeartbeatAt: z.string().datetime()
  }).strict()),
  leases: z.array(ThreadExecutionLeaseSchema)
}

export const ServiceManagerStateSnapshotSchema = z.union([
  z.object({
    version: z.literal(1),
    ...StateSnapshotFields,
    resourceLeases: z.array(LegacyManagerResourceLeaseSchema)
  }).strict(),
  z.object({
    version: z.literal(2),
    ...StateSnapshotFields,
    resourceLeases: z.array(ManagerResourceLeaseSchema),
    resourceFenceHighWater: z.record(z.string(), z.number().int().nonnegative())
  }).strict()
])

export type ServiceManagerStateSnapshot = z.infer<typeof ServiceManagerStateSnapshotSchema>

export class ThreadLeaseBusyError extends Error {
  constructor(readonly lease: ThreadExecutionLease) {
    super(`thread_busy: ${lease.threadId} is owned by ${lease.ownerFlavor}/${lease.ownerInstanceId}`)
    this.name = 'ThreadLeaseBusyError'
  }
}

export class RuntimeSlotBusyError extends Error {
  constructor(readonly owner: RuntimeRegistration) {
    super(`runtime_slot_busy: ${owner.flavor} is owned by ${owner.instanceId}`)
    this.name = 'RuntimeSlotBusyError'
  }
}

export class RuntimeRegistrationRequiredError extends Error {}

export class ServiceManagerState {
  private readonly slots = new Map<RuntimeFlavor, RuntimeSlot>()
  private readonly leases = new Map<string, ThreadExecutionLease>()
  private resourceLeaseRegistry = new ManagerResourceLeaseRegistry()
  private mutationListener: (() => void) | undefined

  static restore(value: unknown): ServiceManagerState {
    const snapshot = ServiceManagerStateSnapshotSchema.parse(value)
    const state = new ServiceManagerState()
    for (const slot of snapshot.slots) state.slots.set(slot.registration.flavor, slot)
    for (const lease of snapshot.leases) state.leases.set(lease.threadId, lease)
    state.resourceLeaseRegistry = ManagerResourceLeaseRegistry.restore({
      leases: snapshot.resourceLeases,
      ...(snapshot.version === 2 ? { highWater: snapshot.resourceFenceHighWater } : {})
    })
    return state
  }

  onMutation(listener: (() => void) | undefined): void {
    this.mutationListener = listener
  }

  durableSnapshot(): ServiceManagerStateSnapshot {
    return ServiceManagerStateSnapshotSchema.parse({
      version: 2,
      slots: this.snapshot(),
      leases: [...this.leases.values()],
      resourceLeases: this.resourceLeaseRegistry.snapshot(),
      resourceFenceHighWater: this.resourceLeaseRegistry.highWaterSnapshot()
    })
  }

  register(registration: RuntimeRegistration, now = new Date()): RuntimeRegistration {
    const parsed = RuntimeRegistrationSchema.parse(registration)
    const existing = this.slots.get(parsed.flavor)
    if (existing && existing.registration.instanceId !== parsed.instanceId) {
      throw new RuntimeSlotBusyError(existing.registration)
    }
    this.slots.set(parsed.flavor, {
      registration: parsed,
      lastHeartbeatAt: now.toISOString()
    })
    this.changed()
    return parsed
  }

  heartbeat(flavor: RuntimeFlavor, instanceId: string, now = new Date()): boolean {
    const slot = this.slots.get(flavor)
    if (!slot || slot.registration.instanceId !== instanceId) return false
    slot.lastHeartbeatAt = now.toISOString()
    this.changed()
    return true
  }

  unregister(flavor: RuntimeFlavor, instanceId: string): boolean {
    const slot = this.slots.get(flavor)
    if (!slot || slot.registration.instanceId !== instanceId) return false
    const removed = this.slots.delete(flavor)
    if (removed) this.changed()
    return removed
  }

  registration(flavor: RuntimeFlavor): RuntimeRegistration | null {
    return this.slots.get(flavor)?.registration ?? null
  }

  snapshot(): Array<RuntimeSlot> {
    return [...this.slots.values()].map((slot) => ({
      registration: { ...slot.registration },
      lastHeartbeatAt: slot.lastHeartbeatAt
    }))
  }

  acquireLease(input: {
    threadId: string
    turnId: string
    ownerFlavor: RuntimeFlavor
    ownerInstanceId: string
  }, now = new Date()): ThreadExecutionLease {
    const slot = this.slots.get(input.ownerFlavor)
    if (!slot || slot.registration.instanceId !== input.ownerInstanceId) {
      throw new RuntimeRegistrationRequiredError('runtime must register before acquiring a thread lease')
    }
    this.expireLeases(now)
    const existing = this.leases.get(input.threadId)
    if (existing && (
      existing.ownerInstanceId !== input.ownerInstanceId ||
      existing.turnId !== input.turnId
    )) {
      throw new ThreadLeaseBusyError(existing)
    }
    const acquiredAt = existing?.acquiredAt ?? now.toISOString()
    const lease = ThreadExecutionLeaseSchema.parse({
      ...input,
      acquiredAt,
      expiresAt: new Date(now.getTime() + THREAD_EXECUTION_LEASE_TTL_MS).toISOString()
    })
    this.leases.set(input.threadId, lease)
    this.changed()
    return lease
  }

  renewLease(input: {
    threadId: string
    turnId: string
    ownerFlavor: RuntimeFlavor
    ownerInstanceId: string
  }, now = new Date()): ThreadExecutionLease | null {
    this.expireLeases(now)
    const existing = this.leases.get(input.threadId)
    if (!existing ||
      existing.turnId !== input.turnId ||
      existing.ownerFlavor !== input.ownerFlavor ||
      existing.ownerInstanceId !== input.ownerInstanceId) return null
    const lease = {
      ...existing,
      expiresAt: new Date(now.getTime() + THREAD_EXECUTION_LEASE_TTL_MS).toISOString()
    }
    this.leases.set(input.threadId, lease)
    this.changed()
    return lease
  }

  releaseLease(input: {
    threadId: string
    turnId: string
    ownerFlavor: RuntimeFlavor
    ownerInstanceId: string
  }): boolean {
    const existing = this.leases.get(input.threadId)
    if (!existing ||
      existing.turnId !== input.turnId ||
      existing.ownerFlavor !== input.ownerFlavor ||
      existing.ownerInstanceId !== input.ownerInstanceId) return false
    const released = this.leases.delete(input.threadId)
    if (released) this.changed()
    return released
  }

  lease(threadId: string, now = new Date()): ThreadExecutionLease | null {
    this.expireLeases(now)
    return this.leases.get(threadId) ?? null
  }

  expireStale(now = new Date()): ThreadExecutionLease[] {
    let changed = false
    for (const [flavor, slot] of this.slots) {
      if (now.getTime() - Date.parse(slot.lastHeartbeatAt) > RUNTIME_HEARTBEAT_TTL_MS) {
        this.slots.delete(flavor)
        changed = true
      }
    }
    if (this.resourceLeaseRegistry.expireStale(now)) changed = true
    const expired = this.expireLeases(now)
    if (changed && expired.length === 0) this.changed()
    return expired
  }

  expireVerifiedRuntimeOwners(
    owners: readonly VerifiedForcedRuntimeOwner[]
  ): ThreadExecutionLease[] {
    const ownerKeys = new Set(owners.map(forcedOwnerKey))
    let changed = false
    for (const [flavor, slot] of this.slots) {
      if (!ownerKeys.has(forcedOwnerKey({
        flavor,
        instanceId: slot.registration.instanceId
      }))) continue
      this.slots.delete(flavor)
      changed = true
    }
    const expired: ThreadExecutionLease[] = []
    for (const [threadId, lease] of this.leases) {
      if (!ownerKeys.has(`${lease.ownerFlavor}:${lease.ownerInstanceId}`)) continue
      this.leases.delete(threadId)
      expired.push(lease)
      changed = true
    }
    if (this.resourceLeaseRegistry.expireOwners(ownerKeys)) changed = true
    if (changed) this.changed()
    return expired
  }

  acquireResource(input: {
    resource: string
    ownerFlavor: RuntimeFlavor
    ownerInstanceId: string
  }, now = new Date()): { acquired: boolean; lease: ManagerResourceLease } {
    const result = this.resourceLeaseRegistry.acquire(input, now)
    if (result.acquired) this.changed()
    return result
  }

  renewResource(input: ManagerResourceFence, now = new Date()): ManagerResourceLease | null {
    const lease = this.resourceLeaseRegistry.renew(resourceFenceFrom(input), now)
    if (lease) this.changed()
    return lease
  }

  beginResourceCommit(
    input: ManagerResourceFence,
    commitId: string,
    now = new Date()
  ): ManagerResourceLease | null {
    const commitExpiresAt = new Date(now.getTime() + RESOURCE_COMMIT_TTL_MS).toISOString()
    const lease = this.resourceLeaseRegistry.beginCommit(
      resourceFenceFrom(input), commitId, commitExpiresAt, now
    )
    if (lease) this.changed()
    return lease
  }

  renewResourceCommit(
    input: ManagerResourceFence,
    commitId: string,
    now = new Date()
  ): ManagerResourceLease | null {
    const commitExpiresAt = new Date(now.getTime() + RESOURCE_COMMIT_TTL_MS).toISOString()
    const lease = this.resourceLeaseRegistry.renewCommit(
      resourceFenceFrom(input), commitId, commitExpiresAt, now
    )
    if (lease) this.changed()
    return lease
  }

  endResourceCommit(input: ManagerResourceFence, commitId: string): boolean {
    const ended = this.resourceLeaseRegistry.endCommit(resourceFenceFrom(input), commitId)
    if (ended) this.changed()
    return ended
  }

  validateResource(input: ManagerResourceFence, now = new Date()): boolean {
    return this.resourceLeaseRegistry.validate(resourceFenceFrom(input), now)
  }

  assertResource(input: ManagerResourceFence, now = new Date()): void {
    if (!this.validateResource(input, now)) throw new ResourceFenceStaleError()
  }

  assertResourceCommit(input: ManagerResourceFence, commitId: string, now = new Date()): void {
    if (!this.resourceLeaseRegistry.validateCommit(resourceFenceFrom(input), commitId, now)) {
      throw new ResourceFenceStaleError()
    }
  }

  releaseResource(input: ManagerResourceFence): boolean {
    const released = this.resourceLeaseRegistry.release(resourceFenceFrom(input))
    if (released) this.changed()
    return released
  }

  private expireLeases(now: Date): ThreadExecutionLease[] {
    const expired: ThreadExecutionLease[] = []
    for (const [threadId, lease] of this.leases) {
      const slot = this.slots.get(lease.ownerFlavor)
      const ownerAlive = slot?.registration.instanceId === lease.ownerInstanceId &&
        now.getTime() - Date.parse(slot.lastHeartbeatAt) <= RUNTIME_HEARTBEAT_TTL_MS
      if (Date.parse(lease.expiresAt) > now.getTime() && ownerAlive) continue
      this.leases.delete(threadId)
      expired.push(lease)
    }
    if (expired.length > 0) this.changed()
    return expired
  }

  private changed(): void {
    this.mutationListener?.()
  }
}

function resourceFenceFrom(input: ManagerResourceFence): ManagerResourceFence {
  return ManagerResourceFenceSchema.parse({
    resource: input.resource,
    ownerFlavor: input.ownerFlavor,
    ownerInstanceId: input.ownerInstanceId,
    fencingToken: input.fencingToken
  })
}

export type ServiceManagerHandle = NodeHttpServerHandle & {
  instanceId: string
  discovery: ManagerDiscoveryRecord
  state: ServiceManagerState
  shutdownRequested: Promise<void>
}

export async function reconcileVerifiedForcedRuntimeRecovery(input: {
  controlDir: string
  dataDir: string
  record: NonNullable<Awaited<ReturnType<typeof readForcedRuntimeRecovery>>>
  state: ServiceManagerState
  sharedData: Pick<ManagerSharedDataStore, 'reconcileExpiredLease'>
  flushState: () => Promise<void>
}): Promise<number> {
  const owners = await forcedRecoveryOwnersForDataDir(input.record.owners, input.dataDir)
  if (owners.length === 0) return 0
  const expired = input.state.expireVerifiedRuntimeOwners(owners)
  for (const lease of expired) await input.sharedData.reconcileExpiredLease(lease)
  await input.flushState()
  const consumed = await consumeForcedRuntimeRecoveryOwners({
    controlDir: input.controlDir,
    markerId: input.record.markerId,
    owners
  })
  if (!consumed) {
    throw new Error('Kun forced-runtime recovery marker changed during reconciliation')
  }
  return expired.length
}

async function forcedRecoveryOwnersForDataDir(
  owners: readonly ForcedRuntimeRecoveryOwner[],
  dataDir: string
): Promise<ForcedRuntimeRecoveryOwner[]> {
  const activeRealPath = await canonicalRealPath(dataDir)
  const matched: ForcedRuntimeRecoveryOwner[] = []
  for (const owner of owners) {
    if (sameCanonicalPath(owner.dataDir, dataDir)) {
      matched.push(owner)
      continue
    }
    const ownerRealPath = await canonicalRealPath(owner.dataDir)
    if (activeRealPath && ownerRealPath && sameCanonicalPath(ownerRealPath, activeRealPath)) {
      matched.push(owner)
    }
  }
  return matched
}

async function canonicalRealPath(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

export async function startServiceManager(input: {
  controlDir: string
  managerToken: string
  host?: string
  port?: number
  instanceId: string
  startedAt: string
  buildId?: string
  logPath?: string
  state?: ServiceManagerState
  dataDir: string
  sharedData?: ManagerSharedDataStore
  settingsPath: string
  documents?: RevisionedDocumentStore
}): Promise<ServiceManagerHandle> {
  // The Manager is the physical owner of canonical stores for every managed
  // Runtime flavor. Hold the data-directory lease before constructing those
  // stores so migration and manager election cannot overlap writes.
  const dataDirLease = await acquireRuntimeDataDirLease(input.dataDir)
  const managerStatePath = join(input.controlDir, 'manager-state.json')
  let state: ServiceManagerState
  let forcedRecovery: Awaited<ReturnType<typeof readForcedRuntimeRecovery>>
  try {
    ;[state, forcedRecovery] = await Promise.all([
      input.state ?? readPersistedManagerState(managerStatePath),
      readForcedRuntimeRecovery(input.controlDir)
    ])
  } catch (error) {
    await dataDirLease.release().catch(() => undefined)
    throw error
  }
  let statePersistence = Promise.resolve()
  let statePersistenceError: unknown
  state.onMutation(() => {
    if (statePersistenceError !== undefined) return
    const snapshot = state.durableSnapshot()
    statePersistence = statePersistence.then(async () => {
      await atomicWriteFile(managerStatePath, `${JSON.stringify(snapshot, null, 2)}\n`)
      await chmod(managerStatePath, 0o600).catch((error) => {
        if (process.platform !== 'win32') throw error
      })
    }).catch((error) => {
      statePersistenceError = error
      console.error('[kun-manager] failed to persist manager lease state:', error)
      throw error
    })
    void statePersistence.catch(() => undefined)
  })
  const flushState = async () => {
    await statePersistence
    if (statePersistenceError !== undefined) throw statePersistenceError
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
        flushState: () => statePersistence
      })
    } catch (error) {
      state.onMutation(undefined)
      await statePersistence.catch(() => undefined)
      await sharedData.close().catch(() => undefined)
      await dataDirLease.release().catch(() => undefined)
      throw error
    }
  }
  let requestShutdown!: () => void
  const shutdownRequested = new Promise<void>((resolve) => { requestShutdown = resolve })
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined
  const deferShutdown = () => {
    if (shutdownTimer) return
    shutdownTimer = setTimeout(requestShutdown, 25)
    shutdownTimer.unref?.()
  }
  let reconciliationTimer: ReturnType<typeof setInterval> | undefined
  let server!: NodeHttpServerHandle
  let discovery!: ManagerDiscoveryRecord
  try {
    const documents = input.documents ?? new RevisionedDocumentStore({
      settingsPath: input.settingsPath,
      clientStatePath: `${input.controlDir}/shared-client-state.json`
    })
    reconciliationTimer = setInterval(() => {
      const expired = state.expireStale()
      for (const lease of expired) {
        void sharedData.reconcileExpiredLease(lease).catch((error) => {
          console.warn('[kun-manager] failed to reconcile expired thread lease:', error)
        })
      }
    }, 1_000)
    reconciliationTimer.unref?.()
    const router = buildServiceManagerRouter({
      managerToken: input.managerToken,
      instanceId: input.instanceId,
      startedAt: input.startedAt,
      ...(input.buildId ? { buildId: input.buildId } : {}),
      state,
      sharedData,
      documents,
      requestShutdown: deferShutdown,
      flushState
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
      dataDir: input.dataDir,
      settingsPath: input.settingsPath,
      ...(input.logPath ? { logPath: input.logPath } : {})
    })
  } catch (error) {
    if (reconciliationTimer) clearInterval(reconciliationTimer)
    await server?.close().catch(() => undefined)
    await statePersistence.catch(() => undefined)
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
    shutdownRequested,
    close: async () => {
      if (closed) return
      closed = true
      if (shutdownTimer) clearTimeout(shutdownTimer)
      if (reconciliationTimer) clearInterval(reconciliationTimer)
      state.onMutation(undefined)
      let firstError: unknown
      const settle = async (action: () => Promise<unknown>): Promise<void> => {
        try {
          await action()
        } catch (error) {
          if (firstError === undefined) firstError = error
        }
      }
      await settle(() => server.close())
      await settle(() => statePersistence)
      state.onMutation(undefined)
      await settle(() => sharedData.close())
      await settle(() => removeManagerDiscovery(input.controlDir, input.instanceId))
      await settle(() => dataDirLease.release())
      if (firstError !== undefined) throw firstError
    }
  }
}

export async function readPersistedManagerState(path: string): Promise<ServiceManagerState> {
  try {
    return ServiceManagerState.restore(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (String((error as { code?: unknown })?.code ?? '') === 'ENOENT') {
      return new ServiceManagerState()
    }
    throw error
  }
}
