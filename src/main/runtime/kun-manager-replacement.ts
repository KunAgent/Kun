import {
  readManagerHandoffDiscovery,
  removeManagerDiscovery,
  type ManagerHandoffDiscoveryRecord
} from '../../../kun/src/manager/manager-discovery.js'
import { sameCanonicalPath } from '../../../kun/src/manager/canonical-path.js'
import {
  listListeningPidsOnPort,
  processCommandLine,
  terminateVerifiedPid,
  waitForPidExit
} from '../kun-process-ports'
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
  commandLine: typeof processCommandLine
  listenerPids: typeof listListeningPidsOnPort
  terminate: typeof terminateVerifiedPid
  removeDiscovery: typeof removeManagerDiscovery
}

const defaultDependencies: KunManagerReplacementDependencies = {
  readDiscovery: readManagerHandoffDiscovery,
  requestShutdown: requestExactManagerShutdown,
  waitForExit: waitForPidExit,
  commandLine: processCommandLine,
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

  try {
    const current = await readTarget(controlDir, deps)
    if (!current.ok || !sameManagerOwner(target, current.value)) {
      return settleChangedOwner(controlDir, target, deps)
    }
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
      new Error(`timed out waiting for Kun Service Manager ${target.pid} to exit`)
    )
  } catch (error) {
    return forceVerifiedManager(controlDir, scope, target, deps, error)
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
  originalError: unknown
): Promise<KunManagerReplacementReport> {
  const current = await readTarget(controlDir, deps)
  if (!current.ok || !sameManagerOwner(target, current.value)) {
    return settleChangedOwner(controlDir, target, deps, originalError)
  }
  const terminated = await deps.terminate(target.pid, () =>
    targetStillMatches(controlDir, scope, target, deps)
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
  deps: KunManagerReplacementDependencies
): Promise<boolean> {
  const current = await readTarget(controlDir, deps)
  if (!current.ok || !current.value ||
    !sameManagerOwner(target, current.value) || target.pid === process.pid) {
    return false
  }
  try {
    assertManagerScope(current.value, scope)
  } catch {
    return false
  }
  const [command, listeners] = await Promise.all([
    deps.commandLine(target.pid).catch(() => ''),
    deps.listenerPids(target.port).catch((): number[] => [])
  ])
  return commandLooksLikeManager(command) && listeners.includes(target.pid)
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

function commandLooksLikeManager(command: string): boolean {
  const normalized = command.trim().replace(/\\/gu, '/').toLowerCase()
  return normalized === 'kun-service-manager' ||
    normalized.startsWith('kun-service-manager ') ||
    normalized.includes('manager-entry.js')
}

function replacementFailure(pid: number, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new KunOwnerVerificationError('manager', pid, detail)
}
