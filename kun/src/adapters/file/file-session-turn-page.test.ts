import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionStore } from '../../ports/session-store.js'
import { makeAssistantTextItem, makeToolResultItem, makeUserItem } from '../../domain/item.js'
import { InMemorySessionStore } from '../in-memory-session-store.js'
import { FileSessionStore } from './file-session-store.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture(kind: string) {
  const root = await mkdtemp(join(tmpdir(), 'kun-turn-items-'))
  roots.push(root)
  const threadId = 'thread_turn_page'
  const store: SessionStore = kind === 'memory' ? new InMemorySessionStore() : new FileSessionStore({ dataDir: root })
  for (let i = 0; i < 20; i += 1) {
    await store.appendItem(threadId, makeUserItem({
      id: `a_${i}`, threadId, turnId: 'turn_a', text: `message ${i}`
    }))
    await store.appendItem(threadId, makeUserItem({
      id: `b_${i}`, threadId, turnId: 'turn_b', text: `other ${i}`
    }))
  }
  if (kind === 'scan') {
    const directory = join(root, 'threads', threadId)
    for (const file of await readdir(directory)) {
      if (file.includes('index')) await rm(join(directory, file))
    }
    ;(store as FileSessionStore).clearThreadMemory(threadId)
  }
  return { root, store, threadId }
}

describe.each(['memory', 'indexed', 'scan'])('exact-turn item pages (%s)', (kind) => {
  it('filters before paging and never admits an unrelated turn or anchor', async () => {
    const { store, threadId } = await fixture(kind)
    let before: string | undefined
    const ids: string[] = []
    do {
      const page = await store.loadItemPage!(threadId, {
        turnId: 'turn_a', anchorTurnId: 'turn_b', before, maxItems: 3, maxBytes: 2048
      })
      expect(page.items.length).toBeLessThanOrEqual(3)
      expect(page.itemBytes).toBeLessThanOrEqual(2048)
      expect(page.items.every((item) => item.turnId === 'turn_a')).toBe(true)
      ids.unshift(...page.items.map((item) => item.id))
      before = page.nextCursor
    } while (before)
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => `a_${i}`))
    expect(await store.loadItemPage!(threadId, { turnId: 'absent', maxItems: 5, maxBytes: 2048 }))
      .toMatchObject({ items: [], hasMore: false })
  })

  it('reads every byte-budgeted fragment from the latest exact item, including non-ASCII payloads', async () => {
    const { store, threadId } = await fixture(kind)
    const text = '完成😀'.repeat(5000)
    await store.appendItem(threadId, makeToolResultItem({
      id: 'large', threadId, turnId: 'turn_a', toolName: 'bash', callId: 'call',
      output: { text: 'obsolete' }, status: 'completed'
    }))
    await store.appendItem(threadId, makeToolResultItem({
      id: 'large', threadId, turnId: 'turn_a', toolName: 'bash', callId: 'call',
      output: { text }, status: 'completed'
    }))
    let offset: number | undefined = 0
    let restored = ''
    do {
      const page = await store.loadItemPage!(threadId, {
        turnId: 'turn_a', itemId: 'large', contentOffset: offset, maxItems: 1, maxBytes: 4096
      })
      expect(page).toMatchObject({ items: [], hasMore: false, itemBytes: 0 })
      expect(page.content!.field).toBe('output')
      expect(page.content!.offset).toBe(offset)
      expect(Buffer.byteLength(page.content!.text, 'utf8')).toBeLessThanOrEqual(4096)
      restored += page.content!.text
      offset = page.content!.nextOffset
    } while (offset !== undefined)
    expect(restored).toBe(JSON.stringify({ text }))
    expect((await store.loadItemPage!(threadId, {
      turnId: 'turn_b', itemId: 'large', maxItems: 1, maxBytes: 4096
    })).content).toBeUndefined()
  })
})

it('reads damaged/unindexed history without rebuilding, truncating or compacting files', async () => {
  const { root, threadId } = await fixture('scan')
  const path = join(root, 'threads', threadId, 'messages.jsonl')
  const original = await readFile(path, 'utf8') + '{"incomplete":'
  await writeFile(path, original)
  const before = await stat(path)
  const store = new FileSessionStore({ dataDir: root, itemHistoryCompactionMinBytes: 1 })
  const page = await store.loadItemPage(threadId, { turnId: 'turn_a', maxItems: 2, maxBytes: 4096 })
  expect(page.items.map((item) => item.id)).toEqual(['a_18', 'a_19'])
  await new Promise((resolve) => setTimeout(resolve, 25))
  expect(await readFile(path, 'utf8')).toBe(original)
  expect((await stat(path)).mtimeMs).toBe(before.mtimeMs)
  expect((await readdir(join(root, 'threads', threadId))).some((file) => file.includes('index'))).toBe(false)
})

it('includes live exact-turn content without leaking another live turn', async () => {
  const { root, threadId } = await fixture('indexed')
  const store = new FileSessionStore({ dataDir: root })
  await store.checkpointLiveItem(threadId, makeAssistantTextItem({
    id: 'live', turnId: 'turn_a', threadId, text: 'live response', status: 'running'
  }), 20)
  const page = await store.loadItemPage(threadId, { turnId: 'turn_a', itemId: 'live', maxItems: 1, maxBytes: 4096 })
  expect(page.content).toMatchObject({ text: 'live response', field: 'text' })
  expect((await store.loadItemPage(threadId, { turnId: 'turn_b', itemId: 'live', maxItems: 1, maxBytes: 4096 })).content).toBeUndefined()
})
