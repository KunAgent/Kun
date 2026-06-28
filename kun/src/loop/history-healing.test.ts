import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { healLoadedHistoryItems } from './history-healing.js'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

function assistantText(id: string, text = 'hi'): TurnItem {
  return {
    id,
    kind: 'assistant_text',
    turnId: 't1',
    threadId: 'thr1',
    role: 'assistant',
    status: 'completed',
    createdAt: CREATED_AT,
    text
  }
}

function toolCall(id: string, callId: string): TurnItem {
  return {
    id,
    kind: 'tool_call',
    turnId: 't1',
    threadId: 'thr1',
    role: 'assistant',
    status: 'completed',
    createdAt: CREATED_AT,
    toolName: 'bash',
    callId,
    toolKind: 'tool_call',
    arguments: {}
  }
}

function toolResult(id: string, callId: string): TurnItem {
  return {
    id,
    kind: 'tool_result',
    turnId: 't1',
    threadId: 'thr1',
    role: 'tool',
    status: 'completed',
    createdAt: CREATED_AT,
    toolName: 'bash',
    callId,
    toolKind: 'tool_call',
    output: 'ok',
    isError: false
  }
}

describe('healLoadedHistoryItems', () => {
  it('reports changed=false and preserves item references for already-valid history', () => {
    const items = [assistantText('a1'), toolCall('c1', 'call1'), toolResult('r1', 'call1')]
    const result = healLoadedHistoryItems(items)
    expect(result.changed).toBe(false)
    // Unchanged items keep their original references — the perf rewrite must not
    // reallocate every item just to compare (KunAgent/Kun#621).
    result.items.forEach((item, index) => expect(item).toBe(items[index]))
  })

  it('drops structurally invalid items and reports changed', () => {
    const items = [assistantText('a1'), { kind: 'tool_call', id: 'bad' } as unknown as TurnItem]
    const result = healLoadedHistoryItems(items)
    expect(result.changed).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe('a1')
  })

  it('synthesizes a missing id and reports changed', () => {
    const noId = {
      kind: 'assistant_text',
      turnId: 't1',
      threadId: 'thr1',
      role: 'assistant',
      status: 'completed',
      createdAt: CREATED_AT,
      text: 'x'
    } as unknown as TurnItem
    const result = healLoadedHistoryItems([noId])
    expect(result.changed).toBe(true)
    expect(result.items[0]?.id).toBe('item_healed_0_assistant_text')
  })

  it('removes an unpaired tool_call and reports changed', () => {
    const result = healLoadedHistoryItems([toolCall('c1', 'call1')])
    expect(result.changed).toBe(true)
    expect(result.items).toHaveLength(0)
  })

  it('keeps a paired tool_call/result and reports unchanged', () => {
    const items = [toolCall('c1', 'call1'), toolResult('r1', 'call1')]
    const result = healLoadedHistoryItems(items)
    expect(result.changed).toBe(false)
    expect(result.items).toHaveLength(2)
  })
})
