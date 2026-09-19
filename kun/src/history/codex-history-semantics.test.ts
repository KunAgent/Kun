import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHistoryReference, createHistorySubreference, inspectCodexSession, readHistoryPage, readSourceHistory } from './codex-history.js'
import { isCodexUserTurnBoundary } from './codex-turn-boundary.js'

let root: string
let path: string
const record = (type: string, payload: unknown) => ({ timestamp: '2026-09-01T00:00:00.000Z', type, payload })
const event = (type: string, id?: string) => record('event_msg', { type, turn_id: id })
const message = (role: string, text: string) => record('response_item', {
  type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }]
})
const meta = (id = 'session-a', cwd?: string, extra = {}) => record('session_meta', { id, cwd, ...extra })
const turn = (id: string, cwd?: string) => [event('task_started', id), record('turn_context', { turn_id: id, cwd }),
  message('user', `Question ${id}`), message('assistant', `Answer ${id}`), event('task_complete', id)]
const rollback = (count = 1) => record('event_msg', { type: 'thread_rolled_back', num_turns: count })
const encode = (records: unknown[]) => records.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
const save = (records: unknown[]) => writeFile(path, encode(records))
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'kun-codex-semantics-')); path = join(root, 'rollout-session-a.jsonl') })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('Codex effective workspace', () => {
  it('selects the workspace at each branch point and keeps the preview on the latest context', async () => {
    await save([meta('session-a', '/project-a'), ...turn('a', '/project-a'), ...turn('b', '/project-b')])
    expect((await inspectCodexSession(path)).session.workspace).toBe('/project-b')
    expect((await inspectCodexSession(path)).cutoffs.map((cutoff) => cutoff.workspace)).toEqual(['/project-a', '/project-b'])
    const latest = await createHistoryReference(path)
    expect(latest.workspace).toBe('/project-b')
    expect((await createHistoryReference(path, 'codex:session-a:a')).workspace).toBe('/project-a')
    expect((await createHistorySubreference(latest, 'codex:session-a:a')).workspace).toBe('/project-a')
  })

  it('does not let a new incomplete context overwrite an earlier completed cutoff', async () => {
    await save([meta('session-a', '/initial'), ...turn('a', '/project-a'),
      event('task_started', 'pending'), record('turn_context', { turn_id: 'pending', cwd: '/project-b' })])
    expect((await inspectCodexSession(path)).session.workspace).toBe('/project-b')
    expect((await createHistoryReference(path)).workspace).toBe('/project-a')
  })

  it('handles legacy contexts without IDs and context updates within an active turn', async () => {
    await save([meta('session-a', '/initial'), ...turn('a', '/project-a'), event('task_started'),
      record('turn_context', { cwd: '/project-b' }), message('user', 'Legacy task'),
      record('turn_context', { cwd: '/project-c' }), message('assistant', 'Legacy answer'), event('task_complete')])
    expect((await createHistoryReference(path)).workspace).toBe('/project-c')
    expect((await createHistoryReference(path, 'codex:session-a:a')).workspace).toBe('/project-a')
  })

  it('inherits a missing cwd and restores surviving context after a rollback', async () => {
    await save([meta('session-a', '/initial'), ...turn('a', '/project-a'), ...turn('b'), ...turn('c', '/project-c'), rollback()])
    expect((await inspectCodexSession(path)).session.workspace).toBe('/project-a')
    expect((await createHistoryReference(path)).workspace).toBe('/project-a')
  })

  it('retains each parent cutoff workspace instead of applying the child workspace', async () => {
    const parent = join(root, 'rollout-parent.jsonl')
    const parentContent = encode([meta('parent', '/initial'), ...turn('a', '/parent-a'), ...turn('b', '/parent-b')])
    await writeFile(parent, parentContent)
    await save([meta('session-a', '/child', { history_base: { thread_id: 'parent', end_byte_offset: Buffer.byteLength(parentContent) } }), ...turn('child')])
    expect((await createHistoryReference(path)).workspace).toBe('/child')
    const latest = await createHistoryReference(path)
    expect((await createHistorySubreference(latest, 'codex:parent:a')).workspace).toBe('/parent-a')
    expect((await createHistorySubreference(latest, 'codex:parent:b')).workspace).toBe('/parent-b')
    await save([meta('session-a', undefined, { history_base: { thread_id: 'parent', end_byte_offset: Buffer.byteLength(parentContent) } }), ...turn('child')])
    expect((await createHistoryReference(path)).workspace).toBe('/parent-b')
  })
})

