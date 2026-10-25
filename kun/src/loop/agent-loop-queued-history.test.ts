import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { ItemEvent } from '../contracts/events.js'
import { createThreadRecord } from '../domain/thread.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { ContextWindowTurnModes } from '../services/context-window-turn-modes.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { AgentLoop } from './agent-loop.js'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'

const threadId = 'thread_queued_history'
const followup = 'FOLLOWUP_ONLY_ONCE'

async function fixture(mode: 'windows' | 'model_compact', guide: boolean) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const bus = new InMemoryEventBus()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const ids = new SequentialIdGenerator()
  let now = Date.now()
  const nowIso = () => new Date(now).toISOString()
  const events = new RuntimeEventRecorder({
    eventBus: bus, sessionStore, allocateSeq: (id) => bus.allocateSeq(id), nowIso
  })
  const compactor = new ContextCompactor()
  const turns = new TurnService({ threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso })
  const requests: ModelRequest[] = []
  let queuedId = ''
  const model: ModelClient = {
    provider: 'test', model: 'test',
    async *stream(request): AsyncIterable<ModelStreamChunk> {
      requests.push(request)
      if (requests.length === 1) {
        const queued = await turns.startTurn({
          threadId, request: { prompt: followup, enqueueIfBusy: true }
        })
        queuedId = queued.turnId
        if (guide) {
          await turns.steerTurn({
            threadId, turnId: request.turnId, sourceTurnId: queuedId,
            operationId: 'guide-followup', text: followup
          })
        }
        yield { kind: 'tool_call_complete', callId: 'call_ping', toolName: 'ping', arguments: {} }
        yield { kind: 'completed', stopReason: 'tool_calls' }
        return
      }
      yield { kind: 'assistant_text_delta', text: 'Finished the current request.' }
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
  const loop = new AgentLoop({
    threadStore, sessionStore, events, turns, inflight, steering, compactor, ids, nowIso, model,
    approvalGate: { request: async () => 'allow' } as never,
    userInputGate: {} as never,
    toolHost: new LocalToolHost({ tools: [LocalToolHost.defineTool({
      name: 'ping', description: 'Return a local test result',
      inputSchema: { type: 'object', additionalProperties: false },
      toolKind: 'tool_call', policy: 'auto', execute: async () => ({ output: 'pong' })
    })] }),
    usage: new UsageService(),
    prefix: createImmutablePrefix({ systemPrompt: 'Complete only the current request.' }),
    contextWindowModes: new ContextWindowTurnModes(() => mode)
  })
  await threadStore.upsert({
    ...createThreadRecord({ id: threadId, workspace: '/tmp/workspace', model: 'test', title: 'Queue isolation' }),
    titleAuto: false
  })
  const first = await turns.startTurn({ threadId, request: { prompt: 'Original request' } })
  return { loop, turns, requests, sessionStore, threadStore, bus, first,
    queuedId: () => queuedId, advance: () => { now += 240_000 } }
}

describe('AgentLoop queued history isolation', () => {
  it.each(['windows', 'model_compact'] as const)('executes a queued follow-up only after promotion in %s mode', async (mode) => {
    const f = await fixture(mode, false)
    await expect(f.loop.runTurn(threadId, f.first.turnId)).resolves.toBe('completed')
    const firstRequests = f.requests.filter((request) => request.turnId === f.first.turnId)
    expect(firstRequests).toHaveLength(2)
    for (const request of firstRequests) expect(JSON.stringify(request.history)).not.toContain(followup)
    const canonicalUser = (await f.sessionStore.loadItems(threadId))
      .filter((item) => item.kind === 'user_message').find((item) => item.turnId === f.queuedId())!
    expect(canonicalUser.text).toBe(followup)

    f.advance()
    await expect(f.turns.startNextQueuedTurn(threadId)).resolves.toEqual({ turnId: f.queuedId() })
    const promoted = (await f.threadStore.get(threadId))!.turns.find((turn) => turn.id === f.queuedId())!
    const userEvent = f.bus.snapshotSince(threadId, 0).find((event) =>
      event.kind === 'item_created' && event.turnId === f.queuedId())!
    expect(ItemEvent.parse(userEvent)).toMatchObject({
      turnStartedAt: promoted.startedAt, item: { createdAt: canonicalUser.createdAt }
    })
    expect(Date.parse(promoted.startedAt!) - Date.parse(canonicalUser.createdAt)).toBeGreaterThan(239_000)
    await expect(f.loop.runTurn(threadId, f.queuedId())).resolves.toBe('completed')
    const queuedRequests = f.requests.filter((request) => request.turnId === f.queuedId())
    expect(queuedRequests).toHaveLength(1)
    expect(queuedRequests[0].history.filter((item) => item.kind === 'user_message' && item.text === followup)).toHaveLength(1)
    const history = queuedRequests[0].history
    expect(history.findIndex((item) => item.id === canonicalUser.id)).toBeGreaterThan(
      history.findIndex((item) => item.turnId === f.first.turnId && item.kind === 'assistant_text'))
    await expect(f.turns.startNextQueuedTurn(threadId)).resolves.toBeNull()
  })

  it.each(['windows', 'model_compact'] as const)('delivers formal guidance once and retires its queue source in %s mode', async (mode) => {
    const f = await fixture(mode, true)
    await expect(f.loop.runTurn(threadId, f.first.turnId)).resolves.toBe('completed')
    const users = f.requests[1].history.filter((item) => item.kind === 'user_message' && item.text === followup)
    expect(users).toHaveLength(1)
    expect(users[0].turnId).toBe(f.first.turnId)
    expect((await f.threadStore.get(threadId))!.turns.find((turn) => turn.id === f.queuedId()))
      .toMatchObject({ status: 'aborted', steeredToTurnId: f.first.turnId, terminalCode: 'queue_steered' })
    await expect(f.turns.startNextQueuedTurn(threadId)).resolves.toBeNull()
  })
})
