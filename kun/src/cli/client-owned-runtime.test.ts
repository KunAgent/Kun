import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRuntimeCapabilityManifest } from '../contracts/capabilities.js'
import type { RuntimeFlavor, RuntimeRegistration } from '../contracts/runtime-flavor.js'
import { modelCapabilitiesForModel } from '../loop/model-context-profile.js'
import {
  publishManagerDiscovery,
  type ManagerDiscoveryRecord
} from '../manager/manager-discovery.js'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import { KUN_MANAGER_CAPABILITIES } from '../manager/service-manager.js'
import {
  readRuntimeDiscovery,
  runtimeDiscoveryPath,
  type RuntimeDiscoveryRecord
} from '../server/runtime-discovery.js'
import {
  ClientOwnedRuntimeConflictError,
  stopExactClientOwnedRuntime,
  withClientOwnedRuntimeElection
} from './client-owned-runtime.js'

const roots: string[] = []
const capabilities = buildRuntimeCapabilityManifest({
  model: modelCapabilitiesForModel('fixture')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('client-owned Runtime election', () => {
  it('rejects a second client owner in the same data-dir and flavor slot', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const existing = runtimeRecord({
      instanceId: 'gui-owner',
      pid: 2_147_483_601,
      clientOwnerKind: 'gui'
    })
    await writeDiscovery(dataDir, existing)
    mockProcessLiveness(existing.pid)
    const fetchMock = runtimeFetch([{ record: existing, dataDir }])
    const operation = vi.fn(async () => 'started')

    const error = await withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'tui',
      controlDir: join(root, 'control'),
      fetch: fetchMock as unknown as typeof fetch
    }, operation).catch((value) => value)

    expect(error).toMatchObject({
      name: ClientOwnedRuntimeConflictError.name,
      code: 'client_runtime_owner_busy',
      requestedOwnerKind: 'tui',
      message: expect.stringContaining('run `kun tui --no-start`')
    })
    expect(String(error)).toContain(
      'isolate KUN_MANAGER_CONTROL_DIR, KUN_MANAGER_SETTINGS_PATH, and KUN_DATA_DIR'
    )
    expect(operation).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('retires one exact healthy ownerless shared daemon before election', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const legacy = runtimeRecord({ instanceId: 'legacy-shared', pid: 2_147_483_602 })
    await writeDiscovery(dataDir, legacy)
    const liveness = mockProcessLiveness(legacy.pid)
    const fetchMock = runtimeFetch([{ record: legacy, dataDir }], async ({ record }) => {
      liveness.markExited(record.pid)
    })
    const operation = vi.fn(async () => {
      expect(await readRuntimeDiscovery(dataDir)).toBeNull()
      return 'replacement-elected'
    })

    await expect(withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'gui',
      controlDir: join(root, 'control'),
      fetch: fetchMock as unknown as typeof fetch
    }, operation)).resolves.toBe('replacement-elected')
    expect(operation).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('fails closed instead of retiring an unverified legacy process', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const legacy = runtimeRecord({ instanceId: 'legacy-unverified', pid: 2_147_483_603 })
    await writeDiscovery(dataDir, legacy)
    mockProcessLiveness(legacy.pid)
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit
    ) => new Response('', { status: 503 }))
    const operation = vi.fn(async () => undefined)

    await expect(withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'gui',
      controlDir: join(root, 'control'),
      fetch: fetchMock as unknown as typeof fetch
    }, operation)).rejects.toBeInstanceOf(ClientOwnedRuntimeConflictError)
    expect(operation).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect((await readRuntimeDiscovery(dataDir))?.instanceId).toBe(legacy.instanceId)
  })

  it('does not retire a valid legacy Runtime whose info belongs to another data directory', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data-a')
    const otherDataDir = join(root, 'data-b')
    const legacy = runtimeRecord({ instanceId: 'legacy-other-data', pid: 2_147_483_608 })
    await writeDiscovery(dataDir, legacy)
    mockProcessLiveness(legacy.pid)
    const fetchMock = runtimeFetch([{ record: legacy, dataDir: otherDataDir }])
    const operation = vi.fn(async () => undefined)

    await expect(withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'gui',
      controlDir: join(root, 'control'),
      fetch: fetchMock as unknown as typeof fetch
    }, operation)).rejects.toBeInstanceOf(ClientOwnedRuntimeConflictError)

    expect(operation).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect((await readRuntimeDiscovery(dataDir))?.instanceId).toBe(legacy.instanceId)
  })

  it('stops the inspected instance without removing or signaling its replacement', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const original = runtimeRecord({
      instanceId: 'gui-original',
      pid: 2_147_483_604,
      clientOwnerKind: 'gui'
    })
    const replacement = runtimeRecord({
      instanceId: 'gui-replacement',
      pid: 2_147_483_605,
      port: 18900,
      baseUrl: 'http://127.0.0.1:18900',
      runtimeToken: 'replacement-secret',
      clientOwnerKind: 'gui'
    })
    await writeDiscovery(dataDir, original)
    const liveness = mockProcessLiveness(original.pid, replacement.pid)
    const fetchMock = runtimeFetch([{ record: original, dataDir }], async ({ record }) => {
      expect(record.instanceId).toBe(original.instanceId)
      await writeDiscovery(dataDir, replacement)
      liveness.markExited(original.pid)
    })

    await expect(stopExactClientOwnedRuntime({
      dataDir,
      ownerKind: 'gui',
      instanceId: original.instanceId,
      controlDir: join(root, 'control'),
      fetch: fetchMock as unknown as typeof fetch
    })).resolves.toBe(true)

    expect(JSON.parse(await readFile(runtimeDiscoveryPath(dataDir), 'utf8'))).toMatchObject({
      instanceId: replacement.instanceId,
      pid: replacement.pid
    })
    const shutdownCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(shutdownCalls).toHaveLength(1)
    expect(String(shutdownCalls[0]?.[0])).toBe(`${original.baseUrl}/v1/runtime/shutdown`)
  })

  it('terminates only its captured child when exact HTTP shutdown fails', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const owner = runtimeRecord({
      instanceId: 'tui-http-unavailable',
      pid: 2_147_483_615,
      clientOwnerKind: 'tui'
    })
    await writeDiscovery(dataDir, owner)
    mockProcessLiveness(owner.pid)
    const ownerProcess = runningChild(owner.pid)
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit
    ) => new Response('', { status: 503 }))

    await expect(stopExactClientOwnedRuntime({
      dataDir,
      ownerKind: 'tui',
      instanceId: owner.instanceId,
      ownerProcess,
      expectedOwnerPid: owner.pid,
      controlDir: join(root, 'control'),
      fetch: fetchMock as unknown as typeof fetch
    })).resolves.toBe(true)
    expect(ownerProcess.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('terminates the captured old child but never the discovered replacement', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const originalPid = 2_147_483_616
    const replacement = runtimeRecord({
      instanceId: 'gui-live-replacement',
      pid: 2_147_483_617,
      clientOwnerKind: 'gui'
    })
    await writeDiscovery(dataDir, replacement)
    mockProcessLiveness(replacement.pid)
    const ownerProcess = runningChild(originalPid)
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit
    ) => new Response('', { status: 503 }))

    await expect(stopExactClientOwnedRuntime({
      dataDir,
      ownerKind: 'tui',
      instanceId: 'tui-old-instance',
      ownerProcess,
      expectedOwnerPid: originalPid,
      controlDir: join(root, 'control'),
      fetch: fetchMock as unknown as typeof fetch
    })).resolves.toBe(true)
    expect(ownerProcess.kill).toHaveBeenCalledWith('SIGTERM')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect((await readRuntimeDiscovery(dataDir))?.instanceId).toBe(replacement.instanceId)
  })

  it('does not terminate a process whose PID is not the handle-captured owner PID', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const foreignProcess = runningChild(2_147_483_618)

    await expect(stopExactClientOwnedRuntime({
      dataDir,
      ownerKind: 'tui',
      instanceId: 'missing-owner',
      ownerProcess: foreignProcess,
      expectedOwnerPid: 2_147_483_619,
      controlDir: join(root, 'control'),
      fetch: (async () => new Response('', { status: 404 })) as typeof fetch
    })).resolves.toBe(false)
    expect(foreignProcess.kill).not.toHaveBeenCalled()
  })

  it('isolates production and development ownership slots', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const controlDir = join(root, 'control')
    const production = runtimeRecord({
      instanceId: 'production-gui',
      pid: 2_147_483_606,
      clientOwnerKind: 'gui'
    })
    const development = runtimeRecord({
      instanceId: 'development-gui',
      pid: 2_147_483_607,
      port: 18999,
      baseUrl: 'http://127.0.0.1:18999',
      runtimeToken: 'development-secret',
      flavor: 'development',
      clientOwnerKind: 'gui'
    })
    await writeDiscovery(dataDir, production)
    mockProcessLiveness(production.pid, development.pid)
    const fetchMock = runtimeFetch([
      { record: production, dataDir },
      { record: development, dataDir }
    ])
    const developmentOperation = vi.fn(async () => 'development-free')

    await expect(withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'tui',
      runtimeFlavor: 'development',
      controlDir,
      fetch: fetchMock as unknown as typeof fetch
    }, developmentOperation)).resolves.toBe('development-free')
    expect(developmentOperation).toHaveBeenCalledOnce()

    await writeDiscovery(controlDir, development, 'development')
    await expect(withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'tui',
      runtimeFlavor: 'production',
      controlDir,
      fetch: fetchMock as unknown as typeof fetch
    }, async () => undefined)).rejects.toMatchObject({
      existing: { discovery: { instanceId: production.instanceId } }
    })
    await expect(withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'tui',
      runtimeFlavor: 'development',
      controlDir,
      fetch: fetchMock as unknown as typeof fetch
    }, async () => undefined)).rejects.toMatchObject({
      existing: { discovery: { instanceId: development.instanceId } }
    })
  })

  it('fails closed when a live Manager is unreachable during election', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const controlDir = join(root, 'control')
    const manager = await publishTestManager(controlDir, dataDir, {
      instanceId: 'manager-unreachable',
      pid: 2_147_483_609,
      port: 18701,
      baseUrl: 'http://127.0.0.1:18701'
    })
    mockProcessLiveness(manager.discovery.pid)
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }))
    const operation = vi.fn(async () => undefined)

    await expect(withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'tui',
      controlDir,
      manager,
      fetch: fetchMock as unknown as typeof fetch
    }, operation)).rejects.toThrow(/Manager process .* alive but unavailable/u)
    expect(operation).not.toHaveBeenCalled()
  })

  it('resolves a healthy replacement Manager and observes its unpublished owner', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const controlDir = join(root, 'control')
    const stale = managerConnection(dataDir, {
      instanceId: 'manager-stale-binding',
      pid: 2_147_483_610,
      port: 18702,
      baseUrl: 'http://127.0.0.1:18702'
    })
    const current = await publishTestManager(controlDir, dataDir, {
      instanceId: 'manager-current',
      pid: 2_147_483_611,
      port: 18703,
      baseUrl: 'http://127.0.0.1:18703'
    })
    const owner = runtimeRegistration({
      instanceId: 'unpublished-runtime-owner',
      pid: 2_147_483_612
    })
    mockProcessLiveness(stale.discovery.pid, current.discovery.pid, owner.pid)
    const fetchMock = managerReplacementFetch(stale, current, owner)
    const operation = vi.fn(async () => undefined)

    await expect(withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'tui',
      controlDir,
      manager: stale,
      fetch: fetchMock as unknown as typeof fetch
    }, operation)).rejects.toMatchObject({
      existing: {
        published: false,
        discovery: { instanceId: owner.instanceId, pid: owner.pid }
      }
    })
    expect(operation).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      `${current.discovery.baseUrl}/v1/runtimes/production`,
      expect.any(Object)
    )
  })

  it('rejects a healthy replacement Manager for another canonical data directory', async () => {
    const root = await tempRoot()
    const dataDir = join(root, 'data')
    const controlDir = join(root, 'control')
    const stale = managerConnection(dataDir, {
      instanceId: 'manager-stale-other-data',
      pid: 2_147_483_613,
      port: 18704,
      baseUrl: 'http://127.0.0.1:18704'
    })
    const current = await publishTestManager(controlDir, join(root, 'other-data'), {
      instanceId: 'manager-current-other-data',
      pid: 2_147_483_614,
      port: 18705,
      baseUrl: 'http://127.0.0.1:18705'
    })
    mockProcessLiveness(stale.discovery.pid, current.discovery.pid)
    const fetchMock = managerReplacementFetch(stale, current, null)
    const operation = vi.fn(async () => undefined)

    await expect(withClientOwnedRuntimeElection({
      dataDir,
      ownerKind: 'gui',
      controlDir,
      manager: stale,
      fetch: fetchMock as unknown as typeof fetch
    }, operation)).rejects.toThrow('different canonical data directory')
    expect(operation).not.toHaveBeenCalled()
  })
})

