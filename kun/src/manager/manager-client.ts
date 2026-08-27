import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  RuntimeFlavorSchema,
  RuntimeRegistrationSchema,
  ThreadExecutionLeaseSchema,
  type RuntimeFlavor,
  type RuntimeRegistration,
  type ThreadExecutionLease
} from '../contracts/runtime-flavor.js'
import { GraphRunConflictError } from '../graph/graph-run-store.js'
import { isLoopbackHost } from '../server/loopback-host.js'
import {
  readRuntimeDiscovery,
  removeRuntimeDiscovery,
  type RuntimeDiscoveryRecord
} from '../server/runtime-discovery.js'
import {
  KUN_MANAGER_PROTOCOL_VERSION,
  defaultKunControlDir,
  defaultProductionSettingsPath,
  readManagerDiscovery,
  removeManagerDiscovery,
  withManagerStartLock,
  type ManagerDiscoveryRecord
} from './manager-discovery.js'
import { sameCanonicalPath } from './canonical-path.js'
import { withRuntimeDataDirAncillaryWriter } from '../server/runtime-data-dir-lease.js'
import { ManagerResourceLeaseSchema, type ManagerResourceFence } from './resource-lease-state.js'
import type { ManagerRequestOptions } from './manager-client-support.js'
import {
  resolveServiceManager
} from './manager-resolution.js'
import {
  launchServiceManagerProcess,
  type ManagerLaunchOverride
} from './manager-launch.js'
export {
  resolveServiceManager,
  resolveServiceManagerForMigration
} from './manager-resolution.js'
const START_TIMEOUT_MS = 30_000
const POLL_MS = 100
const LEGACY_HANDOVER_TIMEOUT_MS = 5 * 60_000
export type ServiceManagerConnection = {
  discovery: ManagerDiscoveryRecord
}
export { ManagerThreadExecutionLeaseClient } from './manager-thread-execution-lease-client.js'

export class ManagerRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`shared document changed concurrently; current revision is ${currentRevision}`)
    this.name = 'ManagerRevisionConflictError'
  }
}

export class ManagerRuntimeSlotBusyError extends Error {
  constructor(readonly owner: RuntimeRegistration) {
    super(`Kun runtime slot ${owner.flavor} is already owned by ${owner.instanceId}`)
    this.name = 'ManagerRuntimeSlotBusyError'
  }
}

export class ManagerRevisionedDocumentClient {
  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly key: 'settings' | 'client-state'
  ) {}

  async read(): Promise<{ revision: number; value: string | null }> {
    const body = await requestManagerJson(this.manager, `/v1/documents/${this.key}`, {})
    return z.object({
      snapshot: z.object({
        revision: z.number().int().nonnegative(),
        value: z.string().nullable()
      })
    }).parse(body).snapshot
  }

  async write(expectedRevision: number, value: string): Promise<{ revision: number; value: string }> {
    const response = await requestManagerResponse(this.manager, `/v1/documents/${this.key}`, {
      method: 'PUT',
      body: { expectedRevision, value }
    })
    if (response.status === 409) {
      const conflict = z.object({ currentRevision: z.number().int().nonnegative() })
        .safeParse(await response.json().catch(() => null))
      if (conflict.success) throw new ManagerRevisionConflictError(conflict.data.currentRevision)
    }
    return z.object({
      snapshot: z.object({
        revision: z.number().int().nonnegative(),
        value: z.string()
      })
    }).parse(await requireManagerJson(response)).snapshot
  }
}

