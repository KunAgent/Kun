import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { buildContextWindowToolProviders } from '../adapters/tool/context-window-tool-provider.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import { createThreadRecord } from '../domain/thread.js'
import { modelCapabilitiesForModel } from './model-context-profile.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ContextWindowNotes } from '../services/context-window-notes.js'
import { ContextWindowService } from '../services/context-window-service.js'
import { ContextWindowTurnModes } from '../services/context-window-turn-modes.js'
import { ContextWindowTransitionCoordinator } from '../services/context-window-transition-coordinator.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { AgentLoop } from './agent-loop.js'
import { ContextWindowBudget } from './context-window-budget.js'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'

const NOW = () => '2026-09-15T00:00:00.000Z'
const SECRET = 'PRE-BOUNDARY-SECRET'

function userItem(id: string, text: string): TurnItem {
  return {
    id, turnId: 'turn-seed', threadId: 'thread-w',
    kind: 'user_message', role: 'user', status: 'completed',
    createdAt: NOW(), text
  }
}

function createHarness(model: ModelClient) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const eventBus = new InMemoryEventBus()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const ids = new SequentialIdGenerator()
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso: NOW
  })
  const modes = new ContextWindowTurnModes(() => 'windows')
  const budget = new ContextWindowBudget({ nowIso: NOW })
  const contextWindows = new ContextWindowService({
    sessionStore,
    notes: new ContextWindowNotes({
      store: new (class {
        async listNoteFiles() { return [] }
        async readNote() { return null }
        async writeNote() { return { status: 'conflict' as const, path: '', expectedRevision: 0, actualRevision: 0 } }
        async appendNote() { return { status: 'replayed' as const, revision: 0 } }
        async copyThreadData() {}
        async deleteThreadData() {}
      })() as never
    }),
    ids
  })
  const transition = new ContextWindowTransitionCoordinator({
    contextWindows,
    events,
    modes,
    budget,
    ids,
    sessionStore,
    hasPendingInteractions: (threadId, excludedCallId) =>
      inflight.list().some((record) =>
        record.threadId === threadId && record.kind === 'tool' && record.callId !== excludedCallId),
    requestItemCount: async (threadId) => (await sessionStore.loadItems(threadId)).length,
    committedOperation: (threadId, operationId) =>
      contextWindows.hasWindowOperation(threadId, operationId)
  })
  const windowTools = buildContextWindowToolProviders({
    service: contextWindows,
    mode: (context) => modes.modeFor(context.threadId, context.turnId),
    newContextTransition: (context, args) => transition.asToolTransition(model.model)(context, args)
  })[0]!.tools
  const compactor = new ContextCompactor()
  const turns = new TurnService({
    threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso: NOW
  })
  const loop = new AgentLoop({
    threadStore,
    sessionStore,
    approvalGate: { request: async () => 'allow' } as never,
    userInputGate: {} as never,
    model,
    toolHost: new LocalToolHost({ tools: [...windowTools] }),
    usage: new UsageService(),
    events,
    turns,
    inflight,
    steering,
    compactor,
    prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
    ids,
    nowIso: NOW,
    contextWindowModes: modes,
    contextWindowTransition: transition,
    contextWindowBudget: budget,
    modelCapabilities: (route) => ({
      ...modelCapabilitiesForModel(route),
      contextWindowTokens: 100_000
    })
  })
  return { sessionStore, threadStore, turns, loop, model, modes, budget, transition }
}

async function runTurn(harness: ReturnType<typeof createHarness>, prompt: string) {
  if (!await harness.threadStore.get('thread-w')) {
    await harness.threadStore.upsert(createThreadRecord({
      id: 'thread-w',
      title: 'window integration',
      workspace: '/tmp/workspace',
      model: harness.model.model
    }))
  }
  const started = await harness.turns.startTurn({ threadId: 'thread-w', request: { prompt } })
  harness.modes.freeze({ threadId: 'thread-w', turnId: started.turnId })
  return harness.loop.runTurn('thread-w', started.turnId)
}

class NewContextThenDoneModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'window-model'
  readonly requests: ModelRequest[] = []
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      yield { kind: 'tool_call_complete', callId: 'call_nc1', toolName: 'new_context', arguments: {} }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'continued after transition' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class GrowingModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'growing-model'
  readonly requests: ModelRequest[] = []
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    const call = this.requests.length
    yield {
      kind: 'assistant_text_delta',
      text: call === 2 ? 'x'.repeat(160_000) : `step ${call} output`
    }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

describe('window-mode loop integration (review findings P1-1/P1-2/P1-3)', () => {
  it('P1-1: a standalone new_context call commits while it is itself inflight', async () => {
    const model = new NewContextThenDoneModel()
    const harness = createHarness(model)
    await harness.sessionStore.appendItem('thread-w', userItem('u-seed', `task with ${SECRET}`))

    await expect(runTurn(harness, 'run the task')).resolves.toBe('completed')

    const items = await harness.sessionStore.loadItems('thread-w')
    const boundary = items.find((item) => item.kind === 'context_window')
    expect(boundary).toBeDefined()
    expect(model.requests).toHaveLength(2)
  })

  it('P1-2: window initialization reaches the next model request with the task pointer', async () => {
    const model = new NewContextThenDoneModel()
    const harness = createHarness(model)
    await harness.sessionStore.appendItem('thread-w', userItem('u-seed', `task with ${SECRET}`))

    await expect(runTurn(harness, 'run the task')).resolves.toBe('completed')

    expect(model.requests).toHaveLength(2)
    const nextRequest = model.requests[1]!
    // The initialization text rides the request as post-prefix context.
    const instructions = nextRequest.contextInstructions ?? []
    const init = instructions.find((entry) => entry.includes('[context window 1 ('))
    expect(init).toBeDefined()
    expect(init).toContain('Current task message:')
    expect(init).not.toContain(SECRET)
    // No pre-boundary conversation text leaked into the new window's history.
    const historyText = JSON.stringify(nextRequest.history)
    expect(historyText).not.toContain(SECRET)
    expect(historyText).not.toContain('u-seed')
  })

  it('P1-3: a request crossing 50% delivers exactly one budget notice to the model', async () => {
    const model = new GrowingModel()
    const harness = createHarness(model)

    await expect(runTurn(harness, 'step one')).resolves.toBe('completed')
    await expect(runTurn(harness, 'step two')).resolves.toBe('completed')
    await expect(runTurn(harness, 'step three')).resolves.toBe('completed')
    expect(model.requests).toHaveLength(3)

    const carriesNotice = (request: ModelRequest) =>
      (request.contextInstructions ?? []).some((entry) => entry.includes('[context window'))
    // The first request already crosses 25% (the output reservation counts
    // toward usage), so it carries the first notice.
    expect(carriesNotice(model.requests[0]!)).toBe(true)
    // The same usage on the next request re-fires nothing: marks dedup.
    expect(carriesNotice(model.requests[1]!)).toBe(false)
    // The big response crosses 50/75%: exactly one new notice reaches the model.
    expect(carriesNotice(model.requests[2]!)).toBe(true)
    expect(model.requests.filter(carriesNotice)).toHaveLength(2)

    // The notices counted into the window budget.
    const state = harness.budget.stateFor('thread-w', 'win-0')
      ?? harness.budget.snapshot().find((entry) => entry.threadId === 'thread-w')
    expect(state && state.noticeTokens > 0).toBe(true)
    // And the covered marks prevent a re-fire on the following request.
    await expect(runTurn(harness, 'step four')).resolves.toBe('completed')
    expect(model.requests.filter(carriesNotice)).toHaveLength(2)
  })
})
