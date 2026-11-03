import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { buildMemoryToolProviders } from '../adapters/tool/memory-tool-provider.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { createThreadRecord } from '../domain/thread.js'
import { FileMemoryStore } from '../memory/memory-store.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { AgentLoop } from './agent-loop.js'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('room memory discovery and execution', () => {
  it.each([
    { kind: 'conversation', readOnly: false, enabled: true, decision: 'allow', advertised: true, saved: true },
    { kind: 'conversation', readOnly: false, enabled: true, decision: 'deny', advertised: true, saved: false },
    { kind: 'conversation', readOnly: false, enabled: false, decision: 'allow', advertised: false, saved: false },
    { kind: 'conversation', readOnly: true, enabled: true, decision: 'allow', advertised: false, saved: false },
    ...(['execution', 'discussion', 'review', 'coordination'] as const).map((kind) => ({
      kind, readOnly: false, enabled: true, decision: 'allow', advertised: false, saved: false
    }))
  ] as const)('$kind readOnly=$readOnly enabled=$enabled approval=$decision', async (scenario) => {
    const root = await mkdtemp(join(tmpdir(), 'kun-room-memory-'))
    roots.push(root)
    const nowIso = () => '2026-10-30T00:00:00.000Z'
    const memoryStore = new FileMemoryStore({ rootDir: join(root, 'memory'), nowIso,
      idGenerator: () => 'memory_one', config: { enabled: true, scopes: ['user'], maxInjectedRecords: 8,
        distillation: { enabled: false }, directives: { enabled: true, maxRecords: 20, maxCharacters: 4_000 } } })
    const retrieve = vi.spyOn(memoryStore, 'retrieve')
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const events = new RuntimeEventRecorder({ eventBus, sessionStore,
      allocateSeq: (id) => eventBus.allocateSeq(id), nowIso })
    const compactor = new ContextCompactor()
    const turns = new TurnService({ threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso })
    // Keep the provider registered in the disabled-store case: the loop policy
    // must independently reject a stale catalog and fabricated model call.
    const host = new LocalToolHost({ registry: new CapabilityRegistry(buildMemoryToolProviders(memoryStore)) })
    const listings: string[][] = []
    let round = 0
    const model: ModelClient = { provider: 'test', model: 'test',
      async *stream(request): AsyncIterable<ModelStreamChunk> {
        listings.push(request.tools?.map((entry) => entry.name) ?? [])
        if (round++ === 0) {
          yield { kind: 'tool_call_complete', callId: 'call_memory', toolName: 'memory_create',
            arguments: { content: 'Always use concise replies', scope: 'user', authority: 'directive' } }
          yield { kind: 'completed', stopReason: 'tool_calls' }
        } else {
          yield { kind: 'assistant_text_delta', text: 'Done.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      }
    }
    const requestApproval = vi.fn(async () => scenario.decision)
    const schedule = vi.fn()
    const loop = new AgentLoop({ threadStore, sessionStore,
      approvalGate: { request: requestApproval, get: () => undefined } as never, userInputGate: {} as never,
      model, toolHost: host, usage: new UsageService(), events, turns, inflight, steering, compactor,
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), ids, nowIso,
      ...(scenario.enabled ? { memoryStore } : {}), memoryDistillation: { schedule }
    })
    await threadStore.upsert(createThreadRecord({ id: 'room_thread', title: 'Room', workspace: root,
      model: 'test', approvalPolicy: 'auto', sandboxMode: scenario.readOnly ? 'read-only' : 'danger-full-access',
      roomContext: { roomId: 'room_one', memberId: 'member_one', taskId: 'task_one', kind: scenario.kind,
        participantAgentId: 'agent_one', blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } }))
    const started = await turns.startTurn({ threadId: 'room_thread', request: { prompt: 'Remember my reply preference' } })
    await expect(loop.runTurn('room_thread', started.turnId)).resolves.toBe('completed')
    expect(listings[0]?.includes('memory_create')).toBe(scenario.advertised)
    expect(requestApproval).toHaveBeenCalledTimes(scenario.advertised ? 1 : 0)
    if (scenario.advertised) {
      expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
        action: expect.objectContaining({ requiresUserDecision: true })
      }))
    }
    const records = await memoryStore.list({ all: true })
    expect(records).toHaveLength(scenario.saved ? 1 : 0)
    if (scenario.saved) expect(records[0]).toMatchObject({ authority: 'directive', scope: 'user', sourceThreadId: 'room_thread' })
    expect(retrieve).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })
})