export class ManagerResourceLeaseClient {
  private readonly resources = new Map<string, ResourceLeaseState>()

  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly flavor: RuntimeFlavor,
    private readonly instanceId: string
  ) {}

  async maintain(input: {
    resource: string
    onAcquired: () => void | Promise<void>
    onLost: () => void | Promise<void>
  }): Promise<boolean> {
    if (this.resources.has(input.resource)) throw new Error(`resource lease already maintained: ${input.resource}`)
    this.resources.set(input.resource, {
      held: false,
      generation: 0,
      inFlight: false,
      ...input
    })
    await this.tick(input.resource)
    return this.resources.get(input.resource)?.held === true
  }

  async shutdown(): Promise<void> {
    const resources = [...this.resources.entries()]
    this.resources.clear()
    await Promise.all(resources.map(async ([resource, state]) => {
      state.generation += 1
      if (state.timer) clearTimeout(state.timer)
      if (state.held && state.fence) await this.release(resource, state.fence).catch(() => undefined)
    }))
  }

  private async tick(resource: string): Promise<void> {
    const state = this.resources.get(resource)
    if (!state || state.inFlight) return
    const generation = ++state.generation
    const fence = state.fence
    state.inFlight = true
    try {
      const endpoint = fence ? 'renew' : 'acquire'
      const body = await requestManagerJson(
        this.manager,
        `/v1/leases/resources/${encodeURIComponent(resource)}/${endpoint}`,
        {
          method: 'POST',
          body: fence ?? { ownerFlavor: this.flavor, ownerInstanceId: this.instanceId }
        }
      )
      if (!this.isCurrent(resource, state, generation)) return
      const parsed = fence
        ? z.object({ lease: ManagerResourceLeaseSchema }).parse(body)
        : z.object({ acquired: z.boolean(), lease: ManagerResourceLeaseSchema }).parse(body)
      const acquired = 'acquired' in parsed ? parsed.acquired : true
      if (acquired && state.fence && parsed.lease.fencingToken < state.fence.fencingToken) return
      if (acquired) state.fence = fenceOf(parsed.lease)
      if (acquired && !state.held) {
        state.held = true
        await state.onAcquired()
      } else if (!acquired && state.held) {
        state.held = false
        state.fence = undefined
        await state.onLost()
      }
    } catch {
      if (!this.isCurrent(resource, state, generation)) return
      if (state.held) {
        state.held = false
        state.fence = undefined
        await state.onLost()
      }
    } finally {
      state.inFlight = false
      if (this.isCurrent(resource, state, generation)) this.scheduleTick(resource, state)
    }
  }

  private isCurrent(resource: string, state: ResourceLeaseState, generation: number): boolean {
    return this.resources.get(resource) === state && state.generation === generation
  }

  private scheduleTick(resource: string, state: ResourceLeaseState): void {
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => void this.tick(resource), 3_000)
    state.timer.unref?.()
  }

  private async release(resource: string, fence: ManagerResourceFence): Promise<void> {
    await requestManagerJson(
      this.manager,
      `/v1/leases/resources/${encodeURIComponent(resource)}/release`,
      {
        method: 'POST',
        body: fence
      }
    )
  }
}

type ResourceLeaseState = {
  held: boolean
  fence?: ManagerResourceFence
  timer?: ReturnType<typeof setTimeout>
  generation: number
  inFlight: boolean
  onAcquired: () => void | Promise<void>
  onLost: () => void | Promise<void>
}

function fenceOf(lease: z.infer<typeof ManagerResourceLeaseSchema>): ManagerResourceFence {
  return {
    resource: lease.resource,
    ownerFlavor: lease.ownerFlavor,
    ownerInstanceId: lease.ownerInstanceId,
    fencingToken: lease.fencingToken
  }
}

export type EnsureServiceManagerInput = {
  flavor: RuntimeFlavor
  controlDir?: string
  fetch?: typeof fetch
  timeoutMs?: number
  allowDevelopmentBootstrap?: boolean
  buildId?: string
  dataDir: string
  settingsPath?: string
  launch?: ManagerLaunchOverride
  /** Progress sink for the legacy production Runtime handover wait. */
  onLegacyHandoverStatus?: (status: LegacyRuntimeHandoverStatus) => void
}

export type LegacyRuntimeHandoverStatus =
  | { kind: 'idle' }
  | { kind: 'waiting'; activeTurnCount: number }
  | { kind: 'shutdown-requested' }
  | { kind: 'released' }

export async function ensureServiceManager(
  input: EnsureServiceManagerInput
): Promise<ServiceManagerConnection> {
  const controlDir = input.controlDir ?? defaultKunControlDir()
  const settingsPath = input.settingsPath ?? defaultProductionSettingsPath()
  const fetchImpl = input.fetch ?? fetch
  const existing = await resolveServiceManager(controlDir, fetchImpl)
  if (existing) {
    if (!managerOwnsPaths(existing.discovery, input.dataDir, settingsPath)) {
      throw new Error(
        'Kun Service Manager owns a different canonical data or settings path'
      )
    }
    return existing
  }
  assertManagerBootstrapAllowed(input)
  return withManagerStartLock(
    controlDir,
    () => ensureServiceManagerWithStartLockHeld(input)
  )
}

