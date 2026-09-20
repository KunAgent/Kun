import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { registerRoomProfileRoutes } from './register-room-profile-routes.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { ServerRuntime } from './server-runtime.js'
const resources: Array<{ dir: string; store: SqliteRoomStore }> = []
afterEach(async () => { for (const { dir, store } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) } })
it('persists only validated avatar references, recovers receipts, and emits presentation events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-user-avatar-')), store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ dir, store })
  const rooms = { service: { store }, exclusive: vi.fn((callback: () => unknown) => callback()) } as unknown as RoomRuntime
  const handlers = new Map<string, (rooms: RoomRuntime, request: Request) => Promise<unknown>>()
  registerRoomProfileRoutes((method, path, handler) => handlers.set(method + path, handler), {} as ServerRuntime)
  const put = (body: unknown) => handlers.get('PUT/v1/rooms/user-profile')!(rooms, new Request('http://kun.local/v1/rooms/user-profile', { method: 'PUT', body: JSON.stringify(body) }))
  const get = () => handlers.get('GET/v1/rooms/user-profile')!(rooms, new Request('http://kun.local/v1/rooms/user-profile'))
  expect(await get()).toEqual({ profile: { avatar: null }, revision: null })
  const body = { clientRequestId: 'avatar', expectedRevision: null, avatar: { kind: 'builtin', id: 'explorer' } }
  expect(await put(body)).toEqual({ profile: { avatar: body.avatar }, revision: 0 })
  expect(await put(body)).toEqual(await get())
  await expect(put({ ...body, clientRequestId: 'stale' })).rejects.toThrow()
  await expect(put({ avatar: { kind: 'uploaded', attachmentId: 'att_' + 'a'.repeat(24) }, clientRequestId: 'invalid', expectedRevision: 0 })).rejects.toThrow('unavailable')
  expect(await put({ clientRequestId: 'reset', expectedRevision: 0, avatar: null })).toEqual({ profile: { avatar: null }, revision: 1 })
  expect((await store.events('*')).map((event) => event.kind)).toEqual(['presentation.user-profile.updated', 'presentation.user-profile.updated'])
  expect(await store.list('request')).toEqual([])
  expect(await store.list('message')).toEqual([])
})
