import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HybridThreadStore } from './hybrid-thread-store.js'
import type { UsageEvent } from '../../contracts/events.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import { makeUserItem } from '../../domain/item.js'
import { createThreadRecord } from '../../domain/thread.js'
import { appendTurnItem, createTurnRecord } from '../../domain/turn.js'
import { stripThreadItemBodies } from './hybrid-thread-projection.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function createStore(): Promise<{ root: string; store: HybridThreadStore }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-hybrid-usage-'))
  roots.push(root)
  return { root, store: new HybridThreadStore({ dataDir: root }) }
}

function backfillInternals(store: HybridThreadStore): {
  db: { prepare(sql: string): { get(...args: unknown[]): unknown } } | null
  backfill: { wait(): Promise<void> } | null
} {
  return store as unknown as {
    db: { prepare(sql: string): { get(...args: unknown[]): unknown } } | null
    backfill: { wait(): Promise<void> } | null
  }
}

function usageEvent(seq: number, usage: UsageSnapshot): UsageEvent {
  return {
    kind: 'usage',
    threadId: 'thread-usage-1',
    seq,
    timestamp: `2026-08-08T00:00:${String(seq).padStart(2, '0')}.000Z`,
    turnId: `turn-${seq}`,
    model: 'gpt-5.6-sol',
    usage
  }
}

describe('HybridThreadStore usage timing persistence', () => {
  it('keeps cumulative TTFT/TPS averages after the differential fold', async () => {
    const { store } = await createStore()
    try {
      await store.noteEvent(usageEvent(1, {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        cacheHitRate: null,
        turns: 1,
        avgTtftMs: 800,
        avgTokensPerSecond: 30
      }))
      await store.noteEvent(usageEvent(2, {
        promptTokens: 300,
        completionTokens: 80,
        totalTokens: 380,
        cacheHitRate: null,
        turns: 2,
        avgTtftMs: 1_000,
        avgTokensPerSecond: 42.5
      }))

      const records = await store.loadUsageRecords({ threadId: 'thread-usage-1' })
      // Two differential records: token counters are deltas, timing aggregates
      // are the latest snapshot's cumulative values.
      expect(records).toHaveLength(2)
      expect(records[0].usage).toMatchObject({
        promptTokens: 100,
        completionTokens: 20,
        avgTtftMs: 800,
        avgTokensPerSecond: 30
      })
      expect(records[1].usage).toMatchObject({
        promptTokens: 200,
        completionTokens: 60,
        avgTtftMs: 1_000,
        avgTokensPerSecond: 42.5
      })
    } finally {
      store.close()
    }
  })

  it('keeps turn, cache-write, and current request attribution in differential records', async () => {
    const { store } = await createStore()
    try {
      await store.noteEvent(usageEvent(1, {
        promptTokens: 25_300,
        completionTokens: 700,
        totalTokens: 26_000,
        cacheHitRate: 0,
        cacheWriteTokens: 300,
        actualProviderId: 'codex-work',
        actualModelId: 'gpt-5.6-luna',
        billingKind: 'subscription',
        serviceTier: 'priority',
        turns: 1
      }))
      await store.noteEvent(usageEvent(2, {
        promptTokens: 30_000,
        completionTokens: 1_000,
        totalTokens: 31_000,
        cacheHitRate: 0,
        cacheWriteTokens: 500,
        actualProviderId: 'openai-api',
        actualModelId: 'gpt-5.4-mini',
        billingKind: 'api',
        turns: 2
      }))

      const records = await store.loadUsageRecords({ threadId: 'thread-usage-1' })
      expect(records[0]).toMatchObject({
        turnId: 'turn-1',
        usage: {
          cacheWriteTokens: 300,
          actualProviderId: 'codex-work',
          actualModelId: 'gpt-5.6-luna',
          billingKind: 'subscription',
          serviceTier: 'priority'
        }
      })
      expect(records[1]).toMatchObject({
        turnId: 'turn-2',
        usage: {
          promptTokens: 4_700,
          cacheWriteTokens: 200,
          actualProviderId: 'openai-api',
          actualModelId: 'gpt-5.4-mini',
          billingKind: 'api'
        }
      })
      expect(records[1]?.usage.serviceTier).toBeUndefined()
    } finally {
      store.close()
    }
  })

  it('keeps the pre-range cumulative snapshot as the differential baseline', async () => {
    const { store } = await createStore()
    try {
      await store.noteEvent(usageEvent(1, {
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
        cacheHitRate: null,
        turns: 1
      }))
      await store.noteEvent(usageEvent(2, {
        promptTokens: 140,
        completionTokens: 15,
        totalTokens: 155,
        cacheHitRate: null,
        turns: 2
      }))

      const records = await store.loadUsageRecords({
        fromInclusive: '2026-08-08T00:00:02.000Z',
        toExclusive: '2026-08-08T00:00:03.000Z'
      })

      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        turnId: 'turn-2',
        usage: { promptTokens: 40, completionTokens: 5, totalTokens: 45, turns: 1 }
      })
    } finally {
      store.close()
    }
  })

  it('defaults timing aggregates to null when snapshots omit them', async () => {
    const { store } = await createStore()
    try {
      await store.noteEvent(usageEvent(1, {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cacheHitRate: null,
        turns: 1
      }))

      const records = await store.loadUsageRecords({ threadId: 'thread-usage-1' })
      expect(records).toHaveLength(1)
      expect(records[0].usage.avgTtftMs).toBeUndefined()
      expect(records[0].usage.avgTokensPerSecond).toBeUndefined()
    } finally {
      store.close()
    }
  })
})

