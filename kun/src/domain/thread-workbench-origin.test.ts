import { describe, expect, it } from 'vitest'
import { ThreadListSummarySchema, ThreadSchema, CreateThreadRequest } from '../contracts/threads.js'
import { rowFromIndexRecord, summaryFromRow } from '../adapters/hybrid/hybrid-thread-index-mapping.js'
import { createThreadRecord, toThreadSummary } from './thread.js'

const origin = { kind: 'bot' as const, roomId: 'room-1', linkId: 'link-1', agentId: 'agent-1', agentName: 'Bot', messageId: 'card-1' }

describe('thread workbench origin', () => {
  it('is written by the host, persisted, and shown in summaries', () => {
    const thread = createThreadRecord({ id: 't1', title: 'Fix SSE', workspace: '/w', model: 'm', workbenchOrigin: origin })
    expect(ThreadSchema.parse(thread).workbenchOrigin).toEqual(origin)
    expect(toThreadSummary(thread).workbenchOrigin).toEqual(origin)
    expect(ThreadListSummarySchema.parse({ ...toThreadSummary(thread) }).workbenchOrigin).toEqual(origin)
    expect(createThreadRecord({ id: 't2', title: 'Plain', workspace: '/w', model: 'm' }).workbenchOrigin).toBeUndefined()
  })

  it('survives the hybrid index round trip used by the sidebar list', () => {
    const thread = createThreadRecord({ id: 't1', title: 'Fix SSE', workspace: '/w', model: 'm', workbenchOrigin: origin })
    const row = rowFromIndexRecord({ thread, messageCount: 0, eventSeqHighWater: 0, preview: '' },
      { metadataPath: 'm', messagesPath: 'x', eventsPath: 'e' })
    expect(summaryFromRow(row).workbenchOrigin).toEqual(origin)
    const plain = createThreadRecord({ id: 't2', title: 'Plain', workspace: '/w', model: 'm' })
    expect(summaryFromRow(rowFromIndexRecord({ thread: plain, messageCount: 0, eventSeqHighWater: 0, preview: '' },
      { metadataPath: 'm', messagesPath: 'x', eventsPath: 'e' })).workbenchOrigin).toBeUndefined()
  })

  it('is never accepted from a create-thread request', () => {
    const parsed = CreateThreadRequest.safeParse({ workspace: '/w', model: 'm', workbenchOrigin: origin })
    expect(parsed.success ? 'workbenchOrigin' in parsed.data : false).toBe(false)
  })
})
