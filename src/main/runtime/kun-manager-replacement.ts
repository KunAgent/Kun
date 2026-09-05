import {
  readManagerHandoffDiscovery,
  removeManagerDiscovery,
  type ManagerHandoffDiscoveryRecord
} from '../../../kun/src/manager/manager-discovery.js'
import { sameCanonicalPath } from '../../../kun/src/manager/canonical-path.js'
import {
  listListeningPidsOnPort,
  processIdentity,
  terminateVerifiedPid,
  waitForPidExit,
  type ProcessIdentity
} from '../kun-process-ports'
import { identityMatchesExpectedManager } from '../kun-process-identity'
import { KunOwnerVerificationError } from './kun-replacement-error'

const GRACEFUL_EXIT_TIMEOUT_MS = 15_000
const SHUTDOWN_REQUEST_TIMEOUT_MS = 5_000

export type KunManagerReplacementReport = {
  stopped: boolean
  forced: boolean
}

export type KunManagerReplacementScope = {
  dataDir: string
  settingsPath: string
}

export type KunManagerReplacementDependencies = {
  readDiscovery: typeof readManagerHandoffDiscovery
  requestShutdown: (
    target: ManagerHandoffDiscoveryRecord,
    fetchImpl: typeof fetch
  ) => Promise<void>
  waitForExit: typeof waitForPidExit
  processIdentity: typeof processIdentity
  listenerPids: typeof listListeningPidsOnPort
  terminate: typeof terminateVerifiedPid
  removeDiscovery: typeof removeManagerDiscovery
}

const defaultDependencies: KunManagerReplacementDependencies = {
  readDiscovery: readManagerHandoffDiscovery,
  requestShutdown: requestExactManagerShutdown,
  waitForExit: waitForPidExit,
  processIdentity,
  listenerPids: listListeningPidsOnPort,
  terminate: terminateVerifiedPid,
  removeDiscovery: removeManagerDiscovery
}

/** Stop one exact Manager during an explicit replacement or migration. */
export async function stopServiceManagerForReplacement(
  controlDir: string,
  scope: KunManagerReplacementScope,
  fetchImpl: typeof fetch = fetch,
  overrides: Partial<KunManagerReplacementDependencies> = {}
): Promise<KunManagerReplacementReport> {
  const deps = { ...defaultDependencies, ...overrides }
  const target = await deps.readDiscovery(controlDir)
  if (!target) return { stopped: false, forced: false }
  assertManagerScope(target, scope)

  if (await deps.waitForExit(target.pid, 0)) {
    await deps.removeDiscovery(controlDir, target.instanceId)
    return { stopped: false, forced: false }
  }

  let verifiedIdentity: ProcessIdentity | null = null
  try {
    const current = await readTarget(controlDir, deps)
    if (!current.ok || !sameManagerOwner(target, current.value)) {
      return settleChangedOwner(controlDir, target, deps)
    }
    // Capture the process birth identity while the authenticated Manager is
    // still listening. A graceful shutdown removes discovery and closes the
    // listener before every Electron/Node worker has necessarily exited, so
    // those two signals cannot remain mandatory during forced escalation.
    verifiedIdentity = await captureVerifiedManagerIdentity(
      controlDir,
      scope,
      target,
      deps
    )
    await deps.requestShutdown(target, fetchImpl)
    if (await deps.waitForExit(target.pid, GRACEFUL_EXIT_TIMEOUT_MS)) {
      await deps.removeDiscovery(controlDir, target.instanceId)
      return { stopped: true, forced: false }
    }
    return forceVerifiedManager(
      controlDir,
      scope,
      target,
      deps,
      new Error(`timed out waiting for Kun Service Manager ${target.pid} to exit`),
      verifiedIdentity
    )
  } catch (error) {
    return forceVerifiedManager(controlDir, scope, target, deps, error, verifiedIdentity)
  }
}

async function requestExactManagerShutdown(
  target: ManagerHandoffDiscoveryRecord,
  fetchImpl: typeof fetch
): Promise<void> {
  const response = await fetchImpl(`${target.baseUrl.replace(/\/$/u, '')}/v1/manager/shutdown`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.managerToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ instanceId: target.instanceId }),
    signal: AbortSignal.timeout(SHUTDOWN_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`manager shutdown failed with HTTP ${response.status}`)
}

