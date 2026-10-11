import { describe, expect, it } from 'vitest'
import { createThreadRecord } from '../../domain/thread.js'
import {
  filterThreadSummaries,
  rowFromIndexRecord,
  summaryFromRow
} from './hybrid-thread-index-mapping.js'
import type { ThreadSummary } from '../../contracts/threads.js'

function summary(id: string, workspace: string): ThreadSummary {
  return createThreadRecord({ id, title: id, workspace, model: 'm' }) as unknown as ThreadSummary
}

describe('hybrid thread index mapping', () => {
  it('projects the indexed event high-water mark into lean summaries', () => {
    const thread = createThreadRecord({
      id: 'thread-activity', historyRefId: 'history-source', title: 'Activity', workspace: '/tmp/project', model: 'model'
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

    expect(summaryFromRow(row)).toMatchObject({ id: thread.id, historyRefId: 'history-source', latestSeq: 17 })
  })

  it('carries the accepted turn count so New task can spot an empty thread from the list', () => {
    const paths = { metadataPath: '/tmp/m.jsonl', messagesPath: '/tmp/msg.jsonl', eventsPath: '/tmp/e.jsonl' }
    const empty = createThreadRecord({ id: 'thread-empty', title: '', workspace: '/tmp/project', model: 'model' })
    expect(summaryFromRow(rowFromIndexRecord({ thread: empty, messageCount: 0, eventSeqHighWater: 0, preview: '' }, paths)))
      .toMatchObject({ turnCount: 0 })
    const used = { ...empty, id: 'thread-used', turns: [{ id: 'turn-1' }, { id: 'turn-2' }] } as unknown as typeof empty
    expect(summaryFromRow(rowFromIndexRecord({ thread: used, messageCount: 0, eventSeqHighWater: 0, preview: '' }, paths)))
      .toMatchObject({ turnCount: 2 })
    // Rows indexed before the field existed report it as unknown, never as empty.
    const legacy = { ...rowFromIndexRecord({ thread: used, messageCount: 0, eventSeqHighWater: 0, preview: '' }, paths),
      extension_metadata_json: JSON.stringify({ summaryMetadataVersion: 1 }) }
    expect(summaryFromRow(legacy).turnCount).toBeUndefined()
  })

  it('matches a thread when its workspace equals any listed root', () => {
    const threads = [
      summary('main', '/repo'),
      summary('worktree', '/home/u/.kun/worktrees/ab12/repo'),
      summary('other', '/elsewhere')
    ]
    const filtered = filterThreadSummaries(threads, {
      workspace: '/repo',
      workspaces: ['/home/u/.kun/worktrees/ab12/repo']
    })
    expect(filtered.map((thread) => thread.id).sort()).toEqual(['main', 'worktree'])
  })
})
