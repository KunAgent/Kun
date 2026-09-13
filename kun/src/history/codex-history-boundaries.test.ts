import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFile, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHistoryReference, inspectCodexSession, readHistoryPage, relinkHistoryReference } from './codex-history.js'

let root: string
let path: string
const record = (type: string, payload: unknown) => ({ timestamp: '2026-09-01T00:00:00.000Z', type, payload })
const event = (type: string, turnId?: string) => record('event_msg', { type, ...(turnId ? { turn_id: turnId } : {}) })
const message = (role: string, text: string) => record('response_item', {
  type: 'message', role, phase: role === 'assistant' ? 'final_answer' : undefined,
  content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }]
})
const meta = (id = 'session-a', extra = {}) => record('session_meta', { id, cwd: '/project', ...extra })
const turn = (id: string, user = true) => [
  event('task_started', id), record('turn_context', { turn_id: id }),
  ...(user ? [message('user', `Question ${id}`)] : []),
  message('assistant', `Answer ${id}`), event('task_complete', id)
]
const encode = (records: unknown[]) => records.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
const save = (records: unknown[]) => writeFile(path, encode(records))
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'kun-codex-boundaries-')); path = join(root, 'rollout-session-a.jsonl') })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('Codex lifecycle boundaries', () => {
  it('isolates assistant-only turns and their tool results from earlier branch points', async () => {
    const first = [meta(), ...turn('a')]
    await save([...first, event('task_started', 'b'),
      record('response_item', { type: 'function_call', call_id: 'one', name: 'shell', arguments: '{}' }),
      record('response_item', { type: 'function_call_output', call_id: 'one', output: 'Autonomous result b' }),
      message('assistant', 'Answer b'), event('task_complete', 'b')])
    expect((await inspectCodexSession(path)).cutoffs.map((entry) => entry.turnId))
      .toEqual(['codex:session-a:a', 'codex:session-a:b'])
    const early = await createHistoryReference(path, 'codex:session-a:a')
    expect(early.files[0].byteLength).toBe(Buffer.byteLength(encode(first)))
    const earlyPage = await readHistoryPage(early, { threadId: 'branch' })
    expect(earlyPage.turns.map((entry) => entry.id)).toEqual(['codex:session-a:a'])
    expect(JSON.stringify(earlyPage)).not.toContain('Answer b')
    expect(JSON.stringify(earlyPage)).not.toContain('Autonomous result b')
    const full = await readHistoryPage(await createHistoryReference(path), { threadId: 'branch' })
    expect(full.turns[1].items.map((item) => item.kind)).toEqual(['tool_call', 'tool_result', 'assistant_text'])
    expect(full.turns[1].items.every((item) => item.turnId === 'codex:session-a:b')).toBe(true)
  })

  it('rolls back an assistant-only turn without removing the preceding user turn', async () => {
    await save([meta(), ...turn('a'), ...turn('b', false),
      record('event_msg', { type: 'thread_rolled_back', num_turns: 1 })])
    expect((await inspectCodexSession(path)).cutoffs.map((entry) => entry.turnId)).toEqual(['codex:session-a:a'])
    const page = await readHistoryPage(await createHistoryReference(path), { threadId: 'branch' })
    expect(page.turns).toHaveLength(1)
    expect(JSON.stringify(page)).toContain('Answer a')
    expect(JSON.stringify(page)).not.toContain('Answer b')
  })

  it('keeps incomplete autonomous turns outside the default branch boundary', async () => {
    await save([meta(), ...turn('a'), event('task_started', 'b'), message('assistant', 'Answer b')])
    expect((await inspectCodexSession(path)).cutoffs.map((entry) => entry.turnId)).toEqual(['codex:session-a:a'])
    expect((await createHistoryReference(path)).cutoffTurnId).toBe('codex:session-a:a')
    await appendFile(path, encode([event('task_complete', 'a')]))
    expect((await inspectCodexSession(path)).cutoffs).toHaveLength(1)
    await appendFile(path, encode([event('task_complete', 'b')]))
    expect((await inspectCodexSession(path)).cutoffs).toHaveLength(2)
  })

  it('uses turn context for legacy starts without IDs and preserves one turn for steering messages', async () => {
    await save([meta(), ...turn('a'), event('task_started'), message('user', 'Question b'),
      record('turn_context', { turn_id: 'b' }), message('user', 'Steering b'),
      message('assistant', 'Answer b'), event('task_complete', 'b')])
    const page = await readHistoryPage(await createHistoryReference(path), { threadId: 'branch' })
    expect(page.turns.map((entry) => entry.id)).toEqual(['codex:session-a:a', 'codex:session-a:b'])
    expect(page.turns[1].items).toHaveLength(3)
  })

  it('tracks a context-only autonomous turn without a synthetic user message', async () => {
    await save([meta(), ...turn('a'), record('turn_context', { turn_id: 'b' }),
      message('assistant', 'Answer b'), event('task_complete', 'b')])
    const page = await readHistoryPage(await createHistoryReference(path), { threadId: 'branch' })
    expect(page.turns.map((entry) => entry.id)).toEqual(['codex:session-a:a', 'codex:session-a:b'])
    expect(page.turns[1].items.map((entry) => entry.kind)).toEqual(['assistant_text'])
  })
})

