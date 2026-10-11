import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { openCodeCallUsage, startOpenCodeSessionUsage, type OpenCodeCallUsage } from './opencode-session-usage.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-usage-'))
  dirs.push(dir)
  const path = join(dir, 'opencode.db')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE session (id text PRIMARY KEY, parent_id text, title text);
    CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text NOT NULL, time_updated integer, data text NOT NULL);`)
  const put = (id: string, data: Record<string, unknown>, session = 'ses_acp') => db
    .prepare('INSERT OR REPLACE INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
    .run(id, session, 1, 1, JSON.stringify(data))
  return { path, put, close: () => db.close() }
}

const assistant = (tokens: Record<string, unknown>, completed = true) => ({
  role: 'assistant',
  tokens,
  time: completed ? { created: 1, completed: 2 } : { created: 1 },
  ...(completed ? { finish: 'tool-calls' } : {})
})

describe('OpenCode per-call usage', () => {
  test('maps one assistant message to one request with cache reads on the prompt side', () => {
    const call = openCodeCallUsage({
      id: 'msg_2',
      data: JSON.stringify(assistant({ total: 59_693, input: 286, output: 105, reasoning: 102, cache: { read: 59_200, write: 0 } }))
    }, false)
    expect(call?.usage).toMatchObject({
      promptTokens: 59_486,
      completionTokens: 207,
      totalTokens: 59_693,
      reasoningTokens: 102,
      cachedTokens: 59_200,
      cacheHitTokens: 59_200,
      cacheMissTokens: 286,
      turns: 1
    })
    expect(openCodeCallUsage({ id: 'msg_u', data: JSON.stringify({ role: 'user' }) }, true)).toBeUndefined()
    expect(openCodeCallUsage({ id: 'msg_x', data: '{' }, true)).toBeUndefined()
  })

  test('books each finished call of this turn once, skipping earlier turns', async () => {
    const db = store()
    db.put('msg_001', assistant({ input: 900, output: 10, reasoning: 0, cache: { read: 0, write: 0 } }))
    const live: OpenCodeCallUsage[] = []
    const reader = startOpenCodeSessionUsage({
      dbPath: db.path, acpSessionId: 'ses_acp', intervalMs: 10, onCalls: (calls) => live.push(...calls)
    })!
    expect(reader).toBeDefined()

    db.put('msg_002', { role: 'user' })
    db.put('msg_003', assistant({ input: 100, output: 20, reasoning: 5, cache: { read: 1_000, write: 0 } }))
    db.put('msg_004', assistant({ input: 50, output: 3, reasoning: 0, cache: { read: 1_100, write: 0 } }, false))
    db.put('msg_other', assistant({ input: 7, output: 7, reasoning: 0, cache: { read: 0, write: 0 } }), 'ses_other')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(live.map((call) => call.messageId)).toEqual(['msg_003'])
    expect(reader.calls).toBe(1)

    // The call still streaming when the turn ends is booked with what it used.
    const rest = reader.finish()
    expect(rest.map((call) => call.messageId)).toEqual(['msg_004'])
    expect(rest[0]?.usage).toMatchObject({ promptTokens: 1_150, completionTokens: 3, cacheHitTokens: 1_100 })
    expect(reader.calls).toBe(2)
    expect(reader.finish()).toEqual([])
    db.close()
  })

  test('a store that cannot be read disables the reader', () => {
    expect(startOpenCodeSessionUsage({
      dbPath: join(tmpdir(), 'missing-opencode-usage', 'opencode.db'),
      acpSessionId: 'ses_acp',
      onCalls: () => undefined
    })).toBeUndefined()
  })
})
