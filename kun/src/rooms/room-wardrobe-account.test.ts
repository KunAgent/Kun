import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from './room-store-sqlite.js'
import {
  assertRoomWardrobeAllows, countRoomWardrobeTurn, defaultAgentWardrobeKeys, markRoomWardrobeSeen, readRoomWardrobe
} from './room-wardrobe-service.js'
import {
  accountAvatar, ackWardrobeActivity, attachAccountWardrobe, detachAccountWardrobe, listWardrobeActivity
} from './room-wardrobe-account.js'
import { roomFingerprint } from './room-service.js'
import { KUN_WARDROBE_STARTER_PACK } from '../contracts/kun-wardrobe.js'

const resources: Array<{ dir: string; store: SqliteRoomStore }> = []
afterEach(async () => { for (const { dir, store } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) } })
async function openStore() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-wardrobe-account-')), store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ dir, store })
  return store
}
const composed = (parts: Record<string, string>) => ({ kind: 'composed' as const, version: 1 as const, parts: { color: 'sky', face: 'normal', bg: '#f7f5ef', ...parts } })
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
  expect(Object.keys(detail.wardrobe.items).sort()).toEqual(['glasses/square', 'headwear/headset', 'outfit/blue-scarf', 'prop/notebook'])
  expect([detail.wardrobe.pending, detail.wardrobe.feathers, detail.wardrobe.settings.notice]).toEqual([[], 0, 'quiet'])
  // The beret is taken off; the starter glasses, face and color stay.
  expect(await profile(store)).toEqual(composed({ glasses: 'square', face: 'wink' }))
  expect((await readRoomWardrobe(store)).revision).toBe(detail.revision)
})

it('drops nothing while signed out and lets the signed-out look wear only the starter pack', async () => {
  const store = await openStore()
  expect(await countRoomWardrobeTurn(store, { roomId: 'room-a', runId: 'run-1', finishedAt: now() })).toBeNull()
  expect((await readRoomWardrobe(store)).wardrobe.pending).toEqual([])
  await expect(assertRoomWardrobeAllows(store, [composed({ headwear: 'headset' })], { self: true })).resolves.toBeUndefined()
  await expect(assertRoomWardrobeAllows(store, [composed({ headwear: 'beret' })], { self: true })).rejects.toThrow('avatar_item_locked')
  // Agents may keep what the default Agents wear, the user's own look may not.
  const [templateKey] = [...defaultAgentWardrobeKeys()].filter((key) => !KUN_WARDROBE_STARTER_PACK.includes(key))
  const [category, id] = templateKey!.split('/')
  await expect(assertRoomWardrobeAllows(store, [composed({ [category!]: id! })])).resolves.toBeUndefined()
  await expect(assertRoomWardrobeAllows(store, [composed({ [category!]: id! })], { self: true })).rejects.toThrow('avatar_item_locked')
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
  const queued = await listWardrobeActivity(store)
  expect(queued.userId).toBe('user-1')
  expect(queued.activity.map((entry) => [entry.runId, entry.source, entry.roomId ?? entry.threadId])).toEqual([
    ['run-1', 'room', 'room-a'], ['code-turn-1', 'code', 'thread-1']])
  expect((await store.events('*')).filter((event) => event.kind === 'wardrobe.activity')).toHaveLength(2)

  // The account dropped a bottle for run-1; a turn queued meanwhile stays queued.
  await countRoomWardrobeTurn(store, { roomId: 'room-b', runId: 'run-3', finishedAt: now() })
  const dropped = { id: 'c0ffee00-0000-4000-8000-000000000003', kind: 'item', rarity: 'common', item: { category: 'prop', id: 'camera' },
    duplicate: false, feathers: 0, source: 'room', roomId: 'room-a', messageId: 'msg-1', runId: 'run-1', createdAt: now() }
  const acked = await ackWardrobeActivity(store, { userId: 'user-1', runIds: ['run-1', 'code-turn-1'],
    drops: [{ runId: 'run-1', dropId: dropped.id }], wardrobe: serverWardrobe({ pending: [dropped] }) })
  expect(acked.wardrobe.pending.map((drop) => drop.id)).toEqual([dropped.id])
  expect((await listWardrobeActivity(store)).activity.map((entry) => entry.runId)).toEqual(['run-3'])
  expect((await store.events('*')).filter((event) => event.kind === 'wardrobe.dropped')).toEqual([expect.objectContaining({
    roomId: 'room-a', payload: { dropId: dropped.id, runId: 'run-1', messageId: 'msg-1' } })])
  await expect(ackWardrobeActivity(store, { userId: 'user-2', runIds: ['run-3'], drops: [], wardrobe: serverWardrobe() }))
    .rejects.toThrow('wardrobe_account_changed')
})

it('starts a different account with an empty queue and signs out to the starter wardrobe', async () => {
  const store = await openStore()
  await attachAccountWardrobe(store, { userId: 'user-1', wardrobe: serverWardrobe(), look: null })
  await countRoomWardrobeTurn(store, { roomId: 'room-a', runId: 'run-1', finishedAt: now() })
  await attachAccountWardrobe(store, { userId: 'user-1', wardrobe: serverWardrobe(), look: null })
  expect((await listWardrobeActivity(store)).activity).toHaveLength(1)
  await attachAccountWardrobe(store, { userId: 'user-2', wardrobe: serverWardrobe(), look: { color: 'sky', face: 'happy', headwear: 'beret', bg: '#f7f5ef' } })
  expect((await listWardrobeActivity(store)).activity).toEqual([])

  const guest = await detachAccountWardrobe(store)
  expect(guest.mode).toBe('guest')
  expect(guest.wardrobe.items['headwear/beret']).toBeUndefined()
  expect(await profile(store)).toEqual(composed({ face: 'happy' }))
  expect(await listWardrobeActivity(store)).toEqual({ userId: null, activity: [] })
  expect((await detachAccountWardrobe(store)).revision).toBe(guest.revision)
})

it('ignores account looks it cannot read', () => {
  expect(accountAvatar(null)).toBeNull()
  expect(accountAvatar({ color: 'sky', face: 'normal', headwear: 'not-a-hat' })).toBeNull()
  expect(accountAvatar({ color: 'sky', face: 'normal', prop: null })).toEqual(composed({ bg: expect.any(String) as unknown as string }))
})
