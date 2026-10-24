import { describe, expect, it } from 'vitest'
import type { ContextSnapshotEvent } from '../contracts/events.js'
import { contextBarRuns, contextCapacity, formatWindowShare } from './context-capacity.js'

function snapshot(overrides: Partial<ContextSnapshotEvent> = {}): ContextSnapshotEvent {
  return {
    seq: 3,
    timestamp: '2026-10-21T00:00:00.000Z',
    threadId: 'thr_1',
    turnId: 'turn_1',
    kind: 'context_snapshot',
    model: 'deepseek-flash',
    stepIndex: 0,
    contextWindowTokens: 1_000_000,
    softThresholdTokens: 900_000,
    hardThresholdTokens: 950_000,
    estimatedInputTokens: 35_619,
    breakdown: { tools: 18_240, system: 6_120, skills: 1_410, messages: 9_849, other: 0 },
    toolCount: 42,
    activeSkillIds: ['diagram-design', 'pptx'],
    ...overrides
  }
}

describe('context capacity', () => {
  it('splits the latest request by category and sums to the window with free space', () => {
    const capacity = contextCapacity(snapshot())!
    expect(capacity.percent).toBe(4)
    expect(capacity.categories.map((category) => [category.key, category.label, category.tokens])).toEqual([
      ['tools', 'System tools', 18_240],
      ['system', 'System prompt', 6_120],
      ['skills', 'Skills', 1_410],
      ['messages', 'Messages', 9_849]
    ])
    const total = capacity.categories.reduce((sum, category) => sum + category.tokens, 0) + capacity.free.tokens
    expect(total).toBe(1_000_000)
    expect(capacity.compactRatio).toBe(0.9)
    expect(capacity.activeSkills).toBe(2)
  })

  it('keeps estimated categories on the measured total', () => {
    const over = contextCapacity(snapshot({ estimatedInputTokens: 10_000, breakdown: { tools: 10_000, system: 10_000, skills: 0, messages: 0, other: 0 } }))!
    expect(over.categories.map((category) => category.tokens)).toEqual([5_000, 5_000])
    const under = contextCapacity(snapshot({ estimatedInputTokens: 10_000, breakdown: { tools: 4_000, system: 0, skills: 0, messages: 0, other: 0 } }))!
    expect(under.categories.map((category) => [category.key, category.tokens])).toEqual([['tools', 4_000], ['other', 6_000]])
  })

  it('shows an Agent total that was not split as one figure', () => {
    const capacity = contextCapacity(snapshot({ occupancySource: 'agent', breakdown: { tools: 0, system: 0, skills: 0, messages: 35_619, other: 0 } }))!
    expect(capacity.categories).toEqual([{ key: 'other', label: 'Reported by agent', tokens: 35_619, ratio: 0.035619 }])
  })

  it('draws every category at least one cell and marks the compaction threshold', () => {
    const runs = contextBarRuns(contextCapacity(snapshot())!, 38)
    expect(runs).toEqual([
      { kind: 'tools', count: 1 },
      { kind: 'system', count: 1 },
      { kind: 'skills', count: 1 },
      { kind: 'messages', count: 1 },
      { kind: 'free', count: 30 },
      { kind: 'marker', count: 1 },
      { kind: 'free', count: 3 }
    ])
    expect(runs.reduce((sum, run) => sum + run.count, 0)).toBe(38)
  })

  it('never draws a full window wider than the bar', () => {
    const full = contextCapacity(snapshot({ estimatedInputTokens: 1_000_000, breakdown: { tools: 500_000, system: 0, skills: 0, messages: 500_000, other: 0 } }))!
    const runs = contextBarRuns(full, 10)
    expect(runs.reduce((sum, run) => sum + run.count, 0)).toBe(10)
    expect(runs.some((run) => run.kind === 'free')).toBe(false)
  })

  it('formats window shares', () => {
    expect(formatWindowShare(0.018)).toBe('1.8%')
    expect(formatWindowShare(0.0004)).toBe('<0.1%')
    expect(formatWindowShare(0.964)).toBe('96%')
    expect(formatWindowShare(0)).toBe('0%')
  })
})
