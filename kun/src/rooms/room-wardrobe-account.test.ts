import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from './room-store-sqlite.js'
import {
  assertRoomWardrobeAllows, countRoomWardrobeTurn, markRoomWardrobeSeen, readRoomWardrobe
} from './room-wardrobe-service.js'
import {
  accountAvatar, attachAccountWardrobe, detachAccountWardrobe
} from './room-wardrobe-account.js'
import { roomFingerprint } from './room-service.js'
import { KUN_WARDROBE_STARTER_PACK } from '../contracts/kun-wardrobe.js'
import type { RoomAvatarReference } from '../contracts/room-content.js'

const resources: Array<{ dir: string; store: SqliteRoomStore }> = []
afterEach(async () => { for (const { dir, store } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) } })
async function openStore() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-wardrobe-account-')), store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ dir, store })
  return store
}
// Test looks use plain strings; the schema narrows them when a look is saved.
const composed = (parts: Record<string, string>) => ({ kind: 'composed', version: 1, parts: { color: 'sky', face: 'normal', bg: '#f7f5ef', ...parts } }) as unknown as RoomAvatarReference
const profile = async (store: SqliteRoomStore) => (await store.get<{ avatar: unknown }>('room_user_profile', 'self'))?.value.avatar
const now = () => new Date().toISOString()

/** What GET /api/wardrobe returns inside `wardrobe` for a signed-in user with two bottles waiting. */
function serverWardrobe(extra: Record<string, unknown> = {}) {
  const bottle = (id: string, runId: string, more: Record<string, unknown> = {}) => ({ id, kind: 'item', rarity: 'rare',
    item: { category: 'headwear', id: 'beret' }, duplicate: false, feathers: 0, source: 'welcome', runId, createdAt: now(), ...more })
  return { version: 1, items: { 'headwear/headset': 1, 'glasses/square': 1, 'outfit/blue-scarf': 1, 'prop/notebook': 1, 'headwear/beret': 1 },
    seen: [], roles: [], feathers: 120, pending: [bottle('b0e4e0c2-0000-4000-8000-000000000001', 'welcome'),
      bottle('b0e4e0c2-0000-4000-8000-000000000002', 'invite-1', { source: 'campaign', sourceLabel: 'x'.repeat(200) })],
    pity: { sinceDrop: 0, sinceEpic: 0, lastCountedAt: null }, daily: { date: '2026-10-10', drops: 0 }, rngState: 0, totalDrops: 2,
    firstDropAt: null, settings: { drops: true, code: true, notice: 'card' }, history: [], ...extra }
}

it('turns a locally collected wardrobe into the signed-out starter wardrobe once', async () => {
  const store = await openStore()
  await store.commit({ requestId: 'seed', checks: [{ kind: 'room_wardrobe', id: 'self', expectedRevision: null },
    { kind: 'room_user_profile', id: 'self', expectedRevision: null }], puts: [
    { kind: 'room_wardrobe', id: 'self', value: { ...serverWardrobe({ pending: [] }), items: { 'headwear/beret': 1, 'prop/camera': 2 }, settings: { drops: false, code: true, notice: 'quiet' } } },
    { kind: 'room_user_profile', id: 'self', value: { avatar: composed({ headwear: 'beret', glasses: 'square', face: 'wink' }) } }
  ] })
  const detail = await readRoomWardrobe(store)
  expect(detail.mode).toBe('guest')
  expect(detail.wardrobe.items).toEqual({})
  expect([detail.wardrobe.pending, detail.wardrobe.feathers, detail.wardrobe.settings.notice]).toEqual([[], 0, 'quiet'])
  // The beret is taken off; the starter glasses, face and color stay.
  expect(await profile(store)).toEqual(composed({ face: 'wink' }))
  expect((await readRoomWardrobe(store)).revision).toBe(detail.revision)
})

