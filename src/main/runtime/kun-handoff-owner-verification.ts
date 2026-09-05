import { resolve } from 'node:path'
import type { RuntimeFlavor } from '../../../kun/src/contracts/runtime-flavor.js'
import type { ManagerHandoffDiscoveryRecord } from '../../../kun/src/manager/manager-discovery.js'
import type { RuntimeHandoffDiscoveryRecord } from '../../../kun/src/server/runtime-discovery.js'
import {
  MAX_RUNTIME_STARTED_AT_DIFFERENCE_MS,
  identityMatchesExpectedManager,
  identityMatchesExpectedRuntime
} from '../kun-process-identity'
import type { ProcessIdentity } from '../kun-process-ports'

export type OwnerVerification = 'verified_owner' | 'verified_mismatch' | 'unknown'

export type OwnerVerificationDependencies = {
  processIdentity: (pid: number) => Promise<ProcessIdentity | null>
  fetch: typeof fetch
  now?: () => number
}

const IDENTITY_FETCH_TIMEOUT_MS = 2_000

/**
 * Three-state process ownership verdict for a single Runtime discovery record.
 *
 * - `verified_owner`:   the live PID provably belongs to this exact owner.
 * - `verified_mismatch`: the live PID provably does NOT belong to this owner.
 * - `unknown`:          neither is provable. Callers must fail closed and never
 *                       terminate the PID or reclaim its port.
 *
 * OS process identity (command line, birth time, executable path) is the
 * primary signal. When that signal is unreadable — a null identity, a missing
 * `startedAtMs`, or (on Windows) a missing `ExecutablePath` — the function
 * falls back to the token-authenticated `/v1/runtime/identity` endpoint, which
 * is reachable only from loopback and must match every identity field.
 */
export async function verifyRuntimeOwner(
  record: RuntimeHandoffDiscoveryRecord,
  dataDir: string,
  flavor: RuntimeFlavor,
  deps: OwnerVerificationDependencies
): Promise<OwnerVerification> {
  const identity = await readIdentity(record.pid, deps)
  if (identity !== 'unreadable') {
    return identityMatchesExpectedRuntime(identity, record, dataDir, flavor)
      ? 'verified_owner'
      : 'verified_mismatch'
  }
  return crossVerifyRuntimeOwner(record, dataDir, deps)
}

export async function verifyManagerOwner(
  record: ManagerHandoffDiscoveryRecord,
  deps: OwnerVerificationDependencies
): Promise<OwnerVerification> {
  const identity = await readIdentity(record.pid, deps)
  if (identity !== 'unreadable') {
    return identityMatchesExpectedManager(identity, record)
      ? 'verified_owner'
      : 'verified_mismatch'
  }
  return crossVerifyManagerOwner(record, deps)
}

/**
 * Returns the OS identity when every field required for a positive or negative
 * verdict is present, or `'unreadable'` when any field is missing. On Windows
 * the executable path is mandatory because PID reuse plus a missing path would
 * otherwise collapse the mismatch branch into the owner branch.
 */
async function readIdentity(
  pid: number,
  deps: OwnerVerificationDependencies
): Promise<ProcessIdentity | 'unreadable'> {
  const identity = await deps.processIdentity(pid).catch(() => null)
  if (!identity || identity.startedAtMs === null) return 'unreadable'
  if (process.platform === 'win32' && !identity.executablePath) return 'unreadable'
  return identity
}

async function crossVerifyRuntimeOwner(
  record: RuntimeHandoffDiscoveryRecord,
  dataDir: string,
  deps: OwnerVerificationDependencies
): Promise<OwnerVerification> {
  try {
    const response = await deps.fetch(
      `${record.baseUrl.replace(/\/$/u, '')}/v1/runtime/identity`,
      {
        headers: { authorization: `Bearer ${record.runtimeToken}` },
        signal: AbortSignal.timeout(IDENTITY_FETCH_TIMEOUT_MS)
      }
    )
    if (!response.ok) return 'unknown'
    const body = await response.json() as {
      instanceId?: unknown
      pid?: unknown
      startedAt?: unknown
      buildId?: unknown
      dataDir?: unknown
      port?: unknown
    }
    if (body.instanceId !== record.instanceId) return 'unknown'
    if (body.pid !== record.pid) return 'unknown'
    if (body.port !== record.port) return 'unknown'
    if (!sameStartedAt(body.startedAt, record.startedAt)) return 'unknown'
    if (record.buildId !== undefined && body.buildId !== record.buildId) return 'unknown'
    if (typeof body.dataDir === 'string' && !sameCanonicalPath(body.dataDir, dataDir)) {
      return 'unknown'
    }
    return 'verified_owner'
  } catch {
    return 'unknown'
  }
}

async function crossVerifyManagerOwner(
  record: ManagerHandoffDiscoveryRecord,
  deps: OwnerVerificationDependencies
): Promise<OwnerVerification> {
  try {
    const response = await deps.fetch(
      `${record.baseUrl.replace(/\/$/u, '')}/v1/manager/status`,
      {
        headers: { authorization: `Bearer ${record.managerToken}` },
        signal: AbortSignal.timeout(IDENTITY_FETCH_TIMEOUT_MS)
      }
    )
    if (!response.ok) return 'unknown'
    const body = await response.json() as {
      instanceId?: unknown
      pid?: unknown
      startedAt?: unknown
    }
    if (body.instanceId !== record.instanceId) return 'unknown'
    if (!sameStartedAt(body.startedAt, record.startedAt)) return 'unknown'
    if (typeof body.pid === 'number' && body.pid !== record.pid) return 'unknown'
    return 'verified_owner'
  } catch {
    return 'unknown'
  }
}

function sameStartedAt(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false
  const actualMs = Date.parse(actual)
  const expectedMs = Date.parse(expected)
  return Number.isFinite(actualMs) && Number.isFinite(expectedMs) &&
    Math.abs(actualMs - expectedMs) <= MAX_RUNTIME_STARTED_AT_DIFFERENCE_MS
}

function sameCanonicalPath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}
