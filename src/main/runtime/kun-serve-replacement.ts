import { resolve } from 'node:path'
import type { RuntimeFlavor } from '../../../kun/src/contracts/runtime-flavor.js'
import type { RuntimeHandoffDiscoveryRecord } from '../../../kun/src/server/runtime-discovery.js'
import { readRuntimeHandoffDiscovery } from '../../../kun/src/server/runtime-discovery.js'
import {
  inspectSharedRuntime,
  type SharedRuntimeConnection,
  type SharedRuntimeScope
} from '../../../kun/src/cli/shared-runtime.js'
import { requestExactRuntimeShutdown } from '../../../kun/src/cli/runtime-shutdown-client.js'
import {
  processAlive,
  runtimeDiscoveryDirectory
} from '../../../kun/src/cli/shared-runtime-support.js'
import { removeRuntimeDiscovery } from '../../../kun/src/server/runtime-discovery.js'
import { withRuntimeDataDirAncillaryWriter } from '../../../kun/src/server/runtime-data-dir-lease.js'
import { unregisterRuntimeWithManager } from '../../../kun/src/manager/manager-client.js'
import {
  identityMatchesExpectedRuntime,
  sameRuntimeOwner as sameDiscoveryRuntimeOwner
} from '../kun-process-identity'
import {
  listListeningPidsOnPort,
  processCommandLine,
  processIdentity,
  terminateVerifiedPid,
  waitForPidExit
} from '../kun-process-ports'
import { KunOwnerVerificationError } from './kun-replacement-error'

export type KunServeReplacementReport = {
  stopped: boolean
  forced: boolean
}

export type SharedRuntimeReplacementInspection = {
  discovery: RuntimeHandoffDiscoveryRecord
  connection: SharedRuntimeConnection | null
}

export type KunServeReplacementDependencies = {
  inspect: (
    dataDir: string,
    fetchImpl: typeof fetch,
    scope: SharedRuntimeScope
  ) => Promise<SharedRuntimeReplacementInspection | null>
  requestShutdown: (
    target: SharedRuntimeReplacementInspection,
    fetchImpl: typeof fetch
  ) => Promise<void>
  waitForExit: typeof waitForPidExit
  commandLine: typeof processCommandLine
  listenerPids: typeof listListeningPidsOnPort
  processIdentity: typeof processIdentity
  terminate: typeof terminateVerifiedPid
  removeDiscovery: typeof removeRuntimeDiscovery
  withAncillaryWriter: typeof withRuntimeDataDirAncillaryWriter
  unregister: typeof unregisterRuntimeWithManager
}

const defaultDependencies: KunServeReplacementDependencies = {
  inspect: inspectSharedRuntimeForReplacement,
  requestShutdown: (target, fetchImpl) =>
    requestExactRuntimeShutdown(target.discovery, fetchImpl),
  waitForExit: waitForPidExit,
  commandLine: processCommandLine,
  listenerPids: listListeningPidsOnPort,
  processIdentity,
  terminate: terminateVerifiedPid,
  removeDiscovery: removeRuntimeDiscovery,
  withAncillaryWriter: withRuntimeDataDirAncillaryWriter,
  unregister: unregisterRuntimeWithManager
}

/**
 * Stop one explicitly selected shared serve before it is replaced. The normal
 * stop operation remains deliberately conservative for ordinary health
 * recovery; this path is only for a user-confirmed restart or file-replacement
 * handoff. It never scans by process name and it never targets another flavor.
 */
export async function stopSharedRuntimeForReplacement(
  dataDir: string,
  fetchImpl: typeof fetch = fetch,
  scope: SharedRuntimeScope = {},
  overrides: Partial<KunServeReplacementDependencies> = {}
): Promise<KunServeReplacementReport> {
  const deps = { ...defaultDependencies, ...overrides }
  const target = await deps.inspect(dataDir, fetchImpl, scope)
  if (!target) return { stopped: false, forced: false }
  return stopExactSharedRuntimeForReplacementWithDependencies(
    dataDir,
    target,
    fetchImpl,
    scope,
    deps
  )
}