/** Caller must already hold withManagerStartLock for this control directory. */
export async function ensureServiceManagerWithStartLockHeld(
  input: EnsureServiceManagerInput
): Promise<ServiceManagerConnection> {
  const controlDir = input.controlDir ?? defaultKunControlDir()
  const settingsPath = input.settingsPath ?? defaultProductionSettingsPath()
  const fetchImpl = input.fetch ?? fetch
  const elected = await resolveServiceManager(controlDir, fetchImpl)
  if (elected) {
    if (!managerOwnsPaths(elected.discovery, input.dataDir, settingsPath)) {
      throw new Error('Kun Service Manager owns a different canonical data or settings path')
    }
    return elected
  }
  assertManagerBootstrapAllowed(input)
  const stale = await readManagerDiscovery(controlDir).catch(() => null)
  if (stale && !processIsAlive(stale.pid)) {
    await removeManagerDiscovery(controlDir, stale.instanceId).catch(() => undefined)
  } else if (stale) {
    throw new Error(`Kun Service Manager process ${stale.pid} is alive but unavailable`)
  }
  // The Manager owns the canonical data plane for both flavor slots. Even
  // an explicitly allowed source-DV bootstrap must drain a pre-manager
  // production writer before opening shared stores; otherwise the DV
  // Runtime and legacy production Runtime can concurrently mutate JSONL.
  await handoverLegacyProductionRuntime({
    dataDir: input.dataDir,
    fetch: fetchImpl,
    timeoutMs: Math.max(input.timeoutMs ?? START_TIMEOUT_MS, LEGACY_HANDOVER_TIMEOUT_MS),
    ...(input.onLegacyHandoverStatus ? { onStatus: input.onLegacyHandoverStatus } : {})
  })
  const { child, logPath } = await launchServiceManagerProcess({
    controlDir,
    dataDir: input.dataDir,
    settingsPath,
    ...(input.buildId ? { buildId: input.buildId } : {}),
    ...(input.launch ? { launch: input.launch } : {})
  })
  const deadline = Date.now() + (input.timeoutMs ?? START_TIMEOUT_MS)
  while (Date.now() < deadline) {
    const connection = await resolveServiceManager(controlDir, fetchImpl)
    if (connection) return connection
    if (child.exitCode !== null) break
    await delay(POLL_MS)
  }
  throw new Error(`Kun Service Manager did not become ready; inspect ${logPath}`)
}

function assertManagerBootstrapAllowed(input: EnsureServiceManagerInput): void {
  if (input.flavor === 'development' && !input.allowDevelopmentBootstrap) {
    throw new Error(
      'kun-dv requires the compatible Kun Service Manager installed by the production application; start or update Kun first'
    )
  }
}

function managerOwnsPaths(
  discovery: ManagerDiscoveryRecord,
  dataDir: string,
  settingsPath: string
): boolean {
  return sameCanonicalPath(discovery.dataDir, dataDir) &&
    sameCanonicalPath(discovery.settingsPath, settingsPath)
}

/**
 * A pre-manager runtime owns the canonical JSONL files directly. The manager
 * must never open those stores concurrently. Manager-aware runtimes advertise
 * their protocol in the authenticated info response and can remain alive
 * while a crashed manager is restarted; older direct writers are drained and
 * stopped before manager storage is composed.
 */
