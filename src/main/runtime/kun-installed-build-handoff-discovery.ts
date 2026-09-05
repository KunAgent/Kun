import { resolve } from 'node:path'
import { z } from 'zod'
import type { RuntimeFlavor } from '../../../kun/src/contracts/runtime-flavor.js'
import {
  isSafeRuntimeHandoffDiscovery,
  removeRuntimeDiscovery,
  readRuntimeHandoffDiscoveryStrict,
  type RuntimeHandoffDiscoveryRecord
} from '../../../kun/src/server/runtime-discovery.js'
import {
  defaultKunControlDir,
  removeManagerDiscovery,
  readManagerHandoffDiscoveryStrict,
  withManagerStartLock,
  type ManagerDiscoveryRecord,
  type ManagerHandoffDiscoveryRecord
} from '../../../kun/src/manager/manager-discovery.js'
import { sameCanonicalPath } from '../../../kun/src/manager/canonical-path.js'
import { processAlive, runtimeDiscoveryDirectory } from '../../../kun/src/cli/shared-runtime-support.js'
import { withRuntimeDataDirAncillaryWriter } from '../../../kun/src/server/runtime-data-dir-lease.js'
import { unregisterRuntimeWithManager } from '../../../kun/src/manager/manager-client.js'
import type {
  KunHandoffOwnerReport,
  KunHandoffProbeClassification,
  KunInstalledBuildHandoffInput
} from './kun-installed-build-handoff'
import { KunHandoffError } from './kun-installed-build-handoff'
import {
  stopExactSharedRuntimeForReplacement,
  type SharedRuntimeReplacementInspection
} from './kun-serve-replacement'
import {
  stopServiceManagerForReplacement
} from './kun-manager-replacement'
import { processIdentity } from '../kun-process-ports'
import { recordVerifiedForcedRuntimeOwner } from '../../../kun/src/manager/forced-runtime-recovery.js'
import {
  verifyManagerOwner,
  verifyRuntimeOwner
} from './kun-handoff-owner-verification'

export type RuntimeOwner = {
  dataDir: string
  flavor: RuntimeFlavor
  inspection: SharedRuntimeReplacementInspection
}

export type StaleRuntimeOwner = RuntimeOwner & {
  source: 'discovery' | 'manager-slot'
}

export type HandoffDependencies = {
  readManager: typeof readManagerHandoffDiscoveryStrict
  readRuntime: typeof readRuntimeHandoffDiscoveryStrict
  withManagerLock: <T>(controlDir: string, action: () => Promise<T>) => Promise<T>
  stopRuntime: typeof stopExactSharedRuntimeForReplacement
  stopManager: typeof stopServiceManagerForReplacement
  processAlive: typeof processAlive
  processIdentity: typeof processIdentity
  removeRuntime: typeof removeRuntimeDiscovery
  removeManager: typeof removeManagerDiscovery
  withAncillaryWriter: typeof withRuntimeDataDirAncillaryWriter
  unregisterRuntime: (input: {
    manager: ManagerHandoffDiscoveryRecord
    flavor: RuntimeFlavor
    instanceId: string
    fetch?: typeof fetch
  }) => Promise<boolean>
  recordForcedOwner: typeof recordVerifiedForcedRuntimeOwner
  backupCleanupRecord?: (record: unknown, instanceId: string) => Promise<string>
  appendCleanupAudit?: (entry: import('./kun-handoff-cleanup').HandoffCleanupAuditEntry) => Promise<void>
  now: () => number
}

export type DiscoveredHandoffOwners = {
  manager: ManagerHandoffDiscoveryRecord | null
  runtimes: RuntimeOwner[]
  staleManager: ManagerHandoffDiscoveryRecord | null
  staleRuntimes: StaleRuntimeOwner[]
  unknownManager: ManagerHandoffDiscoveryRecord | null
  unknownRuntimes: RuntimeOwner[]
  probeClassifications: KunHandoffProbeClassification[]
}

