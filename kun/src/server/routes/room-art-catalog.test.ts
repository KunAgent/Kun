import { afterEach, expect, it, vi } from 'vitest'
import { registerRoomWardrobeRoutes } from './register-room-wardrobe-routes.js'
import { installArtCatalog, readArtCatalog } from '../../contracts/kun-art-catalog.js'
import { KunAvatarPartsSchema } from '../../contracts/kun-avatar-schema.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
afterEach(() => installArtCatalog(null))
it('installs and resets display metadata without writing wardrobe ownership', async () => {
  const handlers = new Map<string, (rooms: RoomRuntime, request: Request) => Promise<unknown>>()
  registerRoomWardrobeRoutes((method, path, handler) => handlers.set(method + path, handler))
  const rooms = { exclusive: vi.fn((work: () => unknown) => work()) } as unknown as RoomRuntime
  const request = (body: unknown) => handlers.get('POST/v1/rooms/wardrobe/art-catalog')!(rooms,
    new Request('http://localhost/v1/rooms/wardrobe/art-catalog', { method: 'POST', body: JSON.stringify(body) }))
  const catalog = readArtCatalog()
  catalog.parts.glasses.push({ ...catalog.parts.glasses[0], id: 'new-art' })
  expect(await request({ catalog })).toEqual({ ok: true })
  expect(KunAvatarPartsSchema.safeParse({ color: 'sky', face: 'normal', glasses: 'new-art' }).success).toBe(true)
  await expect(request({ catalog: { parts: {} } })).rejects.toThrow()
  expect(KunAvatarPartsSchema.safeParse({ color: 'sky', face: 'normal', glasses: 'new-art' }).success).toBe(true)
  expect(await request({ catalog: null })).toEqual({ ok: true })
  expect(KunAvatarPartsSchema.safeParse({ color: 'sky', face: 'normal', glasses: 'new-art' }).success).toBe(false)
})
