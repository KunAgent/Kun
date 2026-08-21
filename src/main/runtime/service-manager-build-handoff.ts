import {
  inspectSharedRuntime,
  type SharedRuntimeInspection,
  type SharedRuntimeScope
} from '../../../kun/src/cli/shared-runtime.js'
import { sameCanonicalPath } from '../../../kun/src/manager/canonical-path.js'
import {
  requestManagerJson,
  type ServiceManagerConnection
} from '../../../kun/src/manager/manager-client.js'
import { waitForPidExit } from '../kun-process-ports'
import { stopSharedRuntimeForReplacement } from './kun-serve-replacement'

const HANDOFF_PROBE_ATTEMPTS = 3
const HANDOFF_PROBE_TIMEOUT_MS = 3_000
const RUNTIME_FLAVORS = ['production', 'development'] as const

type StopRuntimeForHandoff = (
  dataDir: string,
  fetchImpl: typeof fetch,
  scope: SharedRuntimeScope
) => Promise<unknown>

type ProbeRuntimeForHandoff = (
  inspected: SharedRuntimeInspection,
  dataDir: string,
  fetchImpl: typeof fetch
) => Promise<number | undefined>

export type ServiceManagerBuildHandoffOverrides = {
  inspect?: typeof inspectSharedRuntime
  stop?: StopRuntimeForHandoff
  probe?: ProbeRuntimeForHandoff
  shutdown?: () => Promise<void>
  waitForExit?: (pid: number, timeoutMs: number) => Promise<boolean>
  /** Replace the Manager even when canonical paths already match. */
  force?: boolean
}

/**
 * Replace an older Manager without requiring its Runtime to satisfy the new
 * build's complete capability schema. The authenticated identity fields and
 * active-turn header are the stable cross-version handoff contract.
 */
export async function handoffExistingKunServiceManagerForDataDir(
  existing: ServiceManagerConnection,
  dataDir: string,
  settingsPath: string,
  overrides: ServiceManagerBuildHandoffOverrides = {}
): Promise<void> {
  if (
    !overrides.force &&
    sameCanonicalPath(existing.discovery.dataDir, dataDir) &&
    sameCanonicalPath(existing.discovery.settingsPath, settingsPath)
  ) return
  if (!sameCanonicalPath(existing.discovery.settingsPath, settingsPath)) {
    throw new Error('Kun Service Manager owns a different canonical settings path')
  }

  const inspect = overrides.inspect ?? inspectSharedRuntime
  const probe = overrides.probe ?? probeRuntimeForServiceManagerHandoff
  const stop = overrides.stop ?? stopSharedRuntimeForReplacement
  for (const runtimeFlavor of RUNTIME_FLAVORS) {
    const inspected = await inspect(existing.discovery.dataDir, fetch, {
      runtimeFlavor,
      manager: existing
    })
    if (!inspected) continue
    const activeTurnCount = inspected.connection?.activeTurnCount ??
      await probe(inspected, existing.discovery.dataDir, fetch)
    if (activeTurnCount === undefined) {
      throw new Error(`Kun ${runtimeFlavor} Runtime could not be verified for a safe data-directory handoff`)
    }
    if (activeTurnCount > 0) {
      throw new Error(`Kun ${runtimeFlavor} Runtime still has active turns; custom data-directory handoff was deferred`)
    }
  }

  await Promise.all(RUNTIME_FLAVORS.map((runtimeFlavor) =>
    stop(existing.discovery.dataDir, fetch, {
      runtimeFlavor,
      manager: existing
    })
  ))
  if (overrides.shutdown) await overrides.shutdown()
  else await requestManagerJson(existing, '/v1/manager/shutdown', {
      method: 'POST',
      body: { instanceId: existing.discovery.instanceId },
      timeoutMs: 10_000
    })
  if (!(await (overrides.waitForExit ?? waitForPidExit)(existing.discovery.pid, 15_000))) {
    throw new Error('Kun Service Manager did not exit during custom data-directory handoff')
  }
}

export async function probeRuntimeForServiceManagerHandoff(
  inspected: SharedRuntimeInspection,
  dataDir: string,
  fetchImpl: typeof fetch = fetch
): Promise<number | undefined> {
  for (let attempt = 0; attempt < HANDOFF_PROBE_ATTEMPTS; attempt += 1) {
    const activeTurnCount = await probeOnce(inspected, dataDir, fetchImpl)
    if (activeTurnCount !== undefined) return activeTurnCount
  }
  return undefined
}

async function probeOnce(
  inspected: SharedRuntimeInspection,
  dataDir: string,
  fetchImpl: typeof fetch
): Promise<number | undefined> {
  const record = inspected.discovery
  try {
    const response = await fetchImpl(`${record.baseUrl.replace(/\/$/u, '')}/v1/runtime/info`, {
      headers: record.runtimeToken
        ? { authorization: `Bearer ${record.runtimeToken}` }
        : {},
      signal: AbortSignal.timeout(HANDOFF_PROBE_TIMEOUT_MS)
    })
    if (!response.ok) return undefined
    const body = await response.json() as unknown
    if (!isRecord(body) ||
      body.instanceId !== record.instanceId ||
      body.startedAt !== record.startedAt ||
      (body.pid !== undefined && body.pid !== record.pid) ||
      typeof body.dataDir !== 'string' ||
      !sameCanonicalPath(body.dataDir, dataDir) ||
      (body.buildId !== undefined && body.buildId !== record.buildId)) {
      return undefined
    }
    return parseNonnegativeInteger(response.headers.get('x-kun-active-turn-count'))
  } catch {
    return undefined
  }
}

function parseNonnegativeInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
