import { describe, expect, it, vi } from 'vitest'
import { bootstrapThread, makeHarness } from '../../tests/loop-test-harness.js'
import { MemoryRecord } from '../contracts/memory.js'
import type { MemoryStore } from './memory-store.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
import { assembleMemoryRelationContext } from './memory-working-context.js'
import { emptyMemoryRelationContext } from '../contracts/memory-working-context.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createAgentSdkRuntime } from '../runtime/agent-sdk/agent-sdk-runtime-factory.js'
import type { SdkRuntimeDeps } from '../runtime/agent-sdk/agent-sdk-runtime-contracts.js'
import { createCursorSdkRuntime } from '../runtime/cursor/cursor-sdk-runtime-factory.js'
import type { CursorSdkRuntimeDeps } from '../runtime/cursor/cursor-sdk-runtime.js'

const annotation = {
  id: 'relation_' + 'a'.repeat(64), kind: 'contradicts' as const,
  source: { id: 'mem_a', revision: 1 }, target: { id: 'mem_b', revision: 1 },
  reviewedAt: '2026-10-20T00:00:00Z'
}
const records = ['mem_a', 'mem_b'].map((id) => MemoryRecord.parse({
  id, content: 'Database version ' + (id === 'mem_a' ? '17' : '16'), scope: 'user',
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z'
}))

describe('relation annotations across real turn-context entry points', () => {
  it.each((['native', 'agent-sdk', 'cursor-sdk'] as const).flatMap((engine) =>
    [false, true].map((room) => ({ engine, room }))))(
    '$engine preserves opt-in context and the room=$room boundary', async ({ engine, room }) => {
      const requests: ModelRequest[] = []
      const model: ModelClient = { provider: 'test', model: 'fake', async *stream(request) {
        requests.push(request)
        yield { kind: 'assistant_text_delta', text: 'Synthetic answer.' }
        yield { kind: 'completed', stopReason: 'stop' }
      } }
      const relationContext = vi.fn(async () => assembleMemoryRelationContext([annotation], 1600, true))
      const memoryStore = { retrieve: vi.fn(async () => records), setLastInjected: vi.fn(), relationContext } as unknown as MemoryStore
      const h = makeHarness(model, { memoryStore, tools: [] })
      await bootstrapThread(h, { request: { prompt: 'Database version?' } })
      if (room) {
        const thread = (await h.threadStore.get(h.threadId))!
        thread.roomContext = { roomId: 'room', memberId: 'member', participantAgentId: 'agent',
          kind: 'conversation', blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] }
        await h.threadStore.upsert(thread)
      }
      const common = { registry: CapabilityRegistry.fromLocalTools([]), toolHost: new LocalToolHost({ tools: [] }),
        turns: h.turns, threadStore: h.threadStore, sessionStore: h.sessionStore, events: h.events,
        providerConfigs: {}, ids: h.ids, memoryStore, defaultApprovalPolicy: 'auto' as const }
      let run: () => Promise<string>
      if (engine === 'native') {
        run = async () => {
          requests.length = 0
          await h.loop.runTurn(h.threadId, h.turnId)
          expect(requests.every((request) => !request.systemPrompt?.includes(annotation.id))).toBe(true)
          return JSON.stringify(requests)
        }
      } else if (engine === 'agent-sdk') {
        const runtime = createAgentSdkRuntime({ ...common, agentSdkProviderIds: new Set(), prefix: { systemPrompt: 'Stable prefix' } })
        const deps = (runtime as unknown as { deps: SdkRuntimeDeps }).deps
        run = async () => (await deps.loadTurnContext(h.threadId, h.turnId))?.contextInstructions?.join('\n') ?? ''
      } else {
        const runtime = createCursorSdkRuntime({ ...common, providerIds: new Set(), defaultIsCursor: true, defaultModel: 'fake' })
        const deps = (runtime as unknown as { deps: CursorSdkRuntimeDeps }).deps
        run = async () => (await deps.loadKunTurnContext!({ threadId: h.threadId, turnId: h.turnId,
          userText: 'Database version?', actingModelRoute: { model: 'fake' }, signal: new AbortController().signal
        })).instructionBlocks.join('\n')
      }
      const text = await run()
      if (room) {
        expect(text).not.toContain(annotation.id)
        expect(memoryStore.retrieve).not.toHaveBeenCalled()
        expect(relationContext).not.toHaveBeenCalled()
        return
      }
      expect(text).toContain(annotation.id)
      expect(text).toContain('MEMORY_RELATION_DATA')
      expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryRelations).toEqual([annotation])
      expect(memoryStore.setLastInjected).toHaveBeenCalledWith(['mem_a', 'mem_b'])
      if (engine !== 'native') {
        relationContext.mockResolvedValueOnce(emptyMemoryRelationContext())
        expect(await run()).not.toContain(annotation.id)
        expect((await h.turns.getTurn(h.threadId, h.turnId))?.injectedMemoryRelations).toEqual([])
      }
    })
})