describe('Codex frozen parent locations', () => {
  it('relinks a moved child using the original frozen parent path, ahead of nearby conflicting candidates', async () => {
    const parent = join(root, 'rollout-parent-id.jsonl')
    const parentPrefix = encode([meta('parent-id'), ...turn('parent')])
    await writeFile(parent, parentPrefix)
    await save([meta('session-a', { history_base: { thread_id: 'parent-id', end_byte_offset: Buffer.byteLength(parentPrefix) } }),
      ...turn('child')])
    const reference = await createHistoryReference(path)
    const movedRoot = join(root, 'moved')
    await mkdir(movedRoot)
    const moved = join(movedRoot, 'rollout-session-a.jsonl')
    await rename(path, moved)
    await writeFile(join(movedRoot, 'rollout-parent-id.jsonl'), encode([meta('parent-id'), ...turn('wrong')]))
    const relinked = await relinkHistoryReference(reference, moved)
    expect(relinked.id).toBe(reference.id)
    expect(relinked.files[1].path).toBe(parent)
    const page = await readHistoryPage(relinked, { threadId: 'branch' })
    expect(page.status).toBe('available')
    expect(page.turns.map((entry) => entry.id)).toEqual(['codex:parent-id:parent', 'codex:session-a:child'])
    expect(JSON.stringify(page)).not.toContain('Answer wrong')
  })

  it('uses frozen ancestor locations recursively when only the child moves', async () => {
    const grandparent = join(root, 'rollout-grandparent.jsonl')
    const grandparentPrefix = encode([meta('grandparent'), ...turn('grandparent')])
    await writeFile(grandparent, grandparentPrefix)
    const parent = join(root, 'rollout-parent.jsonl')
    const parentPrefix = encode([meta('parent', {
      history_base: { thread_id: 'grandparent', end_byte_offset: Buffer.byteLength(grandparentPrefix) }
    }), ...turn('parent')])
    await writeFile(parent, parentPrefix)
    await save([meta('session-a', { history_base: { thread_id: 'parent', end_byte_offset: Buffer.byteLength(parentPrefix) } }), ...turn('child')])
    const reference = await createHistoryReference(path)
    const movedRoot = join(root, 'moved')
    await mkdir(movedRoot)
    const moved = join(movedRoot, 'rollout-session-a.jsonl')
    await rename(path, moved)
    const page = await readHistoryPage(await relinkHistoryReference(reference, moved), { threadId: 'branch' })
    expect(page.status).toBe('available')
    expect(page.turns.map((entry) => entry.id)).toEqual(['codex:grandparent:grandparent', 'codex:parent:parent', 'codex:session-a:child'])
  })
})
