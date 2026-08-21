import { describe, expect, test } from 'vitest'
import { SdkEventMapper, SdkResourceLimitError, mapSdkUsage } from './sdk-event-mapper.js'
import type { SdkEventMapperContext, SdkStreamResourceLimits } from './sdk-event-mapper.js'
import type { SdkMessage } from './sdk-protocol.js'

function makeMapper(streamLimits?: Partial<SdkStreamResourceLimits>): SdkEventMapper {
  let n = 0
  const ctx: SdkEventMapperContext = {
    threadId: 'th_1',
    turnId: 'tn_1',
    nextId: (prefix) => `${prefix}_${++n}`,
    ...(streamLimits ? { streamLimits } : {})
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

  test('redacts Browser Use arguments from durable SDK events', () => {
    const events = makeMapper().map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_browser',
          name: 'mcp__kun__browser_use',
          input: {
            action: 'open',
            url: 'https://example.com/path?token=secret#fragment',
            unexpected: 'private-value'
          }
        }]
      }
    } as SdkMessage)

    expect(events.find((event) => event.kind === 'item_created')).toMatchObject({
      item: {
        arguments: {
          action: 'open',
          url: 'https://example.com/path',
          unexpectedFields: ['unexpected']
        }
      }
    })
    expect(JSON.stringify(events)).not.toContain('token=secret')
    expect(JSON.stringify(events)).not.toContain('private-value')
  })

  test('omits unresolved raw arguments from durable SDK tool-call events', () => {
    const m = makeMapper()
    const raw = '{"plan":{"title":"private-sdk-event-marker"'
    const events = m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_raw',
          name: 'mcp__kun__graph_define_plan',
          input: { __raw: raw }
        }]
      }
    } as SdkMessage)

    expect(events.find((event) => event.kind === 'item_created')).toMatchObject({
      item: {
        kind: 'tool_call',
        arguments: {},
        summary: expect.stringContaining(`${Buffer.byteLength(raw, 'utf8')} UTF-8 bytes`)
      }
    })
    expect(JSON.stringify(events)).not.toContain('private-sdk-event-marker')
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
    expect(m.getFinal()?.code).toBe('turn_step_limit')
  })

  test('keeps thousands of tiny text deltas exact without repeated string append semantics', () => {
    const m = makeMapper({ maxEvents: 4_000, maxOutputBytes: 4_000 })
    for (let index = 0; index < 2_048; index += 1) {
      m.map({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }
      } as SdkMessage)
    }
    const events = m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(2_048) }] }
    } as SdkMessage)
    expect(events[0]).toMatchObject({
      kind: 'item_created',
      item: { text: 'x'.repeat(2_048), status: 'completed' }
    })
  })

  test('deduplicates the authoritative assistant copy from the streamed output byte budget', () => {
    const m = makeMapper({ maxOutputBytes: 5 })
    m.map({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }
    } as SdkMessage)
    expect(() => m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
    } as SdkMessage)).not.toThrow()
  })

  test('charges an equal-length authoritative rewrite instead of deduplicating it', () => {
    const m = makeMapper({ maxOutputBytes: 5 })
    m.map({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'abc' } }
    } as SdkMessage)

    expect(() => m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: 'xyz' }] }
    } as SdkMessage)).toThrow(expect.objectContaining({ code: 'stream_resource_limit' }))
  })

  test('does not re-emit prior text for a later tool-only assistant message', () => {
    const m = makeMapper()
    m.map({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } }
    } as SdkMessage)
    m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] }
    } as SdkMessage)

    const toolOnly = m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'Read', input: {} }]
      }
    } as SdkMessage)

    expect(toolOnly.filter((event) =>
      event.kind === 'item_created' &&
      'item' in event &&
      event.item.kind === 'assistant_text'
    )).toEqual([])
    expect(toolOnly).toContainEqual(expect.objectContaining({ kind: 'tool_call_ready' }))
  })

  test('rejects over-budget output with a stable content-free code', () => {
    const m = makeMapper({ maxOutputBytes: 3 })
    let error: unknown
    try {
      m.map({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'SECRET_MARKER' }
        }
      } as SdkMessage)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(SdkResourceLimitError)
    expect(error).toMatchObject({ code: 'stream_resource_limit' })
    expect((error as Error).message).toContain('response text and reasoning bytes')
    expect((error as Error).message).not.toContain('SECRET_MARKER')
  })

  test('applies the output budget when the SDK only supplies result text', () => {
    const m = makeMapper({ maxOutputBytes: 3 })
    expect(() => m.map({
      type: 'result', subtype: 'success', is_error: false, result: 'result-only'
    } as SdkMessage)).toThrow(expect.objectContaining({ code: 'stream_resource_limit' }))
  })

  test('does not dedupe identical result-only text across separate SDK queries', () => {
    const m = makeMapper({ maxOutputBytes: 4 })
    m.beginQuery()
    m.map({
      type: 'result', subtype: 'success', is_error: false, result: 'done'
    } as SdkMessage)
    m.beginQuery()
    expect(() => m.map({
      type: 'result', subtype: 'success', is_error: false, result: 'done'
    } as SdkMessage)).toThrow(expect.objectContaining({ code: 'stream_resource_limit' }))
  })

  test('rejects an SDK event-count storm independently of payload bytes', () => {
    const m = makeMapper({ maxEvents: 2 })
    m.map({ type: 'system', subtype: 'init', session_id: 'one' } as SdkMessage)
    m.map({ type: 'system', subtype: 'init', session_id: 'two' } as SdkMessage)
    expect(() => m.map({
      type: 'system', subtype: 'init', session_id: 'three'
    } as SdkMessage)).toThrow(expect.objectContaining({ code: 'stream_resource_limit' }))
  })

  test('enforces maxToolCallsPerStep atomically', () => {
    const m = makeMapper({ maxToolCallsPerStep: 1 })
    expect(() => m.map({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'one', name: 'Read', input: {} },
          { type: 'tool_use', id: 'two', name: 'Read', input: {} }
        ]
      }
    } as SdkMessage)).toThrow(expect.objectContaining({ code: 'tool_call_limit_exceeded' }))
    expect(m.getPendingToolCallCount()).toBe(0)
  })

  test('bounds pending tool state and releases it after the matching result', () => {
    const m = makeMapper({ maxToolCallsPerStep: 1, maxPendingToolCalls: 1 })
    const call = (id: string): void => {
      m.map({
        type: 'assistant', parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: {} }] }
      } as SdkMessage)
    }
    call('one')
    expect(m.getPendingToolCallCount()).toBe(1)
    expect(() => call('two')).toThrow(expect.objectContaining({ code: 'stream_resource_limit' }))
    m.map({
      type: 'user', parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: 'ok' }] }
    } as SdkMessage)
    expect(m.getPendingToolCallCount()).toBe(0)
    expect(() => call('two')).not.toThrow()
  })

  test('releases unresolved tool-name state when an SDK query result terminates the query', () => {
    const m = makeMapper()
    m.map({
      type: 'assistant', parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'pending', name: 'Read', input: {} }]
      }
    } as SdkMessage)
    expect(m.getPendingToolCallCount()).toBe(1)
    m.map({ type: 'result', subtype: 'success', is_error: false } as SdkMessage)
    expect(m.getPendingToolCallCount()).toBe(0)
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

  test('preserves subscription attribution for downstream value estimation', () => {
    expect(mapSdkUsage(
      { input_tokens: 25_300, output_tokens: 700 },
      1,
      undefined,
      { billingKind: 'subscription', model: 'gpt-5.6-luna' }
    )).toMatchObject({
      actualModelId: 'gpt-5.6-luna',
      billingKind: 'subscription'
    })
  })

  test('null cache hit rate when no prompt tokens', () => {
    const usage = mapSdkUsage(undefined, 0)
    expect(usage.promptTokens).toBe(0)
    expect(usage.cacheHitRate).toBeNull()
    expect(usage.costUsd).toBeUndefined()
  })
})