describe('Codex rollback input boundaries', () => {
  const communication = { author: '/parent', recipient: '/worker', content: 'Continue the work', trigger_turn: true }
  const inputs = [
    ['assistant communication', message('assistant', JSON.stringify(communication))],
    ['plaintext AgentMessage', record('response_item', { type: 'agent_message', author: '/parent', recipient: '/worker',
      content: [{ type: 'input_text', text: 'Continue the work' }] })],
    ['encrypted AgentMessage', record('response_item', { type: 'agent_message', author: '/parent', recipient: '/worker',
      content: [{ type: 'encrypted_content', encrypted_content: 'fixture-ciphertext' }] })],
    ['rollout communication', record('inter_agent_communication', communication)]
  ] as const

  it.each(inputs)('counts %s as an input turn while preserving inert visible history', async (_label, input) => {
    const prefix = [meta('session-a', '/project'), ...turn('a'), event('task_started', 'agent'),
      record('turn_context', { turn_id: 'agent' }), input, message('assistant', 'Agent answer'), event('task_complete', 'agent')]
    await save(prefix)
    const before = await createHistoryReference(path)
    const page = await readHistoryPage(before, { threadId: 'branch' })
    expect(page.turns.at(-1)?.items).toHaveLength(2)
    expect(page.warnings).toEqual([])
    await save([...prefix, rollback()])
    expect((await inspectCodexSession(path)).cutoffs.map((entry) => entry.turnId)).toEqual(['codex:session-a:a'])
    const after = await readHistoryPage(await createHistoryReference(path), { threadId: 'branch' })
    expect(JSON.stringify(after)).toContain('Answer a')
    expect(JSON.stringify(after)).not.toContain('Agent answer')
  })

  it('skips contextual input wrappers, plain output turns and empty tasks together', async () => {
    await save([meta('session-a', '/project'), ...turn('a'), ...turn('b'),
      event('task_started', 'context'), message('user', '<environment_context>\n<cwd>/project</cwd>\n</environment_context>'),
      message('assistant', 'Contextual answer'), event('task_complete', 'context'),
      event('task_started', 'output'), message('assistant', 'Pure output'), event('task_complete', 'output'),
      event('task_started', 'empty'), event('task_complete', 'empty'), rollback()])
    const reference = await createHistoryReference(path)
    expect(reference.cutoffTurnId).toBe('codex:session-a:a')
    const page = await readHistoryPage(reference, { threadId: 'branch' })
    expect(page.turns).toHaveLength(1)
    const read = await readSourceHistory(reference, { operation: 'recent' })
    expect(JSON.stringify(read)).not.toContain('Answer b')
    expect(JSON.stringify(read)).not.toContain('Pure output')
  })

  it('counts valid user response items even when there is no visible text to project', async () => {
    await save([meta(), ...turn('a'), event('task_started', 'empty-input'),
      record('response_item', { type: 'message', role: 'user', content: [] }),
      message('assistant', 'Answer to an empty input'), event('task_complete', 'empty-input'), rollback()])
    expect((await inspectCodexSession(path)).cutoffs.map((entry) => entry.turnId)).toEqual(['codex:session-a:a'])
  })

  it('rolls back across parent history using the parent input classifications', async () => {
    const parent = join(root, 'rollout-parent.jsonl')
    const parentContent = encode([meta('parent', '/parent'), ...turn('a'), ...turn('b')])
    await writeFile(parent, parentContent)
    await save([meta('session-a', '/child', { history_base: { thread_id: 'parent', end_byte_offset: Buffer.byteLength(parentContent) } }),
      event('task_started', 'output'), message('assistant', 'Pure output'), event('task_complete', 'output'), rollback()])
    const inspected = await inspectCodexSession(path)
    expect(inspected.cutoffs.map((entry) => entry.turnId)).toEqual(['codex:parent:a'])
    expect((await createHistoryReference(path)).workspace).toBe('/parent')
  })

  it('drops all history when rollback exceeds the number of real inputs', async () => {
    await save([meta(), ...turn('a'), event('task_started', 'output'), message('assistant', 'Pure output'),
      event('task_complete', 'output'), rollback(3)])
    expect((await inspectCodexSession(path)).cutoffs).toEqual([])
  })

  it('preserves pure output before the first input even when rollback exceeds available inputs', async () => {
    const prefix = [meta(), event('task_started', 'prefix'), message('assistant', 'Initial output'), event('task_complete', 'prefix')]
    await save([...prefix, ...turn('a'), rollback(5)])
    expect((await inspectCodexSession(path)).cutoffs.map((entry) => entry.turnId)).toEqual(['codex:session-a:prefix'])
    await save([...prefix, rollback()])
    expect((await inspectCodexSession(path)).cutoffs.map((entry) => entry.turnId)).toEqual(['codex:session-a:prefix'])
  })

  it.each([
    '# AGENTS.md instructions for /project\n<INSTRUCTIONS>rules</INSTRUCTIONS>',
    '<ENVIRONMENT_CONTEXT>cwd</ENVIRONMENT_CONTEXT>', '<skill>instructions</skill>',
    '<user_shell_command>echo hello</user_shell_command>', '<turn_aborted>interrupted</turn_aborted>',
    '<subagent_notification>{}</subagent_notification>', '<recommended_plugins>available</recommended_plugins>',
    '<external_test>context</external_test>', '<codex_internal_context source="extension">hidden</codex_internal_context>',
    '<goal_context>goal</goal_context>', '<hook_prompt hook_run_id="hook-1">Retry</hook_prompt>',
    '<hook_prompt hook_run_id=" hook-1 ">Retry</hook_prompt>',
    '<hook_prompt hook_run_id="hook-1"/>', '<hook_prompt hook_run_id="hook-1"><![CDATA[Retry]]></hook_prompt>',
    'Warning: The maximum number of unified exec processes you can keep open is 64',
    'Warning: Your account was flagged for potentially high-risk cyber activity',
    'Warning: apply_patch was requested via exec_command. Use the apply_patch tool instead of exec_command.'
  ])('does not count a recognized contextual wrapper: %s', (text) => {
    expect(isCodexUserTurnBoundary(message('user', `  ${text}  `))).toBe(false)
  })

  it.each(['A normal question', '<project_context>user-supplied</project_context>',
    '<environment_context>missing close', '<codex_internal_context source="Extension">invalid</codex_internal_context>',
    '<external_test>mismatch</external_other>', '<hook_prompt hook_run_id="">Retry</hook_prompt>',
    '<hook_prompt hook_run_id="&#x20;">Retry</hook_prompt>'])('does not hide normal user input or malformed context: %s', (text) => {
    expect(isCodexUserTurnBoundary(message('user', text))).toBe(true)
  })

  it('only recognizes assistant JSON that matches the inter-agent communication contract', () => {
    expect(isCodexUserTurnBoundary(message('assistant', JSON.stringify(communication)))).toBe(true)
    expect(isCodexUserTurnBoundary(message('assistant', 'Ordinary answer'))).toBe(false)
    expect(isCodexUserTurnBoundary(message('assistant', JSON.stringify({ content: 'Ordinary answer' })))).toBe(false)
    expect(isCodexUserTurnBoundary(message('assistant', JSON.stringify({ ...communication, trigger_turn: 'yes' })))).toBe(false)
  })
})