type RuntimeEndpoint = { record: RuntimeDiscoveryRecord; dataDir: string }

function runtimeFetch(
  endpoints: RuntimeEndpoint[],
  onShutdown?: (endpoint: RuntimeEndpoint) => Promise<void>
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const target = String(input)
    const endpoint = endpoints.find(({ record }) => target.startsWith(`${record.baseUrl}/`))
    if (!endpoint) return new Response('', { status: 404 })
    if (target.endsWith('/v1/runtime/info') && init?.method !== 'POST') {
      return Response.json(runtimeInfo(endpoint.record, endpoint.dataDir))
    }
    if (target.endsWith('/v1/runtime/shutdown') && init?.method === 'POST') {
      await onShutdown?.(endpoint)
      return Response.json({ accepted: true, instanceId: endpoint.record.instanceId })
    }
    return new Response('', { status: 404 })
  })
}

function runtimeInfo(record: RuntimeDiscoveryRecord, dataDir: string): Record<string, unknown> {
  return {
    instanceId: record.instanceId,
    serviceVersion: record.serviceVersion,
    launchMode: record.launchMode,
    host: record.host,
    port: record.port,
    dataDir,
    model: 'fixture',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    insecure: record.insecure,
    startedAt: record.startedAt,
    pid: record.pid,
    capabilities
  }
}

