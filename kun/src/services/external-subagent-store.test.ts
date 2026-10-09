import { describe, expect, test } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import {
  externalSubagentThreadId,
  externalSubagentTurnId,
  type ExternalSubagentPresentation
} from '../contracts/external-subagent.js'
import type { TurnItem } from '../contracts/items.js'
import { createThreadRecord } from '../domain/thread.js'
import { makeAssistantTextItem, makeToolCallItem } from '../domain/item.js'
import { ExternalSubagentStore } from './external-subagent-store.js'
import type { RuntimeEventDraft } from './runtime-event-recorder.js'

async function setup() {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const events: RuntimeEventDraft[] = []
  await threadStore.upsert(createThreadRecord({ id: 'thr_parent', title: 'Parent', workspace: '/repo', model: 'claude-sonnet-4-5' }))
  const store = new ExternalSubagentStore({
    threadStore,
    sessionStore,
    events: { record: async (draft) => { events.push(draft) } },
    nowIso: () => '2026-10-10T00:00:00.000Z'
  })
  return { threadStore, sessionStore, events, store }
}

const childThreadId = externalSubagentThreadId('thr_parent', 'call_1')

function parentCall(presentation: Partial<ExternalSubagentPresentation>): TurnItem {
  return {
    ...makeToolCallItem({
      id: 'item_call_1',
      turnId: 'turn_parent',
      threadId: 'thr_parent',
      callId: 'call_1',
      toolName: 'Agent',
      toolKind: 'tool_call',
      arguments: { description: 'Trace', prompt: 'Trace the SSE replay path' },
      status: 'running'
    }),
    meta: {
      externalSubagent: {
        version: 1,
        source: 'claude-code',
        childThreadId,
        profile: 'Explore',
        label: 'Trace',
        status: 'running',
        ...presentation
      }
    }
  } as TurnItem
}

describe('ExternalSubagentStore', () => {
  test('first sight creates a hidden side thread whose turn starts with the delegated prompt', async () => {
    const { threadStore, sessionStore, events, store } = await setup()
    await store.syncParentItem(parentCall({}))
    const child = await threadStore.get(childThreadId)
    expect(child).toMatchObject({
      relation: 'side',
      parentThreadId: 'thr_parent',
      harnessId: 'claude-code',
      agentId: 'Explore',
      workspace: '/repo',
      status: 'running',
      title: 'Trace'
    })
    expect(child!.turns[0]!.items[0]).toMatchObject({ kind: 'user_message', text: 'Trace the SSE replay path' })
    expect(await sessionStore.loadItems(childThreadId)).toHaveLength(1)
    expect(events.map((event) => event.kind)).toEqual(['turn_started', 'item_created'])
  })

  test('child items are persisted on the side thread and a terminal status closes its turn', async () => {
    const { threadStore, events, store } = await setup()
    await store.syncParentItem(parentCall({}))
    const turnId = externalSubagentTurnId(childThreadId)
    const text = makeAssistantTextItem({ id: 'child_text', turnId, threadId: childThreadId, text: 'Found it', status: 'completed' })
    await store.apply({ kind: 'item_created', threadId: childThreadId, turnId, itemId: text.id, item: text })
    await store.syncParentItem(parentCall({ status: 'completed', summary: 'Found it' }))
    const child = await threadStore.get(childThreadId)
    expect(child!.status).toBe('idle')
    expect(child!.turns[0]).toMatchObject({ status: 'completed' })
    expect(child!.turns[0]!.items.map((item) => item.id)).toEqual([`${turnId}_prompt`, 'child_text'])
    expect(events.map((event) => event.kind)).toEqual(['turn_started', 'item_created', 'item_created', 'turn_completed'])
  })

  test('drafts for an unknown child are ignored', async () => {
    const { events, store } = await setup()
    const text = makeAssistantTextItem({ id: 'x', turnId: 't', threadId: childThreadId, text: 'orphan', status: 'completed' })
    await store.apply({ kind: 'item_created', threadId: childThreadId, turnId: 't', itemId: 'x', item: text })
    expect(events).toEqual([])
  })

  test('open children of a finished parent turn are settled as ended with the turn', async () => {
    const { store } = await setup()
    await store.syncParentItem(parentCall({ detached: true }))
    const settled = store.settleOpenChildren('thr_parent', 'turn_parent')
    expect(settled).toHaveLength(1)
    expect((settled[0] as { meta?: Record<string, unknown> }).meta?.externalSubagent).toMatchObject({
      status: 'aborted', endedWithTurn: true
    })
    await store.syncParentItem(settled[0]!)
    expect(store.settleOpenChildren('thr_parent', 'turn_parent')).toEqual([])
  })
})