it('does not generate a guest hint without a server receipt and denies guest appearance changes', async () => {
  const store = await openStore()
  const context = { roomId: 'room-a', runId: 'guest-turn', finishedAt: now() }
  expect(await countRoomWardrobeTurn(store, context)).toBeNull()
  await countRoomWardrobeTurn(store, context)
  const guest = await readRoomWardrobe(store)
  expect(guest.wardrobe.pending).toEqual([])
  expect(guest.wardrobe.items).toEqual({})
  expect(guest.wardrobe.roles).toEqual([])
  expect(guest.wardrobe.feathers).toBe(0)
  expect(guest.guestHints).toHaveLength(0)
  expect((await store.events('*')).filter(e => e.kind === 'wardrobe.guest_hint')).toHaveLength(0)
  await expect(assertRoomWardrobeAllows(store, [composed({ headwear: 'headset' })], { self: true })).rejects.toThrow('wardrobe_login_required')
  await expect(assertRoomWardrobeAllows(store, [composed({})], { self: true })).rejects.toThrow('wardrobe_login_required')
  await expect(assertRoomWardrobeAllows(store, [null], { self: true })).rejects.toThrow('wardrobe_login_required')
  await expect(assertRoomWardrobeAllows(store, [composed({ headwear: 'beret' })])).rejects.toThrow('wardrobe_login_required')
})

it('mirrors the account, wears its look, queues turns and refuses local changes', async () => {
  const store = await openStore()
  const attached = await attachAccountWardrobe(store, { userId: 'user-1', wardrobe: serverWardrobe(),
    look: { color: 'periwinkle', face: 'wink', headwear: 'beret', glasses: null, outfit: null, prop: null, bg: '#f7f5ef' } })
  expect(attached.mode).toBe('account')
  expect(attached.wardrobe.feathers).toBe(120)
  expect(attached.wardrobe.pending[1]!.sourceLabel).toHaveLength(120)
  expect(await profile(store)).toEqual(composed({ color: 'periwinkle', face: 'wink', headwear: 'beret' }))
  await expect(assertRoomWardrobeAllows(store, [composed({ headwear: 'beret' })], { self: true })).resolves.toBeUndefined()
  await expect(markRoomWardrobeSeen(store, { clientRequestId: 'seen-1', expectedRevision: null, keys: ['headwear/beret'] },
    roomFingerprint({ keys: ['headwear/beret'] }))).rejects.toThrow('wardrobe_account_mode')

  const context = { roomId: 'room-a', runId: 'run-1', messageId: 'msg-1', finishedAt: now(), sourceLabel: '周报' }
  expect(await countRoomWardrobeTurn(store, context)).toBeNull()
  expect(await countRoomWardrobeTurn(store, context)).toBeNull()
  await countRoomWardrobeTurn(store, { source: 'code', threadId: 'thread-1', runId: 'code-turn-1', finishedAt: now() })
  expect((await readRoomWardrobe(store)).wardrobe.pending).toHaveLength(2)
})

it('starts a different account with an empty queue and signs out to the starter wardrobe', async () => {
  const store = await openStore()
  await attachAccountWardrobe(store, { userId: 'user-1', wardrobe: serverWardrobe(), look: null })
  await countRoomWardrobeTurn(store, { roomId: 'room-a', runId: 'run-1', finishedAt: now() })
  await attachAccountWardrobe(store, { userId: 'user-1', wardrobe: serverWardrobe(), look: null })
  await attachAccountWardrobe(store, { userId: 'user-2', wardrobe: serverWardrobe(), look: { color: 'sky', face: 'happy', headwear: 'beret', bg: '#f7f5ef' } })

  const guest = await detachAccountWardrobe(store)
  expect(guest.mode).toBe('guest')
  expect(guest.wardrobe.items['headwear/beret']).toBeUndefined()
  expect(await profile(store)).toEqual(composed({ face: 'happy' }))
  expect((await detachAccountWardrobe(store)).revision).toBe(guest.revision)
})

it('ignores account looks it cannot read', () => {
  expect(accountAvatar(null)).toBeNull()
  expect(accountAvatar({ color: 'sky', face: 'normal', headwear: 'not-a-hat' })).toBeNull()
  expect(accountAvatar({ color: 'sky', face: 'normal', prop: null })).toEqual(composed({ bg: expect.any(String) as unknown as string }))
})

it('refuses an older inventory snapshot after a newer revision has been mirrored', async () => {
  const store=await openStore()
  await attachAccountWardrobe(store,{userId:'user-1',serverRevision:9,wardrobe:serverWardrobe({feathers:50})})
  await attachAccountWardrobe(store,{userId:'user-1',serverRevision:8,wardrobe:serverWardrobe({feathers:99})})
  expect((await readRoomWardrobe(store)).wardrobe.feathers).toBe(50)
})
