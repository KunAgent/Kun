import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { createHistoryReference, createHistorySubreference, discoverCodexSessions, inspectCodexSession, readHistoryPage,
  readHistorySourceRecord, readSourceHistory, relinkHistoryReference } from './codex-history.js'

let root: string
let path: string
const timestamp = '2026-09-01T00:00:00.000Z'
const record = (type: string, payload: unknown) => ({ timestamp, type, payload })
const meta = (id = 'session-a', extra = {}) => record('session_meta', { id, cwd: '/project', ...extra })
const message = (role: string, text: string, channel?: string) => record('response_item', {
  type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }], ...(channel ? { channel } : {})
})
const turn = (id: string, prompt = `Question ${id}`, answer = `Answer ${id}`) => [
  record('turn_context', { turn_id: id }), message('user', prompt), message('assistant', answer, 'final'),
  record('event_msg', { type: 'task_complete', turn_id: id })
]
const encode = (records: unknown[]) => records.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
const save = (records: unknown[]) => writeFile(path, encode(records))
const text = (value: unknown) => JSON.stringify(value)
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'kun-codex-history-')); path = join(root, 'rollout-session-a.jsonl') })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('Codex fixed history references', () => {
  it('stores boundaries without copying bodies and ignores source appends', async () => {
    await save([meta(), ...turn('a', 'Request', 'Original answer')])
    const before = await readFile(path)
    const reference = await createHistoryReference(path)
    expect(reference.files[0].byteLength).toBe(before.length)
    expect(text(reference)).not.toContain('Original answer')
    expect((await createHistoryReference(path)).id).toBe(reference.id)
    await appendFile(path, encode(turn('b')))
    const page = await readHistoryPage(reference, { threadId: 'branch' })
    expect(page.status).toBe('available')
    expect(page.turns.map((entry) => entry.id)).toEqual(['codex:session-a:a'])
    expect(page.turns[0].items.every((item) => item.threadId === 'branch' && item.id.startsWith('codex:'))).toBe(true)
    expect(text(page)).toContain('Original answer')
    expect(text(page)).not.toContain('Answer b')
    expect(await readdir(root)).toEqual(['rollout-session-a.jsonl'])
    expect((await readFile(path)).subarray(0, before.length)).toEqual(before)
  })
  it('paginates without duplicates and enforces an explicit cutoff for UI and model reads', async () => {
    await save([meta(), ...turn('a'), ...turn('b'), ...turn('c')])
    const reference = await createHistoryReference(path, 'codex:session-a:b')
    const first = await readHistoryPage(reference, { threadId: 'branch', limit: 3 })
    const second = await readHistoryPage(reference, { threadId: 'branch', limit: 3, cursor: first.nextCursor })
    const ids = [...second.turns, ...first.turns].flatMap((entry) => entry.items.map((item) => item.id))
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    expect(first.hasMore).toBe(true)
    expect(second.hasMore).toBe(false)
    expect(text([first, second])).not.toContain('Answer c')
    expect((await readSourceHistory(reference, { operation: 'search', query: 'Answer c' })).text).toContain('No matching')
  })
  it('creates older subbranches from the frozen snapshot after Codex rolls those turns back', async () => {
    await save([meta(), ...turn('a'), ...turn('b')])
    const reference = await createHistoryReference(path)
    await appendFile(path, encode([record('event_msg', { type: 'thread_rolled_back', num_turns: 2 }), ...turn('c')]))
    const subreference = await createHistorySubreference(reference, 'codex:session-a:a')
    expect((await readHistoryPage(subreference, { threadId: 'child' })).turns.map((entry) => entry.id)).toEqual(['codex:session-a:a'])
    await expect(createHistorySubreference(reference, 'codex:session-a:c')).rejects.toThrow('outside')
  })
  it('filters instructions, displays readable reasoning and inert tools, and skips compaction duplicates', async () => {
    await save([meta(), message('system', 'SYSTEM SECRET'), message('developer', 'DEVELOPER SECRET'),
      record('turn_context', { turn_id: 'a' }), message('user', 'Request'),
      record('response_item', { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Readable thought' }], encrypted_content: 'DO NOT EXPOSE' }),
      record('response_item', { type: 'function_call', name: 'exec_command', call_id: 'one', arguments: '{"cmd":"pwd"}' }),
      record('response_item', { type: 'function_call_output', call_id: 'one', output: '/project' }),
      message('assistant', 'Original answer', 'final'),
      record('compacted', { replacement_history: [{ type: 'message', role: 'assistant', content: 'DUPLICATE' }] }), ...turn('b')])
    const page = await readHistoryPage(await createHistoryReference(path), { threadId: 'branch' })
    expect(text(page)).toContain('Readable thought')
    for (const secret of ['SYSTEM SECRET', 'DEVELOPER SECRET', 'DO NOT EXPOSE', 'DUPLICATE']) expect(text(page)).not.toContain(secret)
    const tools = page.turns[0].items.filter((item) => item.kind === 'tool_call' || item.kind === 'tool_result')
    expect(tools).toHaveLength(2)
    expect(tools.every((item) => item.status === 'completed' && item.toolName === 'exec_command')).toBe(true)
  })
  it('namespaces tool call identities across source turns and new Kun calls', async () => {
    const withTool = (id: string) => [record('turn_context', { turn_id: id }), message('user', id),
      record('response_item', { type: 'function_call', name: 'shell', call_id: 'one', arguments: '{}' }),
      record('response_item', { type: 'function_call_output', call_id: 'one', output: 'ok' }), message('assistant', 'Done', 'final')]
    await save([meta(), ...withTool('a'), ...withTool('b')])
    const page = await readHistoryPage(await createHistoryReference(path), { threadId: 'branch' })
    const ids = page.turns.flatMap((entry) => entry.items.filter((item) => item.kind === 'tool_call' || item.kind === 'tool_result').map((item) => item.callId))
    expect(ids).toEqual(['codex:session-a:a:call:one', 'codex:session-a:a:call:one', 'codex:session-a:b:call:one', 'codex:session-a:b:call:one'])
    expect(ids).not.toContain('one')
  })
  it('respects rollback and rejects incomplete tool turns as branch points', async () => {
    await save([meta(), ...turn('a'), ...turn('b'), record('event_msg', { type: 'thread_rolled_back', num_turns: 1 }), ...turn('c'),
      record('turn_context', { turn_id: 'pending' }), message('user', 'Unfinished'),
      record('response_item', { type: 'function_call', name: 'shell', call_id: 'pending', arguments: '{}' })])
    expect((await inspectCodexSession(path)).cutoffs.map((entry) => entry.turnId)).toEqual(['codex:session-a:a', 'codex:session-a:c'])
    const reference = await createHistoryReference(path)
    expect(reference.cutoffTurnId).toBe('codex:session-a:c')
    expect((await readHistoryPage(reference, { threadId: 'branch' })).turns.map((entry) => entry.id)).toEqual(['codex:session-a:a', 'codex:session-a:c'])
    await expect(createHistoryReference(path, 'codex:session-a:pending')).rejects.toThrow('No completed')
  })
  it('requires the completion marker for explicit turns and never branches from modern commentary', async () => {
    await save([meta(), record('event_msg', { type: 'task_started', turn_id: 'a' }),
      record('turn_context', { turn_id: 'a' }), message('user', 'Request'),
      record('response_item', { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Working' }] })])
    expect((await inspectCodexSession(path)).cutoffs).toEqual([])
    await appendFile(path, encode([message('assistant', 'Done', 'final')]))
    expect((await inspectCodexSession(path)).cutoffs).toEqual([])
    await appendFile(path, encode([record('event_msg', { type: 'task_complete', turn_id: 'a' })]))
    expect((await inspectCodexSession(path)).cutoffs).toHaveLength(1)
  })
  it('reports missing/changed sources and relinks identical compressed history', async () => {
    await save([meta(), ...turn('a')])
    const reference = await createHistoryReference(path)
    const compressed = join(root, 'relocated.jsonl.zst')
    const source = await readFile(path)
    await writeFile(compressed, zstdCompressSync(source))
    await rm(path)
    expect((await readHistoryPage(reference, { threadId: 'branch' })).status).toBe('missing')
    const relinked = await relinkHistoryReference(reference, compressed)
    expect(relinked.id).toBe(reference.id)
    expect((await readHistoryPage(relinked, { threadId: 'branch' })).status).toBe('available')
    await writeFile(path, source.toString().replace('Answer a', 'Tampered'))
    expect((await readHistoryPage(reference, { threadId: 'branch' })).status).toBe('changed')
    await expect(relinkHistoryReference(reference, path)).rejects.toThrow('changed')
  })
  it('reports malformed tails, unknown formats and empty incomplete histories', async () => {
    await save([meta(), ...turn('a'), record('response_item', { type: 'future_format' })])
    await appendFile(path, '{"unfinished":')
    const inspected = await inspectCodexSession(path)
    expect(inspected.warnings.join()).toContain('Malformed')
    expect(inspected.warnings.join()).toContain('Unsupported')
    expect((await readHistoryPage(await createHistoryReference(path), { threadId: 'branch' })).turns).toHaveLength(1)
    await save([meta(), message('user', 'Still running')])
    expect((await inspectCodexSession(path)).cutoffs).toEqual([])
    await expect(createHistoryReference(path)).rejects.toThrow('No completed')
  })
  it('follows real Codex history_base thread identity and exclusive byte boundary', async () => {
    const parent = join(root, 'rollout-parent-id.jsonl')
    const prefix = encode([meta('parent-id'), ...turn('a', 'Inherited question', 'Inherited answer')])
    await writeFile(parent, prefix + encode(turn('later', 'Excluded question', 'Excluded answer')))
    await save([meta('session-a', { history_base: { thread_id: 'parent-id', end_ordinal_exclusive: 5, end_byte_offset: Buffer.byteLength(prefix) } }), ...turn('child')])
    const reference = await createHistoryReference(path)
    expect(reference.files).toHaveLength(2)
    expect(reference.files[0].path).toBe(path)
    const page = await readHistoryPage(reference, { threadId: 'branch' })
    expect(page.status).toBe('available')
    expect(page.turns.map((entry) => entry.id)).toEqual(['codex:parent-id:a', 'codex:session-a:child'])
    expect(text(page)).not.toContain('Excluded answer')
    await rm(parent)
    expect((await readHistoryPage(reference, { threadId: 'branch' })).status).toBe('missing')
  })
  it('retains local history with a clear gap when a parent is unavailable', async () => {
    await save([meta('session-a', { history_base: { thread_id: 'missing-parent', end_byte_offset: 500, end_ordinal_exclusive: 3 } }), ...turn('child')])
    const page = await readHistoryPage(await createHistoryReference(path), { threadId: 'branch' })
    expect(page.status).toBe('partial')
    expect(page.turns).toHaveLength(1)
    expect(page.warnings.join()).toContain('Parent history')
  })
  it('paginates large tool content and scopes raw attachment record reads', async () => {
    const output = 'x'.repeat(20000) + ' END OF OUTPUT'
    await save([meta(), record('turn_context', { turn_id: 'a' }), message('user', 'Request'),
      record('response_item', { type: 'function_call', call_id: 'one', name: 'shell', arguments: '{}' }),
      record('response_item', { type: 'function_call_output', call_id: 'one', output }), message('assistant', 'Done', 'final')])
    const reference = await createHistoryReference(path)
    const page = await readHistoryPage(reference, { threadId: 'branch' })
    const item = page.turns[0].items.find((entry) => entry.kind === 'tool_result')!
    expect(text(item)).not.toContain('END OF OUTPUT')
    const tail = await readHistoryPage(reference, { threadId: 'branch', itemId: item.id, contentOffset: 20000 })
    expect(tail.content).toMatchObject({ itemId: item.id, field: 'output', text: ' END OF OUTPUT', totalChars: output.length })
    expect(await readHistorySourceRecord(reference, 'codex:other:item')).toBeUndefined()
    expect((await readHistorySourceRecord(reference, item.id))?.record.payload).toMatchObject({ output })
    const first = await readSourceHistory(reference, { operation: 'read', turnId: 'codex:session-a:a' })
    expect(first.nextContentOffset).toBe(6000)
    expect(first.nextOperation).toBe('read')
    const next = await readSourceHistory(reference, { operation: 'read', cursor: first.nextCursor, contentOffset: first.nextContentOffset })
    expect(next.text).not.toContain('Request')
    expect(next.nextContentOffset).toBe(12000)
  })
  it('caps UTF-8 page bytes and returns a complete continuation cursor', async () => {
    await save([meta(), ...Array.from({ length: 60 }, (_, index) => turn(String(index), '\u6587'.repeat(20000), '\u5b57'.repeat(20000))).flat()])
    const reference = await createHistoryReference(path)
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = await readHistoryPage(reference, { threadId: 'branch', limit: 100, cursor })
      expect(page.itemBytes).toBeLessThanOrEqual(4 * 1024 * 1024)
      ids.push(...page.turns.flatMap((entry) => entry.items.map((item) => item.id)))
      cursor = page.nextCursor
    } while (cursor)
    expect(ids).toHaveLength(120)
    expect(new Set(ids).size).toBe(120)
  })
  it('never gains a formerly missing parent after a fixed branch is created', async () => {
    const parent = join(root, 'rollout-parent-id.jsonl')
    const prefix = encode([meta('parent-id'), ...turn('a', 'Parent request', 'Parent answer')])
    await save([meta('session-a', { history_base: { thread_id: 'parent-id', end_ordinal_exclusive: 5, end_byte_offset: Buffer.byteLength(prefix) } }), ...turn('child')])
    const reference = await createHistoryReference(path)
    await writeFile(parent, prefix)
    const page = await readHistoryPage(reference, { threadId: 'branch' })
    expect(page.turns).toHaveLength(1)
    expect(text(page)).not.toContain('Parent answer')
  })
  it('reads recent whole turns, navigates older turns and paginates search hits', async () => {
    await save([meta(), ...turn('a'), ...turn('b'), ...turn('c')])
    const reference = await createHistoryReference(path)
    const recent = await readSourceHistory(reference, { operation: 'recent', limit: 1 })
    expect(recent.text).toContain('Question c')
    expect(recent.text).toContain('Answer c')
    expect(recent.text).not.toContain('Question b')
    expect(recent.nextOperation).toBe('recent')
    const older = await readSourceHistory(reference, { operation: 'recent', limit: 1, cursor: recent.nextCursor })
    expect(older.text).toContain('Question b')
    const search = await readSourceHistory(reference, { operation: 'search', query: 'Answer', limit: 1 })
    expect(search.text).toContain('Answer a')
    const continued = await readSourceHistory(reference, { operation: 'search', query: 'Answer', limit: 1, cursor: search.nextCursor })
    expect(continued.text).toContain('Answer b')
  })
})

describe('Codex discovery', () => {
  it('falls back to rollout files and filters projects and archives', async () => {
    const sessions = join(root, 'sessions', '2026', '09', '01')
    const archived = join(root, 'archived_sessions')
    await mkdir(sessions, { recursive: true })
    await mkdir(archived)
    await writeFile(join(sessions, 'rollout-session-a.jsonl'), encode([meta(), ...turn('a')]))
    await writeFile(join(archived, 'rollout-archive-id.jsonl'), encode([meta('archive-id'), ...turn('archived')]))
    expect(await discoverCodexSessions({ codexHome: root, cwd: '/wrong' })).toEqual([])
    expect((await discoverCodexSessions({ codexHome: root, cwd: '/project' })).map((entry) => entry.sessionId)).toEqual(['session-a'])
    expect(await discoverCodexSessions({ codexHome: root, includeArchived: true })).toHaveLength(2)
  })
  it('uses compressed siblings referenced by SQLite and filters before the row limit', async () => {
    const compressed = path + '.zst'
    await writeFile(compressed, zstdCompressSync(Buffer.from(encode([meta(), ...turn('a')]))))
    const db = new DatabaseSync(join(root, 'state_5.sqlite'))
    db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER)')
    const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)')
    db.exec('BEGIN')
    for (let index = 0; index < 10001; index += 1) insert.run('other-' + index, '/other.jsonl', 'Other', '/other', 1800000000, 0)
    insert.run('session-a', path, 'Target', '/project', 1700000000, 0)
    db.exec('COMMIT')
    db.close()
    const rows = await discoverCodexSessions({ codexHome: root, cwd: '/project' })
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe(compressed)
  })
  it('reads SQLite metadata without modifying the database', async () => {
    const dbPath = join(root, 'state_5.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, title TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER)')
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)').run('session-a', path, 'Indexed title', '/project', 1700000000, 0)
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)').run('archived-id', '/archive.jsonl', 'Archived', '/project', 1700000001, 1)
    db.close()
    const before = await readFile(dbPath)
    const rows = await discoverCodexSessions({ codexHome: root, query: 'Indexed' })
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Indexed title')
    expect(await readFile(dbPath)).toEqual(before)
  })
})
