import type { RuntimeFlavor } from '../../../kun/src/contracts/runtime-flavor.js'
import {
  defaultKunControlDir,
  withManagerStartLock
} from '../../../kun/src/manager/manager-discovery.js'
import { runtimeBuildIdForFlavor } from '../../../kun/src/cli/runtime-flavor.js'
import {
  type KunServeReplacementReport
} from './kun-serve-replacement'
import { type KunManagerReplacementReport } from './kun-manager-replacement'
import { KunOwnerVerificationError } from './kun-replacement-error'
import { recordVerifiedForcedRuntimeOwner } from '../../../kun/src/manager/forced-runtime-recovery.js'
import {
  defaultDiscoveryDependencies,
  discoverHandoffOwnersSafely,
  managerOwnerReport,
  runtimeOwnerReport,
  sameRuntimeIdentity,
  settleStaleHandoffOwners,
  type DiscoveredHandoffOwners,
  type HandoffDependencies,
  type RuntimeOwner
} from './kun-installed-build-handoff-discovery'

const MANAGED_RUNTIME_FLAVORS = ['production', 'development'] as const
const MAX_RUNTIME_DRAIN_PASSES = 3
const MAX_STALE_OWNER_SETTLEMENT_PASSES = 3

export type KunInstalledBuildProbe = 'matched' | 'mismatched' | 'unknown'

export type KunHandoffReason =
  | 'in-app-update'
  | 'installed-build-change'
  | 'startup-retry'
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
  | 'identity_unverifiable'
  | 'target_build_id_missing'
  | 'runtime_stop_failed'
  | 'manager_stop_failed'
  | 'postcondition_failed'

export type KunHandoffProbeClassification =
  | 'no-live-owner'
  | 'stale-owner'
  | 'runtime-discovery-compatible'
  | 'manager-discovery-compatible'
  | 'manager-status-compatible'
  | 'manager-status-unavailable'
  | 'identity-unverifiable'

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

export class ClientRuntimeOwnerBusyError extends Error {
  readonly name = 'ClientRuntimeOwnerBusyError'
  readonly code = 'client_runtime_owner_busy'
  readonly reason = 'installed-build-change'

  constructor(
    readonly ownerKind: 'gui' | 'tui',
    readonly owner: Omit<KunHandoffOwnerReport, 'result'>
  ) {
    super(
      `client_runtime_owner_busy: Kun Runtime is owned by ${ownerKind} process ${owner.pid}; ` +
      `close the owning ${ownerKind === 'gui' ? 'GUI' : 'TUI'} before starting this installed GUI build`
    )
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

const defaultDependencies: HandoffDependencies = {
  ...defaultDiscoveryDependencies,
  withManagerLock: withManagerStartLock,
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
  const deps = { ...defaultDependencies, ...overrides }
  const discovered = await discoverHandoffOwnersSafely(input, deps)
  assertReplacementHasNoClientOwner(input, discovered)
  if (discovered.unknownManager || discovered.unknownRuntimes.length > 0) {
    throw identityUnverifiableError(input, discovered)
  }
  if (!input.targetBuildId) return 'unknown'
  if (discovered.staleManager || discovered.staleRuntimes.length > 0) return 'mismatched'
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
  let discovered: DiscoveredHandoffOwners
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
  discovered = await settleAndRediscoverStaleOwners(input, discovered, deps)
  assertReplacementHasNoClientOwner(input, discovered)
  if (discovered.unknownManager || discovered.unknownRuntimes.length > 0) {
    throw identityUnverifiableError(input, discovered)
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
    discovered = await settleAndRediscoverStaleOwners(input, discovered, deps)
    assertReplacementHasNoClientOwner(input, discovered)
  }

  // Recheck immediately before stopping the independent Manager. A client may
  // have elected a Runtime after the preceding drain pass; ordinary installed
  // startup has no authority to take either that Runtime or its Manager down.
  discovered = await discoverHandoffOwnersSafely(input, deps)
  discovered = await settleAndRediscoverStaleOwners(input, discovered, deps)
  assertReplacementHasNoClientOwner(input, discovered)
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
  discovered = await settleAndRediscoverStaleOwners(input, discovered, deps)
  assertReplacementHasNoClientOwner(input, discovered)
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

  let remaining = await discoverHandoffOwnersSafely(input, deps)
  remaining = await settleAndRediscoverStaleOwners(input, remaining, deps)
  if (remaining.unknownManager || remaining.unknownRuntimes.length > 0) {
    throw identityUnverifiableError(input, remaining)
  }
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

function assertReplacementHasNoClientOwner(
  input: KunInstalledBuildHandoffInput,
  discovered: DiscoveredHandoffOwners
): void {
  if (input.reason !== 'installed-build-change' && input.reason !== 'startup-retry') return
  const runtime = discovered.runtimes.find(
    (candidate) => candidate.inspection.discovery.clientOwnerKind !== undefined
  )
  if (!runtime) return
  const ownerKind = runtime.inspection.discovery.clientOwnerKind!
  const owner = runtimeOwnerReport(runtime)
  throw new ClientRuntimeOwnerBusyError(ownerKind, owner)
}

async function settleAndRediscoverStaleOwners(
  input: KunInstalledBuildHandoffInput,
  discovered: DiscoveredHandoffOwners,
  deps: HandoffDependencies
): Promise<DiscoveredHandoffOwners> {
  let current = discovered
  for (let pass = 0; pass < MAX_STALE_OWNER_SETTLEMENT_PASSES; pass += 1) {
    await settleStaleHandoffOwners(input, current, deps)
    if (!current.staleManager && current.staleRuntimes.length === 0) return current
    current = await discoverHandoffOwnersSafely(input, deps)
  }
  const owner = current.staleManager
    ? managerOwnerReport(current.staleManager)
    : current.staleRuntimes[0]
      ? runtimeOwnerReport(current.staleRuntimes[0])
      : undefined
  throw new KunHandoffError(
    'probe_failed',
    'discover',
    input.reason,
    true,
    owner,
    'Kun stale handoff ownership did not converge after cleanup'
  )
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

function identityUnverifiableError(
  input: KunInstalledBuildHandoffInput,
  discovered: DiscoveredHandoffOwners
): KunHandoffError {
  const owner = discovered.unknownManager
    ? managerOwnerReport(discovered.unknownManager)
    : discovered.unknownRuntimes.length > 0
      ? runtimeOwnerReport(discovered.unknownRuntimes[0]!)
      : undefined
  return new KunHandoffError(
    'identity_unverifiable',
    'discover',
    input.reason,
    true,
    owner,
    'Kun could not verify the identity of the previous local owner, so it left the process, active work, and saved data untouched.'
  )
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
