import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeHandoffDiscoveryRecord } from '../../../kun/src/server/runtime-discovery.js'
import type { ManagerHandoffDiscoveryRecord } from '../../../kun/src/manager/manager-discovery.js'
import {
  readForcedRuntimeRecovery,
  recordVerifiedForcedRuntimeOwner
} from '../../../kun/src/manager/forced-runtime-recovery.js'
import {
  drainKunOwnersForHandoff,
  KunHandoffError,
  probeInstalledBuildHandoff,
  withDrainedKunOwners
} from './kun-installed-build-handoff'

const controlDir = '/tmp/kun-control'
const dataDir = '/tmp/kun-data'
const settingsPath = '/tmp/Kun/kun-settings.json'

function manager(
  overrides: Partial<ManagerHandoffDiscoveryRecord> = {}
): ManagerHandoffDiscoveryRecord {
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
    settingsPath,
    ...overrides
  }
}

function runtime(
  flavor: 'production' | 'development',
  overrides: Partial<RuntimeHandoffDiscoveryRecord> = {}
): RuntimeHandoffDiscoveryRecord {
  const development = flavor === 'development'
  return {
    version: 1,
    instanceId: `${flavor}-old`,
    pid: development ? 902 : 901,
    startedAt: '2026-08-21T00:00:00.000Z',
    host: '127.0.0.1',
    port: development ? 43002 : 43001,
    baseUrl: `http://127.0.0.1:${development ? 43002 : 43001}`,
    runtimeToken: `${flavor}-secret`,
    ...(development ? { flavor } : {}),
    ...overrides
  }
}

function input(overrides: { dataDirs?: string[] } = {}) {
  return {
    reason: 'installed-build-change' as const,
    dataDirs: overrides.dataDirs ?? [dataDir],
    settingsPath,
    controlDir,
    targetBuildId: 'b'.repeat(64)
  }
}

