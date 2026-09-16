import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import {
  computeWindowRecords,
  itemHistoryText,
  WINDOW_ZERO_ID
} from './context-window-index.js'

let seq = 0
function item(
  kind: 'user_message' | 'assistant_text' | 'context_window' | 'tool_call',
  id: string,
  text = ''
): TurnItem {
  seq += 1
  const base = {
    id,
    turnId: 'turn-1',
    threadId: 'thread-1',
    role: 'user' as const,
    status: 'completed' as const,
    createdAt: `2026-09-14T00:00:${String(seq % 60).padStart(2, '0')}.000Z`
  }
  if (kind === 'user_message') return { ...base, kind, text }
  if (kind === 'assistant_text') return { ...base, kind, role: 'assistant', text }
  if (kind === 'context_window') {
    return {
      ...base, kind, role: 'system',
      schemaVersion: 1, windowId: id, previousWindowId: null, reason: 'model',
      sourceHistoryRevision: 1, splitBefore: { kind: 'seq', seq: 0 },
      initializationRef: 'init', operationId: `op-${id}`, replacedTokens: 0
    }
  }
  return {
    ...base, kind, role: 'assistant',
    toolName: 'read', callId: id, toolKind: 'tool_call', arguments: {}
  }
}

describe('computeWindowRecords', () => {
  it('returns no windows for an empty thread', () => {
    expect(computeWindowRecords([])).toEqual([])
  })

  it('derives a single synthetic window 0 when no boundary exists', () => {
    const items = [item('user_message', 'u1', 'hi'), item('assistant_text', 'a1', 'hello')]
    const records = computeWindowRecords(items)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      windowId: WINDOW_ZERO_ID,
      windowSeq: 0,
      reason: 'initial',
      itemId: null,
      firstItemId: 'u1',
      lastItemId: 'a1',
      itemCount: 2
    })
  })

  it('segments items at boundaries and opens numbered windows', () => {
    const items = [
      item('user_message', 'u1'),
      item('assistant_text', 'a1'),
      item('context_window', 'win-1'),
      item('user_message', 'u2'),
      item('context_window', 'win-2'),
      item('assistant_text', 'a2')
    ]
    const records = computeWindowRecords(items)
    expect(records.map((record) => record.windowId)).toEqual([WINDOW_ZERO_ID, 'win-1', 'win-2'])
    expect(records.map((record) => record.itemCount)).toEqual([2, 1, 1])
    expect(records[1]).toMatchObject({
      windowSeq: 1,
      reason: 'model',
      itemId: 'win-1',
      operationId: 'op-win-1',
      firstItemId: 'u2',
      lastItemId: 'u2'
    })
    expect(records[2].firstItemId).toBe('a2')
    expect(records[0].lastItemId).toBe('a1')
  })

  it('keeps an empty window 0 when the first boundary opens the history', () => {
    const items = [item('context_window', 'win-1'), item('user_message', 'u1')]
    const records = computeWindowRecords(items)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ windowId: WINDOW_ZERO_ID, itemCount: 0, firstItemId: null })
    expect(records[1].itemCount).toBe(1)
  })

  it('ends with an empty active window when the boundary is last', () => {
    const items = [item('user_message', 'u1'), item('context_window', 'win-1')]
    const records = computeWindowRecords(items)
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ windowId: 'win-1', itemCount: 0, firstItemId: null })
  })
})

describe('itemHistoryText', () => {
  it('extracts searchable text across item kinds', () => {
    expect(itemHistoryText(item('user_message', 'u1', 'deploy plan'))).toBe('deploy plan')
    const toolCall = {
      ...item('tool_call', 't1'),
      toolName: 'read',
      callId: 'call-1',
      toolKind: 'tool_call' as const,
      arguments: { path: 'a.ts' }
    }
    expect(itemHistoryText(toolCall)).toContain('read')
    const boundary = item('context_window', 'win-9')
    expect(itemHistoryText(boundary)).toContain('win-9')
  })
})
