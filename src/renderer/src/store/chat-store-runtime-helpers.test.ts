import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { hasPendingRuntimeWork, threadSnapshotLooksRunning } from './chat-store-runtime-helpers'

describe('chat-store-runtime-helpers compaction state', () => {
  it('keeps the thread busy while a compaction item is running', () => {
    const runningCompaction: ChatBlock = {
      kind: 'compaction',
      id: 'compact-running',
      summary: 'Compacting context',
      status: 'running'
    }
    const completedCompaction: ChatBlock = {
      kind: 'compaction',
      id: 'compact-completed',
      summary: 'Compacted context',
      status: 'success'
    }

    expect(hasPendingRuntimeWork(runningCompaction)).toBe(true)
    expect(hasPendingRuntimeWork(completedCompaction)).toBe(false)
    expect(threadSnapshotLooksRunning([runningCompaction])).toBe(true)
    expect(threadSnapshotLooksRunning([completedCompaction])).toBe(false)
  })
})
