import { describe, expect, test } from 'vitest'
import { SdkEventMapper } from './sdk-event-mapper.js'
import type { SdkMessage } from './sdk-protocol.js'
import {
  externalSubagentThreadId,
  externalSubagentTurnId,
  readExternalSubagent
} from '../../contracts/external-subagent.js'
import type { TurnItem } from '../../contracts/items.js'

function makeMapper(): SdkEventMapper {
  let n = 0
  return new SdkEventMapper({ threadId: 'th_1', turnId: 'tn_1', nextId: (prefix) => `${prefix}_${++n}` })
}

const agentCall = (input: Record<string, unknown>): SdkMessage => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_agent', name: 'Agent', input }] }
} as SdkMessage)

const itemOf = (draft: { item?: unknown }) => draft.item as TurnItem

describe('Claude Code subagents', () => {
  const childThreadId = externalSubagentThreadId('th_1', 'toolu_agent')

  test('the Agent call carries a running presentation pointing at its side thread', () => {
    const drafts = makeMapper().map(agentCall({ description: 'Trace SSE replay', prompt: 'Read the code', subagent_type: 'Explore' }))
    const presentation = readExternalSubagent((itemOf(drafts[0]!) as { meta?: unknown }).meta)
    expect(presentation).toMatchObject({
      source: 'claude-code',
      childThreadId,
      profile: 'Explore',
      label: 'Trace SSE replay',
      status: 'running',
      steps: 0
    })
  })

  test('subagent messages go to the side thread, not the parent answer', () => {
    const mapper = makeMapper()
    mapper.map(agentCall({ description: 'Trace', prompt: 'Read', subagent_type: 'Explore' }))
    const drafts = mapper.map({
      type: 'assistant',
      parent_tool_use_id: 'toolu_agent',
      message: {
        role: 'assistant',
        model: 'claude-haiku-4-5',
        content: [
          { type: 'text', text: 'Looking at the recorder.' },
          { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: 'kun/src/server/routes/events.ts' } }
        ]
      }
    } as SdkMessage)
    const child = drafts.filter((draft) => draft.threadId === childThreadId)
    expect(child.map((draft) => itemOf(draft as { item?: unknown }).kind)).toEqual(['assistant_text', 'tool_call'])
    expect(child.every((draft) => draft.turnId === externalSubagentTurnId(childThreadId))).toBe(true)
    const parent = drafts.filter((draft) => draft.threadId === 'th_1')
    expect(parent).toHaveLength(1)
    expect(readExternalSubagent((itemOf(parent[0] as { item?: unknown }) as { meta?: unknown }).meta)).toMatchObject({
      steps: 1,
      activity: 'Read kun/src/server/routes/events.ts',
      model: 'claude-haiku-4-5'
    })
  })

  test('parent progress updates are throttled', () => {
    let now = 0
    const mapper = makeMapper()
    ;(mapper as unknown as { subagents: { nowMs: () => number } }).subagents.nowMs = () => now
    mapper.map(agentCall({ description: 'Trace', prompt: 'Read' }))
    const step = (id: string) => ({
      type: 'assistant',
      parent_tool_use_id: 'toolu_agent',
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Grep', input: { pattern: 'seq' } }] }
    } as SdkMessage)
    now = 2_000
    expect(mapper.map(step('a')).filter((draft) => draft.threadId === 'th_1')).toHaveLength(1)
    now = 2_300
    expect(mapper.map(step('b')).filter((draft) => draft.threadId === 'th_1')).toHaveLength(0)
    now = 3_500
    const parent = mapper.map(step('c')).filter((draft) => draft.threadId === 'th_1')
    expect(readExternalSubagent((itemOf(parent[0] as { item?: unknown }) as { meta?: unknown }).meta)?.steps).toBe(3)
  })

  test('a foreground result completes the subagent with a clean summary', () => {
    const mapper = makeMapper()
    mapper.map(agentCall({ description: 'Trace', prompt: 'Read' }))
    const drafts = mapper.map({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_agent', content: 'The window is publish-before-persist.\nagentId: a123 (for resuming)' }]
      }
    } as SdkMessage)
    expect(readExternalSubagent((itemOf(drafts[0] as { item?: unknown }) as { meta?: unknown }).meta)).toMatchObject({
      status: 'completed',
      summary: 'The window is publish-before-persist.'
    })
  })

  test('a background launch stays running until its task notification', () => {
    const mapper = makeMapper()
    mapper.map(agentCall({ description: 'Count writes', prompt: 'Count', run_in_background: true }))
    const launched = mapper.map({
      type: 'user',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_agent', content: 'Async agent launched successfully.' }] }
    } as SdkMessage)
    expect(readExternalSubagent((itemOf(launched[0] as { item?: unknown }) as { meta?: unknown }).meta)).toMatchObject({
      status: 'running', detached: true
    })
    const done = mapper.map({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task_1',
      tool_use_id: 'toolu_agent',
      status: 'completed',
      summary: '7 write sites',
      usage: { total_tokens: 900, tool_uses: 11, duration_ms: 4200 }
    } as SdkMessage)
    expect(readExternalSubagent((itemOf(done[0] as { item?: unknown }) as { meta?: unknown }).meta)).toMatchObject({
      status: 'completed', summary: '7 write sites', steps: 11, durationMs: 4200, nativeId: 'task_1'
    })
  })

  test('messages of an unknown subagent are dropped instead of mixed into the parent', () => {
    const drafts = makeMapper().map({
      type: 'assistant',
      parent_tool_use_id: 'toolu_missing',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hidden' }] }
    } as SdkMessage)
    expect(drafts).toEqual([])
  })
})
