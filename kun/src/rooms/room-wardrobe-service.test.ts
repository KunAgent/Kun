import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from './room-store-sqlite.js'
import {
  assertRoomWardrobeAllows, countRoomWardrobeTurn, markRoomWardrobeSeen, openRoomWardrobeDrops, readRoomWardrobe, updateRoomWardrobeSettings
} from './room-wardrobe-service.js'
import { roomFingerprint } from './room-service.js'

const resources: Array<{ dir: string; store: SqliteRoomStore }> = []
// These cover the local game kept for debug runs; signed-in and signed-out wardrobes are in room-wardrobe-account.test.ts.
beforeEach(() => { process.env.KUN_WARDROBE_LOCAL = '1' })
afterEach(async () => {
  delete process.env.KUN_WARDROBE_UNLOCK_ALL
  delete process.env.KUN_WARDROBE_LOCAL
  for (const { dir, store } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) }
})
async function openStore() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-wardrobe-')), store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ dir, store })
  return store
}

it('ignores legacy debug switches and never creates assets or hints locally', async () => {
  const store=await openStore()
  process.env.KUN_WARDROBE_UNLOCK_ALL='1'
  const first=await readRoomWardrobe(store)
  expect(first.mode).toBe('guest')
  expect(first.wardrobe.items).toEqual({})
  expect(await countRoomWardrobeTurn(store,{runId:'old-no-ticket',source:'code'})).toBeNull()
  expect((await readRoomWardrobe(store)).wardrobe.pending).toEqual([])
  expect((await store.events('*')).filter(e=>e.kind==='wardrobe.dropped'||e.kind==='wardrobe.guest_hint')).toEqual([])
  const input={clientRequestId:'open',expectedRevision:null,dropIds:['fake']}
  await expect(openRoomWardrobeDrops(store,input,roomFingerprint(input))).rejects.toThrow('wardrobe_login_required')
})
it('keeps presentation preferences while enforcing login on personal dress-up', async () => {
  const store=await openStore(),detail=await readRoomWardrobe(store)
  const input={clientRequestId:'settings',expectedRevision:detail.revision,settings:{code:false}}
  const updated=await updateRoomWardrobeSettings(store,input,roomFingerprint(input))
  expect(updated.wardrobe.settings.code).toBe(false)
  const seen={clientRequestId:'seen',expectedRevision:updated.revision,keys:['headwear/headset']}
  expect((await markRoomWardrobeSeen(store,seen,roomFingerprint(seen))).wardrobe.seen).toContain('headwear/headset')
  await expect(assertRoomWardrobeAllows(store,[{kind:'composed',version:1,parts:{color:'sky',face:'normal',headwear:'astronaut-helmet',bg:'#fff'}}], { self: true })).rejects.toThrow()
})
