import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import { AgentObservabilityRecorder, type AgentObservabilitySpan } from './agent-observability.js'

class CaptureSink {
  spans: AgentObservabilitySpan[] = []

  emit(span: AgentObservabilitySpan): void {
    this.spans.push(span)
  }
}

describe('AgentObservabilityRecorder', () => {
  it('exports turn usage and TTFT without assistant text payloads', async () => {
    const sink = new CaptureSink()
    const recorder = new AgentObservabilityRecorder(sink)

    await recorder.record(event({
      kind: 'turn_started',
      threadId: 'thread-1',
      turnId: 'turn-1',
      timestamp: '2026-07-09T00:00:00.000Z'
    }))
    await recorder.record(event({
      kind: 'assistant_text_delta',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-text',
      timestamp: '2026-07-09T00:00:00.120Z',
      item: {
        id: 'item-text',
        turnId: 'turn-1',
        threadId: 'thread-1',
        role: 'assistant',
        status: 'running',
        createdAt: '2026-07-09T00:00:00.120Z',
        kind: 'assistant_text',
        text: 'secret prompt payload'
      }
    }))
    await recorder.record(event({
      kind: 'usage',
      threadId: 'thread-1',
      turnId: 'turn-1',
      timestamp: '2026-07-09T00:00:00.500Z',
      model: 'gpt-test',
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        turns: 1,
        cacheHitTokens: 60,
        cacheMissTokens: 40,
        cacheHitRate: 0.6
      }
    }))
    await recorder.record(event({
      kind: 'turn_completed',
      threadId: 'thread-1',
      turnId: 'turn-1',
      timestamp: '2026-07-09T00:00:01.000Z'
    }))

    expect(sink.spans).toHaveLength(1)
    expect(sink.spans[0].attributes).toMatchObject({
      'gen_ai.response.model': 'gpt-test',
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 20,
      'gen_ai.usage.total_tokens': 120,
      'gen_ai.usage.input_token_details.cache_read': 60,
      'kun.cache.miss_tokens': 40,
      'kun.cache.hit_rate': 0.6,
      'kun.ttft_ms': 120
    })
    expect(JSON.stringify(sink.spans[0])).not.toContain('secret prompt payload')
  })

  it('exports tool spans without arguments or result output', async () => {
    const sink = new CaptureSink()
    const recorder = new AgentObservabilityRecorder(sink)

    await recorder.record(event({
      kind: 'turn_started',
      threadId: 'thread-1',
      turnId: 'turn-1',
      timestamp: '2026-07-09T00:00:00.000Z'
    }))
    await recorder.record(event({
      kind: 'item_created',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-tool',
      timestamp: '2026-07-09T00:00:00.100Z',
      item: {
        id: 'item-tool',
        turnId: 'turn-1',
        threadId: 'thread-1',
        role: 'tool',
        status: 'running',
        createdAt: '2026-07-09T00:00:00.100Z',
        kind: 'tool_call',
        callId: 'call-1',
        toolName: 'bash',
        toolKind: 'command_execution',
        arguments: { command: 'echo secret-command' }
      }
    }))
    await recorder.record(event({
      kind: 'item_created',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-result',
      timestamp: '2026-07-09T00:00:00.350Z',
      item: {
        id: 'item-result',
        turnId: 'turn-1',
        threadId: 'thread-1',
        role: 'tool',
        status: 'completed',
        createdAt: '2026-07-09T00:00:00.350Z',
        finishedAt: '2026-07-09T00:00:00.350Z',
        kind: 'tool_result',
        callId: 'call-1',
        toolName: 'bash',
        toolKind: 'command_execution',
        output: 'secret output',
        isError: false
      }
    }))

    expect(sink.spans).toHaveLength(1)
    expect(sink.spans[0]).toMatchObject({
      name: 'kun.tool bash',
      durationMs: 250,
      status: { code: 'OK' }
    })
    expect(sink.spans[0].attributes).toMatchObject({
      'tool.name': 'bash',
      'kun.tool.call_id': 'call-1',
      'kun.tool.kind': 'command_execution',
      'kun.tool.is_error': false
    })
    const serialized = JSON.stringify(sink.spans[0])
    expect(serialized).not.toContain('secret-command')
    expect(serialized).not.toContain('secret output')
  })

  it('closes dangling tool spans when a turn aborts', async () => {
    const sink = new CaptureSink()
    const recorder = new AgentObservabilityRecorder(sink)

    await recorder.record(event({
      kind: 'turn_started',
      threadId: 'thread-1',
      turnId: 'turn-1',
      timestamp: '2026-07-09T00:00:00.000Z'
    }))
    await recorder.record(event({
      kind: 'item_created',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-tool',
      timestamp: '2026-07-09T00:00:00.100Z',
      item: {
        id: 'item-tool',
        turnId: 'turn-1',
        threadId: 'thread-1',
        role: 'tool',
        status: 'running',
        createdAt: '2026-07-09T00:00:00.100Z',
        kind: 'tool_call',
        callId: 'call-1',
        toolName: 'bash',
        toolKind: 'command_execution',
        arguments: {}
      }
    }))
    await recorder.record(event({
      kind: 'turn_aborted',
      threadId: 'thread-1',
      turnId: 'turn-1',
      timestamp: '2026-07-09T00:00:00.400Z',
      message: 'interrupted'
    }))

    expect(sink.spans.map((span) => span.name)).toEqual(['kun.tool bash', 'kun.turn'])
    expect(sink.spans[0].status).toEqual({ code: 'ERROR', message: 'interrupted' })
  })
})

function event(input: Record<string, unknown>): RuntimeEvent {
  return { seq: 1, ...input } as RuntimeEvent
}
