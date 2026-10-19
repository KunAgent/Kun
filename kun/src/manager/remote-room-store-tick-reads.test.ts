import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRoomStoreCommit } from '../rooms/room-commit-signal.js'
import { invalidateTickReads, withRoomTickReads } from '../rooms/room-tick-reads.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from '../server/node-http-server.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { RemoteRoomStore } from './remote-room-store.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

const resources: Array<{ root: string; data: ManagerSharedDataStore; server: NodeHttpServerHandle }> = []
afterEach(async () => {
  for (const entry of resources.splice(0)) {
    await entry.server.close()
    await entry.data.close()
    await rm(entry.root, { recursive: true, force: true })
  }
})

async function manager() {
  const root = await mkdtemp(join(tmpdir(), 'kun-manager-room-tick-'))
  const data = await ManagerSharedDataStore.create(join(root, 'data'))
  const router = buildServiceManagerRouter({
    managerToken: 'room-manager-token', instanceId: 'room-tick-manager', startedAt: new Date().toISOString(),
    state: new ServiceManagerState(), sharedData: data, statePersistence: () => ({ degraded: false, durableLag: 0 })
  })
  const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  resources.push({ root, data, server })
  const connection: ServiceManagerConnection = { discovery: {
    version: 1, protocolVersion: 6, instanceId: 'room-tick-manager', pid: process.pid,
    startedAt: new Date().toISOString(), host: '127.0.0.1', port: server.port,
    baseUrl: `http://127.0.0.1:${server.port}`, managerToken: 'room-manager-token',
    serviceVersion: 'test', dataDir: join(root, 'data'), settingsPath: join(root, 'settings.json')
  } }
  return { data, store: new RemoteRoomStore(connection) }
}

const create = (requestId: string, name: string, expectedRevision: number | null) => ({
  requestId, checks: [{ kind: 'room' as const, id: 'room-a', expectedRevision }],
  puts: [{ kind: 'room' as const, id: 'room-a', value: { name } }],
  events: [{ roomId: 'room-a', kind: 'room_updated', payload: {} }]
})

describe('coordinator pass room reads', () => {
  it('shares identical reads inside one pass and hands out private copies', async () => {
    const { data, store } = await manager()
    await store.commit(create('create-a', 'Room A', null))
    const get = vi.spyOn(data.roomStore, 'get')
    const rows = await withRoomTickReads(async () => {
      const [first, second] = await Promise.all([store.get('room', 'room-a'), store.get('room', 'room-a')])
      ;(first!.value as { name: string }).name = 'changed by caller'
      return [second, await store.get('room', 'room-a')]
    })
    expect(get).toHaveBeenCalledTimes(1)
    expect(rows.map((row) => (row!.value as { name: string }).name)).toEqual(['Room A', 'Room A'])
    await store.get('room', 'room-a')
    await store.get('room', 'room-a')
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('reads fresh state after a write in the pass, including a rejected one', async () => {
    const { data, store } = await manager()
    await store.commit(create('create-a', 'Room A', null))
    const get = vi.spyOn(data.roomStore, 'get')
    await withRoomTickReads(async () => {
      const before = await store.get('room', 'room-a')
      await store.commit(create('rename-a', 'Room B', before!.revision))
      expect((await store.get('room', 'room-a'))?.value).toEqual({ name: 'Room B' })
      await expect(store.commit(create('stale-a', 'Room C', before!.revision))).rejects.toThrow()
      await store.get('room', 'room-a')
      invalidateTickReads()
      await store.get('room', 'room-a')
    })
    expect(get).toHaveBeenCalledTimes(4)
  })

  it('stops sharing reads once the pass ends and signals local commits', async () => {
    const { data, store } = await manager()
    await store.commit(create('create-a', 'Room A', null))
    const get = vi.spyOn(data.roomStore, 'get')
    let continuation!: Promise<void>
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    await withRoomTickReads(async () => {
      await store.get('room', 'room-a')
      continuation = gate.then(async () => { await store.get('room', 'room-a') })
    })
    release()
    await continuation
    expect(get).toHaveBeenCalledTimes(2)

    const wake = vi.fn()
    const stop = onRoomStoreCommit(wake)
    const current = await store.get('room', 'room-a')
    await store.commit(create('rename-a', 'Room B', current!.revision))
    stop()
    expect(wake).toHaveBeenCalled()
  })
})