describe('installed build handoff coordinator', () => {
  it('drains both Runtime flavors and an older-schema Manager under one lock', async () => {
    const currentManager = manager()
    const currentRuntimes = new Map([
      ['production', runtime('production')],
      ['development', runtime('development')]
    ] as const)
    let managerAlive = true
    let lockHeld = false
    const order: string[] = []
    const stopRuntime = vi.fn(async (
      _dataDir: string,
      target: { discovery: RuntimeHandoffDiscoveryRecord }
    ) => {
      expect(lockHeld).toBe(true)
      const flavor = target.discovery.flavor ?? 'production'
      order.push(`runtime:${flavor}`)
      currentRuntimes.delete(flavor)
      return { stopped: true, forced: flavor === 'development' }
    })
    const stopManager = vi.fn(async () => {
      expect(lockHeld).toBe(true)
      order.push('manager')
      managerAlive = false
      return { stopped: true, forced: false }
    })
    const fetchMock = vi.fn(async () => Response.json({
      instanceId: currentManager.instanceId,
      pid: currentManager.pid,
      startedAt: currentManager.startedAt,
      slots: [...currentRuntimes.values()].map((registration) => ({ registration: {
        ...registration,
        flavor: registration.flavor ?? 'production'
      } }))
    }))

    const report = await drainKunOwnersForHandoff({ ...input(), fetch: fetchMock as unknown as typeof fetch }, {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => {
        lockHeld = true
        try { return await action() } finally { lockHeld = false }
      },
      readManager: async () => managerAlive ? currentManager : null,
      readRuntime: async (_dir, flavor) => currentRuntimes.get(flavor ?? 'production') ?? null,
      processAlive: (pid) => managerAlive && pid === currentManager.pid ||
        [...currentRuntimes.values()].some((record) => record.pid === pid),
      recordForcedOwner: vi.fn(async () => ({ markerId: 'marker' })) as never,
      stopRuntime: stopRuntime as never,
      stopManager: stopManager as never,
      now: (() => { let value = 100; return () => value += 5 })()
    })

    expect(order).toEqual(['runtime:production', 'runtime:development', 'manager'])
    expect(report.owners).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'runtime', flavor: 'production', result: 'graceful' }),
      expect.objectContaining({ kind: 'runtime', flavor: 'development', result: 'forced' }),
      expect.objectContaining({ kind: 'manager', result: 'graceful' })
    ]))
  })

  it('uses minimally parsed Manager slots when filesystem discovery is absent', async () => {
    const currentManager = manager()
    const slot = runtime('production')
    let runtimeAlive = true
    let managerAlive = true
    const stopRuntime = vi.fn(async () => {
      runtimeAlive = false
      return { stopped: true, forced: false }
    })
    const fetchMock = vi.fn(async () => Response.json({
      instanceId: currentManager.instanceId,
      pid: currentManager.pid,
      startedAt: currentManager.startedAt,
      futureStatusField: true,
      slots: [{ registration: { ...slot, flavor: 'production', futureSlotField: true } }]
    }))

    await expect(drainKunOwnersForHandoff({
      ...input(),
      fetch: fetchMock as unknown as typeof fetch
    }, {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
      readManager: async () => managerAlive ? currentManager : null,
      readRuntime: async () => null,
      processAlive: (pid) => pid === slot.pid ? runtimeAlive : managerAlive,
      stopRuntime: stopRuntime as never,
      stopManager: (async () => {
        managerAlive = false
        return { stopped: true, forced: false }
      }) as never
    })).resolves.toMatchObject({ reason: 'installed-build-change' })

    expect(stopRuntime).toHaveBeenCalledOnce()
  })

  it('re-discovers and drains a replacement Runtime that races the first pass', async () => {
    const first = runtime('production')
    const second = runtime('production', {
      instanceId: 'production-raced',
      pid: 903,
      startedAt: '2026-08-21T00:01:00.000Z',
      port: 43003,
      baseUrl: 'http://127.0.0.1:43003'
    })
    let current: RuntimeHandoffDiscoveryRecord | null = first
    const stopped: string[] = []

    await drainKunOwnersForHandoff(input(), {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
      readManager: async () => null,
      readRuntime: async (_dir, flavor) => flavor === 'production' ? current : null,
      processAlive: (pid) => current?.pid === pid,
      stopRuntime: (async (_dir: string, target: { discovery: RuntimeHandoffDiscoveryRecord }) => {
        stopped.push(target.discovery.instanceId)
        current = target.discovery.instanceId === first.instanceId ? second : null
        return { stopped: true, forced: false }
      }) as never,
      stopManager: vi.fn() as never
    })

    expect(stopped).toEqual([first.instanceId, second.instanceId])
  })

  it('records forced owners from legacy and current data directories without failing handoff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-installed-build-handoff-'))
    try {
      const temporaryControlDir = join(root, 'control')
      const legacyDataDir = join(root, 'legacy-data')
      const currentDataDir = join(root, 'current-data')
      const legacy = runtime('production', {
        instanceId: 'production-legacy',
        pid: 911
      })
      const current = runtime('production', {
        instanceId: 'production-current',
        pid: 912
      })
      const runtimes = new Map([
        [legacyDataDir, legacy],
        [currentDataDir, current]
      ] as const)
      const stopped: Array<[string, string]> = []

      const report = await drainKunOwnersForHandoff({
        ...input({ dataDirs: [legacyDataDir, currentDataDir] }),
        controlDir: temporaryControlDir
      }, {
        withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
        readManager: async () => null,
        readRuntime: async (dir, flavor) =>
          flavor === 'production' ? runtimes.get(dir) ?? null : null,
        processAlive: (pid) => [...runtimes.values()].some((entry) => entry.pid === pid),
        recordForcedOwner: recordVerifiedForcedRuntimeOwner,
        stopRuntime: (async (dir: string, target: { discovery: RuntimeHandoffDiscoveryRecord }) => {
          stopped.push([dir, target.discovery.instanceId])
          runtimes.delete(dir)
          return { stopped: true, forced: true }
        }) as never,
        stopManager: vi.fn() as never
      })

      expect(stopped).toEqual([
        [legacyDataDir, legacy.instanceId],
        [currentDataDir, current.instanceId]
      ])
      expect(report.owners).toEqual(expect.arrayContaining([
        expect.objectContaining({ flavor: 'production', result: 'forced' })
      ]))
      const marker = await readForcedRuntimeRecovery(temporaryControlDir)
      expect(marker?.owners.map((owner) => [owner.dataDir, owner.instanceId])).toEqual([
        [legacyDataDir, legacy.instanceId],
        [currentDataDir, current.instanceId]
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires handoff when an old Runtime exists only in a Manager status slot', async () => {
    const currentManager = manager({ buildId: 'b'.repeat(64) })
    const slot = runtime('production', { buildId: 'a'.repeat(64) })
    let runtimeAlive = true
    let managerAlive = true
    const fetchMock = vi.fn(async () => Response.json({
      instanceId: currentManager.instanceId,
      pid: currentManager.pid,
      startedAt: currentManager.startedAt,
      slots: [{ registration: { ...slot, flavor: 'production' } }]
    }))
    const stopRuntime = vi.fn(async () => {
      runtimeAlive = false
      return { stopped: true, forced: false }
    })
    const overrides = {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
      readManager: async () => managerAlive ? currentManager : null,
      readRuntime: async () => null,
      processAlive: (pid: number) =>
        pid === slot.pid ? runtimeAlive : pid === currentManager.pid && managerAlive,
      stopRuntime: stopRuntime as never,
      stopManager: vi.fn(async () => {
        managerAlive = false
        return { stopped: true, forced: false }
      }) as never
    }

    await expect(probeInstalledBuildHandoff({
      ...input(),
      fetch: fetchMock as unknown as typeof fetch
    }, overrides)).resolves.toBe('mismatched')
    await drainKunOwnersForHandoff({
      ...input(),
      fetch: fetchMock as unknown as typeof fetch
    }, overrides)
    expect(stopRuntime).toHaveBeenCalledOnce()
  })

  it('does not hand off when the Manager and status Runtime already match the target build', async () => {
    const currentManager = manager({ buildId: 'b'.repeat(64) })
    const slot = runtime('production', { buildId: 'b'.repeat(64) })
    const fetchMock = vi.fn(async () => Response.json({
      instanceId: currentManager.instanceId,
      pid: currentManager.pid,
      startedAt: currentManager.startedAt,
      slots: [{ registration: { ...slot, flavor: 'production' } }]
    }))

    await expect(probeInstalledBuildHandoff({
      ...input(),
      fetch: fetchMock as unknown as typeof fetch
    }, {
      readManager: async () => currentManager,
      readRuntime: async () => null,
      processAlive: (pid) => pid === currentManager.pid || pid === slot.pid,
      stopRuntime: vi.fn() as never,
      stopManager: vi.fn() as never
    })).resolves.toBe('matched')
  })

  it('classifies missing build identity and unavailable Manager status as unknown', async () => {
    const legacyManager = manager()
    const legacyRuntime = runtime('production')
    const baseOverrides = {
      readManager: async () => legacyManager,
      readRuntime: async (_dir: string, flavor?: 'production' | 'development') =>
        flavor === 'production' ? legacyRuntime : null,
      processAlive: (pid: number) => pid === legacyManager.pid || pid === legacyRuntime.pid,
      stopRuntime: vi.fn() as never,
      stopManager: vi.fn() as never
    }

    await expect(probeInstalledBuildHandoff({
      ...input(),
      fetch: vi.fn(async () => Response.json({
        instanceId: legacyManager.instanceId,
        pid: legacyManager.pid,
        startedAt: legacyManager.startedAt,
        slots: []
      })) as unknown as typeof fetch
    }, baseOverrides)).resolves.toBe('unknown')

    await expect(probeInstalledBuildHandoff({
      ...input(),
      fetch: vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch
    }, {
      ...baseOverrides,
      readManager: async () => manager({ buildId: 'b'.repeat(64) }),
      readRuntime: async () => null
    })).resolves.toBe('unknown')
  })

  it('fails closed on unreadable discovery instead of treating it as no owner', async () => {
    const failure = await probeInstalledBuildHandoff(input(), {
      readManager: async () => { throw new Error('invalid manager discovery') },
      readRuntime: async () => null,
      processAlive: () => false,
      stopRuntime: vi.fn() as never,
      stopManager: vi.fn() as never
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(KunHandoffError)
    expect(failure).toMatchObject({ code: 'unsafe_scope', phase: 'discover', retryable: false })
  })

  it('fails closed before stopping anything when Manager settings scope differs', async () => {
    const stopRuntime = vi.fn()
    const stopManager = vi.fn()
    const failure = await drainKunOwnersForHandoff(input(), {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
      readManager: async () => manager({ settingsPath: '/tmp/Other/settings.json' }),
      readRuntime: async () => null,
      processAlive: () => true,
      stopRuntime: stopRuntime as never,
      stopManager: stopManager as never
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(KunHandoffError)
    expect(failure).toMatchObject({ code: 'unsafe_scope', retryable: false })
    expect(stopRuntime).not.toHaveBeenCalled()
    expect(stopManager).not.toHaveBeenCalled()
  })

  it('wraps an ambiguous Runtime failure and preserves the Manager', async () => {
    const target = runtime('production')
    const stopManager = vi.fn()
    const failure = await drainKunOwnersForHandoff(input(), {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => action(),
      readManager: async () => manager(),
      readRuntime: async (_dir, flavor) => flavor === 'production' ? target : null,
      processAlive: () => true,
      stopRuntime: (async () => { throw new Error('identity proof failed') }) as never,
      stopManager: stopManager as never
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(KunHandoffError)
    expect(failure).toMatchObject({
      code: 'runtime_stop_failed',
      phase: 'stop-runtimes',
      owner: { kind: 'runtime', flavor: 'production', pid: target.pid }
    })
    expect(String((failure as Error).message)).not.toContain(target.runtimeToken)
    expect(stopManager).not.toHaveBeenCalled()
  })

  it('runs the post-drain action before releasing the Manager election lock', async () => {
    let lockHeld = false
    const result = await withDrainedKunOwners(input(), async () => {
      expect(lockHeld).toBe(true)
      return 'manager-started'
    }, {
      withManagerLock: async <T>(_dir: string, action: () => Promise<T>) => {
        lockHeld = true
        try { return await action() } finally { lockHeld = false }
      },
      readManager: async () => null,
      readRuntime: async () => null,
      processAlive: () => false,
      stopRuntime: vi.fn() as never,
      stopManager: vi.fn() as never
    })

    expect(lockHeld).toBe(false)
    expect(result.value).toBe('manager-started')
  })
})
