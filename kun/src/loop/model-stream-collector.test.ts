import { describe, expect, it } from 'vitest'
import { ModelStreamCollector } from './model-stream-collector.js'

function collector(options: {
  maxToolCallsPerStep?: number
  toolCallOverflowBehavior?: 'fail' | 'truncate'
  allocateRuntimeCallId?: (providerCallId: string) => string
} = {}): ModelStreamCollector {
  return new ModelStreamCollector({
    maxToolCallsPerStep: options.maxToolCallsPerStep ?? 2,
    ...(options.toolCallOverflowBehavior
      ? { toolCallOverflowBehavior: options.toolCallOverflowBehavior }
      : {}),
    allocateRuntimeCallId: options.allocateRuntimeCallId ?? ((providerCallId) => providerCallId),
    toolMetadata: new Map([
      ['edit', { providerId: 'builtin', toolKind: 'file_change' as const }]
    ])
  })
}

describe('ModelStreamCollector', () => {
  it('accumulates text and reasoning while continuing to accept usage after completion', () => {
    const stream = collector()
    expect(stream.reduce({ kind: 'assistant_reasoning_delta', text: 'think ' }).intents)
      .toEqual([{ kind: 'assistant_reasoning_delta', text: 'think ' }])
    stream.reduce({ kind: 'assistant_text_delta', text: 'hello' })
    stream.reduce({ kind: 'assistant_text_delta', text: ' world' })
    stream.reduce({ kind: 'completed', stopReason: 'length' })
    const usage = {
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
      cacheHitRate: null,
      turns: 1
    }
    expect(stream.reduce({ kind: 'usage', usage }).intents).toEqual([{ kind: 'usage', usage }])

    expect(stream.snapshot()).toEqual({
      text: 'hello world',
      reasoning: 'think ',
      toolCalls: [],
      stopReason: 'length'
    })
  })

  it('preserves tool-call order, metadata, and repaired arguments', () => {
    const stream = collector()
    stream.reduce({ kind: 'tool_call_delta', callId: 'call_ignored', toolName: 'edit' })
    const first = stream.reduce({
      kind: 'tool_call_complete',
      callId: 'call_1',
      toolName: 'edit',
      arguments: { input: { path: 'src/a.ts' } },
      providerMetadata: {
        gemini: { thoughtSignature: 'opaque-provider-signature' }
      }
    })
    const second = stream.reduce({
      kind: 'tool_call_complete',
      callId: 'call_2',
      toolName: 'edit',
      arguments: { path: 'src/b.ts' }
    })

    expect(first.intents).toEqual([expect.objectContaining({
      kind: 'tool_call_ready',
      repairNotes: ['flattened input wrapper'],
      providerMetadata: {
        gemini: { thoughtSignature: 'opaque-provider-signature' }
      },
      call: expect.objectContaining({
        callId: 'call_1',
        providerId: 'builtin',
        toolKind: 'file_change',
        arguments: { path: 'src/a.ts' }
      })
    })])
    expect(second.intents).toEqual([expect.objectContaining({
      kind: 'tool_call_ready',
      call: expect.objectContaining({ callId: 'call_2' })
    })])
    expect(stream.snapshot().toolCalls.map((call) => call.callId)).toEqual(['call_1', 'call_2'])
  })

  it('replaces missing or repeated provider ids with unique runtime ids', () => {
    let nextId = 0
    const stream = collector({
      allocateRuntimeCallId: () => `call_runtime_${++nextId}`
    })

    const first = stream.reduce({
      kind: 'tool_call_complete',
      callId: '',
      toolName: 'edit',
      arguments: { path: 'src/a.ts' }
    })
    const second = stream.reduce({
      kind: 'tool_call_complete',
      callId: '',
      toolName: 'edit',
      arguments: { path: 'src/b.ts' }
    })

    expect(first.intents).toEqual([expect.objectContaining({
      kind: 'tool_call_ready',
      call: expect.objectContaining({ callId: 'call_runtime_1' })
    })])
    expect(second.intents).toEqual([expect.objectContaining({
      kind: 'tool_call_ready',
      call: expect.objectContaining({ callId: 'call_runtime_2' })
    })])
    expect(stream.snapshot().toolCalls.map((call) => call.callId))
      .toEqual(['call_runtime_1', 'call_runtime_2'])
  })

  it('rejects an incomplete completed call with content-free diagnostics', () => {
    const stream = collector()
    const reduction = stream.reduce({
      kind: 'tool_call_complete',
      callId: 'provider-secret-id',
      toolName: '',
      arguments: { command: 'provider-secret-command' }
    })

    expect(reduction).toEqual({
      intents: [{
        kind: 'model_error',
        message: 'model stream produced an incomplete tool call',
        code: 'stream_tool_call_protocol'
      }]
    })
    expect(JSON.stringify(reduction)).not.toContain('provider-secret')
    expect(stream.snapshot()).toMatchObject({ toolCalls: [], stopReason: 'error' })
  })

  it('does not accept a tool call past the configured cap', () => {
    const stream = collector({ maxToolCallsPerStep: 1 })
    stream.reduce({ kind: 'tool_call_complete', callId: 'call_1', toolName: 'edit', arguments: {} })
    const limited = stream.reduce({
      kind: 'tool_call_complete',
      callId: 'call_2',
      toolName: 'edit',
      arguments: {}
    })

    expect(limited).toEqual({
      intents: [],
      terminal: {
        kind: 'tool_call_limit_exceeded',
        message: 'model response exceeded 1 tool calls'
      }
    })
    expect(stream.snapshot().toolCalls.map((call) => call.callId)).toEqual(['call_1'])
  })

  it('can truncate excess tool calls while retaining the accepted batch', () => {
    const stream = collector({ maxToolCallsPerStep: 1, toolCallOverflowBehavior: 'truncate' })
    stream.reduce({ kind: 'tool_call_complete', callId: 'call_1', toolName: 'edit', arguments: {} })
    const truncated = stream.reduce({
      kind: 'tool_call_complete', callId: 'call_2', toolName: 'edit', arguments: {}
    })

    expect(truncated).toEqual({ intents: [] })
    expect(stream.truncatedToolCallCount).toBe(1)
    expect(stream.snapshot().toolCalls.map((call) => call.callId)).toEqual(['call_1'])
  })

  it('keeps a model error sticky when a later completed marker arrives', () => {
    const stream = collector()
    expect(stream.reduce({ kind: 'error', message: 'upstream failed', code: 'upstream' }).intents)
      .toEqual([{ kind: 'model_error', message: 'upstream failed', code: 'upstream' }])
    stream.reduce({ kind: 'completed', stopReason: 'stop' })
    const image = stream.reduce({
      kind: 'image_generation_complete',
      imageBase64: 'aW1hZ2U=',
      mimeType: 'image/png'
    })

    expect(stream.snapshot().stopReason).toBe('error')
    expect(image.intents).toEqual([{
      kind: 'generated_image', imageBase64: 'aW1hZ2U=', mimeType: 'image/png'
    }])
  })

  it('preserves safe provider failure metadata on model errors', () => {
    const stream = collector()
    expect(stream.reduce({
      kind: 'error',
      message: 'model request failed with status 520',
      code: 'http_520',
      failure: {
        category: 'unavailable',
        httpStatus: 520,
        failoverAllowed: true
      }
    }).intents).toEqual([{
      kind: 'model_error',
      message: 'model request failed with status 520',
      code: 'http_520',
      failure: {
        category: 'unavailable',
        httpStatus: 520,
        failoverAllowed: true
      }
    }])
  })
})
