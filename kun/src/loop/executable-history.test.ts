import { effectiveHistoryAfterLatestCompaction } from './compaction-history.js'
import { describe, expect, it } from 'vitest'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { makeUserItem, makeCompactionItem } from '../domain/item.js'
import { executableHistory } from './executable-history.js'

const turn = (id: string, status: 'queued' | 'running' | 'completed') =>
  createTurnRecord({ id, threadId: 'thread', prompt: id, status })
const item = (id: string, turnId = id) => makeUserItem({ id, turnId, threadId: 'thread', text: id })

describe('executable history ordering', () => {
  it('replays admitted order without exposing queued inputs or moving unmapped records', () => {
    const thread = { ...createThreadRecord({ id: 'thread', title: '', workspace: '/tmp', model: 'test' }),
      turns: [turn('A', 'completed'), turn('recovery', 'completed'), { ...turn('B', 'running'), queueExecutionAnchorItemId: 'recovery-2' }, turn('C', 'queued')] }
    const history = [item('inherited'), item('A'), item('B'), item('C'), item('recovery'), item('recovery-2', 'recovery'), item('B-2', 'B')]
    expect(executableHistory(history, thread).map((entry) => entry.id)).toEqual([
      'inherited', 'A', 'recovery', 'recovery-2', 'B', 'B-2'
    ])
    expect(history[2]?.id).toBe('B')
  })
  it('does not change an already ordered history or discard items absent from metadata', () => {
    const thread = { ...createThreadRecord({ id: 'thread', title: '', workspace: '/tmp', model: 'test' }),
      turns: [turn('A', 'completed'), turn('B', 'running')] }
    const history = [item('A'), item('inherited'), item('B')]
    expect(executableHistory(history, thread)).toEqual(history)
    expect(executableHistory(history, null)).toBe(history)
  })
})

describe('queued execution anchor boundaries', () => {
  it('preserves every unrelated record and boundary while relocating the promoted input', () => {
    const thread = { ...createThreadRecord({ id: 'thread', title: '', workspace: '/tmp', model: 'test' }),
      turns: [turn('A', 'completed'), { ...turn('B', 'running'), queueExecutionAnchorItemId: 'anchor' }] }
    const history = [item('A'), item('B'), item('old-cut'), item('anchor', 'A'), item('new-cut'), item('B-tool', 'B')]
    const projected = executableHistory(history, thread)
    expect(projected.map((entry) => entry.id)).toEqual(['A', 'old-cut', 'anchor', 'B', 'new-cut', 'B-tool'])
    expect(projected.filter((entry) => entry.turnId !== 'B')).toEqual(history.filter((entry) => entry.turnId !== 'B'))
  })
  it.each(['queue_cancelled', 'queue_admission_failed', 'write_context_stale'])('excludes never-executed %s input', (terminalCode) => {
    const thread = { ...createThreadRecord({ id: 'thread', title: '', workspace: '/tmp', model: 'test' }),
      turns: [{ ...turn('B', 'completed'), status: 'failed' as const, terminalCode }] }
    expect(executableHistory([item('B')], thread)).toEqual([])
  })
})

describe('promoted turn compaction marker', () => {
  it('never relocates the summary across its deliberately retained history', () => {
    const thread = { ...createThreadRecord({ id: 'thread', title: '', workspace: '/tmp', model: 'test' }),
      turns: [turn('A', 'completed'), { ...turn('B', 'running'), queueExecutionAnchorItemId: 'A-final' }] }
    const summary = makeCompactionItem({ id: 'B-summary', threadId: 'thread', turnId: 'B', summary: 'old work', replacedTokens: 100, pinnedConstraints: [] })
    const history = [item('A-old', 'A'), summary, item('A-retained', 'A'), item('A-final', 'A'), item('B')]
    const projected = executableHistory(history, thread)
    expect(projected).toEqual(history)
    expect(effectiveHistoryAfterLatestCompaction(projected).map((entry) => entry.id))
      .toEqual(['B-summary', 'A-retained', 'A-final', 'B'])
  })
})
