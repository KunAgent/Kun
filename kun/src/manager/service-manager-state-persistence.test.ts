import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ServiceManagerState,
  THREAD_EXECUTION_LEASE_TTL_MS
} from './service-manager-state.js'
import {
  MANAGER_STATE_DEFERRED_FLUSH_SAFE_MS,
  startServiceManager
} from './service-manager-startup.js'
import { ServiceManagerStateSnapshotSchema } from './service-manager-state-snapshot.js'
import {
  readPersistedManagerState,
  writePersistedManagerState
} from './service-manager-state-persistence.js'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-manager-state-persistence-'))
  roots.push(root)
  return { root, path: join(root, 'manager-state.json') }
}

function registration(instanceId: string) {
  return {
    flavor: 'production' as const,
    instanceId,
    pid: process.pid,
    startedAt: '2026-08-05T00:00:00.000Z',
    host: '127.0.0.1',
    port: 1,
    baseUrl: 'http://127.0.0.1:1',
    runtimeToken: 'runtime-token'
  }
}

async function managerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-manager-renewal-flush-'))
  roots.push(root)
  return {
    root,
    controlDir: join(root, 'control'),
    dataDir: join(root, 'data'),
    settingsPath: join(root, 'settings.json')
  }
}

describe('Service Manager state persistence', () => {
  it('returns a fresh state when the file does not exist', async () => {
    const test = await fixture()

    const state = await readPersistedManagerState(test.path)

    expect(state.durableSnapshot()).toMatchObject({ version: 5, slots: [], leases: [] })
    expect(await readdir(test.root)).toEqual([])
  })

  it('restores a valid legacy snapshot without rewriting or backing it up', async () => {
    const test = await fixture()
    const serialized = JSON.stringify({
      version: 1,
      slots: [],
      leases: [],
      resourceLeases: []
    })
    await writeFile(test.path, serialized)

    const state = await readPersistedManagerState(test.path)

    expect(state.durableSnapshot()).toMatchObject({ version: 5, slots: [], leases: [] })
    expect(await readFile(test.path, 'utf8')).toBe(serialized)
    expect((await readdir(test.root)).filter((name) => name.includes('.corrupt-'))).toEqual([])
  })

  it.each([
    ['NUL bytes', '\0'.repeat(1_692), 'invalid JSON'],
    ['truncated JSON', '{"version":', 'invalid JSON'],
    ['empty object', '{}', 'invalid state schema'],
    ['unknown version', '{"version":99}', 'invalid state schema']
  ])('backs up and replaces %s', async (_label, serialized, reason) => {
    const test = await fixture()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await writeFile(test.path, serialized)

    const state = await readPersistedManagerState(test.path)

    expect(state.durableSnapshot()).toMatchObject({ version: 5, slots: [], leases: [] })
    const entries = await readdir(test.root)
    const backups = entries.filter((name) => name.startsWith('manager-state.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(test.root, backups[0]!), 'utf8')).toBe(serialized)
    expect(ServiceManagerStateSnapshotSchema.parse(
      JSON.parse(await readFile(test.path, 'utf8')) as unknown
    )).toMatchObject({ version: 5, slots: [], leases: [] })
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([])
    if (process.platform !== 'win32') {
      expect((await stat(join(test.root, backups[0]!))).mode & 0o777).toBe(0o600)
      expect((await stat(test.path)).mode & 0o777).toBe(0o600)
    }
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(reason))
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(backups[0]!))
  })

  it('writes a durable current snapshot without direct-write fallback artifacts', async () => {
    const test = await fixture()
    const state = await readPersistedManagerState(test.path)

    await writePersistedManagerState(test.path, state.durableSnapshot())

    expect(ServiceManagerStateSnapshotSchema.parse(
      JSON.parse(await readFile(test.path, 'utf8')) as unknown
    )).toMatchObject({ version: 5 })
    expect((await readdir(test.root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('does not treat a filesystem read error as corrupt state', async () => {
    const test = await fixture()
    await mkdir(test.path)

    await expect(readPersistedManagerState(test.path)).rejects.toMatchObject({ code: 'EISDIR' })
    expect((await readdir(test.root)).filter((name) => name.includes('.corrupt-'))).toEqual([])
  })
})

describe('Service Manager renewal flush coalescing', () => {
  it('coalesces a burst of renewals into one trailing durable write', async () => {
    const test = await managerFixture()
    const state = new ServiceManagerState()
    const manager = await startServiceManager({
      controlDir: test.controlDir,
      managerToken: 'manager-token',
      instanceId: 'manager-instance',
      startedAt: '2026-08-05T00:00:00.000Z',
      dataDir: test.dataDir,
      settingsPath: test.settingsPath,
      state
    })
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    try {
      state.register(registration('runtime-1'))
      const lease = state.acquireLease({
        threadId: 'thread-1',
        turnId: 'turn-1',
        ownerFlavor: 'production',
        ownerInstanceId: 'runtime-1'
      })
      const file = join(test.controlDir, 'manager-state.json')
      const readSnapshot = async () => JSON.parse(await readFile(file, 'utf8')) as {
        slots: { lastHeartbeatAt: string }[]
        leases: { expiresAt: string }[]
      }
      const before = await vi.waitFor(async () => {
        const snapshot = await readSnapshot()
        expect(snapshot.slots).toHaveLength(1)
        expect(snapshot.leases).toHaveLength(1)
        return snapshot
      }, { timeout: 2_000, interval: 10 })
      await sleep(1)
      state.heartbeat('production', 'runtime-1')
      state.renewLease({
        threadId: lease.threadId,
        turnId: lease.turnId,
        ownerFlavor: 'production',
        ownerInstanceId: 'runtime-1',
        fencingToken: lease.fencingToken
      })
      await sleep(1)
      state.heartbeat('production', 'runtime-1')
      state.renewLease({
        threadId: lease.threadId,
        turnId: lease.turnId,
        ownerFlavor: 'production',
        ownerInstanceId: 'runtime-1',
        fencingToken: lease.fencingToken
      })
      await vi.waitFor(async () => {
        const after = await readSnapshot()
        expect(Date.parse(after.leases[0]!.expiresAt))
          .toBeGreaterThan(Date.parse(before.leases[0]!.expiresAt))
        expect(Date.parse(after.slots[0]!.lastHeartbeatAt))
          .toBeGreaterThan(Date.parse(before.slots[0]!.lastHeartbeatAt))
      }, { timeout: 2_000, interval: 10 })
    } finally {
      await manager.close().catch(() => undefined)
    }
  })

  it('answers renewals inside the safe TTL window while a durable write is still running', async () => {
    const test = await managerFixture()
    const state = new ServiceManagerState()
    const manager = await startServiceManager({
      controlDir: test.controlDir,
      managerToken: 'manager-token',
      instanceId: 'manager-instance',
      startedAt: '2026-08-05T00:00:00.000Z',
      dataDir: test.dataDir,
      settingsPath: test.settingsPath,
      state
    })
    try {
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer manager-token`
      }
      const base = manager.discovery.baseUrl
      const registerResponse = await fetch(`${base}/v1/runtimes/production/register`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(registration('runtime-1'))
      })
      expect(registerResponse.status).toBe(200)
      const acquireResponse = await fetch(`${base}/v1/leases/threads/thread-1/acquire`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          turnId: 'turn-1',
          ownerFlavor: 'production',
          ownerInstanceId: 'runtime-1'
        })
      })
      expect(acquireResponse.status).toBe(200)
      const { lease } = await acquireResponse.json() as { lease: {
        turnId: string
        ownerFlavor: string
        ownerInstanceId: string
        fencingToken: number
      } }
      const startedAt = performance.now()
      const renewResponse = await fetch(`${base}/v1/leases/threads/thread-1/renew`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          turnId: lease.turnId,
          ownerFlavor: lease.ownerFlavor,
          ownerInstanceId: lease.ownerInstanceId,
          fencingToken: lease.fencingToken
        })
      })
      expect(renewResponse.status).toBe(200)
      expect(performance.now() - startedAt).toBeLessThan(2_000)
    } finally {
      await manager.close().catch(() => undefined)
    }
  })

  it('does not advance durable tracking on a slow renewal write inside the safe window', async () => {
    const test = await managerFixture()
    const state = new ServiceManagerState()
    const manager = await startServiceManager({
      controlDir: test.controlDir,
      managerToken: 'manager-token',
      instanceId: 'manager-instance',
      startedAt: '2026-08-05T00:00:00.000Z',
      dataDir: test.dataDir,
      settingsPath: test.settingsPath,
      state,
      stateWriter: async (path, snapshot) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 60))
        await writePersistedManagerState(path, snapshot)
      }
    })
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    try {
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer manager-token`
      }
      const base = manager.discovery.baseUrl
      const registerResponse = await fetch(`${base}/v1/runtimes/production/register`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(registration('runtime-1'))
      })
      expect(registerResponse.status).toBe(200)
      const acquireResponse = await fetch(`${base}/v1/leases/threads/thread-1/acquire`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          turnId: 'turn-1',
          ownerFlavor: 'production',
          ownerInstanceId: 'runtime-1'
        })
      })
      expect(acquireResponse.status).toBe(200)
      const durableFlushAtBeforeHeartbeat = manager.statePersistence().stats.lastDurableFlushAt

      const startedAt = performance.now()
      const heartbeatResponse = await fetch(`${base}/v1/runtimes/production/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ instanceId: 'runtime-1' })
      })
      expect(heartbeatResponse.status).toBe(200)
      expect(performance.now() - startedAt).toBeLessThan(2_000)

      const atResponse = manager.statePersistence()
      expect(atResponse.durableLag).toBe(1)
      expect(atResponse.stats.lastDurableFlushAt).toBe(durableFlushAtBeforeHeartbeat)

      await sleep(120)
      const settled = manager.statePersistence()
      expect(settled.durableLag).toBe(0)
      expect(settled.stats.lastDurableFlushAt).toBeGreaterThan(durableFlushAtBeforeHeartbeat)
    } finally {
      await manager.close().catch(() => undefined)
    }
  })

  it('degrades persistence and rejects mutations before controlled shutdown', async () => {
    const test = await managerFixture()
    const state = new ServiceManagerState()
    const manager = await startServiceManager({
      controlDir: test.controlDir,
      managerToken: 'manager-token',
      instanceId: 'manager-instance',
      startedAt: '2026-08-05T00:00:00.000Z',
      dataDir: test.dataDir,
      settingsPath: test.settingsPath,
      state,
      stateWriter: async () => {
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      },
      stateWriteRetry: { attempts: 3, baseDelayMs: 1 }
    })
    try {
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer manager-token`
      }
      const base = manager.discovery.baseUrl
      const registerResponse = await fetch(`${base}/v1/runtimes/production/register`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(registration('runtime-1'))
      })
      expect(registerResponse.status).toBe(500)
      expect(manager.statePersistence().degraded).toBe(true)

      const health = await (await fetch(`${base}/health`)).json() as {
        status: string
        persistence: { state: string; durableLag: number }
      }
      expect(health.status).toBe('ok')
      expect(health.persistence.state).toBe('degraded')

      const heartbeatResponse = await fetch(`${base}/v1/runtimes/production/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ instanceId: 'runtime-1' })
      })
      expect(heartbeatResponse.status).toBe(503)

      const acquireResponse = await fetch(`${base}/v1/leases/threads/thread-1/acquire`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          turnId: 'turn-1',
          ownerFlavor: 'production',
          ownerInstanceId: 'runtime-1'
        })
      })
      expect(acquireResponse.status).toBe(503)

      await manager.shutdownRequested
    } finally {
      await manager.close().catch(() => undefined)
    }
  })
})
