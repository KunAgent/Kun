import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeHttpServer, type NodeHttpServerHandle } from '../server/node-http-server.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { RemoteRoomStore } from './remote-room-store.js'
import { RoomExecutionLease } from './room-execution-lease.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import type { ServiceManagerConnection } from './manager-client.js'

const resources: Array<{ root: string; data: ManagerSharedDataStore; server: NodeHttpServerHandle }> = []
const leases: RoomExecutionLease[] = []
afterEach(async () => {
  await Promise.all(leases.splice(0).map((lease) => lease.close()))
  for (const entry of resources.splice(0)) {
    await entry.server.close()
    await entry.data.close()
    await rm(entry.root, { recursive: true, force: true })
  }
})

async function manager() {
  const root = await mkdtemp(join(tmpdir(), 'kun-manager-room-'))
  const data = await ManagerSharedDataStore.create(join(root, 'data'))
  const state = new ServiceManagerState()
  for (const flavor of ['production', 'development'] as const) state.register({
    flavor, instanceId: `${flavor}-runtime`, pid: process.pid,
    startedAt: new Date().toISOString(), host: '127.0.0.1', port: 18899,
    baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'runtime-test-token'
  })
  let degraded = false
  const router = buildServiceManagerRouter({
    managerToken: 'room-manager-token', instanceId: 'room-test-manager',
    startedAt: new Date().toISOString(), state, sharedData: data,
    statePersistence: () => ({ degraded, durableLag: 0 })
  })
  const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  resources.push({ root, data, server })
  const connection: ServiceManagerConnection = { discovery: {
    version: 1, protocolVersion: 5, instanceId: 'room-test-manager', pid: process.pid,
    startedAt: new Date().toISOString(), host: '127.0.0.1', port: server.port,
    baseUrl: `http://127.0.0.1:${server.port}`, managerToken: 'room-manager-token',
    serviceVersion: 'test', dataDir: join(root, 'data'), settingsPath: join(root, 'settings.json')
  } }
  return { connection, state, data, store: new RemoteRoomStore(connection), degrade: () => { degraded = true } }
}

