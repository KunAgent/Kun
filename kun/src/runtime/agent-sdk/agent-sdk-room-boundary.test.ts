import { describe, expect, it, vi } from 'vitest'
import { makeHarness } from '../../../tests/loop-test-harness.js'
import { createAgentSdkRuntime } from './agent-sdk-runtime-factory.js'
import type { SdkRuntimeDeps } from './agent-sdk-runtime-contracts.js'
import type { AgentSdkRuntime } from './agent-sdk-runtime.js'
import { agentSdkCapabilities } from './agent-sdk-runtime-stream.js'
import { decideSdkBuiltinSandbox } from './agent-sdk-runtime-sandbox.js'
import { CanvasReceiptRegistry } from '../../services/canvas-receipt-registry.js'
import { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'

const model = { provider: 'test', model: 'test', async *stream() { yield { kind: 'completed' as const, stopReason: 'stop' as const } } }

describe('room SDK execution boundary', () => {
  it.each([true, false])('AgentLoop admits only a room-safe runtime: %s', async (roomToolPolicy) => {
    const runTurn = vi.fn(async () => 'completed' as const)
    const sdkRuntime = { handlesProvider: () => true,
      capabilities: () => ({ ...agentSdkCapabilities(), roomToolPolicy }), runTurn } as unknown as AgentSdkRuntime
    const h = makeHarness(model, { sdkRuntime })
    const thread = await h.threads.create({ title: 'Room', workspace: '/tmp', model: 'test', mode: 'agent' }, {
      relation: 'side', roomContext: { roomId: 'room', memberId: 'member', participantAgentId: 'agent',
        kind: 'conversation', blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] }
    })
    const turn = await h.turns.startTurn({ threadId: thread.id, request: { prompt: 'Work' } })
    await h.loop.runTurn(thread.id, turn.turnId)
    expect(runTurn).toHaveBeenCalledTimes(roomToolPolicy ? 1 : 0)
  })

  it('blocks native mutations and reads even with an unrestricted sandbox', () => {
    for (const tool of ['Bash', 'Read', 'Write', 'Task', 'WebFetch']) {
      expect(decideSdkBuiltinSandbox(tool, {}, { workspace: '/tmp', sandboxMode: 'danger-full-access',
        allowSdkBuiltins: false })).toMatchObject({ allow: false })
    }
  })

  it('uses the SDK call identity for a single accepted/applied receipt record', async () => {
    const h = makeHarness(model)
    const thread = await h.threads.create({ title: 'Receipt', workspace: '/tmp', model: 'test', mode: 'agent', approvalPolicy: 'auto' })
    const turn = await h.turns.startTurn({ threadId: thread.id, request: { prompt: 'Draw' } })
    const record = (await h.threadStore.get(thread.id))!
    record.turns.find((candidate) => candidate.id === turn.turnId)!.actingModelRoute = { model: 'test' }
    await h.threadStore.upsert(record)
    const receipts = new CanvasReceiptRegistry({ turns: h.turns, events: h.events, nowIso: () => new Date().toISOString() })
    const host = new LocalToolHost({ tools: [LocalToolHost.defineTool({ name: 'test_canvas', description: 'Canvas',
      inputSchema: { type: 'object', properties: {} }, execute: async () => ({
        output: { status: 'accepted', receiptKey: 'receipt' }
      }) })] })
    const runtime = createAgentSdkRuntime({ registry: CapabilityRegistry.fromLocalTools([]), toolHost: host,
      turns: h.turns, threadStore: h.threadStore, sessionStore: h.sessionStore, events: h.events,
      providerConfigs: {}, agentSdkProviderIds: new Set(),
      ids: { next: (prefix) => prefix }, prefix: { systemPrompt: '' }, defaultApprovalPolicy: 'auto', receipts })
    const deps = (runtime as unknown as { deps: SdkRuntimeDeps }).deps
    const result = deps.executeKunTool(thread.id, turn.turnId, 'test_canvas', {}, undefined, 'toolu_canvas')
    let early: unknown
    void result.then((value) => { early = value })
    await vi.waitFor(() => expect({ pending: receipts.pendingCount(), early }).toEqual({ pending: 1, early: undefined }))
    await receipts.fulfillForTurn('receipt', thread.id, turn.turnId, { status: 'applied' })
    await expect(result).resolves.toMatchObject({ output: { status: 'applied', ok: true } })
    const results = (await h.sessionStore.loadItems(thread.id)).filter((item) => item.kind === 'tool_result')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: `item_toolresult_${turn.turnId}_toolu_canvas`, callId: 'toolu_canvas' })
  })
})