export const defaultDiscoveryDependencies: HandoffDependencies = {
  readManager: readManagerHandoffDiscoveryStrict,
  readRuntime: readRuntimeHandoffDiscoveryStrict,
  withManagerLock: withManagerStartLock,
  stopRuntime: stopExactSharedRuntimeForReplacement,
  stopManager: stopServiceManagerForReplacement,
  processAlive,
  processIdentity,
  removeRuntime: removeRuntimeDiscovery,
  removeManager: removeManagerDiscovery,
  withAncillaryWriter: withRuntimeDataDirAncillaryWriter,
  unregisterRuntime: ({ manager, ...input }) => unregisterRuntimeWithManager({
    manager: { discovery: manager as ManagerDiscoveryRecord },
    ...input
  }),
  recordForcedOwner: recordVerifiedForcedRuntimeOwner,
  now: Date.now
}

export async function discoverHandoffOwnersSafely(
  input: KunInstalledBuildHandoffInput,
  deps: HandoffDependencies
): Promise<DiscoveredHandoffOwners> {
  try {
    return await discoverHandoffOwners(input, deps)
  } catch (error) {
    if (error instanceof KunHandoffError) throw error
    throw new KunHandoffError(
      'unsafe_scope',
      'discover',
      input.reason,
      false,
      undefined,
      'Kun update handoff could not safely read Runtime or Service Manager discovery',
      { cause: error }
    )
  }
}

async function discoverHandoffOwners(
  input: KunInstalledBuildHandoffInput,
  deps: HandoffDependencies
): Promise<DiscoveredHandoffOwners> {
  const controlDir = input.controlDir ?? defaultKunControlDir()
  const managerRecord = await deps.readManager(controlDir)
  if (managerRecord && input.settingsPath &&
    !sameCanonicalPath(managerRecord.settingsPath, input.settingsPath)) {
    throw new KunHandoffError(
      'unsafe_scope',
      'discover',
      input.reason,
      false,
      managerOwnerReport(managerRecord),
      'Kun Service Manager owns a different canonical settings scope'
    )
  }
  const managerState = managerRecord
    ? await managerProcessState(managerRecord, input, deps)
    : 'dead'
  const manager = managerState === 'live' ? managerRecord : null
  const staleManager = managerState === 'stale' ? managerRecord : null
  const unknownManager = managerState === 'unknown' ? managerRecord : null
  const dataDirs = canonicalDataDirs([
    ...input.dataDirs,
    ...(managerRecord ? [managerRecord.dataDir] : [])
  ])
  const runtimes: RuntimeOwner[] = []
  const staleRuntimes: StaleRuntimeOwner[] = []
  const unknownRuntimes: RuntimeOwner[] = []
  for (const dataDir of dataDirs) {
    const record = await deps.readRuntime(dataDir, 'production')
    if (!record) continue
    const state = await runtimeProcessState(dataDir, 'production', record, input, deps)
    if (state === 'live') runtimes.push(runtimeOwner(dataDir, 'production', record))
    else if (state === 'stale') {
      staleRuntimes.push({ ...runtimeOwner(dataDir, 'production', record), source: 'discovery' })
    } else if (state === 'unknown') {
      unknownRuntimes.push(runtimeOwner(dataDir, 'production', record))
    }
  }
  const developmentDir = managerRecord?.dataDir ?? dataDirs[0]
  if (developmentDir) {
    const record = await deps.readRuntime(controlDir, 'development')
    if (record) {
      const state = await runtimeProcessState(
        developmentDir,
        'development',
        record,
        input,
        deps
      )
      if (state === 'live') runtimes.push(runtimeOwner(developmentDir, 'development', record))
      else if (state === 'stale') {
        staleRuntimes.push({
          ...runtimeOwner(developmentDir, 'development', record),
          source: 'discovery'
        })
      } else if (state === 'unknown') {
        unknownRuntimes.push(runtimeOwner(developmentDir, 'development', record))
      }
    }
  }
  const probeClassifications: KunHandoffProbeClassification[] = []
  if (runtimes.length > 0) probeClassifications.push('runtime-discovery-compatible')
  if (manager) probeClassifications.push('manager-discovery-compatible')
  if (manager) {
    const managerStatus = await readCompatibleManagerSlots(manager, input.fetch ?? fetch)
    probeClassifications.push(managerStatus.classification)
    for (const slot of managerStatus.records) {
      const state = await runtimeProcessState(manager.dataDir, slot.flavor, slot, input, deps)
      if (state === 'live') runtimes.push(runtimeOwner(manager.dataDir, slot.flavor, slot))
      else if (state === 'stale') {
        staleRuntimes.push({
          ...runtimeOwner(manager.dataDir, slot.flavor, slot),
          source: 'manager-slot'
        })
      } else if (state === 'unknown') {
        unknownRuntimes.push(runtimeOwner(manager.dataDir, slot.flavor, slot))
      }
    }
  }
  if (staleManager || staleRuntimes.length > 0) probeClassifications.push('stale-owner')
  if (unknownManager || unknownRuntimes.length > 0) {
    probeClassifications.push('identity-unverifiable')
  }
  if (probeClassifications.length === 0) probeClassifications.push('no-live-owner')
  return {
    manager,
    runtimes: deduplicateRuntimeOwners(runtimes),
    staleManager,
    staleRuntimes,
    unknownManager,
    unknownRuntimes: deduplicateRuntimeOwners(unknownRuntimes),
    probeClassifications
  }
}

