import { describe, expect, it } from 'vitest'
import { contextWindowToolSpecs } from '../../contracts/context-windows.js'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { resolveCompatModelCapabilities } from './compat-capabilities.js'
import { RoutePoolHealthStore, RoutePoolModelClient } from './route-pool-model-client.js'

/**
 * Tool support is a route capability, not an endpoint-format detail: every
 * endpoint family (chat completions, anthropic messages, openai responses)
 * advertises the same ten window tools, so a route that cannot execute tools
 * cannot run `new_context` either. These tests pin the adapter/route-level
 * detection that the runtime turn-admission hook (window mode, task 4.x) must
 * consume BEFORE any window transition could be attempted: a route without
 * tool support must fail closed with no model request at all.
 */

const noToolCapability = (model: string): ModelCapabilityMetadata => ({
  id: model,
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportsToolCalling: false,
  messageParts: ['text']
})

const toolCapability = (model: string): ModelCapabilityMetadata => ({
  ...noToolCapability(model),
  supportsToolCalling: true
})

function pool(modelId = 'no-tools-model'): ModelRoutePoolConfig {
  return {
    id: 'no-tools-pool',
    name: 'No tools pool',
    modelId,
    enabled: true,
    strategy: 'priority',
    targets: [
      { id: 'a', providerId: 'provider-a', modelId: 'no-tools-model', enabled: true, weight: 1 }
    ],
    failurePolicy: {
      failoverHttpStatusCodes: [429, 500, 502, 503, 504],
      failoverOnNetworkError: true,
      failoverOnTimeout: true,
      failoverOnAuthError: true
    },
    healthPolicy: { failureThreshold: 2, cooldownMs: 1_000, halfOpenMaxAttempts: 1 }
  }
}

function request(patch: Partial<ModelRequest> = {}): ModelRequest {
  return {
    threadId: 'thread-cw',
    turnId: 'turn-cw',
    model: 'no-tools-model',
    prefix: [],
    history: [],
    tools: contextWindowToolSpecs.map((spec) => ({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema
    })),
    abortSignal: new AbortController().signal,
    ...patch
  }
}

async function drain(stream: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

class FakeDirect implements ModelClient {
  provider = 'fake'
  model = 'default'
  seen: string[] = []
  async *stream(req: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.seen.push(`${req.providerId}/${req.model}`)
    yield { kind: 'assistant_text_delta', text: 'ok' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

describe('window tools on routes without tool support', () => {
  it('capability resolution reports supportsToolCalling=false regardless of endpoint format', () => {
    for (const endpointFormat of ['chat_completions', 'messages', 'responses'] as const) {
      const capabilities = resolveCompatModelCapabilities({
        model: 'no-tools-model',
        providerEndpointFormat: endpointFormat,
        modelCapabilities: noToolCapability
      })
      expect(capabilities.endpointFormat).toBe(endpointFormat)
      expect(capabilities.supportsToolCalling).toBe(false)
    }
  })

  it('route pool refuses a window-tool request on a no-tools route without calling the model', async () => {
    const direct = new FakeDirect()
    const client = new RoutePoolModelClient(direct, [pool()], noToolCapability)

    const chunks = await drain(client.stream(request()))

    expect(direct.seen).toEqual([])
    const last = chunks.at(-1)
    expect(last).toMatchObject({ kind: 'error', code: 'route_no_eligible_target' })
    expect(last && 'message' in last ? last.message : '').toContain('no-tools-model')
  })

  it('route pool serves the same request once the target supports tool calling', async () => {
    const direct = new FakeDirect()
    const client = new RoutePoolModelClient(direct, [pool()], toolCapability)

    const chunks = await drain(client.stream(request()))

    expect(direct.seen).toEqual(['provider-a/no-tools-model'])
    expect(chunks.some((chunk) => chunk.kind === 'completed')).toBe(true)
  })

  it('a no-tools request without window tools still reaches the model', async () => {
    const direct = new FakeDirect()
    const client = new RoutePoolModelClient(direct, [pool()], noToolCapability)

    const chunks = await drain(client.stream(request({ tools: [] })))

    expect(direct.seen).toEqual(['provider-a/no-tools-model'])
    expect(chunks.some((chunk) => chunk.kind === 'completed')).toBe(true)
  })

  // Runtime admission hook (spec scenario "Unsupported model capabilities"):
  // at turn acceptance, when the frozen mode snapshot is 'windows', the
  // turn service pairs it with the route capabilities resolved the same way
  // the loop does and fails admission when supportsToolCalling is false --
  // before any new_context could commit an unrecoverable window clear. The
  // tests above prove the adapter-level detection inputs are correct; this
  // one pins the turn-level wiring in kun/src/services.
  it('window-mode turn admission rejects a no-tools route before any window transition', async () => {
    const { InMemorySessionStore } = await import('../../adapters/in-memory-session-store.js')
    const { InMemoryThreadStore } = await import('../../adapters/in-memory-thread-store.js')
    const { InMemoryEventBus } = await import('../../adapters/in-memory-event-bus.js')
    const { ContextCompactor } = await import('../../loop/context-compactor.js')
    const { InflightTracker } = await import('../../loop/inflight-tracker.js')
    const { SteeringQueue } = await import('../../loop/steering-queue.js')
    const { SequentialIdGenerator } = await import('../../ports/id-generator.js')
    const { createThreadRecord } = await import('../../domain/thread.js')
    const { TurnService } = await import('../../services/turn-service.js')
    const { RuntimeEventRecorder } = await import('../../services/runtime-event-recorder.js')
    const { ContextWindowTurnModes } = await import('../../services/context-window-turn-modes.js')

    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const modes = new ContextWindowTurnModes(() => 'windows')
    const service = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso: () => '2026-09-14T00:00:00.000Z'
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      contextWindowModes: modes,
      modelCapabilities: (model) =>
        model === 'tools-model' ? toolCapability(model) : noToolCapability(model),
      ids: new SequentialIdGenerator(),
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    await threadStore.upsert(createThreadRecord({
      id: 'thread-no-tools',
      title: 'No tools route',
      workspace: '/tmp/workspace',
      model: 'no-tools-model'
    }))

    await expect(service.startTurn({
      threadId: 'thread-no-tools',
      request: { prompt: 'start the window task' }
    })).rejects.toThrow('window-mode context requires a route with tool support')

    // Fail closed: no turn items, no window state, no transition committed.
    expect(await sessionStore.loadItems('thread-no-tools')).toEqual([])
    expect(modes.windowFor('thread-no-tools')).toBeUndefined()
    expect((await threadStore.get('thread-no-tools'))?.turns).toEqual([])

    // The same thread on a tool-capable route is admitted normally.
    const admitted = await service.startTurn({
      threadId: 'thread-no-tools',
      request: { prompt: 'start the window task', model: 'tools-model' }
    })
    expect(admitted.turnId).toEqual(expect.any(String))
    await service.interruptActiveTurns()
  })
})
