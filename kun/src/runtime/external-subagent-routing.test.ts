import { describe, expect, test } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import {
  externalSubagentThreadId,
  externalSubagentTurnId,
  readExternalSubagent
} from '../contracts/external-subagent.js'
import type { TurnItem } from '../contracts/items.js'
import { makeAssistantTextItem, makeToolCallItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { AcpDraftEmitter } from './acp/acp-turn-emitter.js'
import { externalSubagentRouting, withExternalSubagentSettlement } from './external-subagent-routing.js'
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'

async function setup() {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  await threadStore.upsert(createThreadRecord({ id: 'thr_parent', title: 'Parent', workspace: '/repo', model: 'm' }))
  const recorded: RuntimeEventDraft[] = []
  const parentItems: TurnItem[] = []
  const finished: string[] = []
  const turns = {
    applyItem: async (_threadId: string, item: TurnItem) => { parentItems.push(item) },
    applyAssistantDelta: async () => undefined,
    updateItem: async (_threadId: string, _id: string, item: TurnItem) => { parentItems.push(item); return item },
    finishTurn: async (input: { threadId: string; turnId: string }) => { finished.push(input.turnId) }
  }
  const events = { record: async (draft: RuntimeEventDraft) => { recorded.push(draft); return draft as never } }
  const routing = externalSubagentRouting({ threadStore, sessionStore, events })
  return { threadStore, recorded, parentItems, finished, turns, events, routing }
}

const childThreadId = externalSubagentThreadId('thr_parent', 'call_task')

function taskCall(status: string): TurnItem {
  return {
    ...makeToolCallItem({
      id: 'item_task', turnId: 'turn_parent', threadId: 'thr_parent', callId: 'call_task',
      toolName: 'acp:other', toolKind: 'tool_call', arguments: { rawInput: { prompt: 'Trace replay', subagent_type: 'explore' } },
      status: 'running'
    }),
    meta: { externalSubagent: { version: 1, source: 'opencode', childThreadId, profile: 'explore', status } }
  } as TurnItem
}

describe('external subagent routing through the shared draft emitter', () => {
  test('parent items create the side thread and child drafts land on it', async () => {
    const { threadStore, recorded, parentItems, turns, events, routing } = await setup()
    const emitter = new AcpDraftEmitter({ turns, events, subagents: routing }, 'thr_parent', 'turn_parent')
    await emitter.emit({ kind: 'tool_call_started', threadId: 'thr_parent', turnId: 'turn_parent', item: taskCall('running') })
    const turnId = externalSubagentTurnId(childThreadId)
    const text = makeAssistantTextItem({ id: 'c1', turnId, threadId: childThreadId, text: 'found', status: 'completed' })
    await emitter.emit({ kind: 'item_created', threadId: childThreadId, turnId, itemId: 'c1', item: text })
    expect(parentItems.map((item) => item.id)).toEqual(['item_task'])
    const child = await threadStore.get(childThreadId)
    expect(child?.turns[0]?.items.map((item) => item.id)).toEqual([`${turnId}_prompt`, 'c1'])
    expect(child?.turns[0]?.items[0]).toMatchObject({ text: 'Trace replay' })
    expect(recorded.filter((draft) => draft.threadId === childThreadId).map((draft) => draft.kind))
      .toEqual(['turn_started', 'item_created', 'item_created'])
  })

  test('finishing a turn settles subagents that never reported back', async () => {
    const { threadStore, parentItems, finished, turns, routing } = await setup()
    await routing.applyItem('thr_parent', taskCall('running'), turns.applyItem)
    const wrapped = withExternalSubagentSettlement(turns, routing)
    await wrapped.finishTurn({ threadId: 'thr_parent', turnId: 'turn_parent' })
    expect(finished).toEqual(['turn_parent'])
    expect(readExternalSubagent((parentItems.at(-1) as { meta?: unknown }).meta)).toMatchObject({
      status: 'aborted', endedWithTurn: true
    })
    expect((await threadStore.get(childThreadId))?.turns[0]?.status).toBe('aborted')
  })
})
