import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { registerRoomProfileRoutes } from './register-room-profile-routes.js'
import { normalizeKunAvatarParts } from '../../contracts/kun-avatar-catalog.js'
import { AgentIdentityService } from '../../agents/agent-identity-service.js'
import { RoomService, defaultRoomMembers } from '../../rooms/room-service.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { ServerRuntime } from './server-runtime.js'

const resources: Array<{ dir: string; store: SqliteRoomStore }> = []
afterEach(async () => {
  for (const { dir, store } of resources.splice(0)) {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('roundtrips composed avatars in the existing profile route, preserving receipts and revision conflicts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-composed-avatar-'))
  let store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  const resource = { dir, store }
  resources.push(resource)
  const service = { store }
  const rooms = { service, exclusive: vi.fn((callback: () => unknown) => callback()) } as unknown as RoomRuntime
  const handlers = new Map<string, (rooms: RoomRuntime, request: Request) => Promise<unknown>>()
  registerRoomProfileRoutes((method, path, handler) => handlers.set(method + path, handler), {} as ServerRuntime)
  const put = (body: unknown) => handlers.get('PUT/v1/rooms/user-profile')!(rooms,
    new Request('http://kun.local/v1/rooms/user-profile', { method: 'PUT', body: JSON.stringify(body) }))
  const get = () => handlers.get('GET/v1/rooms/user-profile')!(rooms,
    new Request('http://kun.local/v1/rooms/user-profile'))
  const avatar = { kind: 'composed', version: 1,
    parts: normalizeKunAvatarParts({ color: 'mint', face: 'happy', headwear: 'beret', prop: 'paintbrush' }) }
  const request = { clientRequestId: 'composed', expectedRevision: null, avatar }
  expect(await put(request)).toEqual({ profile: { avatar }, revision: 0 })
  expect(await put(request)).toEqual(await get())
  await expect(put({ ...request, clientRequestId: 'stale' })).rejects.toThrow()
  await expect(put({ clientRequestId: 'conflict', expectedRevision: 0, avatar: {
    ...avatar, parts: { ...avatar.parts, headwear: 'astronaut-helmet', glasses: 'square' }
  } })).rejects.toThrow('cannot be combined')
  expect(await get()).toEqual({ profile: { avatar }, revision: 0 })

  await store.close()
  store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resource.store = store
  service.store = store
  expect(await get()).toEqual({ profile: { avatar }, revision: 0 })
  expect((await store.events('*')).map((event) => event.kind)).toEqual(['presentation.user-profile.updated'])
  expect(await put({ clientRequestId: 'reset', expectedRevision: 0, avatar: null }))
    .toEqual({ profile: { avatar: null }, revision: 1 })
  expect((await store.events('*')).map((event) => event.kind))
    .toEqual(['presentation.user-profile.updated', 'presentation.user-profile.updated'])
  expect(await store.list('room_avatar')).toEqual([])
})

it('persists Agent, group and member compositions through their current services without uploads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-composed-services-'))
  let store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  const resource = { dir, store }
  resources.push(resource)
  const avatar = { kind: 'composed' as const, version: 1 as const,
    parts: normalizeKunAvatarParts({ color: 'teal', glasses: 'square', outfit: 'black-hoodie' }) }
  const agents = new AgentIdentityService(store, () => ({}))
  const { agent } = await agents.create({ clientRequestId: 'create-avatar-agent', name: 'Avatar agent', avatar })
  const service = new RoomService(store, () => undefined)
  const members = defaultRoomMembers([]).map((member) => ({ ...member, avatar }))
  const { room } = await service.create({ clientRequestId: 'create-avatar-group', name: 'Avatar group', avatar, members })
  const changed = { ...avatar, parts: normalizeKunAvatarParts({ color: 'mint', face: 'happy', prop: 'leaf' }) }
  await agents.update(agent.id, { clientRequestId: 'update-avatar-agent', expectedRevision: 0, avatar: changed })
  await service.update(room.id, { clientRequestId: 'update-avatar-group', expectedRevision: 0, avatar: changed,
    members: members.map((member) => ({ ...member, avatar: changed })) })
  await expect(agents.update(agent.id, { clientRequestId: 'stale-avatar-agent', expectedRevision: 0, avatar }))
    .rejects.toThrow()
  await expect(service.update(room.id, { clientRequestId: 'stale-avatar-group', expectedRevision: 0, avatar }))
    .rejects.toThrow()
  const invalid = { ...avatar, parts: { ...avatar.parts, headwear: 'astronaut-helmet' } }
  await expect(agents.update(agent.id, { clientRequestId: 'invalid-avatar-agent', expectedRevision: 1, avatar: invalid }))
    .rejects.toThrow('cannot be combined')
  await expect(service.update(room.id, { clientRequestId: 'invalid-avatar-group', expectedRevision: 1, avatar: invalid }))
    .rejects.toThrow('cannot be combined')

  await store.close()
  store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resource.store = store
  expect((await new AgentIdentityService(store, () => ({})).get(agent.id)).avatar).toEqual(changed)
  const persisted = await new RoomService(store, () => undefined).get(room.id)
  expect(persisted.avatar).toEqual(changed)
  expect(persisted.members.every((member) => JSON.stringify(member.avatar) === JSON.stringify(changed))).toBe(true)
  expect((await store.events('*')).map((event) => event.kind))
    .toEqual(['agent.created', 'room.created', 'agent.updated', 'room.updated'])
  expect(await store.list('room_avatar')).toEqual([])
})
