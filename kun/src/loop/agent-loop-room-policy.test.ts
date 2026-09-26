import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost, type LocalTool } from '../adapters/tool/local-tool-host.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { createThreadRecord } from '../domain/thread.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { AgentLoop } from './agent-loop.js'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'

describe('native Rooms tool policy', () => {
  it('hides denied tools and rejects fabricated calls at the actual host execution boundary', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-09-12T00:00:00.000Z'
    const events = new RuntimeEventRecorder({ eventBus, sessionStore,
      allocateSeq: (id) => eventBus.allocateSeq(id), nowIso })
    const compactor = new ContextCompactor()
    const turns = new TurnService({ threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso })
    const performed: string[] = []
    const tool = (name: string): LocalTool => ({ name, description: name,
      inputSchema: { type: 'object', properties: {} }, sideEffect: 'read-only', toolKind: 'tool_call', policy: 'auto',
      execute: async (_args, context) => {
        performed.push(name)
        expect(context).toMatchObject({ workspace: '/room-task', sandboxMode: 'workspace-write',
          approvalPolicy: 'always', allowedReadPaths: ['.'], allowedWritePaths: ['.'], memoryPolicy: { enabled: false } })
        return { output: 'Read complete' }
      }
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry([
      { id: 'builtin', kind: 'built-in', enabled: true, available: true,
        tools: [tool('read'), tool('forbidden'), tool('runtime_forbidden')] },
      { id: 'mcp:private', kind: 'mcp', enabled: true, available: true, tools: [tool('secret_connector')] }
    ]) })
    const listings: string[][] = []
    let round = 0
    const model: ModelClient = { provider: 'test', model: 'test',
      async *stream(request): AsyncIterable<ModelStreamChunk> {
        listings.push(request.tools?.map((entry) => entry.name) ?? [])
        if (round++ === 0) {
          for (const name of ['forbidden', 'secret_connector', 'runtime_forbidden', 'read']) {
            yield { kind: 'tool_call_complete', callId: `call_${name}`, toolName: name, arguments: {} }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
        } else {
          yield { kind: 'assistant_text_delta', text: 'Read complete.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      }
    }
    const schedule = vi.fn()
    const loop = new AgentLoop({ threadStore, sessionStore,
      approvalGate: { request: async () => 'allow', get: () => undefined } as never, userInputGate: {} as never,
      model, toolHost: host, usage: new UsageService(), events, turns, inflight, steering, compactor,
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), ids, nowIso,
      blockedToolNames: ['runtime_forbidden'], memoryDistillation: { schedule }
    })
    await threadStore.upsert(createThreadRecord({ id: 'room_thread', title: 'Room task',
      workspace: '/room-task', model: 'test', approvalPolicy: 'always', sandboxMode: 'workspace-write',
      roomContext: { roomId: 'room_one', memberId: 'member_one', taskId: 'task_one', kind: 'execution',
        blockedToolNames: ['forbidden'], blockedProviderIds: ['mcp:private'], blockedSkillIds: [] } }))
    await expect(turns.startTurn({ threadId: 'room_thread', request: {
      prompt: 'Broaden scope', sandboxMode: 'danger-full-access', approvalPolicy: 'auto'
    } })).rejects.toThrow('policy is frozen')
    await expect(turns.enqueueTurn({ threadId: 'room_thread', request: {
      prompt: 'Broaden scope', sandboxMode: 'danger-full-access'
    } })).rejects.toThrow('policy is frozen')
    expect((await threadStore.get('room_thread'))?.turns).toHaveLength(0)
    const started = await turns.startTurn({ threadId: 'room_thread', request: { prompt: 'Read task files' } })
    await expect(loop.runTurn('room_thread', started.turnId)).resolves.toBe('completed')
    expect(listings[0]).toEqual(['read'])
    expect(performed).toEqual(['read'])
    const results = (await sessionStore.loadItems('room_thread')).filter((item) => item.kind === 'tool_result')
    expect(results.filter((item) => item.isError)).toHaveLength(3)
    expect(schedule).not.toHaveBeenCalled()
  })
})
