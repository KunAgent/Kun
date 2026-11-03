import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { AcpEventMapper } from './acp-event-mapper.js'
import { startOpenCodeChildSessions } from './opencode-child-sessions.js'
import {
  externalSubagentThreadId,
  externalSubagentTurnId,
  readExternalSubagent
} from '../../contracts/external-subagent.js'
import type { TurnItem } from '../../contracts/items.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

const mapper = (mirrorSteps = true) => {
  let n = 0
  return new AcpEventMapper({
    threadId: 'thr_kun', turnId: 'turn_kun', nextId: (p) => `${p}_${++n}`,
    subagents: { source: 'opencode', mirrorSteps }
  })
}
const presentationOf = (draft: RuntimeEventDraft | undefined) =>
  readExternalSubagent(((draft as { item?: TurnItem } | undefined)?.item as { meta?: unknown } | undefined)?.meta)
const items = (drafts: RuntimeEventDraft[]) => drafts.filter((draft) => 'item' in draft && draft.item)
const update = (toolCallId: string, fields: Record<string, unknown>) => ({ sessionUpdate: 'tool_call_update', toolCallId, kind: 'other', ...fields })

describe('ACP subagents (OpenCode family)', () => {
  test('an OpenCode task call becomes a card and completes with the task_result text', () => {
    const m = mapper()
    m.apply({ sessionUpdate: 'tool_call', toolCallId: 'call_task', title: 'task', kind: 'other', status: 'pending', rawInput: {} })
    const running = items(m.apply(update('call_task', {
      status: 'in_progress', title: 'task',
      rawInput: { description: 'Trace SSE replay', prompt: 'Read the code', subagent_type: 'explore' }
    })))
    expect(presentationOf(running.at(-1))).toMatchObject({
      source: 'opencode', profile: 'explore', label: 'Trace SSE replay', status: 'running',
      childThreadId: externalSubagentThreadId('thr_kun', 'call_task')
    })
    const done = items(m.apply(update('call_task', {
      status: 'completed', title: 'Trace SSE replay',
      content: [{ type: 'content', content: { type: 'text', text: 'Publish before persist.\n\n<task_metadata>\nsession_id: ses_child\n</task_metadata>' } }],
      rawOutput: { output: 'x', metadata: { sessionId: 'ses_child', summary: [{}, {}, {}], model: { modelID: 'deepseek-v4-flash' } } }
    })))
    expect(presentationOf(done.at(-1))).toMatchObject({
      status: 'completed', summary: 'Publish before persist.', nativeId: 'ses_child', steps: 3, model: 'deepseek-v4-flash'
    })
  })

  test('background tasks stay running; output and cancel calls fold into the card', () => {
    const m = mapper(false)
    m.apply({ sessionUpdate: 'tool_call', toolCallId: 'call_bg', title: 'background_task', kind: 'other', status: 'in_progress',
      rawInput: { description: 'Count writes', prompt: 'Count', agent: 'explore' } })
    const launched = items(m.apply(update('call_bg', {
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'Background task launched successfully.\n\nTask ID: bg_1\nSession ID: ses_bg\nAgent: explore\nStatus: running' } }]
    })))
    expect(presentationOf(launched.at(-1))).toMatchObject({ status: 'running', detached: true, nativeId: 'ses_bg' })
    expect(presentationOf(launched.at(-1))?.childThreadId).toBeUndefined()

    expect(items(m.apply({ sessionUpdate: 'tool_call', toolCallId: 'call_out', title: 'background_output', kind: 'other', status: 'pending', rawInput: {} }))).toEqual([])
    const checked = items(m.apply(update('call_out', {
      status: 'completed', rawInput: { task_id: 'bg_1' },
      content: [{ type: 'content', content: { type: 'text', text: '| Status | **running** |\n| Last tool | websearch |' } }]
    })))
    expect(checked).toHaveLength(1)
    expect(presentationOf(checked[0])).toMatchObject({ progressChecks: 1, activity: 'websearch', status: 'running' })

    m.apply({ sessionUpdate: 'tool_call', toolCallId: 'call_cancel', title: 'background_cancel', kind: 'other', status: 'in_progress', rawInput: { all: true } })
    const cancelled = items(m.apply(update('call_cancel', { status: 'completed', content: [] })))
    expect(presentationOf(cancelled[0])).toMatchObject({ status: 'aborted', closedByParent: true })
  })

  test('a task interrupted at turn end is marked as ended with the turn', () => {
    const m = mapper()
    m.apply(update('call_task', { status: 'in_progress', rawInput: { description: 'Trace', prompt: 'Read', subagent_type: 'explore' } }))
    expect(presentationOf(items(m.flush()).at(-1))).toMatchObject({ status: 'aborted', endedWithTurn: true })
  })

  test('ordinary ACP tools are untouched', () => {
    const drafts = items(mapper().apply({ sessionUpdate: 'tool_call', toolCallId: 'r', title: 'read', kind: 'read', status: 'in_progress', rawInput: { filePath: 'a.ts' } }))
    expect(presentationOf(drafts[0])).toBeUndefined()
  })
})

