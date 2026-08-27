import { resolve } from 'node:path'
import { z } from 'zod'
import type { RuntimeFlavor } from '../../../kun/src/contracts/runtime-flavor.js'
import {
  isSafeRuntimeHandoffDiscovery,
  readRuntimeHandoffDiscoveryStrict,
  type RuntimeHandoffDiscoveryRecord
} from '../../../kun/src/server/runtime-discovery.js'
import {
  defaultKunControlDir,
  readManagerHandoffDiscoveryStrict,
  withManagerStartLock,
  type ManagerHandoffDiscoveryRecord
} from '../../../kun/src/manager/manager-discovery.js'
import { sameCanonicalPath } from '../../../kun/src/manager/canonical-path.js'
import { processAlive, runtimeDiscoveryDirectory } from '../../../kun/src/cli/shared-runtime-support.js'
import { runtimeBuildIdForFlavor } from '../../../kun/src/cli/runtime-flavor.js'
import {
  stopExactSharedRuntimeForReplacement,
  type KunServeReplacementReport,
  type SharedRuntimeReplacementInspection
} from './kun-serve-replacement'
import {
  stopServiceManagerForReplacement,
  type KunManagerReplacementReport
} from './kun-manager-replacement'
import { KunOwnerVerificationError } from './kun-replacement-error'
import { recordVerifiedForcedRuntimeOwner } from '../../../kun/src/manager/forced-runtime-recovery.js'

const MANAGED_RUNTIME_FLAVORS = ['production', 'development'] as const
const MAX_RUNTIME_DRAIN_PASSES = 3
const STATUS_TIMEOUT_MS = 2_000

export type KunInstalledBuildProbe = 'matched' | 'mismatched' | 'unknown'

export type KunHandoffReason =
  | 'in-app-update'
  | 'installed-build-change'
  | 'exclusive-data-migration'

export type KunHandoffPhase =
  | 'discover'
  | 'quiesce-runtimes'
  | 'stop-runtimes'
  | 'stop-manager'
  | 'verify-drained'
  | 'start-and-verify'

export type KunHandoffErrorCode =
  | 'unsafe_scope'
  | 'probe_failed'
  | 'target_build_id_missing'
  | 'runtime_stop_failed'
  | 'manager_stop_failed'
  | 'postcondition_failed'

export type KunHandoffProbeClassification =
  | 'no-live-owner'
  | 'runtime-discovery-compatible'
  | 'manager-discovery-compatible'
  | 'manager-status-compatible'
  | 'manager-status-unavailable'

export type KunHandoffOwnerReport = {
  kind: 'runtime' | 'manager'
  flavor?: RuntimeFlavor
  instanceId?: string
  pid?: number
  port?: number
  buildId?: string
  result: 'not-found' | 'graceful' | 'forced'
}

export type KunHandoffReport = {
  reason: KunHandoffReason
  targetBuildId?: string
  owners: KunHandoffOwnerReport[]
  elapsedMs: number
}

export type KunHandoffEvent = {
  reason: KunHandoffReason
  phase: KunHandoffPhase
  elapsedMs: number
  targetBuildId?: string
  owner?: Omit<KunHandoffOwnerReport, 'result'>
  result?: KunHandoffOwnerReport['result'] | 'failed'
  code?: KunHandoffErrorCode
  probeClassification?: KunHandoffProbeClassification
  postcondition?: 'drained'
}

export class KunHandoffError extends Error {
  readonly name = 'KunHandoffError'

  constructor(
    readonly code: KunHandoffErrorCode,
    readonly phase: KunHandoffPhase,
    readonly reason: KunHandoffReason,
    readonly retryable: boolean,
    readonly owner: Omit<KunHandoffOwnerReport, 'result'> | undefined,
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, options)
  }
}

export type KunInstalledBuildHandoffInput = {
  reason: KunHandoffReason
  dataDirs: readonly string[]
  settingsPath?: string
  controlDir?: string
  targetBuildId?: string
  fetch?: typeof fetch
  onEvent?: (event: KunHandoffEvent) => void
}

