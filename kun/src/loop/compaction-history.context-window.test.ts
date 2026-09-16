import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { effectiveHistoryAfterLatestCompaction } from './compaction-history.js'

let seq = 0
function base(id: string, kind: TurnItem['kind'], text = ''): TurnItem {
  seq += 1
  const common = {
    id, turnId: 'turn-1', threadId: 'thread-1',
    role: 'user' as const, status: 'completed' as const,
    createdAt: `2026-09-14T00:00:${String(seq % 60).padStart(2, '0')}.000Z`
  }
  if (kind === 'user_message') return { ...common, kind, text }
  if (kind === 'assistant_text') return { ...common, kind, role: 'assistant', text }
  if (kind === 'compaction') {
    return {
      ...common, kind, role: 'system',
      summary: text, replacedTokens: 10, pinnedConstraints: []
    }
  }
  if (kind === 'context_window') {
    return {
      ...common, kind, role: 'system',
      schemaVersion: 1, windowId: id, previousWindowId: null, reason: 'model',
      sourceHistoryRevision: 1, splitBefore: { kind: 'seq', seq: 0 },
      initializationRef: 'init', operationId: `op-${id}`, replacedTokens: 0
    }
  }
  if (kind === 'tool_call') {
    return {
      ...common, kind, role: 'assistant',
      toolName: 'read', callId: text, toolKind: 'tool_call', arguments: {}
    }
  }
  if (kind === 'tool_result') {
    return {
      ...common, kind, role: 'tool',
      toolName: 'read', callId: text, toolKind: 'tool_call', output: 'ok', isError: false
    }
  }
  // goal_context (internal authoritative record)
  return { ...common, kind: 'goal_context' as const, role: 'system', goalKey: 'goal-1', text }
}

describe('effectiveHistoryAfterLatestCompaction with window boundaries', () => {
  it('excludes everything up to and including the latest boundary', () => {
    const items = [
      base('u1', 'user_message', 'before'),
      base('a1', 'assistant_text', 'before'),
      base('win-1', 'context_window'),
      base('u2', 'user_message', 'after'),
      base('a2', 'assistant_text', 'after')
    ]
    expect(effectiveHistoryAfterLatestCompaction(items).map((item) => item.id))
      .toEqual(['u2', 'a2'])
  })

  it('keeps the summary marker when the latest cut is a summary compaction', () => {
    const items = [
      base('u1', 'user_message', 'folded'),
      base('sum-1', 'compaction', 'summary text'),
      base('u2', 'user_message', 'tail')
    ]
    expect(effectiveHistoryAfterLatestCompaction(items).map((item) => item.id))
      .toEqual(['sum-1', 'u2'])
  })

  it('projects mixed checkpoints by whichever cut came last', () => {
    const boundaryThenSummary = [
      base('u0', 'user_message', 'old'),
      base('win-1', 'context_window'),
      base('u1', 'user_message', 'mid'),
      base('sum-1', 'compaction', 'summary after window'),
      base('u2', 'user_message', 'tail')
    ]
    expect(effectiveHistoryAfterLatestCompaction(boundaryThenSummary).map((item) => item.id))
      .toEqual(['sum-1', 'u2'])

    const summaryThenBoundary = [
      base('u0', 'user_message', 'old'),
      base('sum-1', 'compaction', 'summary'),
      base('u1', 'user_message', 'mid'),
      base('win-2', 'context_window'),
      base('u2', 'user_message', 'new window')
    ]
    expect(effectiveHistoryAfterLatestCompaction(summaryThenBoundary).map((item) => item.id))
      .toEqual(['u2'])
  })

  it('preserves post-boundary tool-call/tool-result pairing positionally', () => {
    const items = [
      base('tc-old', 'tool_call', 'call-old'),
      base('win-1', 'context_window'),
      base('u2', 'user_message', 'steered after boundary'),
      base('tc-1', 'tool_call', 'call-1'),
      base('tr-1', 'tool_result', 'call-1')
    ]
    const projected = effectiveHistoryAfterLatestCompaction(items)
    expect(projected.map((item) => item.id)).toEqual(['u2', 'tc-1', 'tr-1'])
    // The orphaned pre-boundary call is excluded; the post-boundary pair is
    // contiguous so downstream pairing repair keeps it intact.
    const callIds = projected
      .filter((item) => item.kind === 'tool_call')
      .map((item) => item.kind === 'tool_call' ? item.callId : '')
    const resultIds = projected
      .filter((item) => item.kind === 'tool_result')
      .map((item) => item.kind === 'tool_result' ? item.callId : '')
    expect(callIds.every((callId) => resultIds.includes(callId))).toBe(true)
  })

  it('drops pre-boundary internal goal records and keeps post-boundary steering', () => {
    const items = [
      base('goal-1', 'goal_context', 'old goal instructions'),
      base('u1', 'user_message', 'old task'),
      base('win-1', 'context_window'),
      base('u2', 'user_message', 'steered input stays')
    ]
    const projected = effectiveHistoryAfterLatestCompaction(items)
    expect(projected.map((item) => item.id)).toEqual(['u2'])
    // Authoritative goal state is rebuilt from the thread record, never from
    // old window text.
    expect(projected.some((item) => item.kind === 'goal_context')).toBe(false)
  })

  it('P1-a: a manual-summary boundary keeps the summary and retained tail model-visible', () => {
    // Canonical order after /compact in window mode: the summary rewrite
    // places the summary before the tail, then the manual-summary boundary is
    // appended at the end.
    const items = [
      base('u0', 'user_message', 'folded old request'),
      base('sum-1', 'compaction', 'the generated summary'),
      base('u2', 'user_message', 'retained tail'),
      base('a2', 'assistant_text', 'tail answer'),
      base('win-1', 'context_window')
    ]
    const win1 = items[4]!
    if (win1.kind !== 'context_window') throw new Error('fixture')
    items[4] = { ...win1, reason: 'manual-summary' }
    const projected = effectiveHistoryAfterLatestCompaction(items)
    expect(projected.map((item) => item.id)).toEqual(['sum-1', 'u2', 'a2'])
    expect(projected.some((item) => item.kind === 'context_window')).toBe(false)
  })

  it('projects identically after a restart reload from the session store', () => {
    const items = [
      base('u1', 'user_message', 'before'),
      base('win-1', 'context_window'),
      base('u2', 'user_message', 'after')
    ]
    const reloaded = JSON.parse(JSON.stringify(items)) as TurnItem[]
    expect(effectiveHistoryAfterLatestCompaction(reloaded))
      .toEqual(effectiveHistoryAfterLatestCompaction(items))
  })
})