describe('ACP subagents (Devin)', () => {
  test('run_subagent becomes a card and read_subagent folds into it', () => {
    let n = 0
    const m = new AcpEventMapper({ threadId: 'thr_kun', turnId: 'turn_kun', nextId: (p) => `${p}_${++n}`, subagents: { source: 'devin', mirrorSteps: false } })
    const started = items(m.apply({ sessionUpdate: 'tool_call', toolCallId: 'run_1', title: 'run_subagent', kind: 'other', status: 'in_progress',
      rawInput: { profile: 'sidekick', task: 'Count events.jsonl writes', is_background: true } }))
    expect(presentationOf(started.at(-1))).toMatchObject({ source: 'devin', profile: 'sidekick', label: 'Count events.jsonl writes', detached: true })
    m.apply({ sessionUpdate: 'tool_call', toolCallId: 'read_1', title: 'read_subagent', kind: 'other', status: 'in_progress', rawInput: {} })
    const read = items(m.apply(update('read_1', { status: 'completed', content: [] })))
    expect(read).toHaveLength(1)
    expect(presentationOf(read[0])).toMatchObject({ progressChecks: 1 })
  })
})

describe('OpenCode child session reader', () => {
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  test('mirrors the child session found by parent id into the side thread', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kun-oc-'))
    dirs.push(dir)
    const dbPath = join(dir, 'opencode.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, time_created INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_updated INTEGER, data TEXT);`)
    db.prepare('INSERT INTO session VALUES (?, ?, ?, ?)').run('ses_child', 'ses_acp', 'Trace SSE replay (@explore subagent)', 1)
    db.prepare('INSERT INTO message VALUES (?, ?, ?)').run('msg_a', 'ses_child', JSON.stringify({ role: 'assistant', modelID: 'deepseek-v4-flash' }))
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)').run('prt_1', 'msg_a', 'ses_child', 10, JSON.stringify({
      type: 'tool', tool: 'grep', callID: 'c1', state: { status: 'completed', input: { pattern: 'highestSeq' }, output: '6 matches' }
    }))
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)').run('prt_2', 'msg_a', 'ses_child', 11, JSON.stringify({
      type: 'text', text: 'Found the window.', time: { end: 11 }
    }))
    db.close()

    const m = mapper()
    m.apply(update('call_task', { status: 'in_progress', rawInput: { description: 'Trace SSE replay', prompt: 'Read', subagent_type: 'explore' } }))
    const emitted: RuntimeEventDraft[] = []
    const reader = startOpenCodeChildSessions({ dbPath, acpSessionId: 'ses_acp', tracker: m.subagents!, emit: (d) => emitted.push(...d), intervalMs: 60_000 })
    await reader.stop()
    const childThreadId = externalSubagentThreadId('thr_kun', 'call_task')
    const child = emitted.filter((draft) => draft.threadId === childThreadId)
    expect(child.map((draft) => draft.kind)).toEqual(['tool_call_started', 'tool_call_finished', 'item_created'])
    expect(child.every((draft) => draft.turnId === externalSubagentTurnId(childThreadId))).toBe(true)
    const parent = emitted.filter((draft) => draft.threadId === 'thr_kun')
    expect(presentationOf(parent[0])).toMatchObject({ steps: 1, activity: 'grep highestSeq', model: 'deepseek-v4-flash', nativeId: 'ses_child' })
  })
})
