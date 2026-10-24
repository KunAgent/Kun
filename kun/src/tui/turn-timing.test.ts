import { describe, expect, it } from 'vitest'
import type { RuntimeEvent, UsageEvent } from '../contracts/events.js'
import { ThreadSchema } from '../contracts/threads.js'
import type { ThreadDetail } from './client.js'
import { applyRuntimeEvent, projectThreadSnapshot } from './state.js'
import { withTurnFooters } from './transcript-trail.js'
import type { ThreadUsageBucket } from '../contracts/usage.js'
import { threadUsageSummary, turnTimingFromUsageEvent, turnTimingParts } from './turn-timing.js'

function usageEvent(overrides: Omit<Partial<UsageEvent>, 'usage'> & { usage?: Partial<UsageEvent['usage']> } = {}): UsageEvent {
  const { usage, ...rest } = overrides
  return {
    seq: 5,
    timestamp: '2026-10-21T00:00:05.000Z',
    threadId: 'thr_1',
    turnId: 'turn_1',
    kind: 'usage',
    usage: {
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      cacheHitTokens: 0,
      cacheMissTokens: 100,
      cacheHitRate: null,
      turns: 1,
      turnAvgTtftMs: 640,
      turnAvgTokensPerSecond: 52.37,
      ...usage
    },
    ...rest
  } as UsageEvent
}

function thread(): ThreadDetail {
  const base = ThreadSchema.parse({
    id: 'thr_1',
    title: 'Timing',
    workspace: '/tmp/project',
    model: 'deepseek-flash',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    relation: 'primary',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:08.000Z',
    turns: []
  })
  return {
    ...base,
    latestSeq: 4,
    pendingUserInputIds: [],
    turns: [{
      id: 'turn_1',
      threadId: 'thr_1',
      status: 'completed',
      model: 'deepseek-flash',
      orchestration: 'direct',
      prompt: 'hi',
      steering: [],
      createdAt: '2026-10-21T00:00:00.000Z',
      startedAt: '2026-10-21T00:00:00.000Z',
      finishedAt: '2026-10-21T00:00:02.800Z',
      items: [{
        id: 'item_1',
        threadId: 'thr_1',
        turnId: 'turn_1',
        kind: 'assistant_text',
        role: 'assistant',
        status: 'completed',
        text: 'Hi.',
        createdAt: '2026-10-21T00:00:01.000Z'
      }],
      attachmentIds: [],
      activeSkillIds: []
    }]
  } as unknown as ThreadDetail
}

describe('turn timing', () => {
  it('reads thread usage totals in the live snapshot terms', () => {
    expect(threadUsageSummary({
      thread_id: 'thr_1',
      cost_usd: 0.001,
      cost_cny: 0.01,
      cache_hit_rate: 0.8,
      avg_ttft_ms: 750,
      avg_tokens_per_second: null
    } as ThreadUsageBucket)).toEqual({
      costUsd: 0.001,
      costCny: 0.01,
      cacheHitRate: 0.8,
      avgTtftMs: 750,
      avgTokensPerSecond: null
    })
  })

  it('takes live averages only from the parent agent turn', () => {
    expect(turnTimingFromUsageEvent(usageEvent())).toEqual({
      turnId: 'turn_1',
      timing: { avgTtftMs: 640, avgTokensPerSecond: 52.37 }
    })
    expect(turnTimingFromUsageEvent(usageEvent({ attribution: 'approval-review' }))).toBeUndefined()
    expect(turnTimingFromUsageEvent(usageEvent({ usage: { turnAvgTtftMs: null, turnAvgTokensPerSecond: null } }))).toBeUndefined()
    const { turnId: _turnId, ...withoutTurn } = usageEvent()
    expect(turnTimingFromUsageEvent(withoutTurn as UsageEvent)).toBeUndefined()
  })

  it('labels a turn footer and drops a missing measurement', () => {
    expect(turnTimingParts({ avgTtftMs: 640, avgTokensPerSecond: 52.37 })).toEqual([
      { label: 'TTFT', value: '0.6s' },
      { label: '', value: '52.4', unit: 'tok/s' }
    ])
    expect(turnTimingParts({ avgTtftMs: null, avgTokensPerSecond: 41 })).toEqual([{ label: '', value: '41.0', unit: 'tok/s' }])
    expect(turnTimingParts(undefined)).toEqual([])
  })

  it('reopens a session with the timing its settled turns were stamped with', () => {
    const settled = thread()
    settled.turns = [{ ...settled.turns[0]!, modelTiming: { avgTtftMs: 640, avgTokensPerSecond: 52.37 } }]
    const projection = projectThreadSnapshot(settled)
    expect(projection.turnTiming).toEqual({ turn_1: { avgTtftMs: 640, avgTokensPerSecond: 52.37 } })
    expect(projectThreadSnapshot(thread()).turnTiming).toBeUndefined()
    // A live usage event of this session replaces the stamped copy.
    const live = applyRuntimeEvent(projection, usageEvent({ usage: { turnAvgTtftMs: 300, turnAvgTokensPerSecond: 60 } }) as RuntimeEvent)
    expect(live.turnTiming).toEqual({ turn_1: { avgTtftMs: 300, avgTokensPerSecond: 60 } })
  })

  it('records a usage event on the projection and shows it on the turn footer', () => {
    const projection = applyRuntimeEvent(projectThreadSnapshot(thread()), usageEvent() as RuntimeEvent)
    expect(projection.turnTiming).toEqual({ turn_1: { avgTtftMs: 640, avgTokensPerSecond: 52.37 } })
    const footer = withTurnFooters([], projection)
    expect(footer).toEqual([])
    const entries = withTurnFooters([{
      kind: 'item',
      key: 'item_1',
      item: projection.items[0]!,
      settled: true,
      separated: true
    } as Parameters<typeof withTurnFooters>[0][number]], projection)
    expect(entries.at(-1)).toMatchObject({
      kind: 'turn-footer',
      model: 'deepseek-flash',
      durationMs: 2_800,
      timing: { avgTtftMs: 640, avgTokensPerSecond: 52.37 }
    })
  })
})
