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