function runtimeRecord(overrides: Partial<RuntimeDiscoveryRecord> = {}): RuntimeDiscoveryRecord {
  return {
    version: 2,
    instanceId: 'runtime-owner',
    pid: 2_147_483_600,
    startedAt: '2026-09-02T00:00:00.000Z',
    host: '127.0.0.1',
    port: 18899,
    baseUrl: 'http://127.0.0.1:18899',
    runtimeToken: 'runtime-secret',
    insecure: false,
    serviceVersion: '0.3.8',
    launchMode: 'shared',
    ...overrides
  }
}

async function writeDiscovery(
  directory: string,
  record: RuntimeDiscoveryRecord,
  flavor: RuntimeFlavor = record.flavor ?? 'production'
): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(runtimeDiscoveryPath(directory, flavor), `${JSON.stringify(record)}\n`, 'utf8')
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-client-owned-runtime-'))
  roots.push(root)
  return root
}

function mockProcessLiveness(...pids: number[]): { markExited(pid: number): void } {
  const tracked = new Set(pids)
  const live = new Set(pids)
  const originalKill = process.kill.bind(process)
  vi.spyOn(process, 'kill').mockImplementation(((pid, signal) => {
    if (!tracked.has(pid)) return originalKill(pid, signal)
    if (live.has(pid)) return true
    throw Object.assign(new Error('process is gone'), { code: 'ESRCH' })
  }) as typeof process.kill)
  return { markExited: (pid) => { live.delete(pid) } }
}