type ProcessOwnerState = 'dead' | 'live' | 'stale' | 'unknown'

async function runtimeProcessState(
  dataDir: string,
  flavor: RuntimeFlavor,
  record: RuntimeHandoffDiscoveryRecord,
  input: KunInstalledBuildHandoffInput,
  deps: HandoffDependencies
): Promise<ProcessOwnerState> {
  if (!deps.processAlive(record.pid)) return 'dead'
  const verification = await verifyRuntimeOwner(record, dataDir, flavor, {
    processIdentity: deps.processIdentity,
    fetch: input.fetch ?? fetch
  })
  if (verification === 'verified_owner') return 'live'
  if (verification === 'verified_mismatch') return 'stale'
  return 'unknown'
}

async function managerProcessState(
  record: ManagerHandoffDiscoveryRecord,
  input: KunInstalledBuildHandoffInput,
  deps: HandoffDependencies
): Promise<ProcessOwnerState> {
  if (!deps.processAlive(record.pid)) return 'dead'
  const verification = await verifyManagerOwner(record, {
    processIdentity: deps.processIdentity,
    fetch: input.fetch ?? fetch
  })
  if (verification === 'verified_owner') return 'live'
  if (verification === 'verified_mismatch') return 'stale'
  return 'unknown'
}

export async function settleStaleHandoffOwners(
  input: KunInstalledBuildHandoffInput,
  discovered: Pick<
    DiscoveredHandoffOwners,
    'manager' | 'staleManager' | 'staleRuntimes' | 'probeClassifications'
  >,
  deps: HandoffDependencies
): Promise<void> {
  const controlDir = input.controlDir ?? defaultKunControlDir()
  if (discovered.manager &&
    discovered.probeClassifications.includes('manager-status-unavailable')) {
    throw new KunHandoffError(
      'probe_failed',
      'discover',
      input.reason,
      true,
      managerOwnerReport(discovered.manager),
      'Kun could not verify Service Manager Runtime ownership before handoff'
    )
  }
  try {
    for (const runtime of discovered.staleRuntimes) {
      const record = runtime.inspection.discovery
      await backupAndAuditRuntimeCleanup(input, runtime, deps)
      if (runtime.source === 'manager-slot' && discovered.manager) {
        const removed = await deps.unregisterRuntime({
          manager: discovered.manager,
          flavor: runtime.flavor,
          instanceId: record.instanceId,
          ...(input.fetch ? { fetch: input.fetch } : {})
        })
        if (!removed) {
          await proveManagerSlotConverged(
            input,
            discovered.manager,
            runtime,
            deps
          )
        }
        continue
      }
      const discoveryDir = runtimeDiscoveryDirectory(runtime.dataDir, runtime.flavor, controlDir)
      const remove = () => deps.removeRuntime(discoveryDir, record.instanceId, runtime.flavor)
      if (runtime.flavor === 'production') await deps.withAncillaryWriter(runtime.dataDir, remove)
      else await remove()
    }
    if (discovered.staleManager) {
      await deps.backupCleanupRecord?.(discovered.staleManager, discovered.staleManager.instanceId)
      await deps.appendCleanupAudit?.({
        at: new Date(deps.now()).toISOString(),
        action: 'cleanup',
        reason: input.reason,
        classification: 'verified_mismatch',
        kind: 'manager',
        instanceId: discovered.staleManager.instanceId,
        pid: discovered.staleManager.pid,
        identityEvidence: 'os-identity-mismatch',
        outcome: 'removed'
      })
      await deps.removeManager(controlDir, discovered.staleManager.instanceId)
    }
  } catch (error) {
    if (error instanceof KunHandoffError) throw error
    throw new KunHandoffError(
      'probe_failed',
      'discover',
      input.reason,
      true,
      undefined,
      'Kun found stale handoff records but could not safely clean them up',
      { cause: error }
    )
  }
}

