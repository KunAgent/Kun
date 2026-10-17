import { describe, expect, test } from 'vitest'
import type { SDKMessage, TokenUsage } from '@cursor/sdk'
import {
  CursorSdkEventMapper,
  CursorSdkResourceLimitError,
  cursorTodosRequestFromMessage,
  mapCursorUsage
} from './cursor-sdk-event-mapper.js'

function mapper(limits?: ConstructorParameters<typeof CursorSdkEventMapper>[0]['limits']) {
  let id = 0
  return new CursorSdkEventMapper({
    threadId: 'thread_1',
    turnId: 'turn_1',
    providerId: 'cursor-subscription',
    model: 'auto',
    nextId: (prefix) => `${prefix}_${++id}`,
    limits
  })
}

describe('CursorSdkEventMapper', () => {
  test('projects assistant and reasoning output as deltas plus authoritative items', () => {
    const subject = mapper()
    const reasoning = subject.map({
      type: 'thinking',
      agent_id: 'agent',
      run_id: 'run',
      text: 'considering'
    })
    const text = subject.map({
      type: 'assistant',
      agent_id: 'agent',
      run_id: 'run',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
    })
    const final = subject.finalize('hello')

    expect(reasoning).toContainEqual(expect.objectContaining({
      kind: 'assistant_reasoning_delta',
      item: expect.objectContaining({ text: 'considering', status: 'running' })
    }))
    expect(text).toContainEqual(expect.objectContaining({
      kind: 'assistant_text_delta',
      item: expect.objectContaining({ text: 'hello', status: 'running' })
    }))
    expect(final).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'item_created',
        item: expect.objectContaining({ kind: 'assistant_reasoning', text: 'considering', status: 'completed' })
      }),
      expect.objectContaining({
        kind: 'item_created',
        item: expect.objectContaining({ kind: 'assistant_text', text: 'hello', status: 'completed' })
      })
    ]))
  })

  test('addresses every text and reasoning fragment by its UTF-16 offset', () => {
    const subject = mapper()
    const firstText = subject.map({
      type: 'assistant',
      agent_id: 'agent',
      run_id: 'run',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'A😀' },
          { type: 'text', text: 'B' }
        ]
      }
    })
    const secondText = subject.map({
      type: 'assistant',
      agent_id: 'agent',
      run_id: 'run',
      message: { role: 'assistant', content: [{ type: 'text', text: '猫' }] }
    })
    const reasoning = [
      ...subject.map({
        type: 'thinking',
        agent_id: 'agent',
        run_id: 'run',
        text: '思😀'
      }),
      ...subject.map({
        type: 'thinking',
        agent_id: 'agent',
        run_id: 'run',
        text: '考'
      })
    ]

    expect([...firstText, ...secondText].map((event) => ({
      offset: 'deltaOffset' in event ? event.deltaOffset : undefined,
      text: 'item' in event && 'text' in event.item ? event.item.text : undefined
    }))).toEqual([
      { offset: 0, text: 'A😀' },
      { offset: 3, text: 'B' },
      { offset: 4, text: '猫' }
    ])
    expect(reasoning.map((event) => ({
      offset: 'deltaOffset' in event ? event.deltaOffset : undefined,
      text: 'item' in event && 'text' in event.item ? event.item.text : undefined
    }))).toEqual([
      { offset: 0, text: '思😀' },
      { offset: 3, text: '考' }
    ])
  })

  test('emits only unseen suffixes for cumulative assistant snapshots', () => {
    const subject = mapper()
    const first = subject.map({
      type: 'assistant',
      agent_id: 'agent',
      run_id: 'run',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }
    })
    const duplicate = subject.map({
      type: 'assistant',
      agent_id: 'agent',
      run_id: 'run',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }
    })
    const extended = subject.map({
      type: 'assistant',
      agent_id: 'agent',
      run_id: 'run',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] }
    })

    expect(first).toEqual([
      expect.objectContaining({
        kind: 'assistant_text_delta',
        deltaOffset: 0,
        item: expect.objectContaining({ text: 'Hello' })
      })
    ])
    expect(duplicate).toEqual([])
    expect(extended).toEqual([
      expect.objectContaining({
        kind: 'assistant_text_delta',
        deltaOffset: 5,
        item: expect.objectContaining({ text: ' world' })
      })
    ])
    expect(subject.runningTextItem).toEqual(expect.objectContaining({ text: 'Hello world' }))
  })

  test('projects Cursor-owned tool lifecycle without a Kun-ready redispatch event', () => {
    const subject = mapper()
    const started = subject.map({
      type: 'tool_call',
      agent_id: 'agent',
      run_id: 'run',
      call_id: 'call_1',
      name: 'shell',
      status: 'running',
      args: { command: 'pwd' }
    })
    const finished = subject.map({
      type: 'tool_call',
      agent_id: 'agent',
      run_id: 'run',
      call_id: 'call_1',
      name: 'shell',
      status: 'completed',
      result: { stdout: '/tmp' }
    })

    expect(started).toEqual([
      expect.objectContaining({
        kind: 'tool_call_started',
        item: expect.objectContaining({
          kind: 'tool_call',
          toolKind: 'command_execution',
          arguments: { command: 'pwd' }
        })
      })
    ])
    expect(finished).toEqual([
      expect.objectContaining({
        kind: 'tool_call_finished',
        item: expect.objectContaining({
          kind: 'tool_result',
          toolKind: 'command_execution',
          output: { stdout: '/tmp' },
          isError: false
        })
      })
    ])
    expect([...started, ...finished].some((event) => event.kind === 'tool_call_ready')).toBe(false)
  })

  test('omits unresolved raw arguments from durable Cursor tool-call events', () => {
    const subject = mapper()
    const raw = '{"plan":{"title":"private-cursor-event-marker"'

    const events = subject.map({
      type: 'tool_call',
      agent_id: 'agent',
      run_id: 'run',
      call_id: 'call_raw',
      name: 'graph_define_plan',
      status: 'running',
      args: { __raw: raw }
    })

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'tool_call_started',
        item: expect.objectContaining({
          kind: 'tool_call',
          arguments: {},
          summary: expect.stringContaining(`${Buffer.byteLength(raw, 'utf8')} UTF-8 bytes`)
        })
      })
    ])
    expect(JSON.stringify(events)).not.toContain('private-cursor-event-marker')
  })

  test('extracts successful Cursor updateTodos results for Kun thread state', () => {
    expect(cursorTodosRequestFromMessage({
      type: 'tool_call',
      agent_id: 'agent',
      run_id: 'run',
      call_id: 'call_todos',
      name: 'updateTodos',
      status: 'completed',
      result: {
        status: 'success',
        value: {
          todos: [
            { content: 'Finished', status: 'completed' },
            { content: 'Current', status: 'inProgress' },
            { content: 'Extra active item', status: 'inProgress' },
            { content: 'Skipped', status: 'cancelled' }
          ],
          totalCount: 4
        }
      }
    })).toEqual({
      todos: [
        { content: 'Finished', status: 'completed' },
        { content: 'Current', status: 'in_progress' },
        { content: 'Extra active item', status: 'pending' },
        { content: 'Skipped', status: 'completed' }
      ]
    })
    expect(cursorTodosRequestFromMessage({
      type: 'tool_call',
      agent_id: 'agent',
      run_id: 'run',
      call_id: 'call_todos',
      name: 'updateTodos',
      status: 'error',
      result: {
        status: 'error',
        error: 'failed'
      }
    })).toBeUndefined()
  })

  test('maps Cursor cache and reasoning usage with provider attribution', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      totalTokens: 120,
      reasoningTokens: 5
    }
    expect(mapCursorUsage(usage, 'cursor-subscription', 'auto')).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      reasoningTokens: 5,
      totalTokens: 120,
      cachedTokens: 40,
      cacheHitTokens: 40,
      cacheMissTokens: 60,
      cacheWriteTokens: 10,
      cacheHitRate: 0.4,
      actualProviderId: 'cursor-subscription',
      actualModelId: 'auto',
      turns: 1
    })

    // The SDK's own total counts cache reads twice (input already has them).
    expect(mapCursorUsage({ ...usage, totalTokens: 170 }, 'cursor-subscription', 'auto').totalTokens).toBe(120)

    const subject = mapper()
    expect(subject.map({
      type: 'usage',
      agent_id: 'agent',
      run_id: 'run',
      usage
    })).toContainEqual(expect.objectContaining({
      kind: 'usage',
      usage: expect.objectContaining({ totalTokens: 120 })
    }))
    expect(subject.finalize(undefined, usage).some((event) => event.kind === 'usage')).toBe(false)
  })

  test('fails closed on oversized SDK output', () => {
    const subject = mapper({ maxOutputBytes: 4 })
    expect(() => subject.map({
      type: 'assistant',
      agent_id: 'agent',
      run_id: 'run',
      message: { role: 'assistant', content: [{ type: 'text', text: '12345' }] }
    } as SDKMessage)).toThrow(CursorSdkResourceLimitError)
  })
})
