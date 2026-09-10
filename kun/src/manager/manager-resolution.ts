import { stat } from 'node:fs/promises'
import { ServiceManagerUnavailableError, type ManagerFailureKind } from './manager-resolution-error.js'
import { z } from 'zod'
import {
  KUN_MANAGER_PROTOCOL_VERSION,
  defaultKunControlDir,
  readManagerDiscovery,
  readManagerHandoffDiscoveryStrict,
  managerDiscoveryPath,
  type ManagerDiscoveryRecord
} from './manager-discovery.js'
import { KUN_MANAGER_CAPABILITIES } from './service-manager.js'
import { processIsAlive, safeManagerUrl } from './manager-client-support.js'

const ManagerHealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('kun-service-manager'),
  protocolVersion: z.literal(KUN_MANAGER_PROTOCOL_VERSION),
  instanceId: z.string(),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  serviceVersion: z.string(),
  buildId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  capabilities: z.array(z.string())
})

const ManagerStatusSchema = ManagerHealthSchema.omit({
  status: true,
  service: true
}).extend({
  slots: z.array(z.unknown())
})

type ManagerIdentity = z.infer<typeof ManagerHealthSchema>

export async function resolveServiceManager(
  controlDir = defaultKunControlDir(),
  fetchImpl: typeof fetch = fetch
): Promise<{ discovery: ManagerDiscoveryRecord } | null> {
  const result = await inspectServiceManager(controlDir, fetchImpl)
  return result.state === 'ready' ? { discovery: result.discovery } : null
}

/**
 * Resolves an older same-protocol Manager only for migration handoff. Normal
 * callers must use resolveServiceManager so current data operations never run
 * against an incomplete capability set.
 */
export async function resolveServiceManagerForHandoff(
  controlDir = defaultKunControlDir(),
  fetchImpl: typeof fetch = fetch
): Promise<{ discovery: ManagerDiscoveryRecord } | null> {
  const candidate = await probeManagerHealth(controlDir, fetchImpl)
  if (!candidate || !candidate.health.capabilities.includes('runtime-slots-v1')) return null
  try {
    const response = await fetchImpl(`${candidate.discovery.baseUrl}/v1/manager/status`, {
      headers: {
        authorization: `Bearer ${candidate.discovery.managerToken}`
      },
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return null
    const status = ManagerStatusSchema.parse(await response.json())
    if (
      !managerIdentityMatchesDiscovery(status, candidate.discovery) ||
      !sameManagerIdentity(status, candidate.health) ||
      !sameStringSet(status.capabilities, candidate.health.capabilities) ||
      !status.capabilities.includes('runtime-slots-v1')
    ) return null
    return { discovery: candidate.discovery }
  } catch {
    return null
  }
}

export async function resolveServiceManagerForMigration(
  controlDir = defaultKunControlDir(),
  fetchImpl: typeof fetch = fetch
): Promise<{ discovery: ManagerDiscoveryRecord } | null> {
  return await resolveServiceManager(controlDir, fetchImpl) ??
    await resolveServiceManagerForHandoff(controlDir, fetchImpl)
}

export type ManagerInspection =
  | { state: 'ready'; discovery: ManagerDiscoveryRecord; health: ManagerIdentity }
  | { state: 'missing' | 'dead' }
  | { state: 'unavailable'; error: ServiceManagerUnavailableError }

/** Startup callers may retry transport failures, sharing one bounded deadline. */
export async function inspectServiceManager(
  controlDir = defaultKunControlDir(),
  fetchImpl: typeof fetch = fetch,
  options: { attempts?: number; deadline?: number } = {}
): Promise<ManagerInspection> {
  const deadline = options.deadline ?? Date.now() + 2_000
  const attempts = Math.min(3, Math.max(1, options.attempts ?? 1))
  let result: ManagerInspection = { state: 'missing' }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = await inspectManagerOnce(controlDir, fetchImpl, deadline)
    if (result.state === 'ready') {
      const { discovery, health } = result
      if (!KUN_MANAGER_CAPABILITIES.every((capability) => health.capabilities.includes(capability))) {
        return { state: 'unavailable', error: new ServiceManagerUnavailableError(
          'capability_incompatible', discovery.pid, discovery.instanceId
        ) }
      }
    }
    if (result.state !== 'unavailable' || !result.error.kind.startsWith('transport_')) break
    if (Date.now() >= deadline || attempt + 1 === attempts) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())))
  }
  return result
}

