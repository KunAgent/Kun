import type { ChildProcess } from 'node:child_process'
import type { RuntimeClientOwnerKind } from '../contracts/runtime-owner.js'
import type { RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { sameCanonicalPath } from '../manager/canonical-path.js'
import {
  defaultKunControlDir,
  readManagerHandoffDiscoveryStrict
} from '../manager/manager-discovery.js'
import {
  resolveServiceManager,
  type ServiceManagerConnection
} from '../manager/manager-client.js'
import { processIsAlive } from '../manager/manager-client-support.js'
import { withRuntimeStartLock } from '../server/runtime-discovery.js'
import {
  ensureSharedRuntime,
  inspectSharedRuntime,
  runtimeDiscoveryDirectory,
  stopInspectedSharedRuntime,
  type SharedRuntimeConnection,
  type SharedRuntimeInspection,
  type SharedRuntimeScope
} from './shared-runtime.js'
import { terminateSpawnedRuntime } from './shared-runtime-launch.js'

export class ClientOwnedRuntimeConflictError extends Error {
  readonly code = 'client_runtime_owner_busy'

  constructor(
    readonly requestedOwnerKind: RuntimeClientOwnerKind,
    readonly existing: SharedRuntimeInspection,
    readonly dataDir: string
  ) {
    const owner = existing.discovery.clientOwnerKind ?? 'legacy-or-external'
    const tuiHint = requestedOwnerKind === 'tui'
      ? ' To use the existing Runtime, run `kun tui --no-start`.'
      : ''
    super(
      `Kun Runtime is already owned by ${owner} process ${existing.discovery.pid} ` +
      `for ${dataDir}; close that client before retrying.${tuiHint} To start an independent ` +
      'Runtime, isolate KUN_MANAGER_CONTROL_DIR, KUN_MANAGER_SETTINGS_PATH, and KUN_DATA_DIR.'
    )
    this.name = 'ClientOwnedRuntimeConflictError'
  }
}

export type ClientOwnedRuntimeHandle = {
  connection: SharedRuntimeConnection
  instanceId: string
  ownerKind: RuntimeClientOwnerKind
  stop(): Promise<boolean>
}

export type ClientOwnedRuntimeElection = {
  dataDir: string
  ownerKind: RuntimeClientOwnerKind
  runtimeFlavor?: RuntimeFlavor
  controlDir?: string
  manager?: ServiceManagerConnection
  fetch?: typeof fetch
  retireLegacyDaemon?: boolean
}

export async function withClientOwnedRuntimeElection<T>(
  input: ClientOwnedRuntimeElection,
  operation: (scope: SharedRuntimeScope) => Promise<T>
): Promise<T> {
  const runtimeFlavor = input.runtimeFlavor ?? 'production'
  const controlDir = input.controlDir ?? defaultKunControlDir()
  const discoveryDir = runtimeDiscoveryDirectory(input.dataDir, runtimeFlavor, controlDir)
  const fetchImpl = input.fetch ?? fetch
  return withRuntimeStartLock(discoveryDir, async () => {
    const { inspected: existing, scope } = await inspectForClientOwnedElection(
      input, runtimeFlavor, controlDir, fetchImpl
    )
    if (existing) {
      if (input.retireLegacyDaemon !== false && isExactLegacyDaemon(existing)) {
        await stopInspectedSharedRuntime(input.dataDir, existing, fetchImpl, scope)
      } else {
        throw new ClientOwnedRuntimeConflictError(input.ownerKind, existing, input.dataDir)
      }
    }
    return operation(scope)
  }, runtimeFlavor)
}

export async function startClientOwnedRuntime(input: ClientOwnedRuntimeElection & {
  expectedBuildId?: string
  env?: Record<string, string | undefined>
  timeoutMs?: number
  launch?: {
    command: string
    args: string[]
    env?: NodeJS.ProcessEnv
    runAsNode?: boolean
  }
}): Promise<ClientOwnedRuntimeHandle> {
  const runtimeFlavor = input.runtimeFlavor ?? 'production'
  const controlDir = input.controlDir ?? defaultKunControlDir()
  const connection = await withClientOwnedRuntimeElection(input, (scope) => ensureSharedRuntime({
    dataDir: input.dataDir,
    runtimeFlavor,
    controlDir,
    ...(scope.manager ? { manager: scope.manager } : {}),
    ...(input.expectedBuildId ? { expectedBuildId: input.expectedBuildId } : {}),
    ...(input.env ? { env: input.env } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.launch ? { launch: input.launch } : {}),
    clientOwnerKind: input.ownerKind,
    runtimeStartLockHeld: true
  }))
  const instanceId = connection.discovery.instanceId
  return {
    connection,
    instanceId,
    ownerKind: input.ownerKind,
    stop: () => stopExactClientOwnedRuntime({
      ...input,
      runtimeFlavor,
      controlDir,
      instanceId,
      ...(connection.ownerProcess
        ? {
            ownerProcess: connection.ownerProcess,
            expectedOwnerPid: connection.discovery.pid
          }
        : {})
    })
  }
}

export async function stopExactClientOwnedRuntime(input: ClientOwnedRuntimeElection & {
  instanceId: string
  ownerProcess?: ChildProcess
  expectedOwnerPid?: number
}): Promise<boolean> {
  const runtimeFlavor = input.runtimeFlavor ?? 'production'
  const controlDir = input.controlDir ?? defaultKunControlDir()
  const fetchImpl = input.fetch ?? fetch
  let gracefulError: unknown
  try {
    const { inspected, scope } = await inspectExactStopWithManagerFallback(
      input, runtimeFlavor, controlDir, fetchImpl
    )
    if (
      inspected &&
      inspected.discovery.instanceId === input.instanceId &&
      inspected.discovery.clientOwnerKind === input.ownerKind
    ) {
      if (await stopInspectedSharedRuntime(input.dataDir, inspected, fetchImpl, scope)) return true
    }
  } catch (error) {
    gracefulError = error
  }
  if (isExactOwnerProcess(input.ownerProcess, input.expectedOwnerPid)) {
    try {
      await terminateSpawnedRuntime(input.ownerProcess)
      return true
    } catch (cleanupError) {
      if (gracefulError) {
        throw new AggregateError(
          [gracefulError, cleanupError],
          'exact Runtime shutdown and owned-child termination both failed'
        )
      }
      throw cleanupError
    }
  }
  if (gracefulError) throw gracefulError
  return false
}

function isExactLegacyDaemon(inspected: SharedRuntimeInspection): boolean {
  return inspected.published !== false &&
    inspected.connection !== null &&
    inspected.discovery.launchMode === 'shared' &&
    inspected.discovery.clientOwnerKind === undefined
}

function runtimeScope(
  input: ClientOwnedRuntimeElection,
  runtimeFlavor: RuntimeFlavor,
  controlDir: string
): SharedRuntimeScope {
  return {
    runtimeFlavor,
    controlDir,
    ...(input.manager ? { manager: input.manager } : {})
  }
}

async function inspectForClientOwnedElection(
  input: ClientOwnedRuntimeElection,
  runtimeFlavor: RuntimeFlavor,
  controlDir: string,
  fetchImpl: typeof fetch
): Promise<{ inspected: SharedRuntimeInspection | null; scope: SharedRuntimeScope }> {
  const preferredScope = runtimeScope(input, runtimeFlavor, controlDir)
  if (preferredScope.manager && sameCanonicalPath(
    preferredScope.manager.discovery.dataDir,
    input.dataDir
  )) {
    try {
      return {
        inspected: await inspectSharedRuntime(input.dataDir, fetchImpl, preferredScope),
        scope: preferredScope
      }
    } catch {
      // Resolve and authenticate the current Manager below. Never downgrade a
      // failed live Manager read directly to discovery-only election.
    }
  }
  const scope = await resolveSafeElectionScope(
    input,
    runtimeFlavor,
    controlDir,
    fetchImpl
  )
  return {
    inspected: await inspectSharedRuntime(input.dataDir, fetchImpl, scope),
    scope
  }
}

async function resolveSafeElectionScope(
  input: ClientOwnedRuntimeElection,
  runtimeFlavor: RuntimeFlavor,
  controlDir: string,
  fetchImpl: typeof fetch
): Promise<SharedRuntimeScope> {
  const current = await resolveServiceManager(controlDir, fetchImpl)
  if (current) {
    if (!sameCanonicalPath(current.discovery.dataDir, input.dataDir)) {
      throw new Error('Kun Service Manager owns a different canonical data directory')
    }
    return { runtimeFlavor, controlDir, manager: current }
  }
  let persisted
  try {
    persisted = await readManagerHandoffDiscoveryStrict(controlDir)
  } catch (error) {
    throw new Error('Kun Service Manager identity cannot be verified for Runtime election', {
      cause: error
    })
  }
  if (persisted && !sameCanonicalPath(persisted.dataDir, input.dataDir)) {
    throw new Error('Kun Service Manager owns a different canonical data directory')
  }
  if (persisted && processIsAlive(persisted.pid)) {
    throw new Error(`Kun Service Manager process ${persisted.pid} is alive but unavailable`)
  }
  if (input.manager && processIsAlive(input.manager.discovery.pid)) {
    throw new Error(
      `Kun Service Manager process ${input.manager.discovery.pid} is alive but unavailable`
    )
  }
  return { runtimeFlavor, controlDir }
}

async function inspectExactStopWithManagerFallback(
  input: ClientOwnedRuntimeElection,
  runtimeFlavor: RuntimeFlavor,
  controlDir: string,
  fetchImpl: typeof fetch
): Promise<{ inspected: SharedRuntimeInspection | null; scope: SharedRuntimeScope }> {
  const scope = runtimeScope(input, runtimeFlavor, controlDir)
  try {
    return {
      inspected: await inspectSharedRuntime(input.dataDir, fetchImpl, scope),
      scope
    }
  } catch (error) {
    if (!scope.manager) throw error
    const fallback = { runtimeFlavor, controlDir }
    return {
      inspected: await inspectSharedRuntime(input.dataDir, fetchImpl, fallback),
      scope: fallback
    }
  }
}

function isExactOwnerProcess(
  ownerProcess: ChildProcess | undefined,
  expectedOwnerPid: number | undefined
): ownerProcess is ChildProcess {
  return ownerProcess !== undefined &&
    Number.isInteger(expectedOwnerPid) &&
    expectedOwnerPid !== undefined &&
    ownerProcess.pid === expectedOwnerPid
}
