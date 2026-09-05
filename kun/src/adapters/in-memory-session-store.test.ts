import { describe, expect, it } from 'vitest'
import { makeAssistantReasoningItem, makeAssistantTextItem } from '../domain/item.js'
import { InMemorySessionStore } from './in-memory-session-store.js'

describe('InMemorySessionStore live item rewrites', () => {
  it('does not restore a live-only item omitted by a full rewrite', async () => {
    const store = new InMemorySessionStore()
    const threadId = 'thread_live_rewrite_remove'
    await store.checkpointLiveItem(threadId, makeAssistantReasoningItem({
      id: 'reasoning_removed',
      threadId,
      turnId: 'turn_removed',
      text: 'stale reasoning',
      status: 'running'
    }), 4)

    await store.rewriteItems(threadId, [])

    const snapshot = await store.loadItemSnapshot(threadId)
    expect(snapshot.items).toEqual([])
    expect(snapshot).not.toHaveProperty('replayAfterSeq')
  })

  it('drops terminal checkpoints and preserves included nonterminal checkpoints', async () => {
    const store = new InMemorySessionStore()
    const threadId = 'thread_live_rewrite_terminal'
    const terminalLive = makeAssistantTextItem({
      id: 'assistant_terminal',
      threadId,
      turnId: 'turn_terminal',
      text: 'partial terminal answer',
      status: 'running'
    })
    const retainedLive = makeAssistantReasoningItem({
      id: 'reasoning_retained',
      threadId,
      turnId: 'turn_active',
      text: 'active reasoning',
      status: 'running'
    })
    await store.checkpointLiveItem(threadId, terminalLive, 6)
    await store.checkpointLiveItem(threadId, retainedLive, 9)
    const before = await store.loadItemSnapshot(threadId)
    const terminal = makeAssistantTextItem({
      ...terminalLive,
      text: 'settled terminal answer',
      status: 'failed'
    })

    await expect(store.rewriteItemsIfRevision(
      threadId,
      before.revision,
      [terminal, retainedLive]
    )).resolves.toMatchObject({ applied: true })

    const snapshot = await store.loadItemSnapshot(threadId)
    expect(snapshot.items).toMatchObject([
      { id: terminal.id, text: 'settled terminal answer', status: 'failed' },
      { id: retainedLive.id, text: 'active reasoning', status: 'running' }
    ])
    expect(snapshot.replayAfterSeq).toBe(9)
  })
})
