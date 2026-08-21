import { resolve } from 'node:path'
import type { RuntimeFlavor } from '../../../kun/src/contracts/runtime-flavor.js'
import {
  inspectSharedRuntime,
  type SharedRuntimeInspection,
  type SharedRuntimeScope
} from '../../../kun/src/cli/shared-runtime.js'
import { runtimeDiscoveryDirectory } from '../../../kun/src/cli/shared-runtime-support.js'
import { removeRuntimeDiscovery } from '../../../kun/src/server/runtime-discovery.js'
import { withRuntimeDataDirAncillaryWriter } from '../../../kun/src/server/runtime-data-dir-lease.js'
import { unregisterRuntimeWithManager } from '../../../kun/src/manager/manager-client.js'
import {
  listListeningPidsOnPort,
  processCommandLine,
  terminateVerifiedPid,
  waitForPidExit
} from '../kun-process-ports'

export type KunServeReplacementReport = {
  stopped: boolean
  forced: boolean
}

export type KunServeReplacementDependencies = {
  inspect: typeof inspectSharedRuntime
  requestShutdown: (target: SharedRuntimeInspection, fetchImpl: typeof fetch) => Promise<void>
  waitForExit: typeof waitForPidExit
  commandLine: typeof processCommandLine
  listenerPids: typeof listListeningPidsOnPort
  terminate: typeof terminateVerifiedPid
  removeDiscovery: typeof removeRuntimeDiscovery
  withAncillaryWriter: typeof withRuntimeDataDirAncillaryWriter
  unregister: typeof unregisterRuntimeWithManager
}

const defaultDependencies: KunServeReplacementDependencies = {
  inspect: inspectSharedRuntime,
  requestShutdown: requestExactRuntimeShutdown,
  waitForExit: waitForPidExit,
  commandLine: processCommandLine,
  listenerPids: listListeningPidsOnPort,
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

  try {
    const currentBeforeShutdown = await inspectTarget(dataDir, fetchImpl, scope, deps)
    if (!currentBeforeShutdown.ok) {
      throw new Error('could not re-verify the recorded runtime owner before shutdown')
    }
    if (!sameRuntimeOwner(target, currentBeforeShutdown.value)) {
      await removeExactOwnership(dataDir, target, scope, deps)
      return { stopped: true, forced: false }
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
  target: SharedRuntimeInspection,
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
    await removeExactOwnership(dataDir, target, scope, deps)
    return { stopped: true, forced: false }
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

async function requestExactRuntimeShutdown(
  target: SharedRuntimeInspection,
  fetchImpl: typeof fetch
): Promise<void> {
  const response = await fetchImpl(`${target.discovery.baseUrl.replace(/\/$/u, '')}/v1/runtime/shutdown`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.discovery.runtimeToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ instanceId: target.discovery.instanceId }),
    signal: AbortSignal.timeout(5_000)
  })
  if (!response.ok) throw new Error(`runtime shutdown failed with HTTP ${response.status}`)
}

async function inspectTarget(
  dataDir: string,
  fetchImpl: typeof fetch,
  scope: SharedRuntimeScope,
  deps: KunServeReplacementDependencies
): Promise<{ ok: true; value: SharedRuntimeInspection | null } | { ok: false }> {
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
  target: SharedRuntimeInspection,
  fetchImpl: typeof fetch,
  scope: SharedRuntimeScope,
  deps: KunServeReplacementDependencies
): Promise<boolean> {
  const current = await inspectTarget(dataDir, fetchImpl, scope, deps)
  if (!current.ok || !sameRuntimeOwner(target, current.value)) return false
  if (target.discovery.pid === process.pid) return false
  const [command, listeners] = await Promise.all([
    deps.commandLine(target.discovery.pid).catch(() => ''),
    deps.listenerPids(target.discovery.port)
  ])
  return commandLooksLikeExpectedServe(
    command,
    dataDir,
    runtimeFlavorFor(target, scope)
  ) && listeners.includes(target.discovery.pid)
}

function sameRuntimeOwner(
  expected: SharedRuntimeInspection,
  current: SharedRuntimeInspection | null
): boolean {
  if (!current) return false
  return current.discovery.instanceId === expected.discovery.instanceId &&
    current.discovery.pid === expected.discovery.pid &&
    current.discovery.startedAt === expected.discovery.startedAt
}

function runtimeFlavorFor(
  target: SharedRuntimeInspection,
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
  target: SharedRuntimeInspection,
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
  return new Error(
    `Kun ${flavor} serve ${pid} could not be safely replaced after graceful shutdown failed: ${detail}`
  )
}
