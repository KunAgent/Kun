import { describe, expect, it } from 'vitest'
import type { ProjectedChildRun } from './state.js'
import { childBriefMetrics, childCardMeta, childCardStatus, childGroupBreakdown } from './subagent-format.js'

function child(overrides: Partial<ProjectedChildRun> = {}): ProjectedChildRun {
  return {
    childId: 'child_1',
    parentTurnId: 'turn_1',
    status: 'running',
    startedAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:18.000Z',
    ...overrides
  } as ProjectedChildRun
}

const now = Date.parse('2026-10-21T00:01:12.000Z')

describe('subagent cards', () => {
  it('lists model, tool policy and metrics on the card meta row', () => {
    expect(childCardMeta(child({
      model: 'deepseek-flash',
      toolPolicy: 'readOnly',
      toolInvocations: 12,
      totalTokens: 18_400,
      cacheHitRate: 0.82,
      costCny: 0.031
    }))).toBe('deepseek-flash · read-only · 12 tools · 18k tok · cache 82% · ¥0.03')
    expect(childCardMeta(child({ toolInvocations: 1 }))).toBe('1 tool')
    expect(childCardMeta(child())).toBe('')
  })

  it('names the state except while running and keeps the time', () => {
    expect(childCardStatus(child(), now)).toEqual({ failed: false, elapsed: '1m 12s' })
    expect(childCardStatus(child({ status: 'completed', durationMs: 100_000 }), now)).toEqual({ state: 'done', failed: false, elapsed: '1m 40s' })
    expect(childCardStatus(child({ status: 'failed', durationMs: 22_000 }), now)).toMatchObject({ state: 'failed', failed: true })
    expect(childCardStatus(child({ status: 'aborted', durationMs: 1_000 }), now)).toMatchObject({ state: 'stopped', failed: true })
    expect(childCardStatus(child({ status: 'queued' }), now)).toMatchObject({ state: 'waiting' })
    expect(childCardStatus(child({ detached: true }), now)).toMatchObject({ state: 'background' })
  })

  it('summarizes a parallel group and a sidebar row', () => {
    expect(childGroupBreakdown([
      child(),
      child({ childId: 'child_2' }),
      child({ childId: 'child_3', status: 'completed' })
    ])).toBe('2 running · 1 done')
    expect(childBriefMetrics(child({ toolInvocations: 4, status: 'completed', durationMs: 48_000 }), now)).toBe('4 tools · 48s')
  })
})