type RuntimeOwner = {
  dataDir: string
  flavor: RuntimeFlavor
  inspection: SharedRuntimeReplacementInspection
}

type HandoffDependencies = {
  readManager: typeof readManagerHandoffDiscoveryStrict
  readRuntime: typeof readRuntimeHandoffDiscoveryStrict
  withManagerLock: <T>(controlDir: string, action: () => Promise<T>) => Promise<T>
  stopRuntime: typeof stopExactSharedRuntimeForReplacement
  stopManager: typeof stopServiceManagerForReplacement
  processAlive: typeof processAlive
  recordForcedOwner: typeof recordVerifiedForcedRuntimeOwner
  now: () => number
}

const defaultDependencies: HandoffDependencies = {
  readManager: readManagerHandoffDiscoveryStrict,
  readRuntime: readRuntimeHandoffDiscoveryStrict,
  withManagerLock: withManagerStartLock,
  stopRuntime: stopExactSharedRuntimeForReplacement,
  stopManager: stopServiceManagerForReplacement,
  processAlive,
  recordForcedOwner: recordVerifiedForcedRuntimeOwner,
  now: Date.now
}

export async function drainKunOwnersForHandoff(
  input: KunInstalledBuildHandoffInput,
  overrides: Partial<HandoffDependencies> = {}
): Promise<KunHandoffReport> {
  return (await withDrainedKunOwners(input, async () => undefined, overrides)).report
}

export async function probeInstalledBuildHandoff(
  input: KunInstalledBuildHandoffInput,
  overrides: Partial<HandoffDependencies> = {}
): Promise<KunInstalledBuildProbe> {
  if (!input.targetBuildId) return 'unknown'
  const deps = { ...defaultDependencies, ...overrides }
  const discovered = await discoverHandoffOwnersSafely(input, deps)
  const targetBuildId = input.targetBuildId
  const identities: Array<{ actual: string | undefined; expected: string }> = [
    ...(discovered.manager
      ? [{ actual: discovered.manager.buildId, expected: targetBuildId }]
      : []),
    ...discovered.runtimes.map((runtime) => ({
      actual: runtime.inspection.discovery.buildId,
      expected: runtimeBuildIdForFlavor(targetBuildId, runtime.flavor) ?? ''
    }))
  ]
  if (identities.some(({ actual, expected }) => actual !== undefined && actual !== expected)) {
    return 'mismatched'
  }
  if (identities.some(({ actual, expected }) => !actual || !expected) ||
    discovered.probeClassifications.includes('manager-status-unavailable')) {
    return 'unknown'
  }
  return 'matched'
}

export function installedBuildProbeError(
  input: KunInstalledBuildHandoffInput,
  probe: KunInstalledBuildProbe
): KunHandoffError | null {
  if (probe !== 'unknown') return null
  const missingBuild = !input.targetBuildId
  return new KunHandoffError(
    missingBuild ? 'target_build_id_missing' : 'probe_failed',
    'discover',
    input.reason,
    !missingBuild,
    undefined,
    missingBuild
      ? 'The packaged Kun Runtime build identity is missing.'
      : 'Kun could not safely determine the installed Runtime owner build.'
  )
}

export async function withDrainedKunOwners<T>(
  input: KunInstalledBuildHandoffInput,
  afterDrain: (report: KunHandoffReport) => Promise<T> | T,
  overrides: Partial<HandoffDependencies> = {}
): Promise<{ report: KunHandoffReport; value: T }> {
  const deps = { ...defaultDependencies, ...overrides }
  const controlDir = input.controlDir ?? defaultKunControlDir()
  return deps.withManagerLock(controlDir, async () => {
    const report = await drainKunOwnersForHandoffWithLock(input, deps)
    return { report, value: await afterDrain(report) }
  })
}

