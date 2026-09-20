import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createOpenCodeReference, inspectOpenCode } from './opencode-history.js'
import { discoverOpenCodeSessions } from './opencode-discovery.js'
import { createHistorySubreference, readHistoryPage, readSourceHistory, relinkHistoryReference } from './codex-history.js'
import { readHistoryAttachment } from './history-reference-attachments.js'
import type { OpenCodeSource } from '../contracts/history-reference.js'

const roots: string[] = []
const databases: DatabaseSync[] = []
afterEach(async () => { databases.splice(0).forEach((db) => db.close()); await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))) })
const time = { created: 1789257600000, completed: 1789257601000 }
const info = { id: 'ses_main', title: 'OpenCode source', directory: '/original', time: { created: time.created, updated: time.completed } }
const secret = 'SOURCE_BODY_DO_NOT_COPY_90210'
function messages() { return [
  { info: { id: 'msg_01', role: 'user', time: { created: time.created } }, parts: [{ id: 'prt_01', type: 'text', text: 'Question' }] },
  { info: { id: 'msg_02', role: 'assistant', parentID: 'msg_01', time, finish: 'stop', path: { cwd: '/original' } }, parts: [
    { id: 'prt_02', type: 'reasoning', text: 'Reasoning' },
    { id: 'prt_03', type: 'tool', tool: 'bash', callID: 'call_1', state: { status: 'completed', input: { command: 'pwd' }, output: '/original', time: { start: time.created, end: time.completed } } },
    { id: 'prt_04', type: 'text', text: secret }
  ] }
] }
async function fixture(kind: OpenCodeSource['kind']) {
  const root = await mkdtemp(join(tmpdir(), 'kun-opencode-')); roots.push(root)
  const data = { info, messages: messages() }
  const path = join(root, kind === 'sqlite' ? 'opencode.db' : kind === 'legacy' ? 'storage' : 'export.json')
  let db: DatabaseSync | undefined
  if (kind === 'sqlite') {
    db = new DatabaseSync(path); databases.push(db)
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER, revert TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);`)
    db.prepare('INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)').run(info.id, info.title, info.directory, time.created, time.completed)
    for (const m of data.messages) {
      db.prepare('INSERT INTO message VALUES (?, ?, ?)').run(m.info.id, info.id, JSON.stringify(m.info))
      for (const part of m.parts) db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)').run(part.id, m.info.id, info.id, JSON.stringify(part))
    }
  } else if (kind === 'legacy') {
    await mkdir(join(path, 'session', 'project'), { recursive: true })
    await writeFile(join(path, 'session', 'project', `${info.id}.json`), JSON.stringify(info))
    await mkdir(join(path, 'message', info.id), { recursive: true })
    for (const m of data.messages) {
      await writeFile(join(path, 'message', info.id, `${m.info.id}.json`), JSON.stringify(m.info))
      await mkdir(join(path, 'part', m.info.id), { recursive: true })
      for (const part of m.parts) await writeFile(join(path, 'part', m.info.id, `${part.id}.json`), JSON.stringify(part))
    }
  } else await writeFile(path, JSON.stringify(data))
  return { root, path, db, data, reference: () => createOpenCodeReference(path, info.id, kind) }
}

describe('OpenCode history references', () => {
  it.each(['sqlite', 'legacy', 'export'] as const)('reads %s, pairs tools and stores only fingerprints', async (kind) => {
    const f = await fixture(kind), ref = await f.reference()
    expect(ref.provider).toBe('opencode'); expect(ref.files).toEqual([])
    expect(JSON.stringify(ref)).not.toContain(secret)
    const page = await readHistoryPage(ref, { threadId: 'kun' })
    expect(page.status).toBe('available'); expect(page.turns).toHaveLength(1)
    expect(page.turns[0].items.map((i) => i.kind)).toEqual(['user_message', 'assistant_reasoning', 'tool_call', 'tool_result', 'assistant_text'])
    expect((await readSourceHistory(ref, { operation: 'search', query: secret })).text).toContain(secret)
    expect((await createHistorySubreference(ref, ref.cutoffTurnId)).id).toBe(ref.id)
    const page1 = await readHistoryPage(ref, { threadId: 'kun', limit: 1 })
    expect(page1.itemCount).toBe(1)
    expect((await readHistoryPage(ref, { threadId: 'kun', limit: 1, cursor: page1.nextCursor })).turns[0].items[0].kind).toBe('tool_result')
  })
  it('reads the pre-migration project storage layout', async () => {
    const f = await fixture('legacy'), old = join(f.root, 'old-storage')
    await mkdir(join(old, 'session', 'part', info.id), { recursive: true })
    await rename(join(f.path, 'session', 'project'), join(old, 'session', 'info'))
    await rename(join(f.path, 'message'), join(old, 'session', 'message'))
    for (const m of f.data.messages) await rename(join(f.path, 'part', m.info.id), join(old, 'session', 'part', info.id, m.info.id))
    const ref = await createOpenCodeReference(old, info.id, 'legacy')
    expect((await readHistoryPage(ref, { threadId: 'kun' })).itemCount).toBe(5)
  })

  it('preserves binary ID ordering, independently of the host locale', async () => {
    const f = await fixture('export')
    await writeFile(f.path, JSON.stringify({ ...f.data, messages: [f.data.messages[0], {
      ...f.data.messages[1], parts: [{ id: 'prt_a', type: 'text', text: 'lowercase later' }, { id: 'prt_Z', type: 'text', text: 'uppercase earlier' }]
    }] }))
    const page = await readHistoryPage(await f.reference(), { threadId: 'kun' })
    expect(page.turns[0].items.map((i) => 'text' in i ? i.text : '')).toEqual(['Question', 'uppercase earlier', 'lowercase later'])
  })

  it('ignores WAL appends, unrelated updates, checkpoints and VACUUM but detects edits', async () => {
    const f = await fixture('sqlite'), ref = await f.reference(), db = f.db!
    db.prepare('INSERT INTO session (id, title) VALUES (?, ?)').run('ses_other', 'Other')
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)').run('prt_05', 'msg_02', info.id, JSON.stringify({ type: 'text', text: 'NEW_PART' }))
    db.prepare('INSERT INTO message VALUES (?, ?, ?)').run('msg_03', info.id, JSON.stringify({ role: 'user', time: { created: time.completed }, id: 'msg_03' }))
    db.prepare('UPDATE session SET title = ?, time_updated = ?, revert = ? WHERE id = ?').run('New title', Date.now(), JSON.stringify({ messageID: 'msg_01' }), info.id)
    expect(JSON.stringify(await readHistoryPage(ref, { threadId: 'kun' }))).not.toContain('NEW_PART')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM')
    expect((await readHistoryPage(ref, { threadId: 'kun' })).status).toBe('available')
    db.prepare('UPDATE part SET data = ? WHERE id = ?').run(JSON.stringify({ type: 'text', text: 'edited' }), 'prt_04')
    expect((await readHistoryPage(ref, { threadId: 'kun' })).status).toBe('changed')
  })
  it.each(['sqlite', 'legacy', 'export'] as const)('detects removed/edited %s records', async (kind) => {
    const f = await fixture(kind), ref = await f.reference()
    if (kind === 'sqlite') f.db!.prepare('DELETE FROM part WHERE id = ?').run('prt_04')
    else if (kind === 'legacy') await writeFile(join(f.path, 'part', 'msg_02', 'prt_04.json'), JSON.stringify({ id: 'prt_04', type: 'text', text: 'edited' }))
    else await writeFile(f.path, (await readFile(f.path, 'utf8')).replace(secret, 'edited'))
    expect((await readHistoryPage(ref, { threadId: 'kun' })).status).not.toBe('available')
  })
  it('honors revert boundaries and rejects unfinished turns', async () => {
    const f = await fixture('sqlite')
    f.db!.prepare('UPDATE session SET revert = ?').run(JSON.stringify({ messageID: 'msg_02', partID: 'prt_04' }))
    expect((await inspectOpenCode(f.path, info.id, 'sqlite')).cutoffs).toEqual([])
    await expect(f.reference()).rejects.toThrow('No completed')
    f.db!.prepare('UPDATE session SET revert = NULL').run()
    f.db!.prepare('UPDATE message SET data = ? WHERE id = ?').run(JSON.stringify({ ...f.data.messages[1].info, finish: 'tool-calls', time: { created: time.created } }), 'msg_02')
    expect((await inspectOpenCode(f.path, info.id, 'sqlite')).cutoffs).toEqual([])
  })
  it('filters main sessions and deduplicates database over legacy', async () => {
    const f = await fixture('sqlite')
    await mkdir(join(f.root, 'storage', 'session', 'project'), { recursive: true })
    await writeFile(join(f.root, 'storage', 'session', 'project', `${info.id}.json`), JSON.stringify({ ...info, title: 'Legacy duplicate' }))
    f.db!.prepare('INSERT INTO session (id, title, parent_id) VALUES (?, ?, ?)').run('ses_child', 'Child', info.id)
    const listed = await discoverOpenCodeSessions({ opencodeHome: f.root })
    expect(listed).toHaveLength(1); expect(listed[0].sourceKind).toBe('sqlite')
    expect(await discoverOpenCodeSessions({ opencodeHome: f.root, cwd: '/different' })).toEqual([])
    expect(await discoverOpenCodeSessions({ path: f.path, query: 'OpenCode' })).toHaveLength(1)
    await expect(createOpenCodeReference(f.path, 'ses_child', 'sqlite')).rejects.toThrow('main session')
  })
  it('relinks exports and reads declared attachments', async () => {
    const f = await fixture('export'), png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    const data = { ...f.data, messages: f.data.messages.map((m, i) => i ? m : { ...m, parts: [{ id: 'prt_01', type: 'file', filename: 'image.png', mime: 'image/png', url: `data:image/png;base64,${png.toString('base64')}` }] }) }
    await writeFile(f.path, JSON.stringify(data))
    const ref = await f.reference(), moved = join(f.root, 'moved.json')
    await rename(f.path, moved)
    expect((await readHistoryPage(ref, { threadId: 'kun' })).status).toBe('missing')
    const linked = await relinkHistoryReference(ref, moved)
    const item = (await readHistoryPage(linked, { threadId: 'kun' })).turns[0].items[0]
    expect(await readHistoryAttachment(linked, item.id, 0)).toMatchObject({ mimeType: 'image/png', dataBase64: png.toString('base64') })
  })
})
