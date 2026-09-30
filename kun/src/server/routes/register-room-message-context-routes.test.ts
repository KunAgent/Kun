import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { RoomMessageSchema } from '../../contracts/rooms.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { registerRoomMessageContextRoutes } from './register-room-message-context-routes.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanups.splice(0)) await fn() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'room-context-')), store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const handlers = new Map<string, Parameters<typeof registerRoomMessageContextRoutes>[0] extends
    (method: string, path: string, handler: infer H) => void ? H : never>()
  registerRoomMessageContextRoutes((_method, path, handler) => handlers.set(path, handler))
  const runtime = { deps: { store }, service: { get: async (id: string) => {
    if (id !== 'room') throw new Error('room not found'); return { id }
  } } } as unknown as RoomRuntime
  const put = async (id: string, roomId = 'room', extra = {}) => {
    const value = RoomMessageSchema.parse({ id, roomId, authorKind: 'user', authorLabelSnapshot: 'User',
      body: id, bodyRevision: 0, messageSeq: 1, mentionMemberIds: [], attachmentIds: [], status: 'final',
      createdAt: '2026-09-30T12:00:00.000Z', ...extra })
    await store.commit({ requestId: id, checks: [{ kind: 'message', id, expectedRevision: null }],
      puts: [{ kind: 'message', id, roomId, value }] })
    return (await store.get('message', id))!
  }
  const call = (path: string, messageId?: string, query = '') => handlers.get(path)!(runtime,
    new Request('http://local/' + query), { params: { roomId: 'room', messageId } } as unknown as RouteContext)
  return { store, put, call }
}

describe('room message context and read anchors', () => {
  it('loads both sides of an exact message in chronological order', async () => {
    const f = await fixture()
    await f.put('before'); await f.put('target'); await f.put('after'); await f.put('far')
    expect(await f.call('/v1/rooms/:roomId/messages/:messageId/context', 'target', '?limit=1')).toMatchObject({
      targetMessageId: 'target', messages: [{ id: 'before' }, { id: 'target' }, { id: 'after' }], hasEarlier: true, hasLater: true })
  })
  it('rejects foreign targets instead of exposing their content', async () => {
    const f = await fixture(); await f.put('foreign', 'other-room')
    await expect(f.call('/v1/rooms/:roomId/messages/:messageId/context', 'foreign')).rejects.toThrow('not found')
    await expect(f.call('/v1/rooms/:roomId/messages/:messageId/context', 'missing')).rejects.toThrow('not found')
  })
  it('returns first actual unread message despite global sequence gaps and hidden setup rows', async () => {
    const f = await fixture(), read = await f.put('read')
    await f.store.commit({ requestId: 'read-state', checks: [{ kind: 'read_state', id: 'room', expectedRevision: null }],
      puts: [{ kind: 'read_state', id: 'room', roomId: 'room', value: { seq: read.seq } }] })
    for (let i = 0; i < 5; i++) await f.put('foreign-' + i, 'other-room')
    await f.put('setup', 'room', { presentationKind: 'setup' })
    await f.put('stream', 'room', { status: 'streaming' })
    await f.put('unread')
    expect(await f.call('/v1/rooms/:roomId/read')).toEqual({ seq: read.seq, firstUnreadMessageId: 'unread' })
  })
  it('handles empty rooms and validates bounded context sizes', async () => {
    const f = await fixture()
    expect(await f.call('/v1/rooms/:roomId/read')).toEqual({ seq: 0 })
    await f.put('target')
    await expect(f.call('/v1/rooms/:roomId/messages/:messageId/context', 'target', '?limit=10000')).rejects.toThrow()
  })
})
