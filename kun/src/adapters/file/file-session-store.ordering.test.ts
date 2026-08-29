import { appendFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '../../domain/item.js'
import { FileSessionStore, readLatestItemsFromJsonl } from './file-session-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 5 : 0,
    retryDelay: 50
  })))
})

describe('FileSessionStore item ordering', () => {
  it('checkpoints a long assistant stream without cumulative canonical appends', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-live-item-'))
    roots.push(root)
    const store = new FileSessionStore({ dataDir: root })
    const threadId = 'thread_live_item'
    let text = ''
    for (let index = 0; index < 256; index += 1) {
      text += 'r'.repeat(2_048)
      await store.checkpointLiveItem(threadId, makeAssistantReasoningItem({
        id: 'reasoning_live',
        threadId,
        turnId: 'turn_live',
        text,
        status: 'running'
      }), index)
    }
    const messagesPath = join(root, 'threads', threadId, 'messages.jsonl')
    await expect(stat(messagesPath)).rejects.toThrow()
    const checkpointPath = join(root, 'threads', threadId, 'live-items.json')
    expect((await stat(checkpointPath)).size).toBeLessThan(text.length * 2)

    store.clearThreadMemory(threadId)
    const snapshot = await store.loadItemSnapshot(threadId)
    expect(snapshot.items).toMatchObject([
      { id: 'reasoning_live', kind: 'assistant_reasoning', status: 'running' }
    ])
    expect(snapshot.replayAfterSeq).toBeTypeOf('number')

    await store.finalizeLiveItem(threadId, makeAssistantReasoningItem({
      id: 'reasoning_live',
      threadId,
      turnId: 'turn_live',
      text,
      status: 'completed'
    }))
    expect((await readFile(messagesPath, 'utf8')).trim().split('\n')).toHaveLength(1)
    await expect(stat(checkpointPath)).rejects.toThrow()
  })

  it('replays durable deltas after the last checkpoint during cold recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-live-recovery-'))
    roots.push(root)
    const threadId = 'thread_live_recovery'
    const store = new FileSessionStore({ dataDir: root })
    const item = (text: string) => makeAssistantTextItem({
      id: 'assistant_live', threadId, turnId: 'turn_live', text, status: 'running'
    })
    await store.checkpointLiveItem(threadId, item('hello'), 0)
    await store.appendEvent(threadId, {
      seq: 1,
      timestamp: '2026-08-29T00:00:00.000Z',
      kind: 'assistant_text_delta',
      threadId,
      turnId: 'turn_live',
      itemId: 'assistant_live',
      deltaOffset: 0,
      item: item('hello')
    })
    // This in-memory checkpoint refresh is below 64 KiB, so only the event
    // carries the second fragment durably.
    await store.checkpointLiveItem(threadId, item('hello world'), 1)
    await store.appendEvent(threadId, {
      seq: 2,
      timestamp: '2026-08-29T00:00:01.000Z',
      kind: 'assistant_text_delta',
      threadId,
      turnId: 'turn_live',
      itemId: 'assistant_live',
      deltaOffset: 5,
      item: item(' world')
    })

    const recovered = new FileSessionStore({ dataDir: root })
    await expect(recovered.loadItems(threadId)).resolves.toMatchObject([
      { id: 'assistant_live', text: 'hello world', status: 'running' }
    ])
  })

  it('rejects an oversized item before creating a partial history record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-record-limit-'))
    roots.push(root)
    const store = new FileSessionStore({ dataDir: root })
    const threadId = 'thread_record_limit'
    await expect(store.appendItem(threadId, makeAssistantTextItem({
      id: 'assistant_too_large',
      threadId,
      turnId: 'turn_1',
      text: 'x'.repeat(16 * 1024 * 1024),
      status: 'completed'
    }))).rejects.toThrow('item history record exceeds')
    await expect(stat(join(root, 'threads', threadId, 'messages.jsonl'))).rejects.toThrow()
  })

  it('keeps an updated item in its original timeline slot after a cold reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-order-'))
    roots.push(root)
    const store = new FileSessionStore({ dataDir: root })
    const threadId = 'thread_order'
    const assistant = makeAssistantTextItem({
      id: 'assistant_1',
      turnId: 'turn_1',
      threadId,
      text: 'before',
      status: 'running',
      createdAt: '2026-07-28T00:00:00.000Z'
    })
    const tool = makeToolCallItem({
      id: 'tool_1',
      turnId: 'turn_1',
      threadId,
      callId: 'call_1',
      toolName: 'read',
      arguments: {}
    })

    await store.appendItem(threadId, assistant)
    await store.appendItem(threadId, tool)
    await store.appendItem(threadId, makeAssistantTextItem({
      id: assistant.id,
      turnId: assistant.turnId,
      threadId: assistant.threadId,
      text: 'before tool',
      status: 'completed',
      createdAt: assistant.createdAt
    }))
    store.clearThreadMemory(threadId)

    const reloaded = await store.loadItems(threadId)
    expect(reloaded.map((item) => item.id)).toEqual(['assistant_1', 'tool_1'])
    expect(reloaded[0]).toMatchObject({
      text: 'before tool',
      status: 'completed'
    })
  })

  it('atomically compacts repeated updates to the latest item state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-compact-'))
    roots.push(root)
    const store = new FileSessionStore({
      dataDir: root,
      itemHistoryCompactionMinBytes: 1
    })
    const threadId = 'thread_compact'
    for (let index = 0; index < 40; index += 1) {
      await store.appendItem(threadId, makeToolResultItem({
        id: 'result_1',
        threadId,
        turnId: 'turn_1',
        callId: 'call_1',
        toolName: 'bash',
        output: { text: `snapshot-${index}-${'x'.repeat(4_096)}` },
        status: index === 39 ? 'completed' : 'running'
      }))
    }
    const path = join(root, 'threads', threadId, 'messages.jsonl')
    const before = (await stat(path)).size

    const result = await store.compactItems(threadId, { force: true })
    const after = (await stat(path)).size
    store.clearThreadMemory(threadId)

    expect(result).toMatchObject({ compacted: true, itemCount: 1 })
    expect(after).toBeLessThan(before / 10)
    expect(await store.loadItems(threadId)).toMatchObject([
      { id: 'result_1', status: 'completed', output: { text: expect.stringContaining('snapshot-39') } }
    ])
    expect((await readFile(path, 'utf-8')).trim().split('\n')).toHaveLength(1)
  })

  it('serializes compaction with a queued append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-compact-race-'))
    roots.push(root)
    const store = new FileSessionStore({
      dataDir: root,
      itemHistoryCompactionMinBytes: 1
    })
    const threadId = 'thread_compact_race'
    const first = makeAssistantTextItem({
      id: 'assistant_1',
      threadId,
      turnId: 'turn_1',
      text: 'first'
    })
    const second = makeAssistantTextItem({
      id: 'assistant_2',
      threadId,
      turnId: 'turn_1',
      text: 'second'
    })
    await store.appendItem(threadId, first)

    await Promise.all([
      store.compactItems(threadId, { force: true }),
      store.appendItem(threadId, second)
    ])
    store.clearThreadMemory(threadId)

    expect((await store.loadItems(threadId)).map((item) => item.id))
      .toEqual(['assistant_1', 'assistant_2'])
  })

  it('preserves a malformed source file when compaction fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-compact-invalid-'))
    roots.push(root)
    const store = new FileSessionStore({
      dataDir: root,
      itemHistoryCompactionMinBytes: 1
    })
    const threadId = 'thread_compact_invalid'
    await store.appendItem(threadId, makeAssistantTextItem({
      id: 'assistant_1',
      threadId,
      turnId: 'turn_1',
      text: 'valid'
    }))
    const path = join(root, 'threads', threadId, 'messages.jsonl')
    await appendFile(path, '{broken-json\n')
    const before = await readFile(path, 'utf-8')

    await expect(store.compactItems(threadId, { force: true }))
      .rejects.toThrow('malformed record')
    expect(await readFile(path, 'utf-8')).toBe(before)
  })

  it('distinguishes an unterminated trailing write from a malformed completed row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-incomplete-tail-'))
    roots.push(root)
    const path = join(root, 'messages.jsonl')
    const item = makeUserItem({
      id: 'user_1',
      threadId: 'thread_incomplete_tail',
      turnId: 'turn_1',
      text: 'valid'
    })
    await appendFile(path, `${JSON.stringify(item)}\n{"id":`)

    await expect(readLatestItemsFromJsonl(path)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'user_1' })],
      rawCount: 1,
      malformedCount: 0,
      incompleteTrailingRecord: true
    })

    await appendFile(path, '}\n{broken-json\n')
    await expect(readLatestItemsFromJsonl(path)).resolves.toMatchObject({
      malformedCount: 2,
      incompleteTrailingRecord: false
    })
  })

  it('does not retain a Session item array that exceeds its byte admission limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-cache-budget-'))
    roots.push(root)
    const store = new FileSessionStore({
      dataDir: root,
      itemsCacheMaxBytes: 1_024
    })
    const threadId = 'thread_cache_budget'
    await store.appendItem(threadId, makeAssistantTextItem({
      id: 'assistant_large',
      threadId,
      turnId: 'turn_1',
      text: 'x'.repeat(4_096),
      status: 'completed'
    }))

    expect(await store.loadItems(threadId)).toHaveLength(1)
    expect(store.itemCacheStats()).toMatchObject({
      entries: 0,
      bytes: 0,
      maxBytes: 1_024
    })
  })

  it('returns a bounded chronological item page from durable history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-page-'))
    roots.push(root)
    const store = new FileSessionStore({ dataDir: root })
    const threadId = 'thread_page'
    for (let index = 0; index < 12; index += 1) {
      await store.appendItem(threadId, makeAssistantTextItem({
        id: `assistant_${index}`,
        threadId,
        turnId: `turn_${index}`,
        text: `answer ${index}`,
        status: 'completed'
      }))
    }
    await store.appendItem(threadId, makeAssistantTextItem({
      id: 'assistant_4',
      threadId,
      turnId: 'turn_4',
      text: 'answer 4 updated',
      status: 'completed'
    }))
    store.clearThreadMemory(threadId)

    const latest = await store.loadItemPage(threadId, { maxItems: 5, maxBytes: 64 * 1024 })
    expect(latest.items.map((item) => item.id)).toEqual([
      'assistant_7', 'assistant_8', 'assistant_9', 'assistant_10', 'assistant_11'
    ])
    expect(latest).toMatchObject({ hasMore: true, nextCursor: 'assistant_7' })

    const older = await store.loadItemPage(threadId, {
      before: latest.nextCursor,
      maxItems: 5,
      maxBytes: 64 * 1024
    })
    expect(older.items.map((item) => item.id)).toEqual([
      'assistant_2', 'assistant_3', 'assistant_4', 'assistant_5', 'assistant_6'
    ])
    expect(older.items[2]).toMatchObject({ text: 'answer 4 updated' })
    expect(store.itemCacheStats()).toMatchObject({ entries: 0, bytes: 0 })
  })

  it('compacts an oversized history after serving its cold item page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-page-compact-'))
    roots.push(root)
    const store = new FileSessionStore({
      dataDir: root,
      itemHistoryCompactionMinBytes: 1,
      compactionDelayMs: 60_000
    })
    const threadId = 'thread_page_compact'
    for (let index = 0; index < 20; index += 1) {
      await store.appendItem(threadId, makeToolResultItem({
        id: 'result_1',
        threadId,
        turnId: 'turn_1',
        callId: 'call_1',
        toolName: 'bash',
        output: { text: `snapshot-${index}-${'x'.repeat(4_096)}` },
        status: index === 19 ? 'completed' : 'running'
      }))
    }
    const path = join(root, 'threads', threadId, 'messages.jsonl')
    const before = (await stat(path)).size
    store.clearThreadMemory(threadId)

    const page = await store.loadItemPage(threadId, { maxItems: 5, maxBytes: 64 * 1024 })
    expect(page.items).toMatchObject([
      { id: 'result_1', status: 'completed', output: { text: expect.stringContaining('snapshot-19') } }
    ])

    await store.flushScheduledCompaction(threadId)
    expect((await stat(path)).size).toBeLessThan(before / 10)
    expect((await readFile(path, 'utf-8')).trim().split('\n')).toHaveLength(1)
    const indexPath = join(root, 'threads', threadId, 'messages-index.jsonl')
    const statePath = join(root, 'threads', threadId, 'messages-index.state.json')
    expect((await readFile(indexPath, 'utf-8')).trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toMatchObject({ rowCount: 1 })
    await expect(store.loadItemPage(threadId, { maxItems: 5, maxBytes: 64 * 1024 }))
      .resolves.toMatchObject({ items: [{ id: 'result_1', status: 'completed' }] })
  })

  it('pins the running turn user message on the newest JSONL page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-anchor-'))
    roots.push(root)
    const store = new FileSessionStore({ dataDir: root })
    const threadId = 'thread_anchor'
    const turnId = 'turn_running'
    await store.appendItem(threadId, makeUserItem({
      id: 'user_active', threadId, turnId, text: 'fix the pipeline'
    }))
    for (let index = 0; index < 349; index += 1) {
      await store.appendItem(threadId, makeAssistantTextItem({
        id: `process_${String(index).padStart(3, '0')}`,
        threadId,
        turnId,
        text: `process ${index}`,
        status: 'completed'
      }))
    }
    store.clearThreadMemory(threadId)

    const latest = await store.loadItemPage(threadId, {
      anchorTurnId: turnId,
      maxItems: 300,
      maxBytes: 4 * 1024 * 1024
    })
    expect(latest.items).toHaveLength(300)
    expect(latest.items[0]).toMatchObject({ id: 'user_active', kind: 'user_message' })
    expect(latest.items.at(-1)?.id).toBe('process_348')
    // The cursor stays at the retained continuous window so the next older
    // page covers the anchor and the 50 trimmed process items.
    expect(latest).toMatchObject({ hasMore: true, nextCursor: 'process_050' })

    const older = await store.loadItemPage(threadId, {
      before: latest.nextCursor,
      maxItems: 300,
      maxBytes: 4 * 1024 * 1024
    })
    expect(older.items.map((item) => item.id)).toEqual([
      'user_active',
      ...Array.from({ length: 50 }, (_, index) => `process_${String(index).padStart(3, '0')}`)
    ])
    expect(older).toMatchObject({ hasMore: false })
    expect(store.itemCacheStats()).toMatchObject({ entries: 0, bytes: 0 })
  })

  it('writes an atomic recoverable archive bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-archive-'))
    roots.push(root)
    const store = new FileSessionStore({ dataDir: root })
    const threadId = 'thread_archive'
    const item = makeUserItem({
      id: 'user_archive',
      threadId,
      turnId: 'turn_archive',
      text: 'archive me'
    })
    const archive = await store.archiveItems({
      threadId,
      cutoffTurnId: item.turnId,
      createdAt: '2026-08-18T12:00:00.000Z',
      items: [item],
      retainedItems: 2,
      replacedTokens: 12
    })
    expect(JSON.parse(await readFile(join(archive.path, 'manifest.json'), 'utf8'))).toMatchObject({
      version: 1,
      archivedItems: 1,
      retainedItems: 2,
      cutoffTurnId: 'turn_archive'
    })
    expect(await readFile(join(archive.path, 'messages.jsonl'), 'utf8')).toContain('user_archive')
    expect(await readFile(join(archive.path, 'conversation.md'), 'utf8')).toContain('archive me')
    await archive.cleanup()
    await expect(stat(archive.path)).rejects.toThrow()
  })

  it('streams a cold event high-water scan without loading an event array', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-highest-seq-'))
    roots.push(root)
    const store = new FileSessionStore({ dataDir: root })
    const threadId = 'thread_highest_seq'
    await store.appendItem(threadId, makeAssistantTextItem({
      id: 'assistant_seed',
      threadId,
      turnId: 'turn_seed',
      text: 'seed'
    }))
    const events = Array.from({ length: 2_000 }, (_, seq) => JSON.stringify({
      seq,
      timestamp: '2026-08-09T00:00:00.000Z',
      threadId,
      kind: 'heartbeat'
    })).join('\n')
    await appendFile(join(root, 'threads', threadId, 'events.jsonl'), `${events}\n`)

    expect(await store.highestSeq(threadId)).toBe(1_999)
  })
})