async function handoverLegacyProductionRuntime(input: {
  dataDir: string
  fetch: typeof fetch
  timeoutMs: number
  onStatus?: (status: LegacyRuntimeHandoverStatus) => void
}): Promise<void> {
  const discovery = await readRuntimeDiscovery(input.dataDir, 'production').catch(() => null)
  if (!discovery) {
    input.onStatus?.({ kind: 'idle' })
    return
  }
  if (!processIsAlive(discovery.pid)) {
    await removeLegacyProductionRuntimeDiscovery(input.dataDir, discovery.instanceId)
    input.onStatus?.({ kind: 'released' })
    return
  }
  const deadline = Date.now() + input.timeoutMs
  for (;;) {
    const probe = await probeLegacyHandoverRuntime(discovery, input.fetch)
    if (!probe) {
      if (!processIsAlive(discovery.pid)) {
        await removeLegacyProductionRuntimeDiscovery(input.dataDir, discovery.instanceId)
        return
      }
      throw new Error(
        `Existing Kun runtime process ${discovery.pid} is alive but cannot be verified; ` +
        'the Service Manager will not open shared data until that process exits'
      )
    }
    if (probe.managerProtocolVersion === KUN_MANAGER_PROTOCOL_VERSION) {
      input.onStatus?.({ kind: 'released' })
      return
    }
    if (probe.activeTurnCount !== undefined && probe.activeTurnCount > 0) {
      input.onStatus?.({ kind: 'waiting', activeTurnCount: probe.activeTurnCount })
      if (Date.now() >= deadline) {
        throw new Error(
          'Timed out waiting for the legacy production Runtime to finish its active turn; ' +
          'DV remains disabled until the production Runtime can be handed over safely'
        )
      }
      await delay(500)
      continue
    }
    input.onStatus?.({ kind: 'shutdown-requested' })
    const response = await input.fetch(`${discovery.baseUrl.replace(/\/$/u, '')}/v1/runtime/shutdown`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${discovery.runtimeToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ instanceId: discovery.instanceId }),
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) {
      throw new Error(`Legacy Kun runtime handover failed with HTTP ${response.status}`)
    }
    while (Date.now() < deadline) {
      if (!processIsAlive(discovery.pid)) {
        await removeLegacyProductionRuntimeDiscovery(input.dataDir, discovery.instanceId)
        return
      }
      await delay(POLL_MS)
    }
    throw new Error('Timed out waiting for the legacy production Runtime to release shared data')
  }
}

async function removeLegacyProductionRuntimeDiscovery(
  dataDir: string,
  instanceId: string
): Promise<boolean> {
  return withRuntimeDataDirAncillaryWriter(
    dataDir,
    () => removeRuntimeDiscovery(dataDir, instanceId, 'production').catch(() => false)
  )
}

