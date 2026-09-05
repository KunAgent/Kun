import { describe, expect, it, vi } from 'vitest'
// Initialize the LocalToolHost/builtin catalog before importing ReviewService.
// The production composition root follows this order as well.
import '../src/adapters/tool/local-tool-host.js'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import { makeReviewItem } from '../src/domain/item.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import { InflightTracker } from '../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../src/loop/steering-queue.js'
import { RandomIdGenerator } from '../src/ports/id-generator.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { ThreadService } from '../src/services/thread-service.js'
import { TurnService } from '../src/services/turn-service.js'
import type {
  ModelClient,
  ModelRequest,
  ModelStreamChunk
} from '../src/ports/model-client.js'

type IsolatedReviewer = {
  runIsolatedReviewer(input: {
    prompt: string
    workspace: string
    model: string
    reasoningEffort?: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max'
    onProgress?: (message: string) => void | Promise<void>
    signal: AbortSignal
  }): Promise<string>
}

const successfulReviewJson = JSON.stringify({
  findings: [],
  overallCorrectness: 'patch is correct',
  overallExplanation: 'No blocking issues found.',
  overallConfidenceScore: 0.9
})

const reviewInspectionPaths = [
  '.',
  'kun',
  'src',
  'docs',
  'scripts',
  'packages',
  'resources',
  'benchmarks'
]

