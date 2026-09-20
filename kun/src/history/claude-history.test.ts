import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, appendFile, rm, mkdir, rename, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHistoryReference, createHistoryPreviewReference, createHistorySubreference, inspectCodexSession, readHistoryPage, readSourceHistory, relinkHistoryReference } from './codex-history.js'
import { discoverClaudeSessions } from './history-source-adapter.js'
import { readHistoryAttachment } from './history-reference-attachments.js'
import { HistoryReferenceSchema } from '../contracts/history-reference.js'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
function record(type: string, uuid: string, parentUuid: string | null, content: unknown, stop_reason?: string) {
  return { type, uuid, parentUuid, sessionId: 'session', cwd: '/original', timestamp: '2026-09-13T00:00:00.000Z',
    message: { role: type, content, ...(stop_reason ? { stop_reason } : {}) } }
}
async function fixture(records: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'claude-history-')); dirs.push(dir)
  const path = join(dir, 'session.jsonl')
  await writeFile(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return { dir, path }
}
const text = (value: string) => [{ type: 'text', text: value }]
const basic = () => [record('user', 'u1', null, text('first question')),
  record('assistant', 'a1', 'u1', text('first answer'), 'end_turn')]

describe('Claude Code source history', () => {
  it('projects content blocks and tool results in one user turn without duplicating bodies', async () => {
    const { path } = await fixture([record('user', 'u1', null, text('PRIVATE_SOURCE_QUESTION')),
      record('assistant', 'a1', 'u1', [{ type: 'thinking', thinking: 'reasoning' }, { type: 'tool_use', id: 'call', name: 'Bash', input: { command: 'pwd' } }], 'tool_use'),
      record('user', 'r1', 'a1', [{ type: 'tool_result', tool_use_id: 'call', content: '/original' }]),
      record('assistant', 'a2', 'r1', text('done'), 'end_turn')])
    const ref = await createHistoryReference(path, undefined, 'claude-code')
    expect(ref.provider).toBe('claude-code')
    expect(JSON.stringify(ref)).not.toContain('reasoning')
    expect(ref.files).toHaveLength(1)
    expect(HistoryReferenceSchema.parse(ref)).toEqual(ref)
    const page = await readHistoryPage(ref, { threadId: 'kun' })
    expect(page.turns).toHaveLength(1)
    expect(page.turns[0].items.map((i) => i.kind)).toEqual(['user_message', 'assistant_reasoning', 'tool_call', 'tool_result', 'assistant_text'])
    expect(page.turns[0].items[3]).toMatchObject({ toolName: 'Bash', output: '/original' })
    const read = await readSourceHistory(ref, { operation: 'search', query: 'reasoning' })
    expect(read.text).toContain('reasoning')
    expect(read.text).not.toContain('PRIVATE_SOURCE_QUESTION')
  })

  it('freezes the chosen branch and excludes sibling branches, sidechains and later appends', async () => {
    const { path } = await fixture([...basic(),
      record('user', 'old-u', 'a1', text('abandoned question')),
      record('assistant', 'old-a', 'old-u', text('abandoned answer'), 'end_turn'),
      { ...record('user', 'u2', 'a1', text('current question')), cwd: '/new' },
      { ...record('assistant', 'a2', 'u2', text('current answer'), 'end_turn'), cwd: '/new' },
      { ...record('assistant', 'side', null, text('sidechain'), 'end_turn'), isSidechain: true }])
    const ref = await createHistoryReference(path, undefined, 'claude-code')
    expect(ref.workspace).toBe('/new')
    await appendFile(path, JSON.stringify(record('user', 'u3', 'a2', text('future'))) + '\n')
    const page = await readHistoryPage(ref, { threadId: 'kun' })
    expect(page.turns).toHaveLength(2)
    const body = JSON.stringify(page)
    expect(body).not.toMatch(/abandoned|sidechain|future/)
    const sub = await createHistorySubreference(ref, page.turns[0].id)
    expect(sub.workspace).toBe('/original')
    expect((await readHistoryPage(sub, { threadId: 'other' })).turns).toHaveLength(1)
  })

  it('rejects unfinished cutoff while preserving earlier complete turns', async () => {
    const { path } = await fixture([...basic(), record('user', 'u2', 'a1', text('pending')),
      record('assistant', 'a2', 'u2', [{ type: 'tool_use', id: 'missing', name: 'Bash', input: {} }], 'tool_use')])
    const preview = await inspectCodexSession(path, 'claude-code')
    expect(preview.cutoffs.map((c) => c.turnId)).toEqual(['claude-code:session:u1'])
    await expect(createHistoryReference(path, 'claude-code:session:u2', 'claude-code')).rejects.toThrow()
    expect((await createHistoryReference(path, undefined, 'claude-code')).cutoffTurnId).toBe('claude-code:session:u1')
  })

  it('paginates individual blocks, retrieves exact records, and relinks verified originals', async () => {
    const { dir, path } = await fixture([record('user', 'u', null, text('question')),
      record('assistant', 'a', 'u', [{ type: 'thinking', thinking: 'think' }, ...text('X'.repeat(20000))], 'end_turn')])
    const ref = await createHistoryReference(path, undefined, 'claude-code')
    const page = await readHistoryPage(ref, { threadId: 'kun', limit: 1 })
    expect(page.itemCount).toBe(1)
    expect(page.hasMore).toBe(true)
    const older = await readHistoryPage(ref, { threadId: 'kun', cursor: page.nextCursor, limit: 1 })
    expect(older.turns[0].items[0].kind).toBe('assistant_reasoning')
    const item = page.turns[0].items[0]
    const detail = await readHistoryPage(ref, { threadId: 'kun', itemId: item.id, contentOffset: 16384 })
    expect(detail.content?.totalChars).toBe(20000)
    expect(detail.content?.text.length).toBe(3616)
    const relocated = join(dir, 'relocated.jsonl'); await rename(path, relocated)
    expect((await readHistoryPage(ref, { threadId: 'kun' })).status).toBe('missing')
    const linked = await relinkHistoryReference(ref, relocated)
    expect((await readHistoryPage(linked, { threadId: 'kun' })).itemCount).toBe(3)
    await writeFile(relocated, (await readFile(relocated, 'utf8')).replace('question', 'tampered'))
    expect((await readHistoryPage(linked, { threadId: 'kun' })).status).toBe('changed')
  })

  it('discovers only main sessions and applies workspace and title filters', async () => {
    const { dir, path } = await fixture(basic())
    const project = join(dir, 'projects', 'encoded'); await mkdir(join(project, 'session', 'subagents'), { recursive: true })
    const body = await readFile(path)
    await writeFile(join(project, 'session.jsonl'), body)
    await writeFile(join(project, 'session', 'subagents', 'agent-1.jsonl'), body)
    expect(await discoverClaudeSessions({ claudeHome: dir, cwd: '/different' })).toEqual([])
    expect(await discoverClaudeSessions({ claudeHome: dir, query: 'question' })).toHaveLength(1)
  })

  it('shows an unfinished preview and warns about compacted or missing ancestry', async () => {
    const { path } = await fixture([
      { type: 'system', uuid: 'compact', parentUuid: 'unavailable', sessionId: 'session', subtype: 'compact_boundary' },
      record('user', 'u', 'compact', text('unfinished'))
    ])
    const ref = (await createHistoryPreviewReference(path, 'claude-code'))!
    const page = await readHistoryPage(ref, { threadId: 'preview' })
    expect(JSON.stringify(page)).toContain('unfinished')
    expect(page.warnings.join(' ')).toMatch(/compact/)
    expect(page.turns.at(-1)?.status).toBe('aborted')
    await expect(createHistoryReference(path, undefined, 'claude-code')).rejects.toThrow()
  })

  it('retains recorded history across an explicit compaction boundary', async () => {
    const { path } = await fixture([...basic(),
      { type: 'system', uuid: 'compact', parentUuid: null, sessionId: 'session', subtype: 'compact_boundary' },
      { ...record('user', 'summary', null, text('compact summary')), isCompactSummary: true },
      record('user', 'u2', 'summary', text('after compact')),
      record('assistant', 'a2', 'u2', text('continued'), 'end_turn')])
    const ref = await createHistoryReference(path, undefined, 'claude-code')
    const page = await readHistoryPage(ref, { threadId: 'kun' })
    expect(page.turns).toHaveLength(2)
    expect(JSON.stringify(page)).toContain('first answer')
    expect(JSON.stringify(page)).toContain('continued')
  })

  it('deduplicates repeated message UUIDs and marks unknown blocks without inventing content', async () => {
    const answer = record('assistant', 'a1', 'u1', [...text('one answer'), { type: 'future_block' }], 'end_turn')
    const { path } = await fixture([basic()[0], answer, answer])
    const ref = await createHistoryReference(path, undefined, 'claude-code')
    const page = await readHistoryPage(ref, { threadId: 'kun' })
    expect(page.itemCount).toBe(3)
    expect(JSON.stringify(page)).toContain('Unsupported Claude Code content')
  })

  it('reads declared embedded attachments from the original verified file', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    const { path } = await fixture([record('user', 'u', null, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }]),
      record('assistant', 'a', 'u', text('image'), 'end_turn')])
    const ref = await createHistoryReference(path, undefined, 'claude-code')
    const page = await readHistoryPage(ref, { threadId: 'kun' })
    const item = page.turns[0].items[0]
    expect(item.sourceAttachments).toHaveLength(1)
    expect(await readHistoryAttachment(ref, item.id, 0)).toMatchObject({ mimeType: 'image/png', dataBase64: png.toString('base64') })
  })
})
