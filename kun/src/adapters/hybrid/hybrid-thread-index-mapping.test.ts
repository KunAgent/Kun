import { describe, expect, it } from 'vitest'
import { createThreadRecord } from '../../domain/thread.js'
import {
  rowFromIndexRecord,
  summaryFromRow
} from './hybrid-thread-index-mapping.js'

describe('hybrid thread index mapping', () => {
  it('projects the indexed event high-water mark into lean summaries', () => {
    const thread = createThreadRecord({
      id: 'thread-activity', title: 'Activity', workspace: '/tmp/project', model: 'model'
    })
    const row = rowFromIndexRecord({
      thread,
      messageCount: 0,
      eventSeqHighWater: 17,
      preview: ''
    }, {
      metadataPath: '/tmp/metadata.jsonl',
      messagesPath: '/tmp/messages.jsonl',
      eventsPath: '/tmp/events.jsonl'
    })

    expect(summaryFromRow(row)).toMatchObject({ id: thread.id, latestSeq: 17 })
  })
})