async function backupAndAuditRuntimeCleanup(
  input: KunInstalledBuildHandoffInput,
  runtime: StaleRuntimeOwner,
  deps: HandoffDependencies
): Promise<void> {
  const record = runtime.inspection.discovery
  await deps.backupCleanupRecord?.(record, record.instanceId)
  await deps.appendCleanupAudit?.({
    at: new Date(deps.now()).toISOString(),
    action: 'cleanup',
    reason: input.reason,
    classification: 'verified_mismatch',
    kind: 'runtime',
    instanceId: record.instanceId,
    pid: record.pid,
    identityEvidence: 'os-identity-mismatch',
    outcome: 'removed'
  })
}

async function proveManagerSlotConverged(
  input: KunInstalledBuildHandoffInput,
  manager: ManagerHandoffDiscoveryRecord,
  stale: StaleRuntimeOwner,
  deps: HandoffDependencies
): Promise<void> {
  const status = await readCompatibleManagerSlots(manager, input.fetch ?? fetch)
  const owner = runtimeOwnerReport(stale)
  if (status.classification === 'manager-status-unavailable') {
    throw new KunHandoffError(
      'probe_failed',
      'discover',
      input.reason,
      true,
      owner,
      `Kun could not verify cleanup of ${ownerLabel(owner)}`
    )
  }
  const oldOwnerRemains = status.records.some((record) =>
    record.flavor === stale.flavor &&
    record.instanceId === stale.inspection.discovery.instanceId &&
    record.pid === stale.inspection.discovery.pid &&
    record.startedAt === stale.inspection.discovery.startedAt
  )
  if (oldOwnerRemains) {
    throw new KunHandoffError(
      'probe_failed',
      'discover',
      input.reason,
      true,
      owner,
      `Kun Service Manager still reports stale ${ownerLabel(owner)}`
    )
  }
}

const RuntimeSlotSchema = z.object({
  flavor: z.enum(['production', 'development']),
  instanceId: z.string().min(1).max(256),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65_535),
  baseUrl: z.string().url().max(2_048),
  runtimeToken: z.string().max(16_384),
  buildId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  logPath: z.string().min(1).max(4_096).optional()
}).passthrough()

