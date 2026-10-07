import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import {
  repairModelHistoryItems,
  repairModelHistoryItemsForModel
} from './model-history-repair.js'

const CREATED_AT = '2026-08-06T00:00:00.000Z'

function assistant(id: string, kind: 'assistant_text' | 'assistant_reasoning' = 'assistant_text'): TurnItem {
  return {
    id,
    kind,
    turnId: 'turn-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    createdAt: CREATED_AT,
    text: kind === 'assistant_text' ? 'I will use the tool.' : 'private reasoning'
  }
}

function call(id: string, callId: string, patch: Partial<TurnItem> = {}): TurnItem {
  return {
    id,
    kind: 'tool_call',
    turnId: 'turn-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'completed',
    createdAt: CREATED_AT,
    toolName: 'read_file',
    toolKind: 'tool_call',
    callId,
    arguments: {},
    ...patch
  } as TurnItem
}

function result(id: string, callId: string, patch: Partial<TurnItem> = {}): TurnItem {
  return {
    id,
    kind: 'tool_result',
    turnId: 'turn-1',
    threadId: 'thread-1',
    role: 'tool',
    status: 'completed',
    createdAt: CREATED_AT,
    toolName: 'read_file',
    toolKind: 'tool_call',
    callId,
    output: 'ok',
    isError: false,
    ...patch
  } as TurnItem
}

describe('repairModelHistoryItems', () => {
  it('drops an entire assistant tool-call round when one result is missing', () => {
    const repaired = repairModelHistoryItems([
      assistant('reasoning', 'assistant_reasoning'),
      assistant('text'),
      call('call-a', 'a'),
      call('call-b', 'b'),
      result('result-a', 'a')
    ])

    expect(repaired).toEqual([])
  })

  it.each([
    ['duplicate result', [call('call-a', 'a'), result('result-a', 'a'), result('result-a-2', 'a')]],
    ['cross-turn result', [call('call-a', 'a'), result('result-a', 'a', { turnId: 'turn-2' })]],
    ['aborted call', [call('call-a', 'a', { status: 'aborted' }), result('result-a', 'a')]],
    ['running result', [call('call-a', 'a'), result('result-a', 'a', { status: 'running' })]],
    ['failed result without an error marker', [
      call('call-a', 'a', { status: 'failed' }),
      result('result-a', 'a', { status: 'failed', isError: false })
    ]]
  ])('drops a group with a %s', (_label, items) => {
    expect(repairModelHistoryItems(items)).toEqual([])
  })

  it('retains a complete failed call and error result as a valid pair', () => {
    const items = [
      call('call-a', 'a', { status: 'failed' }),
      result('result-a', 'a', { status: 'failed', isError: true })
    ]

    expect(repairModelHistoryItems(items)).toBe(items)
  })

  it('keeps legacy Browser Use records durable but removes them from model history', () => {
    const items = [
      call('browser-call', 'browser-call', {
        toolName: 'browser_use',
        arguments: { action: 'invalid' },
        status: 'failed'
      }),
      result('browser-result', 'browser-call', {
        toolName: 'browser_use',
        status: 'failed',
        isError: true,
        output: {
          kind: 'browser_action',
          ok: false,
          code: 'invalid_action',
          message: 'malformed arguments'
        }
      })
    ]

    expect(repairModelHistoryItems(items)).toBe(items)
    const modelHistory = repairModelHistoryItemsForModel(items)
    expect(modelHistory).toEqual([])
    expect(JSON.stringify(modelHistory)).not.toContain('action')
  })

  it('removes only the legacy invalid Browser Use pair from a mixed tool block', () => {
    const items = [
      call('browser-call', 'browser-call', {
        toolName: 'browser_use',
        arguments: { action: 'invalid' },
        status: 'failed'
      }),
      call('read-call', 'read-call', {
        toolName: 'read_file',
        arguments: { path: 'README.md' }
      }),
      result('browser-result', 'browser-call', {
        toolName: 'browser_use',
        status: 'failed',
        isError: true,
        output: { code: 'invalid_action' }
      }),
      result('read-result', 'read-call', {
        toolName: 'read_file',
        output: 'README'
      })
    ]

    expect(repairModelHistoryItemsForModel(items).map((item) => item.id)).toEqual([
      'read-call',
      'read-result'
    ])
  })

  it('does not scan through a record after results to rescue a later result', () => {
    const items = [
      call('call-a', 'a'),
      call('call-b', 'b'),
      result('result-a', 'a'),
      { ...assistant('intervening'), turnId: 'turn-1' },
      result('result-b', 'b')
    ]

    expect(repairModelHistoryItems(items)).toEqual([items[3]])
  })

  it('keeps a parallel round when an interactive gate record lands between results', () => {
    const gate = (kind: 'user_input' | 'approval', turnId = 'turn-1'): TurnItem => ({
      id: `gate-${kind}-${turnId}`, turnId, threadId: 'thread-1', role: 'tool', status: 'completed', createdAt: CREATED_AT,
      ...(kind === 'user_input'
        ? { kind, inputId: 'in-1', prompt: 'Q1?', questions: [] }
        : { kind, approvalId: 'ap-1', toolName: 'write_file', summary: 'write', status: 'allowed' })
    } as TurnItem)
    for (const kind of ['user_input', 'approval'] as const) {
      const items = [
        call('call-a', 'a', { toolName: 'send_im_message' }),
        call('call-b', 'b', { toolName: kind === 'user_input' ? 'user_input' : 'write_file' }),
        result('result-a', 'a'),
        gate(kind),
        result('result-b', 'b')
      ]
      expect(repairModelHistoryItems(items)).toBe(items)
    }
    const crossTurn = [call('call-a', 'a'), call('call-b', 'b'), result('result-a', 'a'), gate('user_input', 'turn-2'), result('result-b', 'b')]
    expect(repairModelHistoryItems(crossTurn).map((item) => item.id)).toEqual(['gate-user_input-turn-2'])
  })

  it('repairs a long complete history in a single forward pass', () => {
    const items: TurnItem[] = []
    for (let index = 0; index < 20_000; index += 1) {
      items.push(call(`call-${index}`, `call-${index}`), result(`result-${index}`, `call-${index}`))
    }

    expect(repairModelHistoryItems(items)).toBe(items)
  })
})