describe('room data over the real Manager HTTP boundary', () => {
  it('proxies atomic request deduplication, pagination and conflicts with Manager as sole physical owner', async () => {
    const { store, data } = await manager()
    const input = { requestId: 'create-a', checks: [{ kind: 'room' as const, id: 'room-a', expectedRevision: null }],
      puts: [{ kind: 'room' as const, id: 'room-a', value: { name: 'Room A' } }],
      events: [{ roomId: 'room-a', kind: 'room_created', payload: { id: 'room-a' } }], result: 'created' }
    const result = await store.commit(input)
    expect(result).toMatchObject({ duplicate: false, result: 'created' })
    expect(await store.commit(input)).toEqual({ ...result, duplicate: true })
    expect(await store.get('room', 'room-a')).toEqual(await data.roomStore.get('room', 'room-a'))
    expect(await store.list('room', { limit: 1 })).toHaveLength(1)
    expect((await store.listRooms({ limit: 1 })).rooms).toMatchObject([{ id: 'room-a', latestMessageSeq: 0 }])
    expect(await store.getRequest('create-a')).toMatchObject({ result: 'created' })
    expect(await store.events('room-a')).toHaveLength(1)
    await expect(store.commit({ ...input, requestId: 'stale-revision' }))
      .rejects.toBeInstanceOf(RoomStoreConflictError)
    await store.close()
    expect(await data.roomStore.get('room', 'room-a')).not.toBeNull()
  })

  it('elects one coordinator across flavors and rejects its stale token before side effects or commits', async () => {
    const { connection, state } = await manager()
    const production = new RoomExecutionLease({ manager: connection, flavor: 'production', instanceId: 'production-runtime' })
    const development = new RoomExecutionLease({ manager: connection, flavor: 'development', instanceId: 'development-runtime' })
    leases.push(production, development)
    expect(await production.start()).toBe(true)
    expect(await development.start()).toBe(false)
    const fence = production.getFence()!
    const store = new RemoteRoomStore(connection, { getFence: () => fence })
    await expect(store.assertOwnership()).resolves.toBeUndefined()
    state.releaseResource(fence)
    await expect(store.assertOwnership()).rejects.toBeInstanceOf(RoomStoreConflictError)
    await expect(store.commit({ requestId: 'stale-task', checks: [{ kind: 'task', id: 'task-a', expectedRevision: null }],
      puts: [{ kind: 'task', id: 'task-a', roomId: 'room-a', value: { status: 'running' } }] }))
      .rejects.toBeInstanceOf(RoomStoreConflictError)
    expect(await store.get('task', 'task-a')).toBeNull()
  })

  it('preserves bounded latest-message projections across the shared Manager boundary', async () => {
    const { store, data, connection } = await manager()
    const otherRuntime = new RemoteRoomStore(connection)
    await store.commit({ requestId: 'list-preview', checks: [
      { kind: 'room', id: 'preview-room', expectedRevision: null },
      { kind: 'message', id: 'preview-message', expectedRevision: null }
    ], puts: [
      { kind: 'room', id: 'preview-room', value: { name: 'Preview room' } },
      { kind: 'message', id: 'preview-message', roomId: 'preview-room', value: {
        authorKind: 'user', authorLabelSnapshot: 'You', createdAt: '2026-09-13T00:00:00Z',
        body: '[Design](https://example.test/private) **ready** ' + 'content '.repeat(7000), attachmentIds: ['image']
      } }
    ] })
    const page = await store.listRooms({ search: 'preview', limit: 1 })
    expect(page).toEqual(await otherRuntime.listRooms({ search: 'preview', limit: 1 }))
    expect(page).toEqual(await data.roomStore.listRooms({ search: 'preview', limit: 1 }))
    expect(page.rooms[0].latestMessage).toMatchObject({ id: 'preview-message', authorKind: 'user',
      authorLabelSnapshot: 'You', createdAt: '2026-09-13T00:00:00Z', attachmentCount: 1 })
    expect(page.rooms[0].latestMessage?.preview).toMatch(/^Design ready content /)
    expect(page.rooms[0].latestMessage?.preview).toHaveLength(160)
    expect(JSON.stringify(page)).not.toContain('private')
    expect(JSON.stringify(page).length).toBeLessThan(1500)
  })

  it('permits history reads but rejects commits while Manager durability is degraded', async () => {
    const { store, degrade } = await manager()
    degrade()
    expect(await store.list('room')).toEqual([])
    await expect(store.commit({ requestId: 'degraded' })).rejects.toMatchObject({ status: 503 })
  })

  it('requires the coordinator fence for peer state while preserving the ordinary user-message path', async () => {
    const { store, connection } = await manager()
    const input = { requestId: 'peer-topic', checks: [{ kind: 'peer_topic' as const, id: 'root', expectedRevision: null }],
      puts: [{ kind: 'peer_topic' as const, id: 'root', roomId: 'room', value: { rootRequestId: 'root', status: 'active' } }] }
    await expect(store.commit(input)).rejects.toBeInstanceOf(RoomStoreConflictError)
    expect(await store.get('peer_topic', 'root')).toBeNull()
    await expect(store.commit({ requestId: 'user-message', checks: [{ kind: 'message', id: 'user-message', expectedRevision: null }],
      puts: [{ kind: 'message', id: 'user-message', roomId: 'room', value: { body: 'User authorization' } }] })).resolves.toMatchObject({ duplicate: false })
    const lease = new RoomExecutionLease({ manager: connection, flavor: 'production', instanceId: 'production-runtime' })
    leases.push(lease)
    expect(await lease.start()).toBe(true)
    const fenced = new RemoteRoomStore(connection, { getFence: () => lease.getFence() })
    await expect(fenced.commit(input)).resolves.toMatchObject({ duplicate: false })
    expect(await store.list('peer_topic', { rootRequestId: 'root' })).toHaveLength(1)
  })

  it('preserves the internal activity projection across the Manager boundary', async () => {
    const { store } = await manager()
    await store.commit({ requestId: 'activity', checks: [{ kind: 'integration', id: 'integration', expectedRevision: null }],
      puts: [{ kind: 'integration', id: 'integration', roomId: 'room', taskId: 'task', value: {
        taskId: 'task', status: 'validating', diff: 'large omitted candidate diff',
        attention: { approvalIds: ['approval'], userInputIds: [] }
      } }] })
    const rows = await store.list<{ status: string; attention: unknown; diff?: string }>('integration', { roomId: 'room', activityOnly: true })
    expect(rows[0]).toMatchObject({ taskId: 'task', value: { status: 'validating', attention: { approvalIds: ['approval'] } } })
    expect(rows[0].value).not.toHaveProperty('diff')
  })
})
