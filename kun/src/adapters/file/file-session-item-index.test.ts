import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeAssistantTextItem, makeToolResultItem, makeUserItem } from '../../domain/item.js'
import { FileSessionItemIndex } from './file-session-item-index.js'
import { ItemIndexView, ItemIndexViewCache } from './file-session-item-index-view.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function harness(threadId = 'thread_cache'): Promise<{
  index: FileSessionItemIndex
  sourcePath: string
  indexPath: string
  statePath: string
  threadId: string
  evidencePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'kun-item-index-'))
  roots.push(root)
  return {
    index: new FileSessionItemIndex(),
    sourcePath: join(root, 'messages.jsonl'),
    indexPath: join(root, 'messages-index.jsonl'),
    statePath: join(root, 'messages-index.state.json'),
    threadId,
    evidencePath: join(root, 'messages-tail.evidence.json')
  }
}

describe('FileSessionItemIndex rebuild', () => {
  it('holds the source read lease across scanning and source validation', async () => {
    const h = await harness('thread_1')
    const item = makeToolResultItem({
      id: 'result_1', threadId: h.threadId, turnId: 'turn_1', callId: 'call_1',
      toolName: 'bash', output: { text: 'done' }, status: 'completed'
    })
    await writeFile(h.sourcePath, `${JSON.stringify(item)}\n`)
    let active = false
    let calls = 0

    const result = await h.index.rebuild({
      ...h,
      withSourceRead: async (operation) => {
        calls += 1
        active = true
        try {
          return await operation()
        } finally {
          active = false
        }
      }
    })

    expect(calls).toBe(1)
    expect(active).toBe(false)
    expect(result).toMatchObject({ rawCount: 1, uniqueCount: 1 })
    expect(JSON.parse(await readFile(h.statePath, 'utf8'))).toMatchObject({
      version: 3, tailReady: true, sourceBytes: expect.any(Number)
    })
  })

  it('rebuilds without a source read hook for direct callers', async () => {
    const h = await harness('thread_direct')
    const item = makeToolResultItem({
      id: 'result_1', threadId: h.threadId, turnId: 'turn_1', callId: 'call_1',
      toolName: 'bash', output: { text: 'done' }, status: 'completed'
    })
    await writeFile(h.sourcePath, `${JSON.stringify(item)}\n`)
    await expect(h.index.rebuild(h)).resolves.toMatchObject({ rawCount: 1, uniqueCount: 1 })
  })
})