function inspectingUntilFinalModel(
  modelName: string,
  options: { visibleFirstRound?: boolean } = {}
): { model: ModelClient; requests: ModelRequest[] } {
  const requests: ModelRequest[] = []
  const model: ModelClient = {
    provider: 'test',
    model: modelName,
    async *stream(request): AsyncIterable<ModelStreamChunk> {
      requests.push(request)
      if (request.tools.length === 0) {
        yield { kind: 'assistant_text_delta', text: successfulReviewJson }
        yield { kind: 'completed', stopReason: 'stop' }
        return
      }
      if (options.visibleFirstRound && requests.length === 1) {
        yield { kind: 'assistant_reasoning_delta', text: 'Inspect the relevant files.' }
        yield { kind: 'assistant_text_delta', text: 'I will inspect the workspace.' }
      }
      yield {
        kind: 'tool_call_complete',
        callId: `call_visible_ls_${requests.length}`,
        toolName: 'ls',
        arguments: { path: reviewInspectionPaths[requests.length - 1] ?? '.' }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
    }
  }
  return { model, requests }
}

describe('ReviewService isolation', () => {
  it('creates the isolated reviewer with a read-only sandbox', async () => {
    const { ReviewService } = await import('../src/services/review-service.js')
    const service = new ReviewService({
      threadStore: {} as never,
      turns: {} as never,
      model: {} as never,
      defaultModel: 'test-model',
      nowIso: () => '2026-07-10T00:00:00.000Z'
    })
    let request: { approvalPolicy?: string; sandboxMode?: string } | undefined
    const create = vi.spyOn(ThreadService.prototype, 'create').mockImplementation(async (input) => {
      request = input
      throw new Error('stop after capturing child thread request')
    })
    const isolated = service as unknown as IsolatedReviewer

    try {
      await expect(isolated.runIsolatedReviewer({
        prompt: 'Review an untrusted diff.',
        workspace: '/workspace/project',
        model: 'test-model',
        signal: new AbortController().signal
      })).rejects.toThrow('stop after capturing child thread request')
    } finally {
      create.mockRestore()
    }

    expect(request).toMatchObject({
      approvalPolicy: 'auto',
      sandboxMode: 'read-only'
    })
  })

  it('inherits the requested reasoning effort and projects safe child progress', async () => {
    const requests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'test',
      model: 'test-model',
      async *stream(request): AsyncIterable<ModelStreamChunk> {
        requests.push(request)
        if (requests.length === 1) {
          yield { kind: 'assistant_reasoning_delta', text: 'private reasoning' }
          yield {
            kind: 'tool_call_complete',
            callId: 'call_ls',
            toolName: 'ls',
            arguments: { path: '.' }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: successfulReviewJson }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const { ReviewService } = await import('../src/services/review-service.js')
    const service = new ReviewService({
      threadStore: {} as never,
      turns: {} as never,
      model,
      defaultModel: model.model,
      nowIso: () => '2026-08-12T00:00:00.000Z'
    })
    const progress: string[] = []

    const text = await (service as unknown as IsolatedReviewer).runIsolatedReviewer({
      prompt: 'Review current changes.',
      workspace: process.cwd(),
      model: model.model,
      reasoningEffort: 'max',
      onProgress: (message) => {
        progress.push(message)
      },
      signal: new AbortController().signal
    })

    expect(text).toBe(successfulReviewJson)
    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.reasoningEffort === 'max')).toBe(true)
    expect(progress).toContain('Analyzing the changed code...')
    expect(progress).toContain('Inspecting the workspace with ls...')
    expect(progress.join('\n')).not.toContain('private reasoning')
  })

  it('reserves the last configured model step for final synthesis', async () => {
    const { model, requests } = inspectingUntilFinalModel('bounded-review-model')
    const { ReviewService } = await import('../src/services/review-service.js')
    const service = new ReviewService({
      threadStore: {} as never,
      turns: {} as never,
      model,
      defaultModel: model.model,
      nowIso: () => '2026-08-12T00:00:00.000Z',
      runtime: { turnLimits: { maxSteps: 3 } }
    })

    await expect((service as unknown as IsolatedReviewer).runIsolatedReviewer({
      prompt: 'Review current changes.',
      workspace: process.cwd(),
      model: model.model,
      signal: new AbortController().signal
    })).resolves.toBe(successfulReviewJson)
    expect(requests).toHaveLength(3)
    expect(requests.slice(0, 2).every((request) => request.tools.length > 0)).toBe(true)
    expect(requests[2]?.tools).toEqual([])
  })

  it('uses a single no-tool synthesis request when maxSteps is one', async () => {
    const { model, requests } = inspectingUntilFinalModel('single-step-review-model')
    const { ReviewService } = await import('../src/services/review-service.js')
    const service = new ReviewService({
      threadStore: {} as never,
      turns: {} as never,
      model,
      defaultModel: model.model,
      nowIso: () => '2026-08-12T00:00:00.000Z',
      runtime: { turnLimits: { maxSteps: 1 } }
    })

    await expect((service as unknown as IsolatedReviewer).runIsolatedReviewer({
      prompt: 'Review current changes.',
      workspace: process.cwd(),
      model: model.model,
      signal: new AbortController().signal
    })).resolves.toBe(successfulReviewJson)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.tools).toEqual([])
  })

  it('projects reviewer reasoning, intermediate text, and tools into the parent turn', async () => {
    const { model, requests } = inspectingUntilFinalModel(
      'visible-review-model',
      { visibleFirstRound: true }
    )
    const nowIso = () => '2026-08-12T00:00:00.000Z'
    const eventBus = new InMemoryEventBus()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const ids = new RandomIdGenerator()
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    const threads = new ThreadService({ threadStore, sessionStore, events, ids, nowIso })
    const thread = await threads.create({
      title: 'Visible review',
      workspace: process.cwd(),
      model: model.model,
      mode: 'agent'
    })
    const started = await turns.startTurn({
      threadId: thread.id,
      request: { prompt: '/review', model: model.model, mode: 'agent' }
    })
    const reviewItemId = `item_${started.turnId}_review`
    await turns.applyItem(thread.id, makeReviewItem({
      id: reviewItemId,
      threadId: thread.id,
      turnId: started.turnId,
      target: { kind: 'custom', instructions: 'Review the test workspace.' },
      title: 'Custom code review',
      status: 'running'
    }))
    const { ReviewService } = await import('../src/services/review-service.js')
    const service = new ReviewService({
      threadStore,
      turns,
      model,
      defaultModel: model.model,
      nowIso
    })

    await expect(service.runReview({
      threadId: thread.id,
      turnId: started.turnId,
      reviewItemId,
      target: { kind: 'custom', instructions: 'Review the test workspace.' },
      model: model.model,
      reasoningEffort: 'high'
    })).resolves.toBe('completed')
    expect(requests).toHaveLength(9)
    expect(requests.slice(0, 8).every((request) => request.tools.length > 0)).toBe(true)
    expect(requests[8]?.tools).toEqual([])

    const items = await sessionStore.loadItems(thread.id)
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant_reasoning', text: 'Inspect the relevant files.' }),
      expect.objectContaining({ kind: 'assistant_text', text: 'I will inspect the workspace.' }),
      expect.objectContaining({ kind: 'tool_call', toolName: 'ls' }),
      expect.objectContaining({ kind: 'tool_result', toolName: 'ls' }),
      expect.objectContaining({ kind: 'review', status: 'completed' })
    ]))
    expect(items.filter((item) => item.kind === 'assistant_text')).toHaveLength(1)
    expect(items.some((item) =>
      item.kind === 'assistant_text' && item.text.includes('overallCorrectness')
    )).toBe(false)
    expect(items.findIndex((item) => item.kind === 'assistant_text')).toBeLessThan(
      items.findIndex((item) => item.kind === 'tool_call')
    )
    const parentEvents = await sessionStore.loadEventsSince(thread.id, 0)
    expect(parentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'assistant_reasoning_delta',
        threadId: thread.id,
        turnId: started.turnId
      }),
      expect.objectContaining({
        kind: 'item_created',
        threadId: thread.id,
        turnId: started.turnId,
        item: expect.objectContaining({ kind: 'tool_call', toolName: 'ls' })
      })
    ]))
  })
})
