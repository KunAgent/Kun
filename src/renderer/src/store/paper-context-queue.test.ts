import { describe, expect, it } from 'vitest'
import { createPaperTurnContext } from '@shared/paper/paper-turn-context'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'
import { queuedMessageGuidancePayload } from './queued-message-guidance'
import { canRestoreQueuedMessageToComposer } from './queued-message-edit'

const paper = () => createPaperTurnContext({ version: 1, scope: 'current-paper', privacy: 'model-provider',
  providerId: 'chosen-api', model: 'chosen-model', purpose: 'Understand the method', maxModelRequests: 1,
  sources: [{ paperId: 'p1', title: 'Title', locator: 'p4', text: 'Frozen source', sourceVersion: 'v1' }] })

describe('paper context queue', () => {
  it('keeps exact context through reload and refuses context-losing guidance/edit', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const context = paper()
    saveQueuedMessagesForThread('paper-thread', [{ id: 'q-paper', text: 'Explain', paperContext: context }], storage)
    context.sources[0].text = 'Changed after queueing'
    const queued = queuedMessagesForThread('paper-thread', storage)
    expect(queued[0].paperContext).toEqual(paper())
    expect(queuedMessageGuidancePayload(queued[0])).toBeNull()
    expect(canRestoreQueuedMessageToComposer(queued[0])).toBe(false)
  })
})
