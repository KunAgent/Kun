import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { roomFingerprint } from '../../rooms/room-service.js'
import {
  exchangeRoomWardrobeItem, markRoomWardrobeSeen, openRoomWardrobeDrop, readRoomWardrobe, wardrobeUnlockAll
} from '../../rooms/room-wardrobe-service.js'
import { readJsonBody } from '../read-json-body.js'

type Add = (method: string, path: string, handler: (rooms: RoomRuntime, request: Request) => Promise<unknown>) => void
const Mutation = { clientRequestId: z.string().min(1).max(128), expectedRevision: z.number().int().nonnegative().nullable() }
const OpenRequest = z.object({ ...Mutation, dropId: z.string().min(1).max(128) }).strict()
const SeenRequest = z.object({ ...Mutation, keys: z.array(z.string().min(1).max(128)).max(200) }).strict()
const ExchangeRequest = z.object({ ...Mutation, key: z.string().regex(/^(headwear|glasses|outfit|prop)\/[a-z0-9-]+$/) }).strict()

/** The wardrobe is one row per user; drops are produced by finished Agent turns, never by these routes. */
export function registerRoomWardrobeRoutes(add: Add) {
  add('GET', '/v1/rooms/wardrobe', async (rooms) => ({ ...await readRoomWardrobe(rooms.service.store), unlockAll: wardrobeUnlockAll() }))
  add('POST', '/v1/rooms/wardrobe/open', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = OpenRequest.parse(raw.value)
    return rooms.exclusive(() => openRoomWardrobeDrop(rooms.service.store, input, roomFingerprint(input)))
  })
  add('POST', '/v1/rooms/wardrobe/seen', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = SeenRequest.parse(raw.value)
    return rooms.exclusive(() => markRoomWardrobeSeen(rooms.service.store, input, roomFingerprint(input)))
  })
  add('POST', '/v1/rooms/wardrobe/exchange', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = ExchangeRequest.parse(raw.value)
    return rooms.exclusive(() => exchangeRoomWardrobeItem(rooms.service.store,
      { ...input, key: input.key as `${'headwear' | 'glasses' | 'outfit' | 'prop'}/${string}` }, roomFingerprint(input)))
  })
}
