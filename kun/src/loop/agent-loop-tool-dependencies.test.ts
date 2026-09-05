import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { InMemoryArtifactStore } from '../artifacts/artifact-store.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { createThreadRecord } from '../domain/thread.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import type { ToolHost } from '../ports/tool-host.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { CanvasReceiptRegistry } from '../services/canvas-receipt-registry.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { AgentLoop } from './agent-loop.js'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'

class ToolThenStopModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'tool-dependency-model'
  private round = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.round += 1
    if (this.round === 1) {
      yield {
        kind: 'tool_call_complete', callId: 'call_design_large',
        toolName: 'design_large_result', arguments: {}
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'done' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

describe('AgentLoop tool execution dependencies', () => {
  it('wires renderer receipts and artifact offload into the live loop', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-08-30T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus, sessionStore, allocateSeq: (threadId) => eventBus.allocateSeq(threadId), nowIso
    })
    const compactor = new ContextCompactor()
    const turns = new TurnService({
      threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso
    })
    const register = vi.fn()
    const awaitTurnReceipts = vi.fn(async () => undefined)
    const receipts = { register, awaitTurnReceipts } as unknown as CanvasReceiptRegistry
    const artifactStore = new InMemoryArtifactStore(nowIso)
    const model = new ToolThenStopModel()
    const localToolHost = new LocalToolHost({ tools: [LocalToolHost.defineTool({
      name: 'design_large_result',
      description: 'return a large accepted design payload',
      inputSchema: { type: 'object', additionalProperties: false },
      toolKind: 'tool_call',
      policy: 'auto',
      execute: async () => ({
        output: {
          status: 'accepted', receiptKey: 'receipt-large-design', ops: [],
          payload: 'x'.repeat(1024 * 1024 + 64)
        }
      })
    })] })
    // Keep this integration focused on AgentLoop -> ToolExecutionService;
    // LocalToolHost has its own earlier 128 KiB offload boundary.
    const toolHost: ToolHost = {
      id: 'unoffloaded-test-host',
      listTools: (context) => localToolHost.listTools(context),
      execute: (call, context, onUpdate) => {
        const { artifactStore: _artifactStore, ...withoutArtifactStore } = context
        return localToolHost.execute(call, withoutArtifactStore, onUpdate)
      }
    }
    const loop = new AgentLoop({
      threadStore, sessionStore,
      approvalGate: { request: async () => 'allow' } as never,
      userInputGate: {} as never,
      model, toolHost, usage: new UsageService(), events, turns, inflight, steering, compactor,
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), ids, nowIso, receipts, artifactStore
    })
    const threadId = 'thread_tool_dependencies'
    await threadStore.upsert(createThreadRecord({
      id: threadId, title: 'Tool dependencies', workspace: '/tmp/workspace', model: model.model
    }))
    const started = await turns.startTurn({ threadId, request: { prompt: 'run tool', model: model.model } })

    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('completed')
    const persistedItems = await sessionStore.loadItems(threadId)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      receiptKey: 'receipt-large-design', threadId, turnId: started.turnId
    }))
    expect(awaitTurnReceipts).toHaveBeenCalled()
    const artifacts = await artifactStore.list()
    expect(artifacts).toHaveLength(1)
    const toolResult = persistedItems.find((item) => item.kind === 'tool_result')
    expect(toolResult?.output).toMatchObject({ artifactId: artifacts[0]?.id })
  })
})
