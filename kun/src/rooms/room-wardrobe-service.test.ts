import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from './room-store-sqlite.js'
import {
  assertRoomWardrobeAllows, countRoomWardrobeTurn, markRoomWardrobeSeen, openRoomWardrobeDrops, readRoomWardrobe, updateRoomWardrobeSettings
} from './room-wardrobe-service.js'
import { roomFingerprint } from './room-service.js'

const resources: Array<{ dir: string; store: SqliteRoomStore }> = []
afterEach(async () => {
  delete process.env.KUN_WARDROBE_UNLOCK_ALL
  for (const { dir, store } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) }
})
async function openStore() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-wardrobe-')), store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ dir, store })
  return store
}

it('creates the wardrobe once with the starter pack and everything already worn', async () => {
  const store = await openStore()
  await store.commit({ requestId: 'seed', checks: [{ kind: 'room_user_profile', id: 'self', expectedRevision: null },
    { kind: 'agent_identity', id: 'agent-a', expectedRevision: null }, { kind: 'room', id: 'room-a', expectedRevision: null }], puts: [
    { kind: 'room_user_profile', id: 'self', value: { avatar: { kind: 'composed', version: 1, parts: { color: 'sky', face: 'normal', headwear: 'laurel', bg: '#f7f5ef' } } } },
    { kind: 'agent_identity', id: 'agent-a', value: { id: 'agent-a', avatar: { kind: 'composed', version: 1, parts: { color: 'sky', face: 'normal', prop: 'camera', bg: '#f7f5ef' } } } },
    { kind: 'room', id: 'room-a', value: { id: 'room-a', members: [{ id: 'm', avatar: { kind: 'builtin', id: 'magician' } }] } }
  ] })
  const first = await readRoomWardrobe(store)
  expect(first.revision).toBe(0)
  for (const key of ['headwear/headset', 'glasses/square', 'outfit/blue-scarf', 'prop/notebook', 'headwear/laurel', 'prop/camera',
    'headwear/wizard-hat', 'outfit/wizard-cape', 'outfit/black-hoodie', 'headwear/detective-hat', 'prop/magnifier']) {
    expect(first.wardrobe.items[key], key).toBe(1)
  }
  expect(first.wardrobe.roles).toEqual(expect.arrayContaining(['coordinator', 'coder', 'reviewer', 'detective', 'magician']))
  expect(first.wardrobe.items['headwear/astronaut-helmet']).toBeUndefined()
  expect(await readRoomWardrobe(store)).toEqual(first)
  expect(await store.events('*')).toEqual([])
})

it('counts a finished turn once, persists the bottle before publishing it, and ignores stale turns', async () => {
  const store = await openStore()
  const context = { roomId: 'room-a', runId: 'run-1', messageId: 'msg-1', finishedAt: new Date().toISOString() }
  const drop = await countRoomWardrobeTurn(store, context)
  expect(drop?.kind).toBe('item')
  expect(await countRoomWardrobeTurn(store, context)).toBeNull()
  const detail = await readRoomWardrobe(store)
  expect(detail.wardrobe.pending.map((entry) => entry.id)).toEqual([drop!.id])
  const events = await store.events('*')
  expect(events.filter((event) => event.kind === 'wardrobe.dropped')).toEqual([expect.objectContaining({ roomId: 'room-a',
    payload: { dropId: drop!.id, runId: 'run-1', messageId: 'msg-1' } })])
  const stale = { roomId: 'room-a', runId: 'run-old', finishedAt: new Date(Date.now() - 11 * 60_000).toISOString() }
  expect(await countRoomWardrobeTurn(store, stale)).toBeNull()
  expect((await readRoomWardrobe(store)).revision).toBe(detail.revision)
  // Too soon after the last counted turn: nothing changes, but the run is remembered.
  expect(await countRoomWardrobeTurn(store, { roomId: 'room-a', runId: 'run-2', finishedAt: new Date().toISOString() })).toBeNull()
  expect(await store.getRequest('wardrobe-turn:run-2')).not.toBeNull()
})