async function readCompatibleManagerSlots(
  manager: ManagerHandoffDiscoveryRecord,
  fetchImpl: typeof fetch
): Promise<{
  records: Array<RuntimeHandoffDiscoveryRecord & { flavor: RuntimeFlavor }>
  classification: Extract<
    KunHandoffProbeClassification,
    'manager-status-compatible' | 'manager-status-unavailable'
  >
}> {
  try {
    const response = await fetchImpl(`${manager.baseUrl.replace(/\/$/u, '')}/v1/manager/status`, {
      headers: { authorization: `Bearer ${manager.managerToken}` },
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return { records: [], classification: 'manager-status-unavailable' }
    const body = z.object({
      instanceId: z.string(),
      pid: z.number().int().positive().optional(),
      startedAt: z.string(),
      slots: z.array(z.unknown())
    }).passthrough().safeParse(await response.json())
    if (!body.success || body.data.instanceId !== manager.instanceId ||
      body.data.startedAt !== manager.startedAt ||
      (body.data.pid !== undefined && body.data.pid !== manager.pid)) {
      return { records: [], classification: 'manager-status-unavailable' }
    }
    const records: Array<RuntimeHandoffDiscoveryRecord & { flavor: RuntimeFlavor }> = []
    for (const value of body.data.slots) {
      const envelope = z.object({ registration: z.unknown() }).passthrough().safeParse(value)
      const parsed = RuntimeSlotSchema.safeParse(envelope.success ? envelope.data.registration : value)
      if (!parsed.success) return { records: [], classification: 'manager-status-unavailable' }
      const record: RuntimeHandoffDiscoveryRecord & { flavor: RuntimeFlavor } = {
        version: 1,
        ...parsed.data,
        flavor: parsed.data.flavor
      }
      if (!isSafeRuntimeHandoffDiscovery(record)) {
        return { records: [], classification: 'manager-status-unavailable' }
      }
      records.push(record)
    }
    return { records, classification: 'manager-status-compatible' }
  } catch {
    return { records: [], classification: 'manager-status-unavailable' }
  }
}

function runtimeOwner(
  dataDir: string,
  flavor: RuntimeFlavor,
  record: RuntimeHandoffDiscoveryRecord
): RuntimeOwner {
  return { dataDir, flavor, inspection: { discovery: record, connection: null } }
}

function deduplicateRuntimeOwners(owners: RuntimeOwner[]): RuntimeOwner[] {
  const seen = new Set<string>()
  return owners.filter((owner) => {
    const record = owner.inspection.discovery
    const key = `${record.instanceId}:${record.pid}:${record.startedAt}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function canonicalDataDirs(values: readonly string[]): string[] {
  const result: string[] = []
  for (const value of values) {
    if (!value.trim() || result.some((current) => sameCanonicalPath(current, value))) continue
    result.push(resolve(value))
  }
  return result
}

export function sameRuntimeIdentity(left: RuntimeOwner, right: RuntimeOwner): boolean {
  const a = left.inspection.discovery
  const b = right.inspection.discovery
  return left.flavor === right.flavor && a.instanceId === b.instanceId &&
    a.pid === b.pid && a.startedAt === b.startedAt
}

export function runtimeOwnerReport(runtime: RuntimeOwner): Omit<KunHandoffOwnerReport, 'result'> {
  const record = runtime.inspection.discovery
  return {
    kind: 'runtime',
    flavor: runtime.flavor,
    instanceId: record.instanceId,
    pid: record.pid,
    port: record.port,
    ...(record.buildId ? { buildId: record.buildId } : {})
  }
}

export function managerOwnerReport(
  manager: ManagerHandoffDiscoveryRecord
): Omit<KunHandoffOwnerReport, 'result'> {
  return {
    kind: 'manager',
    instanceId: manager.instanceId,
    pid: manager.pid,
    port: manager.port,
    ...(manager.buildId ? { buildId: manager.buildId } : {})
  }
}

function ownerLabel(owner: Omit<KunHandoffOwnerReport, 'result'>): string {
  return owner.kind === 'runtime'
    ? `${owner.flavor ?? 'unknown'} Runtime${owner.pid ? ` ${owner.pid}` : ''}`
    : `Service Manager${owner.pid ? ` ${owner.pid}` : ''}`
}