export async function stopExactSharedRuntimeForReplacement(
  dataDir: string,
  target: SharedRuntimeReplacementInspection,
  fetchImpl: typeof fetch = fetch,
  scope: SharedRuntimeScope = {},
  overrides: Partial<KunServeReplacementDependencies> = {}
): Promise<KunServeReplacementReport> {
  return stopExactSharedRuntimeForReplacementWithDependencies(
    dataDir,
    target,
    fetchImpl,
    scope,
    { ...defaultDependencies, ...overrides }
  )
}

async function stopExactSharedRuntimeForReplacementWithDependencies(
  dataDir: string,
  target: SharedRuntimeReplacementInspection,
  fetchImpl: typeof fetch,
  scope: SharedRuntimeScope,
  deps: KunServeReplacementDependencies
): Promise<KunServeReplacementReport> {
  try {
    const currentBeforeShutdown = await inspectTarget(dataDir, fetchImpl, scope, deps)
    if (!currentBeforeShutdown.ok) {
      throw new Error('could not re-verify the recorded runtime owner before shutdown')
    }
    if (!sameRuntimeOwner(target, currentBeforeShutdown.value)) {
      return settleChangedRuntimeOwner(dataDir, target, scope, deps)
    }
    await deps.requestShutdown(target, fetchImpl)
    if (await deps.waitForExit(target.discovery.pid, 15_000)) {
      await removeExactOwnership(dataDir, target, scope, deps)
      return { stopped: true, forced: false }
    }
    return forceVerifiedReplacement(
      dataDir,
      target,
      fetchImpl,
      scope,
      deps,
      new Error(`timed out waiting for Kun runtime process ${target.discovery.pid} to exit`)
    )
  } catch (error) {
    return forceVerifiedReplacement(dataDir, target, fetchImpl, scope, deps, error)
  }
}

async function forceVerifiedReplacement(
  dataDir: string,
  target: SharedRuntimeReplacementInspection,
  fetchImpl: typeof fetch,
  scope: SharedRuntimeScope,
  deps: KunServeReplacementDependencies,
  originalError: unknown
): Promise<KunServeReplacementReport> {
  const current = await inspectTarget(dataDir, fetchImpl, scope, deps)
  // The authenticated shutdown may have won a race with its own cleanup, or
  // another client may already have replaced this exact owner. In either case
  // it is no longer safe or necessary to signal the old PID.
  if (!current.ok) throw replacementFailure(runtimeFlavorFor(target, scope), target.discovery.pid, originalError)
  if (!sameRuntimeOwner(target, current.value)) {
    return settleChangedRuntimeOwner(dataDir, target, scope, deps, originalError)
  }

  const flavor = runtimeFlavorFor(target, scope)
  const terminated = await deps.terminate(target.discovery.pid, () =>
    targetStillMatches(dataDir, target, fetchImpl, scope, deps)
  )
  if (!terminated) throw replacementFailure(flavor, target.discovery.pid, originalError)

  const remaining = await inspectTarget(dataDir, fetchImpl, scope, deps)
  if (!remaining.ok || sameRuntimeOwner(target, remaining.value)) {
    throw replacementFailure(flavor, target.discovery.pid, originalError)
  }
  await removeExactOwnership(dataDir, target, scope, deps)
  return { stopped: true, forced: true }
}

async function inspectTarget(
  dataDir: string,
  fetchImpl: typeof fetch,
  scope: SharedRuntimeScope,
  deps: KunServeReplacementDependencies
): Promise<
  { ok: true; value: SharedRuntimeReplacementInspection | null } |
  { ok: false }
> {
  try {
    return { ok: true, value: await deps.inspect(dataDir, fetchImpl, scope) }
  } catch {
    // A failed re-inspection is not evidence that a process is gone. Callers
    // fail closed rather than clearing its ownership record or starting a peer.
    return { ok: false }
  }
}

