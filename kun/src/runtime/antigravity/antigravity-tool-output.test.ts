import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { readAntigravityToolOutput } from './antigravity-tool-output.js'

const sessionId = 'bf04eef3-dc05-42d4-813f-448c1a88c5f6'
const name = 'mcp_kun-tools_git_inspect'
let dir: string
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })
function varint(n: number) {
  const bytes = []
  while (n > 127) { bytes.push(n % 128 + 128); n = Math.floor(n / 128) }
  return Buffer.from([...bytes, n])
}
function field(n: number, bytes: Buffer | string) {
  const value = Buffer.from(bytes)
  return Buffer.concat([varint(n * 8 + 2), varint(value.length), value])
}
function fixture() {
  dir = mkdtempSync(join(tmpdir(), 'kun-native-output-'))
  const db = new DatabaseSync(join(dir, sessionId + '.db'))
  db.exec('CREATE TABLE trajectory_meta(cascade_id TEXT); CREATE TABLE steps(step_type, step_format, status, metadata, step_payload, error_details)')
  db.prepare('INSERT INTO trajectory_meta VALUES(?)').run(sessionId)
  const insert = (id: string, text: string, failed = false, format = 0) => {
    const identity = field(4, Buffer.concat([field(1, id), field(2, name), field(3, 'input, never a result')]))
    const payload = field(140, field(2, field(1, text)))
    db.prepare('INSERT INTO steps VALUES(132, ?, ?, ?, ?, ?)').run(format, failed ? 7 : 3, identity, payload,
      failed ? field(2, 'recorded Git error') : null)
  }
  const read = (callId: string, failed = false) => readAntigravityToolOutput({ sessionId, name, callId, failed }, dir)
  return { db, insert, read }
}

it('reads only the exact finished native tool, without confusing similar ids, failures or unknown formats', () => {
  const { db, insert, read } = fixture()
  insert('call_123', 'Created At: 2026-11-18T21:32:28+08:00\nCompleted At: 2026-11-18T21:32:32+08:00\nactual stdout')
  insert('call_1234', 'another command')
  insert('call_2', '', true)
  insert('call_3', 'format changed', false, 9)
  db.close()
  expect(read('call_123')).toEqual({ text: 'actual stdout', truncated: false })
  expect(read('call_12')).toBeNull()
  expect(read('call_2')).toBeNull()
  expect(read('call_2', true)?.text).toBe('recorded Git error')
  expect(read('call_3')).toBeNull()
  expect(readAntigravityToolOutput({ sessionId: '../other', callId: 'call_123', name, failed: false }, dir)).toBeNull()
  expect(readAntigravityToolOutput({ sessionId, callId: 'call_123', name: 'read_file', failed: false }, dir)).toBeNull()
})

it('bounds text without breaking UTF-8 and declines ambiguous calls or a mismatched conversation', () => {
  const { db, insert, read } = fixture()
  insert('long', '图'.repeat(30_000))
  const value = read('long')!
  expect(value.truncated).toBe(true)
  expect(value.text).toBe('图'.repeat(Math.floor(65536 / 3)))
  insert('long', 'duplicate identity')
  expect(read('long')).toBeNull()
  insert('unique', 'in a different conversation')
  db.exec("UPDATE trajectory_meta SET cascade_id = 'different'")
  db.close()
  expect(read('unique')).toBeNull()
})
