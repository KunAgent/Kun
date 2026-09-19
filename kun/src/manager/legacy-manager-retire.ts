import { z } from 'zod'
import { canonicalSessionPath } from './app-session-reservation.js'
import {
  readManagerHandoffDiscoveryStrict,
  removeManagerDiscovery,
  type ManagerHandoffDiscoveryRecord
} from './manager-discovery.js'
import { runtimeProcessIsAlive } from '../server/runtime-process-identity.js'

/** Cross-version identity fence: every live response must name the recorded instance exactly. */
export function legacyManagerIdentitySchema(record: ManagerHandoffDiscoveryRecord) {
  return z.object({
    instanceId: z.literal(record.instanceId),
    pid: z.literal(record.pid),
    startedAt: z.literal(record.startedAt),
    appOwner: z.unknown().optional(),
    ...(record.protocolVersion ? { protocolVersion: z.literal(record.protocolVersion) } : {}),
    ...(record.buildId ? { buildId: z.literal(record.buildId) } : {})
  }).passthrough()
}

/**
 * Verified idle shutdown for legacy Managers that predate atomic
 * `/v1/manager/retire-idle`. Startup takeover and `kun manager retire` share
 * this sequence: authenticate the recorded instance over `/health` and
 * `/v1/manager/status`, require the same canonical dataDir/settingsPath, no
 * application owner and no Runtime slots, then ask `/v1/manager/shutdown` and
 * wait for real process exit. Any ambiguity fails closed without touching the
 * process. Messages must stay free of tokens and credentialed URLs.
 */
export async function retireVerifiablyIdleLegacyManager(input: {
  controlDir: string
  dataDir: string
  settingsPath: string
  fetch?: typeof fetch
  signal?: AbortSignal
  exitDeadlineMs?: number
}): Promise<'absent' | 'already-exited' | 'retired'> {
  const record = await readManagerHandoffDiscoveryStrict(input.controlDir)
  if (!record) return 'absent'
  if (await canonicalSessionPath(record.dataDir) !== await canonicalSessionPath(input.dataDir) ||
    await canonicalSessionPath(record.settingsPath) !== await canonicalSessionPath(input.settingsPath)) {
    throw new Error('Manager data/settings profile differs; select its exact dataDir, controlDir and settingsPath before retiring it')
  }
  if (record.appOwner) throw new Error('Manager belongs to an application session; quit its owning application')
  if (!runtimeProcessIsAlive(record.pid, record)) {
    await removeManagerDiscovery(input.controlDir, record.instanceId, record)
    return 'already-exited'
  }
  const fetchImpl = input.fetch ?? fetch
  const timeout = (ms: number): AbortSignal =>
    input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
  const identity = legacyManagerIdentitySchema(record)
  const headers = { authorization: `Bearer ${record.managerToken}`, 'content-type': 'application/json' }
  const healthResponse = await fetchImpl(`${record.baseUrl}/health`, { signal: timeout(2_000) })
  if (!healthResponse.ok) throw new Error('Legacy Manager health cannot be authenticated')
  const health = identity.extend({ service: z.literal('kun-service-manager') }).parse(await healthResponse.json())
  if (health.appOwner) {
    throw new Error('Manager has an application owner or Runtime slots; close its clients before retiring it')
  }
  const statusResponse = await fetchImpl(`${record.baseUrl}/v1/manager/status`, { headers, signal: timeout(2_000) })
  if (!statusResponse.ok) throw new Error('Legacy Manager status cannot be authenticated')
  const status = identity.extend({ slots: z.array(z.unknown()) }).parse(await statusResponse.json())
  if (status.appOwner || status.slots.length) {
    throw new Error('Manager has an application owner or Runtime slots; close its clients before retiring it')
  }
  const response = await fetchImpl(`${record.baseUrl}/v1/manager/shutdown`, {
    method: 'POST', headers, body: JSON.stringify({ instanceId: record.instanceId }), signal: timeout(2_000)
  })
  if (!response.ok) throw new Error(`Legacy Manager refused shutdown (HTTP ${response.status})`)
  const deadline = Date.now() + (input.exitDeadlineMs ?? 10_000)
  while (runtimeProcessIsAlive(record.pid, record) && Date.now() < deadline) {
    input.signal?.throwIfAborted()
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (runtimeProcessIsAlive(record.pid, record)) {
    throw new Error('Legacy Manager did not exit; no force termination was attempted')
  }
  await removeManagerDiscovery(input.controlDir, record.instanceId, record)
  return 'retired'
}
