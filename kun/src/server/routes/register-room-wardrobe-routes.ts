import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { roomFingerprint } from '../../rooms/room-service.js'
import {
  exchangeRoomWardrobeItem, markRoomWardrobeSeen, openRoomWardrobeDrops, readRoomWardrobe, stashRoomWardrobeDrops,
  updateRoomWardrobeSettings, wardrobeUnlockAll
} from '../../rooms/room-wardrobe-service.js'
import {
  AckWardrobeActivityRequest, AttachWardrobeRequest, ackWardrobeActivity, attachAccountWardrobe, detachAccountWardrobe, listWardrobeActivity
} from '../../rooms/room-wardrobe-account.js'
import { readJsonBody } from '../read-json-body.js'

type Add = (method: string, path: string, handler: (rooms: RoomRuntime, request: Request) => Promise<unknown>) => void
const Mutation = { clientRequestId: z.string().min(1).max(128), expectedRevision: z.number().int().nonnegative().nullable() }
const DropIds = z.array(z.string().min(1).max(128)).min(1).max(10)
// One bottle (dropId) or up to a ten-pull (dropIds).
const OpenRequest = z.object({ ...Mutation, dropId: z.string().min(1).max(128).optional(), dropIds: DropIds.optional() }).strict()
  .refine((input) => Boolean(input.dropId) !== Boolean(input.dropIds), 'give either dropId or dropIds')
const StashRequest = z.object({ ...Mutation, dropIds: z.array(z.string().min(1).max(128)).min(1).max(99) }).strict()
const SeenRequest = z.object({ ...Mutation, keys: z.array(z.string().min(1).max(128)).max(200) }).strict()
const SettingsRequest = z.object({ ...Mutation, settings: z.object({ drops: z.boolean().optional(), code: z.boolean().optional(),
  notice: z.enum(['card', 'quiet']).optional() }).strict() }).strict()
const ExchangeRequest = z.object({ ...Mutation, key: z.string().regex(/^(headwear|glasses|outfit|prop)\/[a-z0-9-]+$/) }).strict()

/** The wardrobe is one row per user; drops are produced by finished Agent and Code turns, never by these routes. */
export function registerRoomWardrobeRoutes(add: Add) {
  add('GET', '/v1/rooms/wardrobe', async (rooms) => ({ ...await readRoomWardrobe(rooms.service.store), unlockAll: wardrobeUnlockAll() }))
  add('POST', '/v1/rooms/wardrobe/open', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = OpenRequest.parse(raw.value)
    const { dropId, dropIds, ...rest } = input
    return rooms.exclusive(() => openRoomWardrobeDrops(rooms.service.store, { ...rest, dropIds: dropIds ?? [dropId!] }, roomFingerprint(input)))
  })
  add('POST', '/v1/rooms/wardrobe/stash', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = StashRequest.parse(raw.value)
    return rooms.exclusive(() => stashRoomWardrobeDrops(rooms.service.store, input, roomFingerprint(input)))
  })
  add('POST', '/v1/rooms/wardrobe/seen', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = SeenRequest.parse(raw.value)
    return rooms.exclusive(() => markRoomWardrobeSeen(rooms.service.store, input, roomFingerprint(input)))
  })
  add('POST', '/v1/rooms/wardrobe/settings', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = SettingsRequest.parse(raw.value)
    return rooms.exclusive(() => updateRoomWardrobeSettings(rooms.service.store, input, roomFingerprint(input)))
  })
  // Main process only (not in the renderer allowlist): keeps the mirror in step with the Kun account.
  add('POST', '/v1/rooms/wardrobe/account/attach', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = AttachWardrobeRequest.parse(raw.value)
    return rooms.exclusive(() => attachAccountWardrobe(rooms.service.store, input))
  })
  add('POST', '/v1/rooms/wardrobe/account/detach', async (rooms) => rooms.exclusive(() => detachAccountWardrobe(rooms.service.store)))
  add('GET', '/v1/rooms/wardrobe/account/activity', async (rooms) => listWardrobeActivity(rooms.service.store))
  add('POST', '/v1/rooms/wardrobe/account/activity/ack', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = AckWardrobeActivityRequest.parse(raw.value)
    return rooms.exclusive(() => ackWardrobeActivity(rooms.service.store, input))
  })
  add('POST', '/v1/rooms/wardrobe/exchange', async (rooms, request) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = ExchangeRequest.parse(raw.value)
    return rooms.exclusive(() => exchangeRoomWardrobeItem(rooms.service.store,
      { ...input, key: input.key as `${'headwear' | 'glasses' | 'outfit' | 'prop'}/${string}` }, roomFingerprint(input)))
  })
}
