import { realpath } from 'node:fs/promises'
import { z } from 'zod'
import {
  RuntimeFlavorSchema,
  RuntimeRegistrationSchema,
  ThreadExecutionLeaseSchema,
  TurnMutationFenceSchema,
  type RuntimeFlavor,
  type RuntimeRegistration,
  type ThreadExecutionLease,
  type TurnMutationFence
} from '../contracts/runtime-flavor.js'
import type { NodeHttpServerHandle } from '../server/node-http-server.js'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse, type JsonResponse } from '../server/response.js'
import { Router } from '../server/router.js'
import {
  KUN_MANAGER_PROTOCOL_VERSION,
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
import { RevisionConflictError } from './revisioned-document-store.js'
import {
  consumeForcedRuntimeRecoveryOwners,
  forcedOwnerKey,
  readForcedRuntimeRecovery,
  type ForcedRuntimeRecoveryOwner,
  type VerifiedForcedRuntimeOwner
} from './forced-runtime-recovery.js'
import { sameCanonicalPath } from './canonical-path.js'
import {
  ManagerResourceLeaseRegistry,
  ManagerResourceFenceSchema,
  ResourceFenceStaleError,
  RESOURCE_COMMIT_TTL_MS,
  RESOURCE_LEASE_TTL_MS,
  type ManagerResourceFence,
  type ManagerResourceLease
} from './resource-lease-state.js'
import {
  ServiceManagerStateSnapshotSchema,
  type ServiceManagerStateSnapshot
} from './service-manager-state-snapshot.js'
import type { ManagerStateWriteQueueStats } from './service-manager-state-write-queue.js'
import {
  extendHostLivenessDeadlines,
  ManagerHostLivenessState
} from './host-liveness-state.js'
export { HOST_RESUME_GRACE_MS } from './host-liveness-state.js'
export {
  ServiceManagerStateSnapshotSchema,
  type ServiceManagerStateSnapshot
} from './service-manager-state-snapshot.js'

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
  'appendEvent', 'appendItem', 'checkpointLiveItem', 'finalizeLiveItem', 'rewriteItems', 'loadItemSnapshot',
  'rewriteItemsIfRevision', 'updateItem', 'compactItems', 'scheduleItemHistoryCompaction', 'loadEventsSince',
  'loadEventPage', 'trimEventsFromSeq', 'eventReplayFloorSeq',
  'loadItems', 'searchItemText', 'loadItemPage', 'loadSession', 'upsertSession',
  'highestSeq', 'allocateEventSeq',
  'loadUsageRecords', 'aggregateUsage', 'loadLatestUsageSnapshots', 'resetMemory', 'clearThreadMemory'
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
// Thread renewal uses the same event loop as the runtime heartbeat. Keep its
// deadline beyond heartbeat liveness so a transient stall cannot expire one
// turn while Manager still considers the owning runtime alive. A real owner
// loss is still released by RUNTIME_HEARTBEAT_TTL_MS in expireLeases().
export const THREAD_EXECUTION_LEASE_TTL_MS = RUNTIME_HEARTBEAT_TTL_MS + 10_000

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

export class StaleTurnFenceError extends Error {
  readonly code = 'stale_turn_fence'
  constructor() {
    super('turn mutation fence is stale')
    this.name = 'StaleTurnFenceError'
  }
}

export class ServiceManagerState {
  private readonly slots = new Map<RuntimeFlavor, RuntimeSlot>()
  private readonly leases = new Map<string, ThreadExecutionLease>()
  private readonly threadLeaseFenceHighWater = new Map<string, number>()
  private readonly pendingExpiredLeases = new Map<string, ThreadExecutionLease>()
  private resourceLeaseRegistry = new ManagerResourceLeaseRegistry()
  private mutationListener: (() => void) | undefined
  private hostLiveness = new ManagerHostLivenessState()

  static restore(value: unknown): ServiceManagerState {
    const snapshot = ServiceManagerStateSnapshotSchema.parse(value)
    const state = new ServiceManagerState()
    const threadFenceHighWater = snapshot.version === 1 || snapshot.version === 2
      ? {}
      : snapshot.threadLeaseFenceHighWater
    for (const slot of snapshot.slots) state.slots.set(slot.registration.flavor, slot)
    for (const stored of snapshot.leases) {
      const fencingToken = snapshot.version >= 3
        ? ('fencingToken' in stored ? stored.fencingToken : 1)
        : 1
      const lease = ThreadExecutionLeaseSchema.parse({ ...stored, fencingToken })
      state.leases.set(lease.threadId, lease)
      state.threadLeaseFenceHighWater.set(
        lease.threadId,
        Math.max(
          fencingToken,
          threadFenceHighWater[lease.threadId] ?? 0
        )
      )
    }
    if (snapshot.version !== 1 && snapshot.version !== 2) {
      for (const [threadId, token] of Object.entries(threadFenceHighWater)) {
        state.threadLeaseFenceHighWater.set(
          threadId,
          Math.max(token, state.threadLeaseFenceHighWater.get(threadId) ?? 0)
        )
      }
    }
    if (snapshot.version === 4 || snapshot.version === 5) {
      for (const lease of snapshot.pendingExpiredLeases) {
        state.pendingExpiredLeases.set(expiredLeaseKey(lease), lease)
      }
    }
    state.resourceLeaseRegistry = ManagerResourceLeaseRegistry.restore({
      leases: snapshot.resourceLeases,
      ...(snapshot.version !== 1
        ? { highWater: snapshot.resourceFenceHighWater }
        : {})
    })
    if (snapshot.version === 5) {
      state.hostLiveness = ManagerHostLivenessState.restore(snapshot.hostLiveness)
    }
    return state
  }

  onMutation(listener: (() => void) | undefined): void {
    this.mutationListener = listener
  }

  durableSnapshot(): ServiceManagerStateSnapshot {
    return ServiceManagerStateSnapshotSchema.parse({
      version: 5,
      slots: this.snapshot(),
      leases: [...this.leases.values()],
      pendingExpiredLeases: [...this.pendingExpiredLeases.values()],
      threadLeaseFenceHighWater: Object.fromEntries(this.threadLeaseFenceHighWater),
      resourceLeases: this.resourceLeaseRegistry.snapshot(),
      resourceFenceHighWater: this.resourceLeaseRegistry.highWaterSnapshot(),
      hostLiveness: this.hostLiveness.snapshot()
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

  noteHostSuspended(observedAt = new Date()): void {
    this.hostLiveness.noteSuspended(observedAt)
    this.changed()
  }

  noteHostResumed(observedAt = new Date()): void {
    this.hostLiveness.noteResumed(observedAt, (deltaMs, aliveAtMs) => {
      this.extendLiveDeadlines(deltaMs, aliveAtMs)
    })
    this.changed()
  }

  reportHostPower(input: {
    phase: 'suspend' | 'resume'
    sourceId: string
    sequence: number
    observedAt: Date
    receivedAt?: Date
  }): boolean {
    const accepted = this.hostLiveness.report(input, (deltaMs, aliveAtMs) => {
      this.extendLiveDeadlines(deltaMs, aliveAtMs)
    })
    if (accepted) this.changed()
    return accepted
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
    const expirationNow = this.expirationNow(now, false)
    this.expireLeases(expirationNow)
    const pending = [...this.pendingExpiredLeases.values()]
      .find((lease) => lease.threadId === input.threadId)
    if (pending) throw new ThreadLeaseBusyError(pending)
    const existing = this.leases.get(input.threadId)
    if (existing && (
      existing.ownerInstanceId !== input.ownerInstanceId ||
      existing.turnId !== input.turnId
    )) {
      throw new ThreadLeaseBusyError(existing)
    }
    const acquiredAt = existing?.acquiredAt ?? now.toISOString()
    const fencingToken = existing?.fencingToken ??
      (this.threadLeaseFenceHighWater.get(input.threadId) ?? 0) + 1
    const lease = ThreadExecutionLeaseSchema.parse({
      ...input,
      fencingToken,
      acquiredAt,
      expiresAt: new Date(now.getTime() + THREAD_EXECUTION_LEASE_TTL_MS).toISOString()
    })
    this.leases.set(input.threadId, lease)
    this.threadLeaseFenceHighWater.set(input.threadId, fencingToken)
    this.changed()
    return lease
  }

  renewLease(input: {
    threadId: string
    turnId: string
    ownerFlavor: RuntimeFlavor
    ownerInstanceId: string
    fencingToken: number
  }, now = new Date()): ThreadExecutionLease | null {
    const expirationNow = this.expirationNow(now, false)
    this.expireLeases(expirationNow)
    const existing = this.leases.get(input.threadId)
    if (!existing ||
      existing.turnId !== input.turnId ||
      existing.ownerFlavor !== input.ownerFlavor ||
      existing.ownerInstanceId !== input.ownerInstanceId ||
      existing.fencingToken !== input.fencingToken) return null
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
    fencingToken: number
  }): boolean {
    const existing = this.leases.get(input.threadId)
    if (!existing ||
      existing.turnId !== input.turnId ||
      existing.ownerFlavor !== input.ownerFlavor ||
      existing.ownerInstanceId !== input.ownerInstanceId ||
      existing.fencingToken !== input.fencingToken) return false
    const released = this.leases.delete(input.threadId)
    if (released) this.changed()
    return released
  }

  lease(threadId: string, now = new Date()): ThreadExecutionLease | null {
    this.expireLeases(this.expirationNow(now, false))
    return this.leases.get(threadId) ?? null
  }

  requiresTurnMutationFence(threadId: string): boolean {
    return this.leases.has(threadId) ||
      [...this.pendingExpiredLeases.values()].some((lease) => lease.threadId === threadId)
  }

  assertTurnMutationFence(input: TurnMutationFence, now = new Date()): void {
    const expirationNow = this.expirationNow(now, false)
    const fence = TurnMutationFenceSchema.parse({
      threadId: input.threadId,
      turnId: input.turnId,
      ownerFlavor: input.ownerFlavor,
      ownerInstanceId: input.ownerInstanceId,
      fencingToken: input.fencingToken
    })
    const lease = this.leases.get(fence.threadId)
    const slot = this.slots.get(fence.ownerFlavor)
    const ownerAlive = slot?.registration.instanceId === fence.ownerInstanceId &&
      expirationNow.getTime() - Date.parse(slot.lastHeartbeatAt) <= RUNTIME_HEARTBEAT_TTL_MS
    if (!lease || !ownerAlive || Date.parse(lease.expiresAt) <= expirationNow.getTime() ||
      lease.turnId !== fence.turnId ||
      lease.ownerFlavor !== fence.ownerFlavor ||
      lease.ownerInstanceId !== fence.ownerInstanceId ||
      lease.fencingToken !== fence.fencingToken) {
      throw new StaleTurnFenceError()
    }
  }

  expireStale(now = new Date()): ThreadExecutionLease[] {
    if (!this.prepareForExpiration(now)) return []
    let changed = false
    for (const [flavor, slot] of this.slots) {
      if (now.getTime() - Date.parse(slot.lastHeartbeatAt) > RUNTIME_HEARTBEAT_TTL_MS) {
        this.slots.delete(flavor)
        changed = true
      }
    }
    if (this.resourceLeaseRegistry.expireStale(now)) changed = true
    this.expireLeases(now)
    const expired = [...this.pendingExpiredLeases.values()]
    if (changed && expired.length === 0) this.changed()
    return expired
  }

  completeExpiredLeaseReconciliation(lease: ThreadExecutionLease): boolean {
    const removed = this.pendingExpiredLeases.delete(expiredLeaseKey(lease))
    if (removed) this.changed()
    return removed
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
    const expirationNow = this.expirationNow(now, false)
    const result = this.resourceLeaseRegistry.acquire(input, expirationNow)
    if (result.acquired) this.changed()
    return result
  }

  renewResource(input: ManagerResourceFence, now = new Date()): ManagerResourceLease | null {
    const expirationNow = this.expirationNow(now, false)
    const lease = this.resourceLeaseRegistry.renew(
      resourceFenceFrom(input), expirationNow
    )
    if (lease) this.changed()
    return lease
  }

  beginResourceCommit(
    input: ManagerResourceFence,
    commitId: string,
    now = new Date()
  ): ManagerResourceLease | null {
    const expirationNow = this.expirationNow(now, false)
    const commitExpiresAt = new Date(
      expirationNow.getTime() + RESOURCE_COMMIT_TTL_MS
    ).toISOString()
    const lease = this.resourceLeaseRegistry.beginCommit(
      resourceFenceFrom(input), commitId, commitExpiresAt, expirationNow
    )
    if (lease) this.changed()
    return lease
  }

  renewResourceCommit(
    input: ManagerResourceFence,
    commitId: string,
    now = new Date()
  ): ManagerResourceLease | null {
    const expirationNow = this.expirationNow(now, false)
    const commitExpiresAt = new Date(
      expirationNow.getTime() + RESOURCE_COMMIT_TTL_MS
    ).toISOString()
    const lease = this.resourceLeaseRegistry.renewCommit(
      resourceFenceFrom(input), commitId, commitExpiresAt, expirationNow
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
    const expirationNow = this.expirationNow(now, false)
    return this.resourceLeaseRegistry.validate(
      resourceFenceFrom(input), expirationNow
    )
  }

  assertResource(input: ManagerResourceFence, now = new Date()): void {
    if (!this.validateResource(input, now)) throw new ResourceFenceStaleError()
  }

  assertResourceCommit(input: ManagerResourceFence, commitId: string, now = new Date()): void {
    const expirationNow = this.expirationNow(now, false)
    if (!this.resourceLeaseRegistry.validateCommit(
      resourceFenceFrom(input), commitId, expirationNow
    )) {
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
      this.pendingExpiredLeases.set(expiredLeaseKey(lease), lease)
    }
    if (expired.length > 0) this.changed()
    return expired
  }

  private extendLiveDeadlines(deltaMs: number, aliveAtMs: number): void {
    const runtimeChanged = extendHostLivenessDeadlines(
      this.slots,
      this.leases,
      deltaMs,
      aliveAtMs,
      RUNTIME_HEARTBEAT_TTL_MS
    )
    const resourceChanged = this.resourceLeaseRegistry.extendLiveDeadlines(deltaMs, aliveAtMs)
    if (runtimeChanged || resourceChanged) this.changed()
  }

  private prepareForExpiration(now: Date, fromReconcile = true): boolean {
    const prepare = fromReconcile
      ? this.hostLiveness.beforeReconcile.bind(this.hostLiveness)
      : this.hostLiveness.beforeOperation.bind(this.hostLiveness)
    return prepare(now, (deltaMs, aliveAtMs) => {
      this.extendLiveDeadlines(deltaMs, aliveAtMs)
    })
  }

  private expirationNow(now: Date, fromReconcile: boolean): Date {
    return this.prepareForExpiration(now, fromReconcile)
      ? now
      : this.hostLiveness.expirationReference(now)
  }

  private changed(): void {
    this.mutationListener?.()
  }
}

function expiredLeaseKey(lease: ThreadExecutionLease): string {
  return `${lease.threadId}:${lease.fencingToken}`
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
  statePersistence: () => {
    degraded: boolean
    durableLag: number
    stats: ManagerStateWriteQueueStats
  }
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
