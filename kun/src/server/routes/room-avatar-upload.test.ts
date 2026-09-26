import { createHash } from 'node:crypto'
import { Jimp } from 'jimp'
import { expect, it, vi } from 'vitest'
import { registerRoomContentRoutes } from './register-room-content-routes.js'
import type { ServerRuntime } from './server-runtime.js'
import type { RouteContext } from '../router.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RoomStoreCommit } from '../../rooms/room-store.js'

it('holds a unique fresh upload lease until the fenced avatar receipt exists, including deduplicated uploads', async () => {
  const records = new Map<string, unknown>()
  const store = { get: vi.fn(async (kind, id) => records.get(`${kind}:${id}`) ?? null),
    commit: vi.fn(async (input: RoomStoreCommit) => {
      for (const row of input.puts ?? []) records.set(`${row.kind}:${row.id}`, row)
      return { result: input.result }
    }) }
  const leases: string[] = []
  const create = vi.fn(async (input: { data: Buffer; leaseId?: string; name: string }) => {
    expect(input.leaseId).toMatch(/^room-avatar:/)
    expect(leases).not.toContain(input.leaseId)
    leases.push(input.leaseId!)
    const hash = createHash('sha256').update(input.data).digest('hex')
    return { id: `att_${hash.slice(0, 24)}`, name: input.name, hash, byteSize: input.data.length,
      width: 128, height: 128, mimeType: 'image/jpeg', createdAt: '2026-09-13T00:00:00.000Z' }
  })
  const releaseLease = vi.fn(async (id: string, leaseId: string, referenced: boolean) => {
    expect(records.has(`room_avatar:${id}`)).toBe(true)
    expect(leases).toContain(leaseId)
    expect(referenced).toBe(true)
    return true
  })
  const rooms = { deps: { store }, service: { setContentReferenceValidator: vi.fn(), setMemberAvatarValidator: vi.fn() } } as unknown as RoomRuntime
  const runtime = { rooms, attachmentStore: { create, releaseLease } } as unknown as ServerRuntime
  const handlers = new Map<string, Parameters<typeof registerRoomContentRoutes>[0] extends (method: string, path: string, handle: infer H) => unknown ? H : never>()
  registerRoomContentRoutes((method, path, handler) => { handlers.set(`${method} ${path}`, handler) }, runtime)
  const source = await new Jimp({ width: 40, height: 60, color: 0x3399ffff }).getBuffer('image/png')
  const request = () => new Request('http://kun.local/v1/rooms/avatars', { method: 'POST',
    body: JSON.stringify({ mimeType: 'image/png', dataBase64: source.toString('base64') }) })
  const upload = handlers.get('POST /v1/rooms/avatars')!
  const first = await upload(rooms, request(), { params: {} } as RouteContext)
  expect(await upload(rooms, request(), { params: {} } as RouteContext)).toEqual(first)
  expect(store.commit).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledTimes(2)
  expect(releaseLease).toHaveBeenCalledTimes(2)
})
