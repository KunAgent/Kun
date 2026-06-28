import { describe, expect, test } from 'vitest'
import { SdkEventMapper, mapSdkUsage } from './sdk-event-mapper.js'
import type { SdkEventMapperContext } from './sdk-event-mapper.js'
import type { SdkMessage } from './sdk-protocol.js'

function makeMapper(): SdkEventMapper {
  let n = 0
  const ctx: SdkEventMapperContext = {
    threadId: 'th_1',
    turnId: 'tn_1',
    nextId: (prefix) => `${prefix}_${++n}`
  }
  return new SdkEventMapper(ctx)
}

describe('SdkEventMapper', () => {
  test('captures session id from system/init and emits nothing', () => {
    const m = makeMapper()
    const events = m.map({ type: 'system', subtype: 'init', session_id: 'sess_abc' } as SdkMessage)
    expect(events).toEqual([])
    expect(m.getSessionId()).toBe('sess_abc')
  })

  test('streams text deltas as assistant_text_delta with full accumulated text', () => {
    const m = makeMapper()
    const first = m.map({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } }
    } as SdkMessage)
    const second = m.map({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } }
    } as SdkMessage)

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      kind: 'assistant_text_delta',
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { kind: 'assistant_text', text: 'Hel', status: 'running' }
    })
    // Second delta carries only the incremental CHUNK (GUI appends per delta)
    expect(second[0]).toMatchObject({
      kind: 'assistant_text_delta',
      item: { text: 'lo', status: 'running' }
    })
    // Same item id reused across deltas
    expect((first[0] as { itemId: string }).itemId).toBe((second[0] as { itemId: string }).itemId)
  })

  test('streams thinking deltas as assistant_reasoning_delta', () => {
    const m = makeMapper()
    const events = m.map({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } }
    } as SdkMessage)
    expect(events[0]).toMatchObject({
      kind: 'assistant_reasoning_delta',
      item: { kind: 'assistant_reasoning', text: 'hmm' }
    })
  })

  test('finalizes text on the complete assistant message as item_created (not a delta)', () => {
    const m = makeMapper()
    const deltaEvents = m.map({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }
    } as SdkMessage)
    // The streamed delta carries only the chunk.
    expect(deltaEvents[0]).toMatchObject({ kind: 'assistant_text_delta', item: { text: 'Hi', status: 'running' } })
    const events = m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }
    } as SdkMessage)
    // The complete message finalizes as item_created (a replace), NOT a delta —
    // so the GUI does not re-append the full text on top of the streamed chunks.
    expect(events.some((e) => e.kind === 'assistant_text_delta')).toBe(false)
    const finalItem = events.find((e) => e.kind === 'item_created')
    expect(finalItem).toMatchObject({
      item: { kind: 'assistant_text', text: 'Hi there', status: 'completed' }
    })
  })

  test('maps a tool_use block to item_created + tool_call_ready', () => {
    const m = makeMapper()
    const events = m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__kun__generate_image', input: { prompt: 'a cat' } }]
      }
    } as SdkMessage)

    const created = events.find((e) => e.kind === 'item_created')
    const ready = events.find((e) => e.kind === 'tool_call_ready')
    expect(created).toMatchObject({
      item: {
        kind: 'tool_call',
        toolName: 'mcp__kun__generate_image',
        callId: 'toolu_1',
        arguments: { prompt: 'a cat' }
      }
    })
    expect(ready).toMatchObject({
      kind: 'tool_call_ready',
      toolName: 'mcp__kun__generate_image',
      callId: 'toolu_1',
      readyCount: 1
    })
  })

  test('maps a tool_result back to tool_call_finished, recovering the tool name', () => {
    const m = makeMapper()
    m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_9', name: 'mcp__kun__web_search', input: {} }]
      }
    } as SdkMessage)
    const events = m.map({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_9', content: [{ type: 'text', text: 'results...' }] }
        ]
      }
    } as SdkMessage)

    expect(events[0]).toMatchObject({
      kind: 'tool_call_finished',
      item: {
        kind: 'tool_result',
        toolName: 'mcp__kun__web_search',
        callId: 'toolu_9',
        output: 'results...',
        isError: false
      }
    })
  })

  test('marks tool_result errors', () => {
    const m = makeMapper()
    m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] }
    } as SdkMessage)
    const events = m.map({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't', content: 'boom', is_error: true }]
      }
    } as SdkMessage)
    expect(events[0]).toMatchObject({ item: { isError: true, status: 'failed', toolKind: 'command_execution' } })
  })

  test('result success emits usage and reports final text', () => {
    const m = makeMapper()
    const events = m.map({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'all done',
      num_turns: 3,
      total_cost_usd: 0.012,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900 }
    } as SdkMessage)

    expect(events[0]).toMatchObject({
      kind: 'usage',
      usage: {
        promptTokens: 1000, // 100 input + 900 cache read
        completionTokens: 50,
        totalTokens: 1050,
        cachedTokens: 900,
        turns: 3,
        costUsd: 0.012
      }
    })
    expect(m.getFinal()).toEqual({ status: 'completed', text: 'all done' })
  })

  test('result error subtype reports failed final', () => {
    const m = makeMapper()
    m.map({ type: 'result', subtype: 'error_max_turns', is_error: true } as SdkMessage)
    expect(m.getFinal()?.status).toBe('failed')
  })
})

describe('mapSdkUsage', () => {
  test('prompt tokens include cache reads and creation (anthropic input excludes them)', () => {
    const usage = mapSdkUsage(
      { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 700, cache_creation_input_tokens: 100 },
      2,
      0.5
    )
    expect(usage.promptTokens).toBe(1000)
    expect(usage.completionTokens).toBe(80)
    expect(usage.totalTokens).toBe(1080)
    expect(usage.cachedTokens).toBe(700)
    expect(usage.cacheMissTokens).toBe(300) // 200 input + 100 creation
    expect(usage.cacheHitRate).toBeCloseTo(0.7)
    expect(usage.costUsd).toBe(0.5)
  })

  test('null cache hit rate when no prompt tokens', () => {
    const usage = mapSdkUsage(undefined, 0)
    expect(usage.promptTokens).toBe(0)
    expect(usage.cacheHitRate).toBeNull()
    expect(usage.costUsd).toBeUndefined()
  })
})