it('opens bottles idempotently with revision checks and tracks seen marks', async () => {
  const store = await openStore()
  const drop = (await countRoomWardrobeTurn(store, { roomId: 'room-a', runId: 'run-1', finishedAt: new Date().toISOString() }))!
  const before = await readRoomWardrobe(store)
  const input = { clientRequestId: 'open-1', expectedRevision: before.revision, dropIds: [drop.id] }
  const opened = await openRoomWardrobeDrops(store, input, roomFingerprint(input))
  expect(opened.revision).toBe(before.revision + 1)
  expect(opened.wardrobe.pending).toEqual([])
  const key = `${drop.item!.category}/${drop.item!.id}`
  expect(opened.wardrobe.items[key]).toBeGreaterThanOrEqual(1)
  expect((opened as { drop?: { openedAt?: string } }).drop?.openedAt).toBeTruthy()
  expect(await openRoomWardrobeDrops(store, input, roomFingerprint(input))).toEqual(opened)
  await expect(openRoomWardrobeDrops(store, { ...input, clientRequestId: 'open-2' }, roomFingerprint({ ...input, clientRequestId: 'open-2' })))
    .rejects.toThrow()
  const seenInput = { clientRequestId: 'seen-1', expectedRevision: opened.revision, keys: [key] }
  const seen = await markRoomWardrobeSeen(store, seenInput, roomFingerprint(seenInput))
  expect(seen.wardrobe.seen).toContain(key)
})

it('lets saved looks wear only owned items unless everything is unlocked', async () => {
  const store = await openStore()
  const locked = { kind: 'composed' as const, version: 1 as const, parts: { color: 'sky' as const, face: 'normal' as const, headwear: 'astronaut-helmet' as const, bg: '#f7f5ef' } }
  await expect(assertRoomWardrobeAllows(store, [locked])).rejects.toThrow('headwear/astronaut-helmet')
  await expect(assertRoomWardrobeAllows(store, [{ kind: 'composed', version: 1, parts: { color: 'sky', face: 'normal', glasses: 'square', bg: '#f7f5ef' } }])).resolves.toBeUndefined()
  await expect(assertRoomWardrobeAllows(store, [{ kind: 'builtin', id: 'astronaut' }, null])).resolves.toBeUndefined()
  process.env.KUN_WARDROBE_UNLOCK_ALL = '1'
  await expect(assertRoomWardrobeAllows(store, [locked])).resolves.toBeUndefined()
})

it('publishes Code task bottles to every window and stops counting once drops are switched off', async () => {
  const store = await openStore()
  const drop = await countRoomWardrobeTurn(store, { source: 'code', threadId: 'thread-1', runId: 'code-turn-1', sourceLabel: '修复登录超时', finishedAt: new Date().toISOString() })
  expect(drop).toMatchObject({ source: 'code', threadId: 'thread-1', sourceLabel: '修复登录超时' })
  expect((await store.events('*')).find((event) => event.kind === 'wardrobe.dropped')).toMatchObject({
    roomId: 'agent-directory', payload: { dropId: drop!.id, runId: 'code-turn-1', threadId: 'thread-1' } })
  const detail = await readRoomWardrobe(store)
  const input = { clientRequestId: 'settings-1', expectedRevision: detail.revision, settings: { code: false } }
  const updated = await updateRoomWardrobeSettings(store, input, roomFingerprint(input))
  expect(updated.wardrobe.settings).toEqual({ drops: true, code: false, notice: 'card' })
  const later = { finishedAt: new Date(Date.now() + 120_000).toISOString(), now: new Date(Date.now() + 120_000) }
  expect(await countRoomWardrobeTurn(store, { source: 'code', threadId: 'thread-1', runId: 'code-turn-2', ...later })).toBeNull()
  expect(await store.getRequest('wardrobe-turn:code-turn-2')).toBeNull()
  const off = { clientRequestId: 'settings-2', expectedRevision: updated.revision, settings: { drops: false } }
  await updateRoomWardrobeSettings(store, off, roomFingerprint(off))
  expect(await countRoomWardrobeTurn(store, { source: 'room', roomId: 'room-a', runId: 'run-9', ...later })).toBeNull()
  expect((await readRoomWardrobe(store)).wardrobe.totalDrops).toBe(1)
})
