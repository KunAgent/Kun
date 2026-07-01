import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import {
  compareReplayReports,
  evaluateReplayQuality,
  ReplaySuiteSchema,
  runReplaySuite,
  SseMessageDecoder,
  summarizeReplayEvents,
  summarizeReplayRuns,
  type ObservedReplayEvent,
  type ReplayReport,
  type ReplayRunResult
} from './replay-benchmark.js'
import { buildRuntimeCapabilityManifest } from '../contracts/capabilities.js'

const baseTimestamp = Date.parse('2026-06-29T00:00:00.000Z')

function observed(event: RuntimeEvent, elapsedMs: number, delayMs = 10): ObservedReplayEvent {
  return {
    event,
    elapsedMs,
    receivedAtMs: Date.parse(event.timestamp) + delayMs
  }
}

function itemBase(kind: string) {
  return {
    kind,
    id: `item_${kind}`,
    turnId: 'turn_1',
    threadId: 'thread_1',
    role: kind === 'tool_result' ? 'tool' : 'assistant',
    status: 'completed',
    createdAt: '2026-06-29T00:00:00.000Z'
  }
}

describe('replay benchmark', () => {
  it('decodes SSE messages across arbitrary chunks', () => {
    const decoder = new SseMessageDecoder()
    const payload = [
      'id: 4',
      'event: turn_completed',
      `data: ${JSON.stringify({
        kind: 'turn_completed',
        seq: 4,
        timestamp: '2026-06-29T00:00:00.000Z',
        threadId: 'thread_1',
        turnId: 'turn_1',
        status: 'completed'
      })}`,
      '',
      ''
    ].join('\n')

    expect(decoder.push(payload.slice(0, 31))).toEqual([])
    expect(decoder.push(payload.slice(31))).toEqual([
      expect.objectContaining({ id: '4', event: 'turn_completed' })
    ])
  })

  it('computes TTFT, tool, SSE, usage, and memory metrics from runtime events', () => {
    const timestamp = (offset: number) => new Date(baseTimestamp + offset).toISOString()
    const events: ObservedReplayEvent[] = [
      observed({
        kind: 'assistant_text_delta',
        seq: 1,
        timestamp: timestamp(100),
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: { ...itemBase('assistant_text'), kind: 'assistant_text', text: 'hello' }
      } as RuntimeEvent, 120, 20),
      observed({
        kind: 'tool_call_started',
        seq: 2,
        timestamp: timestamp(180),
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: {
          ...itemBase('tool_call'),
          kind: 'tool_call',
          toolName: 'read',
          callId: 'call_1',
          toolKind: 'tool_call',
          arguments: { path: 'README.md' }
        }
      } as RuntimeEvent, 200, 20),
      observed({
        kind: 'tool_call_finished',
        seq: 3,
        timestamp: timestamp(430),
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: {
          ...itemBase('tool_result'),
          kind: 'tool_result',
          toolName: 'read',
          callId: 'call_1',
          toolKind: 'tool_call',
          output: { ok: true },
          isError: false
        }
      } as RuntimeEvent, 450, 20),
      observed({
        kind: 'usage',
        seq: 4,
        timestamp: timestamp(500),
        threadId: 'thread_1',
        turnId: 'turn_1',
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          cacheHitTokens: 60,
          cacheMissTokens: 40,
          cacheHitRate: 0.6,
          cacheableTokenHitRate: 0.75,
          totalInputTokenHitRate: 0.6,
          turns: 1,
          costUsd: 0.001
        }
      }, 520, 20),
      observed({
        kind: 'turn_completed',
        seq: 5,
        timestamp: timestamp(580),
        threadId: 'thread_1',
        turnId: 'turn_1',
        status: 'completed'
      }, 600, 20)
    ]

    expect(summarizeReplayEvents(events, 600, 256 * 1024 * 1024)).toEqual({
      ttftMs: 120,
      totalMs: 600,
      assistantChars: 5,
      eventCount: 5,
      errorEvents: 0,
      toolCalls: 1,
      toolDurationMs: 250,
      toolDurationP95Ms: 250,
      sseDelayP50Ms: 20,
      sseDelayP95Ms: 20,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheHitTokens: 60,
      cacheMissTokens: 40,
      cacheHitRate: 0.6,
      cacheableTokenHitRate: 0.75,
      totalInputTokenHitRate: 0.6,
      costUsd: 0.001,
      peakRssBytes: 256 * 1024 * 1024
    })
  })

  it('aggregates reports and identifies material regressions', () => {
    const baselineRun = replayRun('passed', 100, 1_000, 0.8)
    const currentRun = replayRun('passed', 200, 1_800, 0.6)
    const baseline = report([baselineRun], '2026-06-28T00:00:00.000Z')
    const current = report([currentRun], '2026-06-29T00:00:00.000Z')
    const comparison = compareReplayReports(current, baseline)

    expect(comparison.ttftP95MsDelta).toBe(100)
    expect(comparison.totalP95MsDelta).toBe(800)
    expect(comparison.cacheHitRateDelta).toBeCloseTo(-0.2)
    expect(comparison.regressions).toEqual(expect.arrayContaining([
      expect.stringContaining('total latency'),
      expect.stringContaining('cache hit rate')
    ]))
  })

  it('rejects duplicate task ids before spending model tokens', () => {
    expect(() => ReplaySuiteSchema.parse({
      version: 1,
      name: 'duplicate-suite',
      tasks: [
        { id: 'same', prompt: 'one' },
        { id: 'same', prompt: 'two' }
      ]
    })).toThrow('duplicate replay task id')
  })

  it('scores required output, changed files, forbidden behavior, and cost', () => {
    const task = ReplaySuiteSchema.parse({
      version: 1,
      name: 'quality-suite',
      tasks: [{
        id: 'quality',
        prompt: 'fix the pool',
        expect: {
          requiredOutputs: ['poolSize'],
          expectedChangedFiles: ['src/db.ts'],
          forbiddenBehaviors: ['force push'],
          maxCostUsd: 0.01
        }
      }]
    }).tasks[0]!
    const events: ObservedReplayEvent[] = [
      observed({
        kind: 'item_completed',
        seq: 1,
        timestamp: '2026-06-29T00:00:00.000Z',
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: {
          ...itemBase('tool_call'),
          kind: 'tool_call',
          toolName: 'edit',
          callId: 'call_edit',
          toolKind: 'file_change',
          arguments: { path: 'src/db.ts' }
        }
      } as RuntimeEvent, 10),
      observed({
        kind: 'item_completed',
        seq: 2,
        timestamp: '2026-06-29T00:00:00.010Z',
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: { ...itemBase('assistant_text'), kind: 'assistant_text', text: 'Updated poolSize safely.' }
      } as RuntimeEvent, 20)
    ]

    const quality = evaluateReplayQuality(task, { ...replayRun('passed', 10, 20, 0.8).metrics, costUsd: 0.005 }, events)

    expect(quality).toMatchObject({ score: 1, passed: true, violations: [] })
    expect(quality.breakdown.map((entry) => entry.dimension)).toEqual([
      'files',
      'forbidden',
      'outputs',
      'cost'
    ])
  })

  it('hard-fails replay quality when a forbidden behavior is observed', () => {
    const task = ReplaySuiteSchema.parse({
      version: 1,
      name: 'unsafe-suite',
      tasks: [{
        id: 'unsafe',
        prompt: 'publish changes',
        expect: { forbiddenBehaviors: ['force push'] }
      }]
    }).tasks[0]!
    const events = [observed({
      kind: 'item_completed',
      seq: 1,
      timestamp: '2026-06-29T00:00:00.000Z',
      threadId: 'thread_1',
      turnId: 'turn_1',
      item: {
        ...itemBase('tool_call'),
        kind: 'tool_call',
        toolName: 'bash',
        callId: 'call_bash',
        toolKind: 'command_execution',
        arguments: { command: 'force push origin main' }
      }
    } as RuntimeEvent, 10)]

    const quality = evaluateReplayQuality(task, replayRun('passed', 10, 20, 0.8).metrics, events)

    expect(quality.score).toBe(0)
    expect(quality.passed).toBe(false)
    expect(quality.violations.join(' ')).toContain('force push')
  })

  it('fails runs that do not use any required investigation tool', async () => {
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      if (url.pathname === '/v1/runtime/info') return jsonResponse(testRuntimeInfo())
      if (url.pathname === '/v1/threads' && init.method === 'POST') return jsonResponse({ id: 'thr_1' }, 201)
      if (url.pathname === '/v1/threads/thr_1/turns' && init.method === 'POST') {
        return jsonResponse({ threadId: 'thr_1', turnId: 'turn_1', userMessageItemId: 'item_user' }, 202)
      }
      if (url.pathname === '/v1/threads/thr_1/events') {
        return sseResponse([
          {
            kind: 'assistant_text_delta',
            seq: 1,
            timestamp: '2026-06-29T00:00:00.000Z',
            threadId: 'thr_1',
            turnId: 'turn_1',
            item: { ...itemBase('assistant_text'), id: 'item_text', threadId: 'thr_1', turnId: 'turn_1', text: 'hello' }
          } as RuntimeEvent,
          {
            kind: 'turn_completed',
            seq: 2,
            timestamp: '2026-06-29T00:00:00.010Z',
            threadId: 'thr_1',
            turnId: 'turn_1',
            status: 'completed'
          }
        ])
      }
      if (url.pathname === '/v1/threads/thr_1' && init.method === 'DELETE') {
        return jsonResponse({ id: 'thr_1', deleted: true })
      }
      return jsonResponse({ message: `unexpected ${init.method ?? 'GET'} ${url.pathname}` }, 404)
    }

    const report = await runReplaySuite({
      version: 1,
      name: 'tool-required-suite',
      tasks: [{
        id: 'no-tool',
        prompt: 'answer from memory',
        expect: {
          requiredAnyTools: ['read', 'grep', 'find', 'ls'],
          requiredOutputs: ['inspection complete']
        }
      }]
    }, {
      baseUrl: 'http://127.0.0.1:18899',
      token: 'token',
      workspace: '/tmp/workspace',
      fetchImpl
    })

    expect(report.runs[0]?.status).toBe('failed')
    expect(report.runs[0]?.failureReasons).toContain('none of the required tools were used: read, grep, find, ls')
    expect(report.runs[0]?.failureReasons).toContain('missing required output(s): inspection complete')
    expect(report.runs[0]?.quality?.passed).toBe(false)
  })

  it('interrupts timed-out turns before deleting replay threads', async () => {
    const calls: Array<{ method: string; path: string }> = []
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input))
      calls.push({ method: init.method ?? 'GET', path: `${url.pathname}${url.search}` })
      if (url.pathname === '/v1/runtime/info') return jsonResponse(testRuntimeInfo())
      if (url.pathname === '/v1/threads' && init.method === 'POST') return jsonResponse({ id: 'thr_1' }, 201)
      if (url.pathname === '/v1/threads/thr_1/turns' && init.method === 'POST') {
        return jsonResponse({ threadId: 'thr_1', turnId: 'turn_1', userMessageItemId: 'item_user' }, 202)
      }
      if (url.pathname === '/v1/threads/thr_1/events') return neverTerminalSse(init.signal)
      if (url.pathname === '/v1/threads/thr_1/turns/turn_1/interrupt' && init.method === 'POST') {
        return jsonResponse({ threadId: 'thr_1', turnId: 'turn_1', status: 'aborted' })
      }
      if (url.pathname === '/v1/threads/thr_1' && init.method === 'DELETE') {
        return jsonResponse({ id: 'thr_1', deleted: true })
      }
      return jsonResponse({ message: `unexpected ${init.method ?? 'GET'} ${url.pathname}` }, 404)
    }

    const report = await runReplaySuite({
      version: 1,
      name: 'timeout-suite',
      defaults: { timeoutMs: 20 },
      tasks: [{ id: 'slow', prompt: 'wait for a terminal event', expect: { minAssistantChars: 0 } }]
    }, {
      baseUrl: 'http://127.0.0.1:18899',
      token: 'token',
      workspace: '/tmp/workspace',
      fetchImpl
    })

    expect(report.runs[0]?.status).toBe('timeout')
    const interruptIndex = calls.findIndex((call) => call.path === '/v1/threads/thr_1/turns/turn_1/interrupt')
    const deleteIndex = calls.findIndex((call) => call.path === '/v1/threads/thr_1')
    expect(interruptIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(interruptIndex)
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function testRuntimeInfo() {
  return {
    host: '127.0.0.1',
    port: 18899,
    dataDir: '/tmp/kun-replay',
    model: 'deepseek-chat',
    startedAt: '2026-06-29T00:00:00.000Z',
    capabilities: buildRuntimeCapabilityManifest({
      model: {
        id: 'deepseek-chat',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      }
    })
  }
}

function sseResponse(events: RuntimeEvent[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`)
        )
      }
      controller.close()
    }
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' }
  })
}

function neverTerminalSse(signal?: AbortSignal | null): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const heartbeat = [
        'id: 1',
        'event: heartbeat',
        `data: ${JSON.stringify({
          kind: 'heartbeat',
          seq: 1,
          timestamp: '2026-06-29T00:00:00.000Z',
          threadId: 'thr_1'
        })}`,
        '',
        ''
      ].join('\n')
      const push = () => controller.enqueue(encoder.encode(heartbeat))
      const timer = setInterval(push, 1)
      push()
      signal?.addEventListener('abort', () => {
        clearInterval(timer)
        controller.error(new DOMException('aborted', 'AbortError'))
      }, { once: true })
    }
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' }
  })
}

function replayRun(
  status: ReplayRunResult['status'],
  ttftMs: number,
  totalMs: number,
  cacheHitRate: number
): ReplayRunResult {
  return {
    id: 'task#1',
    taskId: 'task',
    iteration: 1,
    tags: [],
    status,
    failureReasons: [],
    metrics: {
      ttftMs,
      totalMs,
      assistantChars: 10,
      eventCount: 5,
      errorEvents: 0,
      toolCalls: 0,
      toolDurationMs: 0,
      toolDurationP95Ms: null,
      sseDelayP50Ms: 10,
      sseDelayP95Ms: 20,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheHitTokens: cacheHitRate * 100,
      cacheMissTokens: (1 - cacheHitRate) * 100,
      cacheHitRate,
      cacheableTokenHitRate: cacheHitRate,
      totalInputTokenHitRate: cacheHitRate,
      costUsd: 0.001,
      peakRssBytes: 100
    }
  }
}

function report(runs: ReplayRunResult[], generatedAt: string): ReplayReport {
  return {
    version: 1,
    generatedAt,
    suite: { name: 'test', taskCount: runs.length, repeat: 1 },
    runtime: { baseUrl: 'http://127.0.0.1', startedAt: generatedAt },
    summary: summarizeReplayRuns(runs),
    runs
  }
}
