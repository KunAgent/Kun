import { describe, expect, test } from 'vitest'
import { CodexEventMapper } from './codex-event-mapper.js'
import {
  externalSubagentThreadId,
  externalSubagentTurnId,
  readExternalSubagent
} from '../../contracts/external-subagent.js'
import type { TurnItem } from '../../contracts/items.js'

const mapper = () => new CodexEventMapper({ threadId: 'thr_kun', turnId: 'turn_kun', codexThreadId: 'cx_parent' })
const presentationOf = (draft: unknown) => readExternalSubagent(((draft as { item: TurnItem }).item as { meta?: unknown }).meta)

const spawn = (status: 'inProgress' | 'completed', receivers: string[] = []) => ({
  threadId: 'cx_parent',
  item: {
    type: 'collabAgentToolCall',
    id: 'call_spawn',
    tool: 'spawnAgent',
    status,
    senderThreadId: 'cx_parent',
    receiverThreadIds: receivers,
    prompt: 'Trace the SSE replay path\nRead only.',
    model: 'gpt-6.1-sol',
    reasoningEffort: null,
    agentsStates: receivers.length ? { cx_child: { status: 'running', message: null } } : {}
  }
})

describe('Codex subagents', () => {
  const childThreadId = externalSubagentThreadId('thr_kun', 'call_spawn')

  test('spawnAgent becomes a subagent card bound to the spawned thread', () => {
    const m = mapper()
    const started = m.mapNotification('item/started', spawn('inProgress'))
    expect(started[0]).toMatchObject({ kind: 'tool_call_started' })
    expect(presentationOf(started[0])).toMatchObject({
      source: 'codex', childThreadId, label: 'Trace the SSE replay path', model: 'gpt-6.1-sol', status: 'queued', detached: true
    })
    const completed = m.mapNotification('item/completed', spawn('completed', ['cx_child']))
    expect(presentationOf(completed[0])).toMatchObject({ status: 'running', nativeId: 'cx_child' })
  })

  test('wait and close fold into the card instead of rendering their own rows', () => {
    const m = mapper()
    m.mapNotification('item/started', spawn('inProgress'))
    m.mapNotification('item/completed', spawn('completed', ['cx_child']))
    const wait = (status: string) => ({
      threadId: 'cx_parent',
      item: {
        type: 'collabAgentToolCall', id: `call_wait_${status}`, tool: 'wait', status: 'completed',
        senderThreadId: 'cx_parent', receiverThreadIds: ['cx_child'], prompt: null, model: null, reasoningEffort: null,
        agentsStates: { cx_child: { status, message: status === 'completed' ? '7 write sites' : null } }
      }
    })
    expect(m.mapNotification('item/started', wait('running'))).toEqual([])
    const first = m.mapNotification('item/completed', wait('running'))
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ kind: 'item_updated', itemId: 'cx_call_spawn_result' })
    expect(presentationOf(first[0])).toMatchObject({ progressChecks: 1, status: 'running' })
    const done = m.mapNotification('item/completed', wait('completed'))
    expect(presentationOf(done[0])).toMatchObject({ progressChecks: 2, status: 'completed', summary: '7 write sites' })
  })

  test('the spawned thread’s items go to the side thread and its completion settles the card', () => {
    const m = mapper()
    m.mapNotification('item/started', spawn('inProgress'))
    m.mapNotification('item/completed', spawn('completed', ['cx_child']))
    const tool = m.mapNotification('item/started', {
      threadId: 'cx_child',
      item: { type: 'commandExecution', id: 'cmd_1', command: 'rg highestSeq', cwd: '/repo' }
    })
    const child = tool.filter((draft) => draft.threadId === childThreadId)
    expect(child).toHaveLength(1)
    expect(child[0]!.turnId).toBe(externalSubagentTurnId(childThreadId))
    const parent = tool.filter((draft) => draft.threadId === 'thr_kun')
    expect(presentationOf(parent[0])).toMatchObject({ steps: 1, activity: 'shell rg highestSeq' })
    m.mapNotification('item/completed', {
      threadId: 'cx_child',
      item: { type: 'agentMessage', id: 'msg_1', text: 'Publish happens before persist.' }
    })
    const finished = m.mapNotification('turn/completed', { threadId: 'cx_child', turn: { id: 't', status: 'completed' } })
    expect(presentationOf(finished[0])).toMatchObject({ status: 'completed', summary: 'Publish happens before persist.' })
  })

  test('other threads and collab calls on unknown agents keep the old behavior', () => {
    const m = mapper()
    expect(m.mapNotification('item/started', {
      threadId: 'cx_other', item: { type: 'commandExecution', id: 'x', command: 'ls' }
    })).toEqual([])
    const unknownWait = m.mapNotification('item/started', {
      threadId: 'cx_parent',
      item: { type: 'collabAgentToolCall', id: 'w', tool: 'wait', receiverThreadIds: ['cx_ghost'] }
    })
    expect(unknownWait[0]).toMatchObject({ kind: 'tool_call_started' })
  })
})