describe('HybridThreadStore filesystem surface fallback', () => {
  it('hydrates only legacy Work candidates before classifying summaries', async () => {
    const { root, store } = await createStore()
    const legacy = legacyWorkThread('thread_legacy_work', 'Write Assistant')
    const code = legacyWorkThread('thread_code', 'Repository notes')
    await Promise.all([writeThreadDocument(root, legacy), writeThreadDocument(root, code)])
    await store.ready()
    // Exercise the JSONL listing path regardless of whether this host has a
    // usable better-sqlite3 native module.
    store.close()
    const fallback = store as unknown as {
      readThreadFromDisk(threadId: string): Promise<ThreadRecord | null>
    }
    const fullRead = vi.spyOn(fallback, 'readThreadFromDisk')

    try {
      const summaries = await store.list({ includeArchived: true })
      expect(summaries).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: legacy.id, agentSurface: 'write' }),
        expect.objectContaining({ id: code.id, agentSurface: 'code' })
      ]))
      expect(fullRead).toHaveBeenCalledTimes(1)
      expect(fullRead).toHaveBeenCalledWith(legacy.id)
    } finally {
      fullRead.mockRestore()
      store.close()
    }
  })

  it('reuses one filesystem scan across cursor pages', async () => {
    const { root, store } = await createStore()
    const records = [
      legacyWorkThread('thread_cache_c', 'Cache C'),
      legacyWorkThread('thread_cache_b', 'Cache B')
    ]
    await Promise.all(records.map((record) => writeThreadDocument(root, record)))
    await store.ready()
    store.close()
    const source = store as unknown as { threadIdsFromFilesystem(): Promise<string[]> }
    const scan = vi.spyOn(source, 'threadIdsFromFilesystem')

    const first = await store.listPage({ includeArchived: true, limit: 1 })
    const second = await store.listPage({
      includeArchived: true,
      limit: 1,
      cursor: first.nextCursor
    })

    expect(first).toMatchObject({ hasMore: true, total: 2 })
    expect(second).toMatchObject({ hasMore: false })
    expect([...first.threads, ...second.threads]).toHaveLength(2)
    expect(scan).toHaveBeenCalledTimes(1)
  })
})

