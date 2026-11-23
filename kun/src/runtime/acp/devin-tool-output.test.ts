import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { readDevinToolOutput } from './devin-tool-output.js'

const at = '2026-10-27T10:00:00.000Z'
const time = Date.parse(at) / 1_000
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function database() {
  const dir = mkdtempSync(join(tmpdir(), 'kun-devin-output-')); dirs.push(dir)
  const path = join(dir, 'sessions.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE message_nodes(session_id TEXT, created_at INTEGER, chat_message TEXT); CREATE INDEX idx_message_nodes_session ON message_nodes(session_id)')
  const put = (session: string, role: string, id: string, content: unknown, when = time) =>
    db.prepare('INSERT INTO message_nodes VALUES(?, ?, ?)').run(session, when, JSON.stringify({ role, tool_call_id: id, content,
      metadata: { internal: 'not tool output' } }))
  const read = (id: string) => readDevinToolOutput({ sessionId: 'right-session', callId: id, finishedAt: at }, path)
  return { db, put, read }
}
it('returns only the unique matching tool message in the negotiated session and ignores other roles and sessions', () => {
  const { db, put, read } = database()
  try {
    put('foreign-session', 'tool', 'grep:0#abc', 'foreign')
    put('right-session', 'assistant', 'grep:0#abc', 'private')
    put('right-session', 'tool', 'grep:0#abcd', 'different call')
    put('right-session', 'tool', 'grep:0#abc', 'Found 2 lines')
    expect(read('grep:0#abc')).toEqual({ text: 'Found 2 lines', truncated: false })
    expect(read('missing')).toBeNull()
    put('right-session', 'tool', 'grep:0#abc', 'ambiguous duplicate')
    expect(read('grep:0#abc')).toBeNull()
    put('right-session', 'tool', 'far', 'unrelated time', time - 86_400)
    expect(read('far')).toBeNull()
    put('right-session', 'tool', 'empty', '')
    put('right-session', 'tool', 'unrecognized', { private: 'not known to be a public tool response' })
    expect(read('empty')).toBeNull()
    expect(read('unrecognized')).toBeNull()
  } finally { db.close() }
})
it('bounds UTF-8 output without a split character and declines unsupported or oversized journals', () => {
  const { db, put, read } = database()
  try {
    put('right-session', 'tool', 'long', 'ab' + '界'.repeat(25_000))
    const result = read('long')
    expect(result?.truncated).toBe(true)
    expect(result?.text).toMatch(/^ab界+$/u)
    expect(Buffer.byteLength(result!.text)).toBeLessThanOrEqual(64 * 1024)
    db.prepare('INSERT INTO message_nodes VALUES(?, ?, zeroblob(16777217))').run('right-session', time)
    expect(read('long')).toBeNull()
    db.exec('DROP INDEX idx_message_nodes_session')
    expect(read('long')).toBeNull()
  } finally { db.close() }
})