/** Caller must hold the Manager start lock for input.controlDir. */
export async function drainKunOwnersForHandoffWithLock(
  input: KunInstalledBuildHandoffInput,
  overrides: Partial<HandoffDependencies> = {}
): Promise<KunHandoffReport> {
  const deps = { ...defaultDependencies, ...overrides }
  const startedAt = deps.now()
  const controlDir = input.controlDir ?? defaultKunControlDir()
  const fetchImpl = input.fetch ?? fetch
  const owners: KunHandoffOwnerReport[] = MANAGED_RUNTIME_FLAVORS.map((flavor) => ({
    kind: 'runtime' as const,
    flavor,
    result: 'not-found' as const
  }))
  owners.push({ kind: 'manager', result: 'not-found' })

  emit(input, startedAt, deps, { phase: 'discover' })
  let discovered: Awaited<ReturnType<typeof discoverHandoffOwners>>
  try {
    discovered = await discoverHandoffOwnersSafely(input, deps)
  } catch (error) {
    if (error instanceof KunHandoffError) {
      emit(input, startedAt, deps, {
        phase: error.phase,
        ...(error.owner ? { owner: error.owner } : {}),
        result: 'failed',
        code: error.code
      })
    }
    throw error
  }
  for (const probeClassification of discovered.probeClassifications) {
    emit(input, startedAt, deps, { phase: 'discover', probeClassification })
  }
  for (let pass = 0; pass < MAX_RUNTIME_DRAIN_PASSES; pass += 1) {
    if (discovered.runtimes.length === 0) break
    emit(input, startedAt, deps, { phase: 'quiesce-runtimes' })
    for (const runtime of discovered.runtimes) {
      const owner = runtimeOwnerReport(runtime)
      try {
        const result = await deps.stopRuntime(
          runtime.dataDir,
          runtime.inspection,
          fetchImpl,
          { runtimeFlavor: runtime.flavor, controlDir },
          {
            inspect: async () => {
              const latest = await discoverHandoffOwnersSafely(input, deps)
              return latest.runtimes.find((candidate) =>
                sameRuntimeIdentity(candidate, runtime)
              )?.inspection ?? null
            }
          }
        )
        if (result.forced) {
          await deps.recordForcedOwner({
            controlDir,
            dataDir: runtime.dataDir,
            owner: {
              flavor: runtime.flavor,
              instanceId: runtime.inspection.discovery.instanceId,
              pid: runtime.inspection.discovery.pid,
              startedAt: runtime.inspection.discovery.startedAt
            }
          })
        }
        mergeOwnerReport(owners, owner, result)
        emit(input, startedAt, deps, {
          phase: 'stop-runtimes',
          owner,
          result: replacementResult(result)
        })
      } catch (error) {
        const failure = handoffFailure(
          input,
          'runtime_stop_failed',
          'stop-runtimes',
          owner,
          error
        )
        emit(input, startedAt, deps, {
          phase: failure.phase,
          owner,
          result: 'failed',
          code: failure.code
        })
        throw failure
      }
    }
    discovered = await discoverHandoffOwnersSafely(input, deps)
  }

  if (discovered.manager) {
    const managerOwner = managerOwnerReport(discovered.manager)
    try {
      const result = await deps.stopManager(
        controlDir,
        {
          dataDir: discovered.manager.dataDir,
          settingsPath: discovered.manager.settingsPath
        },
        fetchImpl
      )
      mergeOwnerReport(owners, managerOwner, result)
      emit(input, startedAt, deps, {
        phase: 'stop-manager',
        owner: managerOwner,
        result: replacementResult(result)
      })
    } catch (error) {
      const failure = handoffFailure(
        input,
        'manager_stop_failed',
        'stop-manager',
        managerOwner,
        error
      )
      emit(input, startedAt, deps, {
        phase: failure.phase,
        owner: managerOwner,
        result: 'failed',
        code: failure.code
      })
      throw failure
    }
  }

  // Once the Manager is down, a Runtime heartbeat cannot elect a replacement
  // while this process holds the same start lock. Drain any owner that raced
  // with the first pass, then prove the scope is stable.
  discovered = await discoverHandoffOwnersSafely(input, deps)
  for (const runtime of discovered.runtimes) {
    const owner = runtimeOwnerReport(runtime)
    try {
      const result = await deps.stopRuntime(
        runtime.dataDir,
        runtime.inspection,
        fetchImpl,
        { runtimeFlavor: runtime.flavor, controlDir },
        {
          inspect: async () => {
            const latest = await discoverHandoffOwnersSafely(input, deps)
            return latest.runtimes.find((candidate) =>
              sameRuntimeIdentity(candidate, runtime)
            )?.inspection ?? null
          }
        }
      )
      if (result.forced) {
        await deps.recordForcedOwner({
          controlDir,
          dataDir: runtime.dataDir,
          owner: {
            flavor: runtime.flavor,
            instanceId: runtime.inspection.discovery.instanceId,
            pid: runtime.inspection.discovery.pid,
            startedAt: runtime.inspection.discovery.startedAt
          }
        })
      }
      mergeOwnerReport(owners, owner, result)
    } catch (error) {
      const failure = handoffFailure(
        input,
        'runtime_stop_failed',
        'stop-runtimes',
        owner,
        error
      )
      emit(input, startedAt, deps, {
        phase: failure.phase,
        owner,
        result: 'failed',
        code: failure.code
      })
      throw failure
    }
  }

  const remaining = await discoverHandoffOwnersSafely(input, deps)
  if (remaining.manager || remaining.runtimes.length > 0) {
    const owner = remaining.manager
      ? managerOwnerReport(remaining.manager)
      : runtimeOwnerReport(remaining.runtimes[0]!)
    const failure = new KunHandoffError(
      'postcondition_failed',
      'verify-drained',
      input.reason,
      true,
      owner,
      `Kun update handoff could not prove that ${ownerLabel(owner)} exited`
    )
    emit(input, startedAt, deps, {
      phase: failure.phase,
      owner,
      result: 'failed',
      code: failure.code
    })
    throw failure
  }

  emit(input, startedAt, deps, {
    phase: 'verify-drained',
    postcondition: 'drained'
  })
  return {
    reason: input.reason,
    ...(input.targetBuildId ? { targetBuildId: input.targetBuildId } : {}),
    owners,
    elapsedMs: deps.now() - startedAt
  }
}