async function forceVerifiedManager(
  controlDir: string,
  scope: KunManagerReplacementScope,
  target: ManagerHandoffDiscoveryRecord,
  deps: KunManagerReplacementDependencies,
  originalError: unknown,
  verifiedIdentity?: ProcessIdentity | null
): Promise<KunManagerReplacementReport> {
  const current = await readTarget(controlDir, deps)
  if (!current.ok) throw replacementFailure(target.pid, originalError)
  if (current.value && !sameManagerOwner(target, current.value)) {
    return settleChangedOwner(controlDir, target, deps, originalError)
  }
  if (!current.value && !verifiedIdentity) {
    return settleChangedOwner(controlDir, target, deps, originalError)
  }
  const terminated = await deps.terminate(target.pid, () =>
    targetStillMatches(controlDir, scope, target, deps, verifiedIdentity)
  )
  if (!terminated || !(await deps.waitForExit(target.pid, 0))) {
    throw replacementFailure(target.pid, originalError)
  }

  const remaining = await readTarget(controlDir, deps)
  if (!remaining.ok) throw replacementFailure(target.pid, originalError)
  if (sameManagerOwner(target, remaining.value)) {
    await deps.removeDiscovery(controlDir, target.instanceId)
  }
  return { stopped: true, forced: true }
}

async function settleChangedOwner(
  controlDir: string,
  target: ManagerHandoffDiscoveryRecord,
  deps: KunManagerReplacementDependencies,
  originalError: unknown = new Error('Manager ownership changed before shutdown')
): Promise<KunManagerReplacementReport> {
  if (!(await deps.waitForExit(target.pid, 0))) {
    throw replacementFailure(target.pid, originalError)
  }
  await deps.removeDiscovery(controlDir, target.instanceId)
  return { stopped: true, forced: false }
}

async function targetStillMatches(
  controlDir: string,
  scope: KunManagerReplacementScope,
  target: ManagerHandoffDiscoveryRecord,
  deps: KunManagerReplacementDependencies,
  verifiedIdentity?: ProcessIdentity | null
): Promise<boolean> {
  const current = await readTarget(controlDir, deps)
  if (!current.ok ||
    (current.value && !sameManagerOwner(target, current.value)) ||
    (!current.value && !verifiedIdentity) ||
    target.pid === process.pid) {
    return false
  }
  try {
    assertManagerScope(current.value ?? target, scope)
  } catch {
    return false
  }
  const identity = await deps.processIdentity(target.pid).catch(() => null)
  if (!identityMatchesExpectedManager(identity, target)) return false
  if (verifiedIdentity && sameProcessBirth(verifiedIdentity, identity)) return true
  if (!current.value) return false
  const listeners = await deps.listenerPids(target.port).catch((): number[] => [])
  return listeners.includes(target.pid)
}

async function captureVerifiedManagerIdentity(
  controlDir: string,
  scope: KunManagerReplacementScope,
  target: ManagerHandoffDiscoveryRecord,
  deps: KunManagerReplacementDependencies
): Promise<ProcessIdentity | null> {
  const before = await readTarget(controlDir, deps)
  if (!before.ok || !before.value || !sameManagerOwner(target, before.value)) return null
  try {
    assertManagerScope(before.value, scope)
  } catch {
    return null
  }
  const [identity, listeners] = await Promise.all([
    deps.processIdentity(target.pid).catch(() => null),
    deps.listenerPids(target.port).catch((): number[] => [])
  ])
  if (!identityMatchesExpectedManager(identity, target) ||
    !Array.isArray(listeners) || !listeners.includes(target.pid)) {
    return null
  }
  const after = await readTarget(controlDir, deps)
  return after.ok && sameManagerOwner(target, after.value) ? identity : null
}

function sameProcessBirth(expected: ProcessIdentity, current: ProcessIdentity | null): boolean {
  return current !== null &&
    expected.pid === current.pid &&
    expected.startedAtMs !== null &&
    current.startedAtMs === expected.startedAtMs
}

async function readTarget(
  controlDir: string,
  deps: KunManagerReplacementDependencies
): Promise<
  { ok: true; value: ManagerHandoffDiscoveryRecord | null } |
  { ok: false }
> {
  try {
    return { ok: true, value: await deps.readDiscovery(controlDir) }
  } catch {
    return { ok: false }
  }
}

function sameManagerOwner(
  expected: ManagerHandoffDiscoveryRecord,
  current: ManagerHandoffDiscoveryRecord | null
): boolean {
  return current !== null &&
    current.instanceId === expected.instanceId &&
    current.pid === expected.pid &&
    current.startedAt === expected.startedAt &&
    current.baseUrl === expected.baseUrl &&
    current.port === expected.port &&
    current.managerToken === expected.managerToken &&
    sameCanonicalPath(current.dataDir, expected.dataDir) &&
    sameCanonicalPath(current.settingsPath, expected.settingsPath)
}

function assertManagerScope(
  target: ManagerHandoffDiscoveryRecord,
  scope: KunManagerReplacementScope
): void {
  if (!sameCanonicalPath(target.dataDir, scope.dataDir) ||
    !sameCanonicalPath(target.settingsPath, scope.settingsPath)) {
    throw new Error('Kun Service Manager replacement target owns a different canonical scope')
  }
}

function replacementFailure(pid: number, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new KunOwnerVerificationError('manager', pid, detail)
}
