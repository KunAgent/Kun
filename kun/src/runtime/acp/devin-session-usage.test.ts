import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import type { OpenCodeCallUsage } from './opencode-session-usage.js'
import { devinCallUsage, devinSessionDatabasePath, startDevinSessionUsage } from './devin-session-usage.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'devin-usage-'))
  dirs.push(dir)
  return dir
}

function store() {
  const path = join(tempDir(), 'sessions.db')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE message_nodes (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, node_id INTEGER NOT NULL,
    parent_node_id INTEGER, chat_message TEXT NOT NULL, created_at INTEGER NOT NULL, metadata TEXT,
    UNIQUE(session_id, node_id))`)
  let node = 0
  const put = (message: Record<string, unknown>, session = 'giddy-acp') => db
    .prepare('INSERT INTO message_nodes (session_id, node_id, chat_message, created_at) VALUES (?, ?, ?, ?)')
    .run(session, node++, JSON.stringify(message), 1)
  return { path, put, close: () => db.close() }
}

/** An assistant node as Devin 3000.11 writes it. */
const assistant = (requestId: string, metrics: Record<string, unknown>, createdAt = '2026-10-17T04:44:08.934Z') => ({
  message_id: `msg_${requestId}`,
  role: 'assistant',
  content: '',
  metadata: { num_tokens: metrics.output_tokens, request_id: requestId, metrics, created_at: createdAt }
})

const NOW = Date.parse('2026-10-17T04:44:00.000Z')

describe('Devin per-call usage', () => {
  test('maps one call with cache reads on the prompt side and its own timing', () => {
    expect(devinCallUsage(JSON.stringify({
      ttft_ms: 2388, total_time_ms: 2993, input_tokens: 15_762, output_tokens: 169,
      cache_read_tokens: null, cache_creation_tokens: null
    }))).toEqual({
      promptTokens: 15_762,
      completionTokens: 169,
      totalTokens: 15_931,
      cachedTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 15_762,
      cacheHitRate: 0,
      turns: 1,
      requestTtftMs: 2388,
      requestGenerationMs: 605
    })
    // A tool-call-only reply lands in one burst: TTFT is kept, its rate is not.
    expect(devinCallUsage(JSON.stringify({
      ttft_ms: 2272, total_time_ms: 2282, input_tokens: 1_939, output_tokens: 112, cache_read_tokens: 15_872
    }))).toMatchObject({
      promptTokens: 17_811,
      totalTokens: 17_923,
      cacheHitTokens: 15_872,
      cacheMissTokens: 1_939,
      requestTtftMs: 2272
    })
    expect(devinCallUsage(JSON.stringify({ ttft_ms: 2272, total_time_ms: 2282, input_tokens: 1, output_tokens: 1 })))
      .not.toHaveProperty('requestGenerationMs')
    expect(devinCallUsage(null)).toBeUndefined()
    expect(devinCallUsage('{')).toBeUndefined()
    expect(devinCallUsage(JSON.stringify({ input_tokens: 0, output_tokens: 0 }))).toBeUndefined()
  })

  test('books each call of this turn once, live, skipping earlier turns and compaction copies', async () => {
    const db = store()
    db.put(assistant('old', { input_tokens: 900, output_tokens: 10 }, '2026-10-17T04:00:00.000Z'))
    const live: OpenCodeCallUsage[] = []
    const reader = startDevinSessionUsage({
      dbPath: db.path, acpSessionId: 'giddy-acp', intervalMs: 10, now: () => NOW,
      onCalls: (calls) => live.push(...calls)
    })!
    expect(reader).toBeDefined()

    db.put({ message_id: 'u1', role: 'user', content: 'go', metadata: { metrics: null } })
    db.put(assistant('r1', { input_tokens: 15_762, output_tokens: 169 }))
    // Devin rewrites a node after its tool call resolves: same request, booked once.
    db.put(assistant('r1', { input_tokens: 15_762, output_tokens: 169 }))
    db.put({ message_id: 't1', role: 'tool', content: 'ok', metadata: { metrics: null } })
    // A compaction copy of an earlier turn's call is not this turn's consumption.
    db.put(assistant('old', { input_tokens: 900, output_tokens: 10 }, '2026-10-17T04:00:00.000Z'))
    db.put(assistant('elsewhere', { input_tokens: 7, output_tokens: 7 }), 'other-session')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(live.map((call) => call.messageId)).toEqual(['r1'])
    expect(reader.calls).toBe(1)

    db.put(assistant('r2', { input_tokens: 1_939, output_tokens: 112, cache_read_tokens: 15_872 }))
    const rest = reader.finish()
    expect(rest.map((call) => call.messageId)).toEqual(['r2'])
    expect(rest[0]?.usage).toMatchObject({ promptTokens: 17_811, completionTokens: 112, cacheHitTokens: 15_872 })
    expect(reader.calls).toBe(2)
    expect(reader.finish()).toEqual([])
    db.close()
  })

  test('a store that cannot be read disables the reader', () => {
    expect(startDevinSessionUsage({
      dbPath: join(tmpdir(), 'missing-devin-usage', 'sessions.db'),
      acpSessionId: 'giddy-acp',
      onCalls: () => undefined
    })).toBeUndefined()
    const foreign = join(tempDir(), 'sessions.db')
    new DatabaseSync(foreign).exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
    expect(startDevinSessionUsage({ dbPath: foreign, acpSessionId: 'giddy-acp', onCalls: () => undefined }))
      .toBeUndefined()
  })

  test('locates the store only for Devin', () => {
    const home = tempDir()
    mkdirSync(join(home, 'devin', 'cli'), { recursive: true })
    writeFileSync(join(home, 'devin', 'cli', 'sessions.db'), '')
    const env = process.platform === 'win32' ? { APPDATA: home } : { XDG_DATA_HOME: home }
    expect(devinSessionDatabasePath('devin', env)).toBe(join(home, 'devin', 'cli', 'sessions.db'))
    expect(devinSessionDatabasePath('opencode', env)).toBeUndefined()
    expect(devinSessionDatabasePath('devin', process.platform === 'win32' ? { APPDATA: join(home, 'none') } : { XDG_DATA_HOME: join(home, 'none') }))
      .toBeUndefined()
  })
})
