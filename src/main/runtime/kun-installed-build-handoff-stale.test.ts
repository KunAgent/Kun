import { describe, expect, it, vi } from 'vitest'
import type { ManagerHandoffDiscoveryRecord } from '../../../kun/src/manager/manager-discovery.js'
import type { RuntimeHandoffDiscoveryRecord } from '../../../kun/src/server/runtime-discovery.js'
import {
  drainKunOwnersForHandoff,
  KunHandoffError
} from './kun-installed-build-handoff'

const controlDir = '/tmp/kun-control'
const dataDir = '/tmp/kun-data'
const settingsPath = '/tmp/Kun/kun-settings.json'

function manager(): ManagerHandoffDiscoveryRecord {
  return {
    version: 7,
    protocolVersion: 3,
    instanceId: 'manager-old',
    pid: 900,
    startedAt: '2026-08-21T00:00:00.000Z',
    host: '127.0.0.1',
    port: 43000,
    baseUrl: 'http://127.0.0.1:43000',
    managerToken: 'manager-secret',
    dataDir,
    settingsPath
  }
}

function runtime(
  overrides: Partial<RuntimeHandoffDiscoveryRecord> = {}
): RuntimeHandoffDiscoveryRecord {
  return {
    version: 1,
    instanceId: 'production-old',
    pid: 901,
    startedAt: '2026-08-21T00:00:00.000Z',
    host: '127.0.0.1',
    port: 43001,
    baseUrl: 'http://127.0.0.1:43001',
    runtimeToken: 'production-secret',
    ...overrides
  }
}

function input(fetchImpl?: typeof fetch) {
  return {
    reason: 'installed-build-change' as const,
    dataDirs: [dataDir],
    settingsPath,
    controlDir,
    targetBuildId: 'b'.repeat(64),
    ...(fetchImpl ? { fetch: fetchImpl } : {})
  }
}

function identityFor(record: { pid: number; startedAt: string }, commandLine: string) {
  return {
    pid: record.pid,
    commandLine,
    executablePath: 'C:\\Program Files\\nodejs\\node.exe',
    startedAtMs: Date.parse(record.startedAt)
  }
}

function statusResponse(
  owner: ManagerHandoffDiscoveryRecord,
  slot: RuntimeHandoffDiscoveryRecord | null
): Response {
  return Response.json({
    instanceId: owner.instanceId,
    pid: owner.pid,
    startedAt: owner.startedAt,
    slots: slot ? [{ registration: { ...slot, flavor: 'production' } }] : []
  })
}