function managerConnection(
  dataDir: string,
  overrides: Partial<ManagerDiscoveryRecord> = {}
): ServiceManagerConnection {
  return {
    discovery: {
      version: 1,
      protocolVersion: 5,
      instanceId: 'manager-test',
      pid: 2_147_483_620,
      startedAt: '2026-09-02T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18700,
      baseUrl: 'http://127.0.0.1:18700',
      managerToken: 'manager-secret',
      serviceVersion: '0.3.8',
      dataDir,
      settingsPath: join(dataDir, 'kun-settings.json'),
      ...overrides
    }
  }
}

async function publishTestManager(
  controlDir: string,
  dataDir: string,
  overrides: Partial<ManagerDiscoveryRecord>
): Promise<ServiceManagerConnection> {
  const base = managerConnection(dataDir, overrides).discovery
  return {
    discovery: await publishManagerDiscovery(controlDir, {
      instanceId: base.instanceId,
      pid: base.pid,
      startedAt: base.startedAt,
      host: base.host,
      port: base.port,
      baseUrl: base.baseUrl,
      managerToken: base.managerToken,
      serviceVersion: base.serviceVersion,
      dataDir: base.dataDir,
      settingsPath: base.settingsPath
    })
  }
}

function runtimeRegistration(
  overrides: Partial<RuntimeRegistration> = {}
): RuntimeRegistration {
  return {
    flavor: 'production',
    instanceId: 'runtime-registration',
    pid: 2_147_483_621,
    startedAt: '2026-09-02T00:00:00.000Z',
    host: '127.0.0.1',
    port: 18899,
    baseUrl: 'http://127.0.0.1:18899',
    runtimeToken: 'runtime-secret',
    ...overrides
  }
}

function managerReplacementFetch(
  stale: ServiceManagerConnection,
  current: ServiceManagerConnection,
  owner: RuntimeRegistration | null
) {
  return vi.fn(async (input: string | URL | Request) => {
    const target = String(input)
    if (target.startsWith(stale.discovery.baseUrl)) {
      return new Response('', { status: 503 })
    }
    if (target === `${current.discovery.baseUrl}/health`) {
      return Response.json({
        status: 'ok',
        service: 'kun-service-manager',
        protocolVersion: current.discovery.protocolVersion,
        instanceId: current.discovery.instanceId,
        pid: current.discovery.pid,
        startedAt: current.discovery.startedAt,
        serviceVersion: current.discovery.serviceVersion,
        capabilities: [...KUN_MANAGER_CAPABILITIES]
      })
    }
    if (target === `${current.discovery.baseUrl}/v1/runtimes/production`) {
      return Response.json({ registration: owner })
    }
    return new Response('', { status: 404 })
  })
}

function runningChild(pid: number): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = pid
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn((signal: NodeJS.Signals) => {
    child.signalCode = signal
    return true
  })
  return child as unknown as ChildProcess
}
