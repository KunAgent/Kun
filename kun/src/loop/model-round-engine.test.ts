import { describe, expect, it, vi } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { CacheRequestSignature } from '../cache/cache-diagnostics.js'
import type { TurnItem } from '../contracts/items.js'
import { ModelRoundEngine, type ModelRoundEngineDeps } from './model-round-engine.js'

const usage = {
  promptTokens: 3,
  completionTokens: 2,
  totalTokens: 5,
  cacheHitRate: null,
  turns: 1
}

/**
 * Keep the expected side-effect order explicit: assistant content that the
 * provider emitted before a tool call must also be persisted before that tool.
 */
const TOOL_ROUND_TIMELINE_REFERENCE = {
  requests: [{
    threadId: 'thread_1',
    turnId: 'turn_1',
    model: 'model_1',
    prefixItems: 0,
    historyItems: 0,
    toolNames: []
  }],
  cacheSignatures: [{
    model: 'model_1',
    providerId: 'builtin',
    endpointFormat: 'openai',
    prefixFingerprint: 'prefix',
    toolCatalogFingerprint: 'tools',
    activeSkillIds: []
  }],
  outcome: {
    kind: 'tool_calls',
    snapshot: {
      text: 'answer',
      reasoning: 'think',
      toolCalls: [{ callId: 'call_tool_3', toolName: 'read', providerId: 'builtin', arguments: {} }],
      stopReason: 'tool_calls'
    }
  },
  trace: [
    'stage:pre_send',
    'stage:post_send',
    'item:assistant_reasoning:delta',
    'event:assistant_reasoning_delta',
    'item:assistant_text:delta',
    'event:assistant_text_delta',
    'item:assistant_reasoning',
    'item:assistant_text',
    'item:tool_call',
    'event:tool_call_ready',
    'telemetry:pressure',
    'usage:record',
    'goal:usage',
    'event:usage',
    'stage:response_received'
  ]
} as const

function chunks(values: readonly ModelStreamChunk[]): AsyncIterable<ModelStreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* values
    }
  }
}

function requestSummary(request: ModelRequest) {
  return {
    threadId: request.threadId,
    turnId: request.turnId,
    model: request.model,
    prefixItems: request.prefix.length,
    historyItems: request.history.length,
    toolNames: request.tools.map((tool) => tool.name)
  }
}

