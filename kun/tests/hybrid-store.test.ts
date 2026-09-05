import { appendFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { HybridSessionStore, HybridThreadStore, describeSqliteAbiMismatch } from '../src/adapters/hybrid/index.js'
import { makeUserItem } from '../src/domain/item.js'
import { appendTurnItem, createTurnRecord, startTurn } from '../src/domain/turn.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { TurnService } from '../src/services/turn-service.js'
import { InflightTracker } from '../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../src/loop/steering-queue.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import { SequentialIdGenerator } from '../src/ports/id-generator.js'
import type { UsageSnapshot } from '../src/contracts/usage.js'

describe('HybridThreadStore', () => {
  let dataDir = ''
  let openStores: HybridThreadStore[] = []
  let sqliteAvailable = false

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-hybrid-'))
    openStores = []
    sqliteAvailable = await canOpenBetterSqlite()
  })

  afterEach(async () => {
    for (const store of openStores) store.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('keeps item bodies in JSONL and uses SQLite metadata indexing when available', async () => {
    const { threadStore, sessionStore } = await createHybridStores()
    const record = await seedThreadWithMessage(threadStore, sessionStore, 'hello from jsonl')

    const summaries = await threadStore.list({ search: 'Hybrid demo' })
    expect(summaries.map((thread) => thread.id)).toEqual([record.id])
    if (sqliteAvailable) {
      await expect(stat(join(dataDir, 'index.sqlite3'))).resolves.toBeTruthy()
    } else {
      await expect(stat(join(dataDir, 'index.sqlite3'))).rejects.toMatchObject({ code: 'ENOENT' })
    }

    const metadata = await readFile(
      join(dataDir, 'threads', record.id, 'metadata.jsonl'),
      'utf-8'
    )
    const messages = await readFile(
      join(dataDir, 'threads', record.id, 'messages.jsonl'),
      'utf-8'
    )
    expect(metadata).not.toContain('hello from jsonl')
    expect(messages).toContain('hello from jsonl')

    const fetched = await threadStore.get(record.id)
    expect(fetched?.turns[0]?.prompt).toBe('hello from jsonl')
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      text: 'hello from jsonl'
    })
  })

  it('backfills legacy agent surfaces from metadata once, including the Code fallback', async () => {
    if (!sqliteAvailable) return
    const first = await createHybridStores()
    const legacyDesign = createThreadRecord({
      id: 'thr_legacy_design_surface',
      title: 'Legacy design',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-08-01T00:00:00.000Z'
    })
    await first.threadStore.upsert({
      ...legacyDesign,
      turns: [0, 1].map((index) => createTurnRecord({
        id: `turn_legacy_design_${index}`,
        threadId: legacyDesign.id,
        prompt: `design ${index}`,
        model: legacyDesign.model,
        agentSurface: 'design',
        createdAt: `2026-08-01T00:00:0${index + 1}.000Z`
      }))
    })
    const legacyCode = createThreadRecord({
      id: 'thr_legacy_code_surface',
      title: 'Legacy code',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-08-01T00:00:00.000Z'
    })
    await first.threadStore.upsert(legacyCode)
    first.threadStore.close()

    const sqlite = await import('better-sqlite3')
    const Database = sqlite.default
    const database = new Database(join(dataDir, 'index.sqlite3'))
    database.prepare('UPDATE threads SET agent_surface = NULL').run()
    database.close()

    const reopened = await createHybridStores()
    const summaries = await reopened.threadStore.list({ includeArchived: true })
    expect(summaries.find((thread) => thread.id === legacyDesign.id)?.agentSurface).toBe('design')
    expect(summaries.find((thread) => thread.id === legacyCode.id)?.agentSurface).toBe('code')
    await reopened.threadStore.waitForBackfill()
    await reopened.threadStore.list({ includeArchived: true })

    const indexed = new Database(join(dataDir, 'index.sqlite3'), { readonly: true })
    const rows = indexed.prepare(`
      SELECT id, agent_surface
      FROM threads
      WHERE id IN (?, ?)
      ORDER BY id
    `).all(legacyCode.id, legacyDesign.id) as Array<{ id: string; agent_surface: string | null }>
    indexed.close()
    expect(rows).toEqual([
      { id: legacyCode.id, agent_surface: 'code' },
      { id: legacyDesign.id, agent_surface: 'design' }
    ])
  })

  it('lists existing SQLite rows without replaying damaged message or event logs', async () => {
    const first = await createHybridStores()
    const record = await seedThreadWithMessage(first.threadStore, first.sessionStore, 'indexed already')
    first.threadStore.close()

    await writeFile(join(dataDir, 'threads', record.id, 'messages.jsonl'), '{not-json\n', 'utf8')
    await writeFile(join(dataDir, 'threads', record.id, 'events.jsonl'), '{not-json\n', 'utf8')

    const reopened = await createHybridStores()
    const summaries = await reopened.threadStore.list({ search: 'Hybrid demo' })

    expect(summaries.map((thread) => thread.id)).toEqual([record.id])
  })

  it('rebuilds the SQLite index from JSONL after the database is deleted', async () => {
    const first = await createHybridStores()
    const record = await seedThreadWithMessage(first.threadStore, first.sessionStore, 'recover me')
    first.threadStore.close()

    await rm(join(dataDir, 'index.sqlite3'), { force: true })
    await rm(join(dataDir, 'index.sqlite3-wal'), { force: true })
    await rm(join(dataDir, 'index.sqlite3-shm'), { force: true })

    const rebuilt = await createHybridStores()
    await rebuilt.threadStore.waitForBackfill()
    const summaries = await rebuilt.threadStore.list({ search: 'Hybrid demo' })
    expect(summaries.map((thread) => thread.id)).toEqual([record.id])

    const fetched = await rebuilt.threadStore.get(record.id)
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      text: 'recover me'
    })
  })

  it('keeps threads visible and repairs derived SQLite paths after the data directory moves', async () => {
    if (!sqliteAvailable) return
    const first = await createHybridStores()
    const record = await seedThreadWithMessage(
      first.threadStore,
      first.sessionStore,
      'survive data directory migration'
    )
    first.threadStore.close()

    const sqlite = await import('better-sqlite3')
    const Database = sqlite.default
    const database = new Database(join(dataDir, 'index.sqlite3'))
    database.prepare(`
      UPDATE threads
      SET metadata_path = @metadataPath,
          messages_path = @messagesPath,
          events_path = @eventsPath
      WHERE id = @id
    `).run({
      id: record.id,
      metadataPath: `/previous/runtime/root/threads/${record.id}/metadata.jsonl`,
      messagesPath: `/previous/runtime/root/threads/${record.id}/messages.jsonl`,
      eventsPath: `/previous/runtime/root/threads/${record.id}/events.jsonl`
    })
    database.close()

    const reopened = await createHybridStores()
    const summaries = await reopened.threadStore.list({ search: 'Hybrid demo' })
    expect(summaries.map((thread) => thread.id)).toEqual([record.id])
    await reopened.threadStore.waitForBackfill()
    await reopened.threadStore.list({ search: 'Hybrid demo' })
    reopened.threadStore.close()

    const repaired = new Database(join(dataDir, 'index.sqlite3'), { readonly: true })
    const row = repaired.prepare(`
      SELECT metadata_path, messages_path, events_path
      FROM threads
      WHERE id = ?
    `).get(record.id) as {
      metadata_path: string
      messages_path: string
      events_path: string
    }
    repaired.close()
    expect(row).toEqual({
      metadata_path: join(dataDir, 'threads', record.id, 'metadata.jsonl'),
      messages_path: join(dataDir, 'threads', record.id, 'messages.jsonl'),
      events_path: join(dataDir, 'threads', record.id, 'events.jsonl')
    })
  })

  it('opens legacy thread.json, preserves archive search, and accepts later JSONL writes', async () => {
    const legacy = createThreadRecord({
      id: 'thr_legacy_archived',
      title: 'Legacy archive fixture',
      workspace: '/tmp/legacy',
      model: 'deepseek-chat',
      createdAt: '2025-01-01T00:00:00.000Z'
    })
    const archived = { ...legacy, status: 'archived' as const, updatedAt: '2025-01-02T00:00:00.000Z' }
    const { approvalReviewer: _legacyReviewer, ...legacyWithoutReviewer } = archived
    const threadDir = join(dataDir, 'threads', legacy.id)
    await mkdir(threadDir, { recursive: true })
    await writeFile(join(threadDir, 'thread.json'), JSON.stringify(legacyWithoutReviewer), 'utf8')

    const { threadStore } = await createHybridStores()
    await threadStore.waitForBackfill()
    expect((await threadStore.list({ search: 'Legacy archive', includeArchived: true })).map((item) => item.id))
      .toEqual([legacy.id])
    expect((await threadStore.list({ archivedOnly: true })).map((item) => item.id)).toEqual([legacy.id])
    expect((await threadStore.get(legacy.id))?.approvalReviewer).toBe('user')
    expect((await threadStore.list({ archivedOnly: true }))[0]?.approvalReviewer).toBe('user')

    await threadStore.upsert({ ...archived, title: 'Legacy archive updated', updatedAt: '2025-01-03T00:00:00.000Z' })
    const metadata = await readFile(join(threadDir, 'metadata.jsonl'), 'utf8')
    expect(metadata).toContain('Legacy archive updated')
    expect((await threadStore.get(legacy.id))?.title).toBe('Legacy archive updated')
  })

  it('indexes event high water and usage events as they are appended', async () => {
    if (!sqliteAvailable) return
    const { threadStore, sessionStore } = await createHybridStores()
    const record = await seedThreadWithMessage(threadStore, sessionStore, 'track usage')
    await sessionStore.appendEvent(record.id, {
      kind: 'usage',
      seq: 2,
      timestamp: '2026-06-04T00:00:03.000Z',
      threadId: record.id,
      turnId: 'turn_hybrid',
      model: 'deepseek-chat',
      usage: usage({ promptTokens: 10, completionTokens: 5, totalTokens: 15, turns: 1 })
    })
    await sessionStore.appendEvent(record.id, {
      kind: 'usage',
      seq: 5,
      timestamp: '2026-06-04T00:00:05.000Z',
      threadId: record.id,
      turnId: 'turn_hybrid',
      model: 'deepseek-chat',
      usage: usage({ promptTokens: 30, completionTokens: 10, totalTokens: 40, turns: 2 })
    })

    await writeFile(join(dataDir, 'threads', record.id, 'events.jsonl'), '{not-json\n', 'utf8')

    await expect(sessionStore.highestSeq(record.id)).resolves.toBe(5)
    await expect(sessionStore.loadLatestUsageSnapshots()).resolves.toMatchObject([
      {
        threadId: record.id,
        seq: 5,
        usage: {
          promptTokens: 30,
          completionTokens: 10,
          totalTokens: 40,
          turns: 2
        }
      }
    ])
    await expect(sessionStore.loadUsageRecords({ threadId: record.id })).resolves.toMatchObject([
      {
        threadId: record.id,
        model: 'deepseek-chat',
        completedAt: '2026-06-04T00:00:03.000Z',
        usage: { totalTokens: 15, turns: 1 }
      },
      {
        threadId: record.id,
        model: 'deepseek-chat',
        completedAt: '2026-06-04T00:00:05.000Z',
        usage: { totalTokens: 25, turns: 1 }
      }
    ])
  })

  it('uses the durable JSONL high-water when SQLite lags after an append', async () => {
    const { threadStore, sessionStore } = await createHybridStores()
    const record = await seedThreadWithMessage(threadStore, sessionStore, 'high water recovery')
    await sessionStore.appendEvent(record.id, {
      kind: 'heartbeat', seq: 1, timestamp: '2026-06-04T00:00:01.000Z', threadId: record.id
    })
    // Simulate a process death after JSONL append but before the Hybrid index
    // hook. The file is canonical and must prevent seq=2 from being reused.
    await appendFile(
      join(dataDir, 'threads', record.id, 'events.jsonl'),
      `${JSON.stringify({ kind: 'heartbeat', seq: 2, timestamp: '2026-06-04T00:00:02.000Z', threadId: record.id })}\n`,
      'utf8'
    )

    await expect(sessionStore.highestSeq(record.id)).resolves.toBe(2)
  })

  it('recovers turn attachment ids from user messages when metadata is stripped', async () => {
    const { threadStore, sessionStore } = await createHybridStores()
    const thread = createThreadRecord({
      id: 'thr_attach',
      title: 'Attachment demo',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-06-04T00:00:00.000Z'
    })
    const turn = createTurnRecord({
      id: 'turn_attach',
      threadId: thread.id,
      prompt: 'describe',
      model: thread.model,
      createdAt: '2026-06-04T00:00:01.000Z'
    })
    const item = makeUserItem({
      id: 'item_turn_attach_user',
      turnId: turn.id,
      threadId: thread.id,
      text: 'describe',
      attachmentIds: ['att_image']
    })
    const record = {
      ...thread,
      updatedAt: '2026-06-04T00:00:02.000Z',
      turns: [startTurn(appendTurnItem(turn, item), '2026-06-04T00:00:01.000Z')]
    }
    await sessionStore.appendItem(record.id, item)
    await threadStore.upsert(record)

    const fetched = await threadStore.get(record.id)

    expect(fetched?.turns[0]?.attachmentIds).toEqual(['att_image'])
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      attachmentIds: ['att_image']
    })
  })

  it('does not synthesize duplicate turns when startTurn writes through the hybrid store', async () => {
    const { threadStore, sessionStore } = await createHybridStores()
    const thread = createThreadRecord({
      id: 'thr_start',
      title: 'Start demo',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-06-04T00:00:00.000Z'
    })
    await threadStore.upsert(thread)
    const turns = createTurnService(threadStore, sessionStore)

    const response = await turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: 'describe this data',
        model: 'deepseek-v4-pro',
        attachmentIds: ['att_image'],
        mode: 'agent'
      }
    })
    const fetched = await threadStore.get(thread.id)
    const items = await sessionStore.loadItems(thread.id)

    expect(fetched?.turns.map((turn) => turn.id)).toEqual([response.turnId])
    expect(fetched?.turns[0]).toMatchObject({
      id: response.turnId,
      attachmentIds: ['att_image'],
      model: 'deepseek-v4-pro'
    })
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      attachmentIds: ['att_image']
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'user_message',
      attachmentIds: ['att_image']
    })
  })

  it('deduplicates damaged turn metadata and recovers attachment ids from earlier metadata lines', async () => {
    const { threadStore, sessionStore } = await createHybridStores()
    const thread = createThreadRecord({
      id: 'thr_damaged',
      title: 'Damaged metadata',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-06-04T00:00:00.000Z'
    })
    const turn = startTurn(
      createTurnRecord({
        id: 'turn_damaged',
        threadId: thread.id,
        prompt: 'describe',
        model: 'deepseek-v4-pro',
        attachmentIds: ['att_from_history'],
        createdAt: '2026-06-04T00:00:01.000Z'
      }),
      '2026-06-04T00:00:01.500Z'
    )
    const damagedTurn = {
      ...turn,
      status: 'completed' as const,
      prompt: '',
      items: [],
      attachmentIds: [],
      finishedAt: '2026-06-04T00:00:03.000Z'
    }
    await mkdir(join(dataDir, 'threads', thread.id), { recursive: true })
    await writeFile(
      join(dataDir, 'threads', thread.id, 'metadata.jsonl'),
      [
        {
          kind: 'thread_metadata',
          version: 1,
          timestamp: '2026-06-04T00:00:02.000Z',
          thread: { ...thread, status: 'running', turns: [{ ...turn, prompt: '', items: [] }] }
        },
        {
          kind: 'thread_metadata',
          version: 1,
          timestamp: '2026-06-04T00:00:03.000Z',
          thread: {
            ...thread,
            status: 'idle',
            updatedAt: '2026-06-04T00:00:03.000Z',
            turns: [damagedTurn, damagedTurn]
          }
        }
      ].map((line) => JSON.stringify(line)).join('\n') + '\n',
      'utf8'
    )
    await sessionStore.appendItem(thread.id, makeUserItem({
      id: 'item_turn_damaged_user',
      turnId: turn.id,
      threadId: thread.id,
      text: 'describe'
    }))

    const fetched = await threadStore.get(thread.id)

    expect(fetched?.turns).toHaveLength(1)
    expect(fetched?.turns[0]).toMatchObject({
      id: turn.id,
      attachmentIds: ['att_from_history']
    })
    expect(fetched?.turns[0]?.items[0]).toMatchObject({
      kind: 'user_message',
      text: 'describe'
    })
  })

  async function createHybridStores(): Promise<{
    threadStore: HybridThreadStore
    sessionStore: HybridSessionStore
  }> {
    const threadStore = new HybridThreadStore({ dataDir })
    await threadStore.ready()
    openStores.push(threadStore)
    return {
      threadStore,
      sessionStore: new HybridSessionStore({ dataDir, index: threadStore })
    }
  }

  async function seedThreadWithMessage(
    threadStore: HybridThreadStore,
    sessionStore: HybridSessionStore,
    text: string
  ) {
    const thread = createThreadRecord({
      id: 'thr_hybrid',
      title: 'Hybrid demo',
      workspace: '/tmp/project',
      model: 'deepseek-chat',
      createdAt: '2026-06-04T00:00:00.000Z'
    })
    const turn = createTurnRecord({
      id: 'turn_hybrid',
      threadId: thread.id,
      prompt: text,
      model: thread.model,
      createdAt: '2026-06-04T00:00:01.000Z'
    })
    const item = makeUserItem({
      id: 'item_turn_hybrid_user',
      turnId: turn.id,
      threadId: thread.id,
      text
    })
    const record = {
      ...thread,
      updatedAt: '2026-06-04T00:00:02.000Z',
      turns: [startTurn(appendTurnItem(turn, item), '2026-06-04T00:00:01.000Z')]
    }
    await sessionStore.appendItem(record.id, item)
    await threadStore.upsert(record)
    return record
  }

  function createTurnService(
    threadStore: HybridThreadStore,
    sessionStore: HybridSessionStore
  ): TurnService {
    const bus = new InMemoryEventBus()
    const events = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso: () => '2026-06-04T00:00:02.000Z'
    })
    return new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      attachmentStore: () => ({
        bindScopes: async () => []
      } as unknown as import('../src/attachments/attachment-store.js').AttachmentStore),
      ids: new SequentialIdGenerator(),
      nowIso: () => '2026-06-04T00:00:02.000Z'
    })
  }

  async function canOpenBetterSqlite(): Promise<boolean> {
    try {
      const sqlite = await import('better-sqlite3')
      const Database = sqlite.default
      const db = new Database(':memory:')
      db.close()
      return true
    } catch {
      return false
    }
  }

  function usage(overrides: Partial<UsageSnapshot>): UsageSnapshot {
    const promptTokens = overrides.promptTokens ?? 10
    const completionTokens = overrides.completionTokens ?? 5
    const cacheHitTokens = overrides.cacheHitTokens ?? 0
    const cacheMissTokens = overrides.cacheMissTokens ?? Math.max(promptTokens - cacheHitTokens, 0)
    const cacheTotal = cacheHitTokens + cacheMissTokens
    return {
      promptTokens,
      completionTokens,
      totalTokens: overrides.totalTokens ?? promptTokens + completionTokens,
      cachedTokens: overrides.cachedTokens ?? cacheHitTokens,
      cacheHitTokens,
      cacheMissTokens,
      cacheHitRate: cacheTotal === 0 ? null : cacheHitTokens / cacheTotal,
      turns: overrides.turns ?? 1
    }
  }
})

describe('describeSqliteAbiMismatch', () => {
  it('classifies a NODE_MODULE_VERSION mismatch with compiled/current ABI', () => {
    const message = "The module 'better_sqlite3.node' was compiled against a different Node.js version " +
      'using NODE_MODULE_VERSION 148. This version of Node.js requires NODE_MODULE_VERSION 141.'
    const classified = describeSqliteAbiMismatch(message)
    expect(classified).toContain('compiled=148')
    expect(classified).toContain(`current=${process.versions.modules ?? 'unknown'}`)
    expect(classified).toContain(process.version)
  })

  it('returns null for unrelated load errors', () => {
    expect(describeSqliteAbiMismatch('Could not locate the bindings file.')).toBeNull()
    expect(describeSqliteAbiMismatch('')).toBeNull()
  })
})
