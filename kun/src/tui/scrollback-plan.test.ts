import { describe, expect, it } from 'vitest'
import { ScrollbackPlanner } from './scrollback-plan.js'
import type { TranscriptEntry } from './transcript-model.js'

function entry(key: string, settled: boolean, kind: 'reply-header' | 'user' = 'reply-header', turnId = `turn_${key}`): TranscriptEntry {
  if (kind === 'user') {
    return {
      kind: 'item', key, settled, separated: true, turnRunning: false, reasoningRunning: false,
      showReasoning: false, userAttachmentIds: [],
      item: { id: key, turnId, threadId: 't', role: 'user', status: 'completed', createdAt: '', kind: 'user_message', text: key }
    } as TranscriptEntry
  }
  return { kind: 'reply-header', key, turnId, settled, separated: false }
}

describe('ScrollbackPlanner', () => {
  it('writes a thread header once, then settled entries strictly in order', () => {
    const planner = new ScrollbackPlanner()
    const first = planner.plan('thr', 'Title', [entry('a', true), entry('b', false), entry('c', true)])
    expect(first.commits.map((commit) => commit.kind === 'entry' ? commit.entry.key : commit.kind)).toEqual(['thread-header', 'a'])
    // An unsettled entry blocks everything after it, even settled ones.
    expect(first.live.map((item) => item.key)).toEqual(['b', 'c'])

    const second = planner.plan('thr', 'Title', [entry('a', true), entry('b', true), entry('c', true)])
    expect(second.commits.map((commit) => commit.kind === 'entry' ? commit.entry.key : commit.kind)).toEqual(['b', 'c'])
    expect(second.live).toEqual([])
    expect(planner.plan('thr', 'Title', [entry('a', true), entry('b', true), entry('c', true)]).commits).toEqual([])
  })

  it('marks only the first written entry as first', () => {
    const planner = new ScrollbackPlanner()
    const plan = planner.plan('thr', 'Title', [entry('a', true), entry('b', true)])
    expect(plan.commits.flatMap((commit) => commit.kind === 'entry' ? [commit.first] : [])).toEqual([true, false])
  })

  it('replays from scratch on a thread switch or reset', () => {
    const planner = new ScrollbackPlanner()
    planner.plan('one', 'One', [entry('a', true)])
    const switched = planner.plan('two', 'Two', [entry('x', true)])
    expect(switched.commits[0]).toMatchObject({ kind: 'thread-header', threadId: 'two', title: 'Two' })
    planner.reset()
    const replay = planner.plan('two', 'Two', [entry('x', true)])
    expect(replay.commits.map((commit) => commit.kind === 'entry' ? commit.entry.key : commit.kind)).toEqual(['thread-header', 'x'])
  })

  it('replays only the recent tail of very long threads, starting at a turn boundary', () => {
    const planner = new ScrollbackPlanner(3)
    const entries = [
      entry('u1', true, 'user', 't1'), entry('r1', true, 'reply-header', 't1'),
      entry('u2', true, 'user', 't2'), entry('r2', true, 'reply-header', 't2'), entry('x', true, 'reply-header', 't2')
    ]
    const plan = planner.plan('thr', 'Long', entries)
    expect(plan.commits[0]).toMatchObject({ kind: 'thread-header', omitted: 1 })
    expect(plan.commits.slice(1).map((commit) => commit.kind === 'entry' ? commit.entry.key : '')).toEqual(['u2', 'r2', 'x'])
  })

  it('writes nothing without a thread', () => {
    expect(new ScrollbackPlanner().plan(undefined, '', [entry('a', true)])).toEqual({ commits: [], live: [] })
  })
})