function harness(values: readonly ModelStreamChunk[]) {
  const trace: string[] = []
  const requests: ModelRequest[] = []
  const cacheSignatures: CacheRequestSignature[] = []
  const recordedEvents: Array<Parameters<ModelRoundEngineDeps['events']['record']>[0]> = []
  const appliedItems: Array<Parameters<ModelRoundEngineDeps['turns']['applyItem']>[1]> = []
  const deltaItems: Array<Extract<TurnItem, {
    kind: 'assistant_text' | 'assistant_reasoning'
  }>> = []
  let id = 0
  let streamFactory = (): AsyncIterable<ModelStreamChunk> => chunks(values)
  const deps: ModelRoundEngineDeps = {
    model: {
      stream: (request) => {
        requests.push(request)
        return streamFactory()
      }
    },
    events: {
      record: async (event) => {
        recordedEvents.push(event)
        trace.push(`event:${event.kind}`)
        return event as never
      }
    },
    turns: {
      applyItem: async (_threadId, item) => {
        appliedItems.push(item)
        trace.push(`item:${item.kind}`)
      },
      applyAssistantDelta: async (threadId, item, deltaText, deltaOffset) => {
        if (item.kind !== 'assistant_text' && item.kind !== 'assistant_reasoning') {
          throw new TypeError(`unexpected delta item: ${item.kind}`)
        }
        deltaItems.push(item)
        trace.push(`item:${item.kind}:delta`)
        if (item.kind === 'assistant_text') {
          recordedEvents.push({
            kind: 'assistant_text_delta',
            threadId,
            turnId: item.turnId,
            itemId: item.id,
            deltaOffset,
            item: { ...item, text: deltaText }
          })
          trace.push('event:assistant_text_delta')
          return
        }
        recordedEvents.push({
          kind: 'assistant_reasoning_delta',
          threadId,
          turnId: item.turnId,
          itemId: item.id,
          deltaOffset,
          item: { ...item, text: deltaText }
        })
        trace.push('event:assistant_reasoning_delta')
      }
    },
    usage: {
      record: (_threadId, _usage, signature) => {
        trace.push('usage:record')
        if (signature) cacheSignatures.push(signature)
        return usage
      }
    },
    telemetry: {
      recordPromptPressure: () => { trace.push('telemetry:pressure') }
    },
    ids: {
      next: (prefix) => `${prefix}_${++id}`
    },
    recordPipelineStage: async (_threadId, _turnId, stage) => { trace.push(`stage:${stage}`) },
    recordGoalUsage: async () => { trace.push('goal:usage') },
    rememberFailure: () => { trace.push('failure') },
    recordToolCallLimit: async () => { trace.push('limit') }
  }
  const engine = new ModelRoundEngine(deps)
  const controller = new AbortController()
  return {
    trace,
    requests,
    cacheSignatures,
    recordedEvents,
    appliedItems,
    deltaItems,
    controller,
    engine,
    setStream: (next: () => AsyncIterable<ModelStreamChunk>) => { streamFactory = next },
    run: (options: {
      maxToolCallsPerStep?: number
      toolCallOverflowBehavior?: 'fail' | 'truncate'
      onRouteSelected?: (route: NonNullable<ModelStreamChunk['route']>) => Promise<void>
    } = {}) => engine.run({
      threadId: 'thread_1',
      turnId: 'turn_1',
      signal: controller.signal,
      request: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        model: 'model_1',
        prefix: [],
        history: [],
        tools: [],
        abortSignal: controller.signal
      },
      maxToolCallsPerStep: options.maxToolCallsPerStep ?? 1,
      ...(options.toolCallOverflowBehavior
        ? { toolCallOverflowBehavior: options.toolCallOverflowBehavior }
        : {}),
      streamToolMetadata: new Map([['read', { providerId: 'builtin' }]]),
      cacheSignature: {
        model: 'model_1', providerId: 'builtin', endpointFormat: 'openai', prefixFingerprint: 'prefix',
        toolCatalogFingerprint: 'tools', activeSkillIds: []
      },
      preSendDetails: { model: 'model_1' },
      postSendDetails: { model: 'model_1' },
      ...(options.onRouteSelected
        ? { onRouteSelected: options.onRouteSelected }
        : {}),
      writeGeneratedImage: async () => {
        trace.push('image:write')
        return { markdown: '\n![generated image](generated.png)\n' }
      }
    })
  }
}