async function targetStillMatches(
  dataDir: string,
  target: SharedRuntimeReplacementInspection,
  fetchImpl: typeof fetch,
  scope: SharedRuntimeScope,
  deps: KunServeReplacementDependencies
): Promise<boolean> {
  const current = await inspectTarget(dataDir, fetchImpl, scope, deps)
  if (!current.ok || !current.value || !sameRuntimeOwner(target, current.value)) return false
  if (target.discovery.pid === process.pid) return false
  const identity = await deps.processIdentity(target.discovery.pid).catch(() => null)
  return identityMatchesExpectedRuntime(
    identity,
    target.discovery,
    dataDir,
    runtimeFlavorFor(target, scope)
  )
}

function sameRuntimeOwner(
  expected: SharedRuntimeReplacementInspection,
  current: SharedRuntimeReplacementInspection | null
): boolean {
  return Boolean(current && sameDiscoveryRuntimeOwner(expected.discovery, current.discovery))
}

async function settleChangedRuntimeOwner(
  dataDir: string,
  target: SharedRuntimeReplacementInspection,
  scope: SharedRuntimeScope,
  deps: KunServeReplacementDependencies,
  originalError: unknown = new Error('Runtime ownership changed before shutdown')
): Promise<KunServeReplacementReport> {
  if (!(await deps.waitForExit(target.discovery.pid, 0))) {
    throw replacementFailure(
      runtimeFlavorFor(target, scope),
      target.discovery.pid,
      originalError
    )
  }
  await removeExactOwnership(dataDir, target, scope, deps)
  return { stopped: true, forced: false }
}

function runtimeFlavorFor(
  target: SharedRuntimeReplacementInspection,
  scope: SharedRuntimeScope
): RuntimeFlavor {
  return scope.runtimeFlavor ?? target.discovery.flavor ?? 'production'
}

function commandLooksLikeExpectedServe(
  command: string,
  dataDir: string,
  flavor: RuntimeFlavor
): boolean {
  const normalized = command.trim()
  const expectedTitle = flavor === 'development' ? 'kun-dv-runtime' : 'kun-runtime'
  if (normalized === expectedTitle || normalized.startsWith(`${expectedTitle} `)) return true
  const normalizedCommand = normalizeCommandPath(normalized)
  const normalizedDataDir = normalizeCommandPath(resolve(dataDir))
  return normalizedCommand.includes('serve-entry') &&
    normalizedCommand.includes('--data-dir') &&
    normalizedCommand.includes(normalizedDataDir)
}

function normalizeCommandPath(value: string): string {
  const normalized = value.replace(/\\/gu, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function removeExactOwnership(
  dataDir: string,
  target: SharedRuntimeReplacementInspection,
  scope: SharedRuntimeScope,
  deps: KunServeReplacementDependencies
): Promise<void> {
  const flavor = runtimeFlavorFor(target, scope)
  const discoveryDir = runtimeDiscoveryDirectory(dataDir, flavor, scope.controlDir)
  const removeDiscovery = () => deps.removeDiscovery(
    discoveryDir,
    target.discovery.instanceId,
    flavor
  )
  if (flavor === 'production') await deps.withAncillaryWriter(dataDir, removeDiscovery)
  else await removeDiscovery()
  if (scope.manager) {
    await deps.unregister({
      manager: scope.manager,
      flavor,
      instanceId: target.discovery.instanceId
    })
  }
}

function replacementFailure(flavor: RuntimeFlavor, pid: number, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new KunOwnerVerificationError('runtime', pid, `${flavor}: ${detail}`)
}

async function inspectSharedRuntimeForReplacement(
  dataDir: string,
  fetchImpl: typeof fetch,
  scope: SharedRuntimeScope
): Promise<SharedRuntimeReplacementInspection | null> {
  const strict = await inspectSharedRuntime(dataDir, fetchImpl, scope)
  if (strict) return strict
  const flavor = scope.runtimeFlavor ?? 'production'
  const discoveryDir = runtimeDiscoveryDirectory(dataDir, flavor, scope.controlDir)
  const compatible = await readRuntimeHandoffDiscovery(discoveryDir, flavor)
  if (!compatible || !processAlive(compatible.pid)) return null
  return { discovery: compatible, connection: null }
}