describe('HybridThreadStore SQLite pagination', () => {
  it('uses the index count for filtered pages without scanning JSONL', async () => {
    const { store } = await createStore()
    const records = [
      createThreadRecord({ id: 'thread_alpha', title: 'Alpha', workspace: '/tmp/a', model: 'test-model' }),
      createThreadRecord({ id: 'thread_beta', title: 'Beta', workspace: '/tmp/a', model: 'test-model' }),
      createThreadRecord({ id: 'thread_other', title: 'Alpha other', workspace: '/tmp/b', model: 'test-model' })
    ]
    await Promise.all(records.map((record) => store.upsert(record)))
    const source = store as unknown as { listFromFilesystem(): Promise<unknown[]> }
    const filesystemScan = vi.spyOn(source, 'listFromFilesystem')

    try {
      const first = await store.listPage({
        workspace: '/tmp/a', search: 'a', includeArchived: true, limit: 1
      })
      expect(first).toMatchObject({ total: 2, hasMore: true })
      expect(first.threads).toHaveLength(1)
      expect(first.nextCursor).toEqual(expect.any(String))

      const second = await store.listPage({
        workspace: '/tmp/a', search: 'a', includeArchived: true,
        limit: 1, cursor: first.nextCursor
      })
      expect(second).toMatchObject({ hasMore: false })
      expect(second.threads).toHaveLength(1)
      expect(second).not.toHaveProperty('total')
      expect(filesystemScan).not.toHaveBeenCalled()
    } finally {
      filesystemScan.mockRestore()
      store.close()
    }
  })
})

describe('HybridThreadStore usage backfill scan failures', () => {
  it('leaves the thread eligible for a later backfill when events.jsonl is unreadable', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const { root, store } = await createStore()
    const thread = createThreadRecord({
      id: 'thread_unreadable_events',
      title: 'Unreadable events',
      workspace: '/tmp/workspace',
      model: 'test-model'
    })
    await writeThreadDocument(root, thread)
    const eventsPath = join(root, 'threads', thread.id, 'events.jsonl')
    await writeFile(eventsPath, `${JSON.stringify(usageEvent(1, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheHitRate: null,
      turns: 1
    }))}\n`)
    await chmod(eventsPath, 0o000)

    try {
      await store.ready()
      const internals = backfillInternals(store)
      if (!internals.db || !internals.backfill) return
      await internals.backfill.wait()
      const row = internals.db.prepare(
        'SELECT usage_backfilled, event_seq_high_water FROM threads WHERE id = ?'
      ).get(thread.id) as { usage_backfilled: number; event_seq_high_water: number } | undefined
      expect(row?.usage_backfilled ?? 0).toBe(0)
      expect(row?.event_seq_high_water ?? 0).toBe(0)
      expect(await store.loadUsageRecords({ threadId: thread.id })).toHaveLength(0)
    } finally {
      await chmod(eventsPath, 0o600).catch(() => undefined)
      store.close()
    }
  })
})

function legacyWorkThread(id: string, title: string): ThreadRecord {
  const turnId = `${id}_turn`
  const prompt = '[写作上下文]\n交互约定: 需要更多信息时通常直接用普通文本向用户提问。仅当当前激活的专用工作流明确要求结构化确认（例如 PPT 视觉评审）时，调用该工作流提供的确认工具；其他写作任务不要滥用结构化交互。\n\n润色当前文件'
  const item = makeUserItem({
    id: `${id}_user`,
    threadId: id,
    turnId,
    text: prompt
  })
  return {
    ...createThreadRecord({ id, title, workspace: '/tmp/workspace', model: 'test-model' }),
    turns: [appendTurnItem(createTurnRecord({
      id: turnId, threadId: id, prompt, status: 'completed'
    }), item)]
  }
}

async function writeThreadDocument(root: string, thread: ThreadRecord): Promise<void> {
  const dir = join(root, 'threads', thread.id)
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(join(dir, 'metadata.jsonl'), `${JSON.stringify({
      kind: 'thread_metadata', version: 1, timestamp: thread.updatedAt,
      thread: stripThreadItemBodies(thread)
    })}\n`),
    writeFile(join(dir, 'messages.jsonl'), thread.turns.flatMap((turn) => turn.items)
      .map((item) => JSON.stringify(item)).join('\n').concat('\n'))
  ])
}