describe('ModelRoundEngine', () => {
  it('dispatches the model stream before awaiting post-send telemetry', async () => {
    const test = harness([])
    test.setStream(() => ({
      async *[Symbol.asyncIterator]() {
        test.trace.push('model:dispatched')
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }))

    await test.run()

    expect(test.trace.indexOf('model:dispatched')).toBeLessThan(
      test.trace.indexOf('stage:post_send')
    )
  })

  it('preserves stream side-effect order through final persistence', async () => {
    const test = harness([
      { kind: 'assistant_reasoning_delta', text: 'think' },
      { kind: 'assistant_text_delta', text: 'answer' },
      { kind: 'tool_call_complete', callId: 'call_1', toolName: 'read', arguments: {} },
      { kind: 'usage', usage },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])

    const outcome = await test.run()
    expect({
      requests: test.requests.map(requestSummary),
      cacheSignatures: test.cacheSignatures,
      outcome,
      trace: test.trace
    }).toEqual(TOOL_ROUND_TIMELINE_REFERENCE)
    const liveReasoning = test.recordedEvents.find(
      (event) => event.kind === 'assistant_reasoning_delta'
    )
    const liveText = test.recordedEvents.find(
      (event) => event.kind === 'assistant_text_delta'
    )
    expect(liveReasoning).toMatchObject({
      deltaOffset: 0,
      item: {
        createdAt: test.appliedItems.find((item) => item.kind === 'assistant_reasoning')?.createdAt
      }
    })
    expect(liveText).toMatchObject({
      deltaOffset: 0,
      item: {
        createdAt: test.appliedItems.find((item) => item.kind === 'assistant_text')?.createdAt
      }
    })
  })

  it('freezes a committed route before persisting its tool call', async () => {
    const route = {
      routePoolId: 'pool',
      targetId: 'target-b',
      providerId: 'provider-b',
      modelId: 'model-b',
      requestedModelId: 'model-auto'
    }
    const test = harness([
      {
        kind: 'tool_call_complete',
        callId: 'call_1',
        toolName: 'read',
        arguments: {},
        route
      },
      { kind: 'completed', stopReason: 'tool_calls', route }
    ])

    await expect(test.run({
      onRouteSelected: async (selected) => {
        test.trace.push(`route:${selected.targetId}`)
      }
    })).resolves.toMatchObject({ kind: 'tool_calls' })

    expect(test.trace.indexOf('route:target-b')).toBeLessThan(
      test.trace.indexOf('item:tool_call')
    )
  })

  it('fails closed if a provider changes target after the route is committed', async () => {
    const test = harness([
      {
        kind: 'assistant_text_delta',
        text: 'partial',
        route: {
          routePoolId: 'pool',
          targetId: 'target-a',
          providerId: 'provider-a',
          modelId: 'model-a',
          requestedModelId: 'model-auto'
        }
      },
      {
        kind: 'completed',
        stopReason: 'stop',
        route: {
          routePoolId: 'pool',
          targetId: 'target-b',
          providerId: 'provider-b',
          modelId: 'model-b',
          requestedModelId: 'model-auto'
        }
      }
    ])

    await expect(test.run()).rejects.toThrow('model route changed after stream commit')
  })

  it('allocates distinct runtime ids when separate model steps reuse a provider call id', async () => {
    const test = harness([
      { kind: 'tool_call_complete', callId: 'call_1', toolName: 'read', arguments: { path: 'file.ts' } },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])

    const first = await test.run()
    const second = await test.run()

    expect(first).toMatchObject({
      kind: 'tool_calls',
      snapshot: { toolCalls: [{ callId: 'call_tool_1' }] }
    })
    expect(second).toMatchObject({
      kind: 'tool_calls',
      snapshot: { toolCalls: [{ callId: 'call_tool_2' }] }
    })
    const toolCallItems = test.appliedItems.filter((item) => item.kind === 'tool_call')
    expect(toolCallItems.map((item) => item.id)).toEqual([
      'item_tool_turn_1_call_tool_1',
      'item_tool_turn_1_call_tool_2'
    ])
    expect(new Set(toolCallItems.map((item) => item.id)).size).toBe(2)
  })

  it('persists provider-owned tool metadata without adding it to GUI runtime events', async () => {
    const test = harness([
      {
        kind: 'tool_call_complete',
        callId: 'call_1',
        toolName: 'read',
        arguments: { path: 'file.ts' },
        providerMetadata: {
          gemini: { thoughtSignature: 'opaque-provider-signature' }
        }
      },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])

    await expect(test.run()).resolves.toEqual(expect.objectContaining({ kind: 'tool_calls' }))
    expect(test.appliedItems.find((item) => item.kind === 'tool_call')).toMatchObject({
      providerMetadata: {
        gemini: { thoughtSignature: 'opaque-provider-signature' }
      }
    })
    expect(JSON.stringify(test.recordedEvents)).not.toContain('opaque-provider-signature')
  })

  it('keeps unresolved raw arguments for execution but redacts persisted history and events', async () => {
    const raw = '{"path":"private-round-marker"'
    const test = harness([
      {
        kind: 'tool_call_complete',
        callId: 'call_raw',
        toolName: 'read',
        arguments: { __raw: raw }
      },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])

    const outcome = await test.run()

    expect(outcome).toMatchObject({
      kind: 'tool_calls',
      snapshot: { toolCalls: [{ arguments: { __raw: raw } }] }
    })
    expect(test.appliedItems.find((item) => item.kind === 'tool_call')).toMatchObject({
      arguments: {},
      summary: expect.stringMatching(
        new RegExp(`${Buffer.byteLength(raw, 'utf8')} UTF-8 bytes; sha256 [a-f0-9]{64}`)
      )
    })
    expect(JSON.stringify(test.appliedItems)).not.toContain('private-round-marker')
    expect(JSON.stringify(test.recordedEvents)).not.toContain('private-round-marker')
  })

  it('allocates distinct runtime ids when one model step repeats a provider call id', async () => {
    const test = harness([
      { kind: 'tool_call_complete', callId: 'call_shared', toolName: 'read', arguments: { path: 'a.ts' } },
      { kind: 'tool_call_complete', callId: 'call_shared', toolName: 'read', arguments: { path: 'b.ts' } },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])

    const outcome = await test.run({ maxToolCallsPerStep: 2 })

    expect(outcome).toMatchObject({
      kind: 'tool_calls',
      snapshot: {
        toolCalls: [
          { callId: 'call_shared', arguments: { path: 'a.ts' } },
          { callId: 'call_tool_1', arguments: { path: 'b.ts' } }
        ]
      }
    })
    const itemIds = test.appliedItems
      .filter((item) => item.kind === 'tool_call')
      .map((item) => item.id)
    expect(itemIds).toEqual([
      'item_tool_turn_1_call_shared',
      'item_tool_turn_1_call_tool_1'
    ])
  })

  it('returns the accepted tool batch when configured to truncate overflow', async () => {
    const test = harness([
      { kind: 'tool_call_complete', callId: 'call_kept', toolName: 'read', arguments: { path: 'a.ts' } },
      { kind: 'tool_call_complete', callId: 'call_truncated', toolName: 'read', arguments: { path: 'b.ts' } },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])

    await expect(test.run({
      maxToolCallsPerStep: 1,
      toolCallOverflowBehavior: 'truncate'
    })).resolves.toMatchObject({
      kind: 'tool_calls',
      snapshot: { toolCalls: [{ callId: 'call_kept' }] }
    })
    expect(test.appliedItems.filter((item) => item.kind === 'tool_call')).toHaveLength(1)
    expect(test.trace).not.toContain('limit')
  })

  it('coalesces provider-sized deltas without changing event order or final text', async () => {
    const reasoning = 'r'.repeat(2_000)
    const text = 't'.repeat(2_000)
    const test = harness([
      ...[...reasoning].map((value): ModelStreamChunk => ({
        kind: 'assistant_reasoning_delta',
        text: value
      })),
      ...[...text].map((value): ModelStreamChunk => ({
        kind: 'assistant_text_delta',
        text: value
      })),
      {
        kind: 'retrying',
        status: 429,
        attempt: 1,
        maxAttempts: 2,
        delayMs: 10,
        failureSummary: 'Provider rate limit resets shortly.'
      },
      { kind: 'completed', stopReason: 'stop' }
    ])

    await expect(test.run()).resolves.toEqual(expect.objectContaining({ kind: 'completed' }))
    const deltaPayloads = test.recordedEvents.flatMap((event) => {
      if (
        (event.kind === 'assistant_reasoning_delta' || event.kind === 'assistant_text_delta') &&
        'item' in event &&
        'text' in event.item
      ) {
        return [[event.kind, event.item.text]]
      }
      return []
    })
    expect(deltaPayloads).toEqual([
      ['assistant_reasoning_delta', reasoning],
      ['assistant_text_delta', text]
    ])
    expect(test.recordedEvents.map((event) => event.kind)).toEqual([
      'assistant_reasoning_delta',
      'assistant_text_delta',
      'model_request_retry'
    ])
    expect(test.recordedEvents.at(-1)).toMatchObject({
      kind: 'model_request_retry',
      failureSummary: 'Provider rate limit resets shortly.'
    })
    expect(test.appliedItems.map((item) => [item.kind, 'text' in item ? item.text : ''])).toEqual([
      ['assistant_reasoning', reasoning],
      ['assistant_text', text]
    ])
    expect(test.deltaItems.map((item) => [item.kind, item.text])).toEqual([
      ['assistant_reasoning', reasoning],
      ['assistant_text', text]
    ])
  })

  it('splits one large provider delta into replay-safe UTF-8 event blocks', async () => {
    const text = `${'a'.repeat(4_095)}${'💡'.repeat(2_000)}`
    const test = harness([
      { kind: 'assistant_text_delta', text },
      { kind: 'completed', stopReason: 'stop' }
    ])

    await expect(test.run()).resolves.toEqual(expect.objectContaining({ kind: 'completed' }))
    const deltas = test.recordedEvents.filter((event) => event.kind === 'assistant_text_delta')
    expect(deltas.length).toBeGreaterThan(1)
    const retained = deltas.map((event) => {
      if (
        event.kind !== 'assistant_text_delta' ||
        !('item' in event) ||
        event.item.kind !== 'assistant_text'
      ) return ''
      return event.item.text
    })
    expect(retained.join('')).toBe(text)
    expect(retained.every((value) => Buffer.byteLength(value, 'utf8') <= 4 * 1024)).toBe(true)
    expect(deltas.map((event) => 'deltaOffset' in event ? event.deltaOffset : undefined)).toEqual(
      retained.reduce<number[]>((offsets, value) => [
        ...offsets,
        (offsets.at(-1) ?? 0) + (offsets.length === 0 ? 0 : retained[offsets.length - 1]!.length)
      ], [])
    )
  })

  it('flushes a low-volume delta while the provider is paused and leaves no timer behind', async () => {
    vi.useFakeTimers()
    try {
      let releaseProvider!: () => void
      let providerWaiting!: () => void
      const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve })
      const waiting = new Promise<void>((resolve) => { providerWaiting = resolve })
      const test = harness([])
      const stream = async function *(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'assistant_text_delta', text: 'live' }
        providerWaiting()
        await providerGate
        yield { kind: 'completed', stopReason: 'stop' }
      }
      test.setStream(() => stream())

      const running = test.run()
      await waiting
      expect(test.recordedEvents).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(40)
      expect(test.recordedEvents).toHaveLength(1)
      expect(test.recordedEvents[0]).toMatchObject({
        kind: 'assistant_text_delta',
        item: { text: 'live' }
      })

      releaseProvider()
      await expect(running).resolves.toEqual(expect.objectContaining({ kind: 'completed' }))
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not emit response_received after a per-step tool limit', async () => {
    const test = harness([
      { kind: 'tool_call_complete', callId: 'call_1', toolName: 'read', arguments: {} },
      { kind: 'tool_call_complete', callId: 'call_2', toolName: 'read', arguments: {} }
    ])

    await expect(test.run()).resolves.toEqual({ kind: 'failed' })
    expect(test.trace).toEqual([
      'stage:pre_send',
      'stage:post_send',
      'item:tool_call',
      'event:tool_call_ready',
      'failure',
      'limit'
    ])
  })

  it('persists accumulated output but does not consume buffered calls after abort', async () => {
    const test = harness([])
    const stream = async function *(): AsyncIterable<ModelStreamChunk> {
      yield { kind: 'assistant_text_delta', text: 'partial' }
      test.controller.abort()
      yield { kind: 'tool_call_complete', callId: 'call_1', toolName: 'read', arguments: {} }
    }
    test.setStream(() => stream())

    await expect(test.run()).resolves.toEqual({ kind: 'aborted' })
    expect(test.trace).toEqual([
      'stage:pre_send',
      'stage:post_send',
      'item:assistant_text:delta',
      'event:assistant_text_delta',
      'item:assistant_text'
    ])
  })

  it('writes an image before it becomes an assistant text delta', async () => {
    const test = harness([
      { kind: 'image_generation_complete', imageBase64: 'aW1hZ2U=', mimeType: 'image/png' },
      { kind: 'completed', stopReason: 'stop' }
    ])

    await expect(test.run()).resolves.toEqual(expect.objectContaining({ kind: 'completed' }))
    expect(test.trace).toEqual([
      'stage:pre_send',
      'stage:post_send',
      'image:write',
      'item:assistant_text:delta',
      'event:assistant_text_delta',
      'stage:response_received',
      'item:assistant_text'
    ])
  })

  it('drains and persists text after a model error while keeping failure sticky', async () => {
    const test = harness([
      { kind: 'assistant_text_delta', text: 'partial' },
      { kind: 'error', message: 'upstream failed', code: 'upstream' },
      { kind: 'completed', stopReason: 'stop' }
    ])

    await expect(test.run()).resolves.toEqual({ kind: 'failed' })
    expect(test.trace).toEqual([
      'stage:pre_send', 'stage:post_send', 'item:assistant_text:delta',
      'event:assistant_text_delta', 'failure', 'event:error',
      'stage:response_received', 'item:assistant_text'
    ])
    // The provider's own error chunk must remain the surfaced failure.
    expect(test.recordedEvents.at(-1)).toMatchObject({
      kind: 'error', message: 'upstream failed', code: 'upstream'
    })
  })

  it('synthesizes a diagnostic when a provider ends with only an error stop reason', async () => {
    const test = harness([{ kind: 'completed', stopReason: 'error' }])

    await expect(test.run()).resolves.toEqual({ kind: 'failed' })
    expect(test.trace).toEqual([
      'stage:pre_send', 'stage:post_send', 'stage:response_received',
      'failure', 'event:error'
    ])
    expect(test.recordedEvents.at(-1)).toMatchObject({
      kind: 'error', code: 'model_error_without_message',
      message: expect.stringContaining('without returning a diagnostic message')
    })
  })

  it('keeps usage-only successful streams replayable through the coordinator safety net', async () => {
    // The engine intentionally still returns completed for an empty-but-
    // successful stream: bounded recovery paths (post-tool, goal, required
    // tool) need the empty snapshot. RoundOutcomeCoordinator owns the
    // terminal model_empty_response failure once recovery declines to act.
    const test = harness([
      { kind: 'usage', usage },
      { kind: 'completed', stopReason: 'stop' }
    ])

    await expect(test.run()).resolves.toEqual({
      kind: 'completed',
      snapshot: { text: '', reasoning: '', toolCalls: [], stopReason: 'stop' }
    })
    expect(test.trace).toEqual([
      'stage:pre_send', 'stage:post_send', 'telemetry:pressure', 'usage:record',
      'goal:usage', 'event:usage', 'stage:response_received'
    ])
  })

  it('flushes pending deltas and the final item when the provider iterator throws', async () => {
    const test = harness([])
    const stream = async function *(): AsyncIterable<ModelStreamChunk> {
      yield { kind: 'assistant_reasoning_delta', text: 'partial thought' }
      throw new Error('provider disconnected')
    }
    test.setStream(() => stream())

    await expect(test.run()).rejects.toThrow('provider disconnected')
    expect(test.trace).toEqual([
      'stage:pre_send',
      'stage:post_send',
      'item:assistant_reasoning:delta',
      'event:assistant_reasoning_delta',
      'item:assistant_reasoning'
    ])
    expect(test.recordedEvents[0]).toMatchObject({
      kind: 'assistant_reasoning_delta',
      item: { text: 'partial thought' }
    })
    expect(test.appliedItems[0]).toMatchObject({
      kind: 'assistant_reasoning',
      text: 'partial thought',
      status: 'completed'
    })
  })
})