describe('installed build handoff stale ownership convergence', () => {
  it('fails closed when Manager unregister transport fails', async () => {
    const currentManager = manager()
    const staleSlot = runtime({ pid: 12948 })
    const stopRuntime = vi.fn()
    const stopManager = vi.fn()
    const failure = await drainKunOwnersForHandoff(
      input(vi.fn(async () => statusResponse(currentManager, staleSlot)) as unknown as typeof fetch),
      {
        withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
        readManager: async () => currentManager,
        readRuntime: async () => null,
        processAlive: () => true,
        processIdentity: async (pid) => pid === currentManager.pid
          ? identityFor(currentManager, 'kun-service-manager')
          : identityFor(staleSlot, 'C:\\Windows\\System32\\unrelated.exe'),
        unregisterRuntime: async () => { throw new Error('connection refused') },
        stopRuntime: stopRuntime as never,
        stopManager: stopManager as never
      }
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(KunHandoffError)
    expect(failure).toMatchObject({ code: 'probe_failed', retryable: true })
    expect((failure as Error).cause).toBeInstanceOf(Error)
    expect(stopRuntime).not.toHaveBeenCalled()
    expect(stopManager).not.toHaveBeenCalled()
  })

  it('fails closed when unregister returns false and the exact old slot remains', async () => {
    const currentManager = manager()
    const staleSlot = runtime({ pid: 12948 })
    const stopRuntime = vi.fn()
    const stopManager = vi.fn()
    const failure = await drainKunOwnersForHandoff(
      input(vi.fn(async () => statusResponse(currentManager, staleSlot)) as unknown as typeof fetch),
      {
        withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
        readManager: async () => currentManager,
        readRuntime: async () => null,
        processAlive: () => true,
        processIdentity: async (pid) => pid === currentManager.pid
          ? identityFor(currentManager, 'kun-service-manager')
          : identityFor(staleSlot, 'unrelated.exe'),
        unregisterRuntime: async () => false,
        stopRuntime: stopRuntime as never,
        stopManager: stopManager as never
      }
    ).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'probe_failed', retryable: true })
    expect(stopRuntime).not.toHaveBeenCalled()
    expect(stopManager).not.toHaveBeenCalled()
  })

  it('accepts false only after status proves the old slot disappeared', async () => {
    const currentManager = manager()
    const staleSlot = runtime({ pid: 12948 })
    let currentSlot: RuntimeHandoffDiscoveryRecord | null = staleSlot
    let managerAlive = true
    const unregisterRuntime = vi.fn(async () => {
      currentSlot = null
      return false
    })
    const stopManager = vi.fn(async () => {
      managerAlive = false
      return { stopped: true, forced: false }
    })
    const fetchMock = vi.fn(async () => statusResponse(currentManager, currentSlot))

    await expect(drainKunOwnersForHandoff(
      input(fetchMock as unknown as typeof fetch),
      {
        withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
        readManager: async () => managerAlive ? currentManager : null,
        readRuntime: async () => null,
        processAlive: (pid) => managerAlive && pid === currentManager.pid || pid === staleSlot.pid,
        processIdentity: async (pid) => pid === currentManager.pid
          ? identityFor(currentManager, 'kun-service-manager')
          : identityFor(staleSlot, 'unrelated.exe'),
        unregisterRuntime,
        stopRuntime: vi.fn() as never,
        stopManager: stopManager as never
      }
    )).resolves.toMatchObject({ reason: 'installed-build-change' })

    expect(unregisterRuntime).toHaveBeenCalledOnce()
    expect(stopManager).toHaveBeenCalledOnce()
  })

  it('preserves and then drains a replacement slot when false means ownership changed', async () => {
    const currentManager = manager()
    const staleSlot = runtime({ pid: 12948 })
    const replacement = runtime({
      instanceId: 'production-replacement',
      pid: 903,
      startedAt: '2026-08-21T00:01:00.000Z',
      port: 43003,
      baseUrl: 'http://127.0.0.1:43003',
      runtimeToken: 'replacement-secret'
    })
    let currentSlot: RuntimeHandoffDiscoveryRecord | null = staleSlot
    let managerAlive = true
    const unregisterRuntime = vi.fn(async () => {
      currentSlot = replacement
      return false
    })
    const stopRuntime = vi.fn(async (
      _dir: string,
      target: { discovery: RuntimeHandoffDiscoveryRecord }
    ) => {
      expect(target.discovery.instanceId).toBe(replacement.instanceId)
      currentSlot = null
      return { stopped: true, forced: false }
    })
    const fetchMock = vi.fn(async () => statusResponse(currentManager, currentSlot))

    await drainKunOwnersForHandoff(input(fetchMock as unknown as typeof fetch), {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
      readManager: async () => managerAlive ? currentManager : null,
      readRuntime: async () => null,
      processAlive: (pid) => managerAlive && pid === currentManager.pid || currentSlot?.pid === pid,
      processIdentity: async (pid) => {
        if (pid === currentManager.pid) return identityFor(currentManager, 'kun-service-manager')
        if (pid === replacement.pid) return identityFor(replacement, 'kun-runtime')
        return identityFor(staleSlot, 'unrelated.exe')
      },
      unregisterRuntime,
      stopRuntime: stopRuntime as never,
      stopManager: (async () => {
        managerAlive = false
        return { stopped: true, forced: false }
      }) as never
    })

    expect(unregisterRuntime).toHaveBeenCalledOnce()
    expect(unregisterRuntime).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: staleSlot.instanceId
    }))
    expect(stopRuntime).toHaveBeenCalledOnce()
  })

  it('fails closed when Manager status cannot be verified', async () => {
    const currentManager = manager()
    const stopManager = vi.fn()
    const failure = await drainKunOwnersForHandoff(
      input(vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch),
      {
        withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
        readManager: async () => currentManager,
        readRuntime: async () => null,
        processAlive: () => true,
        processIdentity: async () => identityFor(currentManager, 'kun-service-manager'),
        stopRuntime: vi.fn() as never,
        stopManager: stopManager as never
      }
    ).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'probe_failed', retryable: true })
    expect(stopManager).not.toHaveBeenCalled()
  })

  it('does not delete a replacement discovery that wins the cleanup race', async () => {
    const stale = runtime({ pid: 12948 })
    const replacement = runtime({
      instanceId: 'production-replacement',
      pid: 903,
      startedAt: '2026-08-21T00:01:00.000Z'
    })
    let current: RuntimeHandoffDiscoveryRecord | null = stale
    const removeRuntime = vi.fn(async (_dir, instanceId) => {
      expect(instanceId).toBe(stale.instanceId)
      current = replacement
      return false
    })
    const stopRuntime = vi.fn(async (
      _dir: string,
      target: { discovery: RuntimeHandoffDiscoveryRecord }
    ) => {
      expect(target.discovery.instanceId).toBe(replacement.instanceId)
      current = null
      return { stopped: true, forced: false }
    })

    await drainKunOwnersForHandoff(input(), {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
      readManager: async () => null,
      readRuntime: async (_dir, flavor) => flavor === 'production' ? current : null,
      processAlive: (pid) => current?.pid === pid,
      processIdentity: async (pid) => current === replacement
        ? identityFor(replacement, 'kun-runtime')
        : { ...identityFor(stale, 'unrelated.exe'), pid },
      removeRuntime,
      withAncillaryWriter: async <T>(_dir: string, action: () => Promise<T>) => action(),
      stopRuntime: stopRuntime as never,
      stopManager: vi.fn() as never
    })

    expect(removeRuntime).toHaveBeenCalledOnce()
    expect(stopRuntime).toHaveBeenCalledOnce()
  })
})