async function inspectManagerOnce(
  controlDir: string, fetchImpl: typeof fetch, deadline: number
): Promise<ManagerInspection> {
  let discovery: ManagerDiscoveryRecord | null
  const unavailable = (kind: ManagerFailureKind, pid?: number, instanceId?: string): ManagerInspection => ({
    state: 'unavailable', error: new ServiceManagerUnavailableError(kind, pid, instanceId)
  })
  try {
    discovery = await readManagerDiscovery(controlDir)
    if (!discovery) {
      const legacy = await readManagerHandoffDiscoveryStrict(controlDir)
      if (legacy) {
        if (!processIsAlive(legacy.pid)) return { state: 'dead' }
        return unavailable('protocol_incompatible', legacy.pid, legacy.instanceId)
      }
      return { state: 'missing' }
    }
  } catch (readError) {
    const code = (readError as NodeJS.ErrnoException)?.code
    if (code === 'EACCES' || code === 'EPERM' || code === 'EIO') return unavailable('discovery_unreadable')
    try { await stat(managerDiscoveryPath(controlDir)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
      return unavailable('discovery_unreadable')
    }
    return unavailable('discovery_invalid')
  }
  const fail = (kind: ManagerFailureKind) => unavailable(kind, discovery.pid, discovery.instanceId)
  if (!safeManagerUrl(discovery)) return fail('discovery_invalid')
  if (!processIsAlive(discovery.pid)) return { state: 'dead' }
  if (Date.now() >= deadline) return fail('transport_timeout')
  let response: Response
  let body: unknown
  try {
    response = await fetchImpl(`${discovery.baseUrl}/health`, {
      signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, deadline - Date.now())))
    })
    if (!response.ok) return fail('http_failure')
    body = await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) return fail('health_invalid')
    const detail = error as { name?: string; code?: string; cause?: { code?: string } }
    const code = detail?.cause?.code ?? detail?.code
    return fail(detail?.name === 'TimeoutError' || detail?.name === 'AbortError'
      ? 'transport_timeout' : code === 'ECONNREFUSED' ? 'transport_refused' : 'transport_failure')
  }
  if (body && typeof body === 'object' && 'protocolVersion' in body &&
    body.protocolVersion !== KUN_MANAGER_PROTOCOL_VERSION) return fail('protocol_incompatible')
  const parsed = ManagerHealthSchema.safeParse(body)
  if (!parsed.success) return fail('health_invalid')
  if (!managerIdentityMatchesDiscovery(parsed.data, discovery)) return fail('identity_mismatch')
  return { state: 'ready', discovery, health: parsed.data }
}

async function probeManagerHealth(
  controlDir: string,
  fetchImpl: typeof fetch
): Promise<{ discovery: ManagerDiscoveryRecord; health: ManagerIdentity } | null> {
  const result = await inspectManagerOnce(controlDir, fetchImpl, Date.now() + 2_000)
  return result.state === 'ready' ? result : null
}

function managerIdentityMatchesDiscovery(
  identity: Omit<ManagerIdentity, 'status' | 'service'>,
  discovery: ManagerDiscoveryRecord
): boolean {
  return identity.protocolVersion === discovery.protocolVersion &&
    identity.instanceId === discovery.instanceId &&
    identity.pid === discovery.pid &&
    identity.startedAt === discovery.startedAt &&
    identity.serviceVersion === discovery.serviceVersion &&
    identity.buildId === discovery.buildId
}

function sameManagerIdentity(
  status: z.infer<typeof ManagerStatusSchema>,
  health: ManagerIdentity
): boolean {
  return status.protocolVersion === health.protocolVersion &&
    status.instanceId === health.instanceId &&
    status.pid === health.pid &&
    status.startedAt === health.startedAt &&
    status.serviceVersion === health.serviceVersion &&
    status.buildId === health.buildId
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const values = new Set(left)
  return values.size === left.length && right.every((value) => values.has(value))
}