async function probeLegacyHandoverRuntime(
  discovery: RuntimeDiscoveryRecord,
  fetchImpl: typeof fetch
): Promise<{ activeTurnCount?: number; managerProtocolVersion?: number } | null> {
  if (!safeRuntimeDiscovery(discovery)) return null
  try {
    const response = await fetchImpl(`${discovery.baseUrl.replace(/\/$/u, '')}/v1/runtime/info`, {
      headers: discovery.runtimeToken
        ? { authorization: `Bearer ${discovery.runtimeToken}` }
        : {},
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return null
    const body = z.object({
      instanceId: z.string(),
      pid: z.number().int().positive().optional(),
      startedAt: z.string()
    }).passthrough().safeParse(await response.json())
    if (!body.success ||
      body.data.instanceId !== discovery.instanceId ||
      body.data.startedAt !== discovery.startedAt ||
      (body.data.pid !== undefined && body.data.pid !== discovery.pid)) return null
    const activeTurnCount = parseNonnegativeHeader(response.headers.get('x-kun-active-turn-count'))
    const managerProtocolVersion = parseNonnegativeHeader(
      response.headers.get('x-kun-manager-protocol-version')
    )
    return {
      ...(activeTurnCount !== undefined ? { activeTurnCount } : {}),
      ...(managerProtocolVersion !== undefined ? { managerProtocolVersion } : {})
    }
  } catch {
    return null
  }
}

function safeRuntimeDiscovery(record: RuntimeDiscoveryRecord): boolean {
  try {
    const url = new URL(record.baseUrl)
    return url.protocol === 'http:' &&
      isLoopbackHost(url.hostname) &&
      isLoopbackHost(record.host) &&
      Number(url.port || '80') === record.port &&
      url.username === '' &&
      url.password === ''
  } catch {
    return false
  }
}

function parseNonnegativeHeader(value: string | null): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export async function registerRuntimeWithManager(input: {
  manager: ServiceManagerConnection
  registration: RuntimeRegistration
  fetch?: typeof fetch
}): Promise<RuntimeRegistration> {
  const response = await requestManagerResponse(input.manager, `/v1/runtimes/${input.registration.flavor}/register`, {
    method: 'PUT',
    body: input.registration,
    fetch: input.fetch
  })
  if (response.status === 409) {
    const conflict = z.object({
      code: z.literal('runtime_slot_busy'),
      owner: RuntimeRegistrationSchema
    }).safeParse(await response.json().catch(() => null))
    if (conflict.success) throw new ManagerRuntimeSlotBusyError(conflict.data.owner)
  }
  const parsed = z.object({ registration: RuntimeRegistrationSchema }).parse(
    await requireManagerJson(response)
  )
  return parsed.registration
}

export async function heartbeatRuntimeWithManager(input: {
  manager: ServiceManagerConnection
  flavor: RuntimeFlavor
  instanceId: string
  fetch?: typeof fetch
}): Promise<boolean> {
  const response = await requestManagerResponse(input.manager, `/v1/runtimes/${input.flavor}/heartbeat`, {
    method: 'POST',
    body: { instanceId: input.instanceId },
    fetch: input.fetch
  })
  if (response.ok) return true
  if (response.status === 409) return false
  await requireManagerJson(response)
  return false
}

export async function unregisterRuntimeWithManager(input: {
  manager: ServiceManagerConnection
  flavor: RuntimeFlavor
  instanceId: string
  fetch?: typeof fetch
}): Promise<void> {
  await requestManagerResponse(input.manager, `/v1/runtimes/${input.flavor}/${encodeURIComponent(input.instanceId)}`, {
    method: 'DELETE',
    fetch: input.fetch
  }).catch(() => undefined)
}

export async function readManagerRuntime(
  manager: ServiceManagerConnection,
  flavor: RuntimeFlavor,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<RuntimeRegistration | null> {
  const parsedFlavor = RuntimeFlavorSchema.parse(flavor)
  const response = await requestManagerJson(manager, `/v1/runtimes/${parsedFlavor}`, {
    fetch: fetchImpl,
    ...(signal ? { signal } : {})
  })
  return z.object({ registration: RuntimeRegistrationSchema.nullable() }).parse(response).registration
}

export async function forwardRequestToExecutionOwner(input: {
  manager: ServiceManagerConnection
  currentInstanceId: string
  request: Request
  threadId?: string
  control?: { kind: 'approval' | 'user-input'; id: string }
}): Promise<Response | null> {
  let lease: ThreadExecutionLease | null = null
  let registration: RuntimeRegistration | null = null
  if (input.threadId) {
    const owner = await requestManagerJson(
      input.manager,
      `/v1/leases/threads/${encodeURIComponent(input.threadId)}`,
      { signal: input.request.signal }
    )
    lease = z.object({ lease: ThreadExecutionLeaseSchema.nullable() }).parse(owner).lease
    if (lease) {
      registration = await readManagerRuntime(
        input.manager,
        lease.ownerFlavor,
        fetch,
        input.request.signal
      )
    }
  } else if (input.control) {
    const owner = await requestManagerJson(
      input.manager,
      `/v1/controls/${input.control.kind}/${encodeURIComponent(input.control.id)}/owner`,
      {}
    )
    const parsed = z.object({
      threadId: z.string().nullable(),
      lease: ThreadExecutionLeaseSchema.nullable(),
      registration: RuntimeRegistrationSchema.nullable()
    }).parse(owner)
    lease = parsed.lease
    registration = parsed.registration
  }
  if (!lease || lease.ownerInstanceId === input.currentInstanceId) return null
  if (!registration || registration.instanceId !== lease.ownerInstanceId) {
    throw new Error('thread execution owner is unavailable')
  }
  const sourceUrl = new URL(input.request.url)
  const targetUrl = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, registration.baseUrl)
  const headers = new Headers(input.request.headers)
  headers.set('authorization', `Bearer ${registration.runtimeToken}`)
  headers.delete('host')
  headers.delete('content-length')
  const method = input.request.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await input.request.arrayBuffer()
  return fetch(targetUrl, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    redirect: 'manual',
    signal: input.request.signal
  })
}

import {
  delay,
  processIsAlive,
  requestManagerResponse,
  requireManagerJson
} from './manager-client-support.js'
export {
  defaultManagerControlDirForTests,
  requestManagerResponse
} from './manager-client-support.js'

export async function requestManagerJson(
  manager: ServiceManagerConnection,
  path: string,
  options: ManagerRequestOptions
): Promise<unknown> {
  const response = await requestManagerResponse(manager, path, options)
  if (response.status === 409) {
    const conflict = z.object({
      code: z.literal('graph_run_conflict'),
      message: z.string()
    }).safeParse(await response.clone().json().catch(() => null))
    if (conflict.success) throw new GraphRunConflictError(conflict.data.message)
  }
  return requireManagerJson(response)
}
