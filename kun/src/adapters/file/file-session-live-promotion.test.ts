import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { makeUserItem, makeAssistantTextItem } from '../../domain/item.js'
import { delegatedHistoryDigest } from '../../runtime/delegated-session-binding.js'
import { FileSessionStore } from './file-session-store.js'
import { ItemsCache } from './file-session-items-cache.js'

const roots: string[] = []
const stores: FileSessionStore[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(stores.splice(0).map((s) => s.close()))
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})
const user = makeUserItem({ id: 'user', threadId: 'thread', turnId: 'one', text: 'hi' })
const live = makeAssistantTextItem({ id: 'live', threadId: 'thread', turnId: 'one', text: 'live', status: 'running' })
const other = makeUserItem({ id: 'other', threadId: 'thread', turnId: 'two', text: 'next' })

test('cache hits preserve the live boundary and exact byte count', () => {
  const c = new ItemsCache(4, 4096)
  c.set('thread', [user])
  c.applyLiveItem('thread', live)
  c.set('thread', c.get('thread')!)
  c.applyItem('thread', other)
  expect(c.get('thread')!.map((x) => x.id)).toEqual(['user', 'other', 'live'])
  expect(c.stats().bytes).toBe(Buffer.byteLength(JSON.stringify(c.get('thread'))))
  c.beforeDurableWrite('thread', live.id)
  expect(c.get('thread')).toBeUndefined()
})

test.each([false, true])('repeated reads and cleanup failure=%s cannot preserve stale live slots', async (failCleanup) => {
  const root = await mkdtemp(join(tmpdir(), 'kun-live-promotion-')); roots.push(root)
  const s = new FileSessionStore({ dataDir: root }); stores.push(s)
  await s.appendItem('thread', user)
  await s.loadItems('thread')
  await s.checkpointLiveItem('thread', live, 1)
  await s.loadItems('thread')
  await s.loadItemPage('thread', { maxItems: 10, maxBytes: 100000 })
  await s.appendItem('thread', other)
  await s.loadItems('thread')
  if (failCleanup) vi.spyOn(s.liveItems, 'remove').mockRejectedValueOnce(new Error('cleanup failed'))
  const promote = s.updateItem('thread', live.id, { status: 'aborted' })
  if (failCleanup) await expect(promote).rejects.toThrow('cleanup failed')
  else await promote
  const warm = await s.loadItems('thread')
  s.clearThreadMemory('thread')
  const cold = await s.loadItems('thread')
  expect(cold).toEqual(warm)
  expect(delegatedHistoryDigest(cold)).toBe(delegatedHistoryDigest(warm))
  expect(cold.map((x) => x.id)).toEqual(['user', 'other', 'live'])
})

test('compaction reloads durable deltas newer than the live checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-compact-deltas-')); roots.push(root)
  const s = new FileSessionStore({ dataDir: root }); stores.push(s)
  await s.appendItem('thread', user)
  await s.loadItems('thread')
  await s.checkpointLiveItem('thread', live, 1)
  const delta = makeAssistantTextItem({ ...live, text: ' updated', status: 'running' })
  await s.appendEvent('thread', { seq: 2, timestamp: new Date().toISOString(),
    kind: 'assistant_text_delta', threadId: 'thread', turnId: 'one', itemId: live.id,
    deltaOffset: 4, item: delta })
  await s.compactItems('thread', { force: true })
  const warm = await s.loadItems('thread')
  expect(warm.find((x) => x.id === live.id)).toMatchObject({ text: 'live updated' })
  s.clearThreadMemory('thread')
  expect(await s.loadItems('thread')).toEqual(warm)
})