describe('FileSessionItemIndex pagination cache', () => {
  it('hydrates once across consecutive pages', async () => {
    const h = await harness()
    for (let value = 0; value < 12; value += 1) {
      const item = makeAssistantTextItem({
        id: `assistant_${value}`, threadId: h.threadId, turnId: `turn_${value}`,
        text: `answer ${value}`, status: 'completed'
      })
      await h.index.append({ ...h, item, record: JSON.stringify(item) })
    }
    h.index.clearSource(h.sourcePath)

    const latest = await h.index.loadPage({ ...h, options: { maxItems: 5, maxBytes: 64 * 1024 } })
    const older = await h.index.loadPage({
      ...h, options: { before: latest?.nextCursor, maxItems: 5, maxBytes: 64 * 1024 }
    })

    expect(latest?.items.map((item) => item.id)).toEqual([
      'assistant_7', 'assistant_8', 'assistant_9', 'assistant_10', 'assistant_11'
    ])
    expect(older?.items.map((item) => item.id)).toEqual([
      'assistant_2', 'assistant_3', 'assistant_4', 'assistant_5', 'assistant_6'
    ])
    expect(h.index.cacheStats()).toMatchObject({ hydrations: 1, hits: 1 })
  })

  it('updates a warm view incrementally without moving an existing item', async () => {
    const h = await harness('thread_append')
    for (let value = 0; value < 3; value += 1) {
      const item = makeAssistantTextItem({
        id: `assistant_${value}`, threadId: h.threadId, turnId: `turn_${value}`,
        text: `answer ${value}`, status: 'completed'
      })
      await h.index.append({ ...h, item, record: JSON.stringify(item) })
    }
    h.index.clearSource(h.sourcePath)
    await h.index.loadPage({ ...h, options: { maxItems: 10, maxBytes: 64 * 1024 } })

    const updated = makeAssistantTextItem({
      id: 'assistant_1', threadId: h.threadId, turnId: 'turn_1',
      text: 'updated answer', status: 'completed'
    })
    await h.index.append({ ...h, item: updated, record: JSON.stringify(updated) })
    const page = await h.index.loadPage({ ...h, options: { maxItems: 10, maxBytes: 64 * 1024 } })

    expect(page?.items.map((item) => item.id)).toEqual(['assistant_0', 'assistant_1', 'assistant_2'])
    expect(page?.items[1]).toMatchObject({ text: 'updated answer' })
    expect(h.index.cacheStats()).toMatchObject({ hydrations: 1, incrementalUpdates: 1 })
  })

  it('keeps anchor pagination semantics in the cached projection', async () => {
    const h = await harness('thread_anchor')
    const user = makeUserItem({
      id: 'user_active', threadId: h.threadId, turnId: 'turn_active', text: 'keep me'
    })
    await h.index.append({ ...h, item: user, record: JSON.stringify(user) })
    for (let value = 0; value < 8; value += 1) {
      const item = makeAssistantTextItem({
        id: `assistant_${value}`, threadId: h.threadId, turnId: 'turn_active',
        text: `answer ${value}`, status: 'completed'
      })
      await h.index.append({ ...h, item, record: JSON.stringify(item) })
    }
    h.index.clearSource(h.sourcePath)

    const page = await h.index.loadPage({
      ...h, options: { anchorTurnId: 'turn_active', maxItems: 5, maxBytes: 64 * 1024 }
    })
    expect(page?.items.map((item) => item.id)).toEqual([
      'user_active', 'assistant_4', 'assistant_5', 'assistant_6', 'assistant_7'
    ])
    expect(page).toMatchObject({ hasMore: true, nextCursor: 'assistant_4' })
  })

  it('pins an anchor that maxBytes trims out of the preliminary row window', async () => {
    const h = await harness('thread_anchor_bytes')
    for (let value = 0; value < 5; value += 1) {
      const item = makeAssistantTextItem({
        id: `older_${value}`, threadId: h.threadId, turnId: `turn_older_${value}`,
        text: `older ${value}`, status: 'completed'
      })
      await h.index.append({ ...h, item, record: JSON.stringify(item) })
    }
    const user = makeUserItem({
      id: 'user_bytes', threadId: h.threadId, turnId: 'turn_bytes', text: 'pin me'
    })
    await h.index.append({ ...h, item: user, record: JSON.stringify(user) })
    for (let value = 0; value < 3; value += 1) {
      const item = makeAssistantTextItem({
        id: `large_${value}`, threadId: h.threadId, turnId: 'turn_bytes',
        text: 'x'.repeat(1_000), status: 'completed'
      })
      await h.index.append({ ...h, item, record: JSON.stringify(item) })
    }
    h.index.clearSource(h.sourcePath)

    const page = await h.index.loadPage({
      ...h, options: { anchorTurnId: 'turn_bytes', maxItems: 5, maxBytes: 1_500 }
    })
    expect(page?.items.map((item) => item.id)).toEqual(['user_bytes', 'large_2'])
  })
})

describe('ItemIndexViewCache bounds', () => {
  const identity = { size: 1, mtimeMs: 1, dev: 1, ino: 1 }

  it('evicts the least recently used entry under the entry limit', () => {
    const cache = new ItemIndexViewCache(2, 1024 * 1024)
    for (const sourcePath of ['a', 'b', 'c']) {
      const view = rowView(sourcePath)
      cache.publish(sourcePath, identity, view)
    }
    expect(cache.stats()).toMatchObject({ entries: 2, evictions: 1 })
    expect(cache.get('a', identity, 1)).toBeUndefined()
    expect(cache.get('b', identity, 1)).toBeDefined()
  })

  it('does not let another source invalidation cancel an inflight hydration', async () => {
    const cache = new ItemIndexViewCache(2, 1024 * 1024)
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const hydrating = cache.hydrate('a', identity, 1, async () => {
      await blocked
      return rowView('a')
    })

    cache.clearSource('b')
    release()
    await hydrating
    expect(cache.get('a', identity, 1)).toBeDefined()
    expect(cache.stats()).toMatchObject({ hydrations: 1 })
  })

  it('does not retain a single entry above the byte budget', () => {
    const cache = new ItemIndexViewCache(2, 100)
    cache.publish('large', identity, rowView('large'))
    expect(cache.stats()).toMatchObject({ entries: 0, estimatedBytes: 0 })
  })
})

function rowView(id: string): ItemIndexView {
  const view = new ItemIndexView()
  view.applyRow({
    itemId: id, turnId: id, kind: 'assistant_text', isPublic: true,
    baseline: false, offset: 0, recordBytes: 1
  })
  return view
}