async function discoverHandoffOwnersSafely(
  input: KunInstalledBuildHandoffInput,
  deps: HandoffDependencies
): ReturnType<typeof discoverHandoffOwners> {
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
): Promise<{
  manager: ManagerHandoffDiscoveryRecord | null
  runtimes: RuntimeOwner[]
  probeClassifications: KunHandoffProbeClassification[]
}> {
  const controlDir = input.controlDir ?? defaultKunControlDir()
  const manager = await deps.readManager(controlDir)
  if (manager && input.settingsPath &&
    !sameCanonicalPath(manager.settingsPath, input.settingsPath)) {
    throw new KunHandoffError(
      'unsafe_scope',
      'discover',
      input.reason,
      false,
      managerOwnerReport(manager),
      'Kun Service Manager owns a different canonical settings scope'
    )
  }
  const dataDirs = canonicalDataDirs([
    ...input.dataDirs,
    ...(manager ? [manager.dataDir] : [])
  ])
  const runtimes: RuntimeOwner[] = []
  for (const dataDir of dataDirs) {
    const record = await deps.readRuntime(dataDir, 'production')
    if (record && deps.processAlive(record.pid)) {
      runtimes.push(runtimeOwner(dataDir, 'production', record))
    }
  }
  const developmentDir = manager?.dataDir ?? dataDirs[0]
  if (developmentDir) {
    const record = await deps.readRuntime(controlDir, 'development')
    if (record && deps.processAlive(record.pid)) {
      runtimes.push(runtimeOwner(developmentDir, 'development', record))
    }
  }
  const probeClassifications: KunHandoffProbeClassification[] = []
  if (runtimes.length > 0) probeClassifications.push('runtime-discovery-compatible')
  if (manager && deps.processAlive(manager.pid)) {
    probeClassifications.push('manager-discovery-compatible')
  }
  if (manager && deps.processAlive(manager.pid)) {
    const managerStatus = await readCompatibleManagerSlots(manager, input.fetch ?? fetch)
    probeClassifications.push(managerStatus.classification)
    for (const slot of managerStatus.records) {
      if (!deps.processAlive(slot.pid)) continue
      runtimes.push(runtimeOwner(manager.dataDir, slot.flavor, slot))
    }
  }
  if (probeClassifications.length === 0) probeClassifications.push('no-live-owner')
  return {
    manager: manager && deps.processAlive(manager.pid) ? manager : null,
    runtimes: deduplicateRuntimeOwners(runtimes),
    probeClassifications
  }
}

const RuntimeSlotSchema = z.object({
  flavor: z.enum(MANAGED_RUNTIME_FLAVORS),
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
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS)
    })
    if (!response.ok) return { records: [], classification: 'manager-status-unavailable' }
    const body = z.object({
      instanceId: z.string(),
      pid: z.number().int().positive().optional(),
      startedAt: z.string(),
      slots: z.array(z.unknown())
    }).passthrough().safeParse(await response.json())
    if (!body.success ||
      body.data.instanceId !== manager.instanceId ||
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
  return {
    dataDir,
    flavor,
    inspection: { discovery: record, connection: null }
  }
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

function sameRuntimeIdentity(left: RuntimeOwner, right: RuntimeOwner): boolean {
  const a = left.inspection.discovery
  const b = right.inspection.discovery
  return left.flavor === right.flavor &&
    a.instanceId === b.instanceId &&
    a.pid === b.pid &&
    a.startedAt === b.startedAt
}

function runtimeOwnerReport(runtime: RuntimeOwner): Omit<KunHandoffOwnerReport, 'result'> {
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

function managerOwnerReport(
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

function mergeOwnerReport(
  reports: KunHandoffOwnerReport[],
  owner: Omit<KunHandoffOwnerReport, 'result'>,
  replacement: KunServeReplacementReport | KunManagerReplacementReport
): void {
  const result = replacementResult(replacement)
  const existing = reports.find((candidate) =>
    candidate.kind === owner.kind && candidate.flavor === owner.flavor
  )
  if (existing) Object.assign(existing, owner, { result })
  else reports.push({ ...owner, result })
}

function replacementResult(
  report: KunServeReplacementReport | KunManagerReplacementReport
): KunHandoffOwnerReport['result'] {
  return report.forced ? 'forced' : report.stopped ? 'graceful' : 'not-found'
}

function handoffFailure(
  input: KunInstalledBuildHandoffInput,
  code: KunHandoffErrorCode,
  phase: KunHandoffPhase,
  owner: Omit<KunHandoffOwnerReport, 'result'>,
  cause: unknown
): KunHandoffError {
  return new KunHandoffError(
    code,
    phase,
    input.reason,
    !(cause instanceof KunOwnerVerificationError),
    owner,
    `Kun update handoff could not safely stop ${ownerLabel(owner)}`,
    { cause }
  )
}

function ownerLabel(owner: Omit<KunHandoffOwnerReport, 'result'>): string {
  return owner.kind === 'runtime'
    ? `${owner.flavor ?? 'unknown'} Runtime${owner.pid ? ` ${owner.pid}` : ''}`
    : `Service Manager${owner.pid ? ` ${owner.pid}` : ''}`
}

function emit(
  input: KunInstalledBuildHandoffInput,
  startedAt: number,
  deps: HandoffDependencies,
  event: Omit<KunHandoffEvent, 'reason' | 'elapsedMs'>
): void {
  input.onEvent?.({
    reason: input.reason,
    elapsedMs: deps.now() - startedAt,
    ...(input.targetBuildId ? { targetBuildId: input.targetBuildId } : {}),
    ...event
  })
}
