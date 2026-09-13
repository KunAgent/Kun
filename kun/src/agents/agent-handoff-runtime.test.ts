import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHarness } from '../../tests/loop-test-harness.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { roomResultProvider } from '../rooms/room-result-tools.js'
import { RoomService, putRoomDocument } from '../rooms/room-service.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomPeerStore } from '../rooms/room-peer-state.js'
import { bindRoomPeerStore } from '../rooms/room-peer-tools.js'
import { QueuedTurnDispatcher } from '../server/queued-turn-dispatcher.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { RoomRuntimeDeps, RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomMessage } from '../contracts/rooms.js'
import { AgentIdentityService } from './agent-identity-service.js'
import { openAgentConversation } from './agent-conversations.js'
import { AgentHandoffService } from './agent-handoff-service.js'
import { AgentHandoffRunner } from './agent-handoff-runner.js'
import { bindAgentHandoffService } from './agent-handoff-tools.js'
import { inspectRoomRun } from '../rooms/room-run-query.js'
import type { AgentHandoff } from '../contracts/agent-handoffs.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
async function waiting(promise: Promise<void>, signal: AbortSignal) {
  let abort!: () => void
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(new Error('aborted'))
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })])
  } finally { signal.removeEventListener('abort', abort) }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-agent-handoff-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanups.push(() => store.close())
  const calls: ModelRequest[] = []
  const steps = new Map<string, number>()
  let hold: Promise<void> | undefined, childAgentId: string | undefined
  const model: ModelClient = { provider: 'fake', model: 'fake',
    async *stream(request): AsyncIterable<ModelStreamChunk> {
      const step = (steps.get(request.turnId) ?? 0) + 1
      steps.set(request.turnId, step)
      const thread = (await h.threadStore.get(request.threadId))!
      const job = thread.roomContext?.handoffId ? await handoffs.get(thread.roomContext.handoffId) : undefined
      if (step === 1) {
        calls.push(request)
        expect(request.tools.some((tool) => tool.name === 'send_room_message')).toBe(true)
        expect(request.tools.some((tool) => ['write', 'bash', 'submit_room_plan', 'delegate_task'].includes(tool.name))).toBe(false)
        if (hold) await waiting(hold, request.abortSignal!)
        if (childAgentId && job?.recipientAgentId === b.id && job.attempt === 1) {
          yield { kind: 'tool_call_complete', callId: 'child', toolName: 'send_agent_message',
            arguments: { recipientAgentId: childAgentId, body: 'Provide a focused check', sourceMessageIds: job.sources.map((source) => source.id) } }
        } else yield { kind: 'tool_call_complete', callId: 'updates', toolName: 'read_room_updates', arguments: {} }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      } else if (step === 2) {
        yield { kind: 'tool_call_complete', callId: 'reply', toolName: 'send_room_message',
          arguments: { body: job?.recipientAgentId === childAgentId ? 'Child evidence: the scoped API is sufficient.' : 'Scoped result with concrete evidence.' } }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      } else {
        yield { kind: 'assistant_text_delta', text: 'Submitted.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
  }
  const h = makeHarness(model)
  h.toolHost.replaceRuntimeComponents({ registry: new CapabilityRegistry([roomResultProvider(h.threadStore)]) })
  h.threads.updateRuntimeDefaults({ modelRequestCaptureEnabled: false, approvalPolicy: 'auto', approvalReviewer: 'user', sandboxMode: 'read-only' })
  const dispatcher = new QueuedTurnDispatcher({ turns: h.turns, threadStore: h.threadStore,
    runTurn: (threadId, turnId) => h.loop.runTurn(threadId, turnId) })
  h.turns.setTurnQueuedHook((id) => dispatcher.requestDrain(id))
  h.turns.setTurnSettledHook((id, status) => dispatcher.onTurnSettled(id, status))
  cleanups.push(async () => { await h.turns.interruptActiveTurns(); await dispatcher.dispose() })
  const agents = new AgentIdentityService(store, () => ({}))
  const rooms = new RoomService(store, () => {}); rooms.setAgentDirectory(agents)
  const a = (await agents.create({ clientRequestId: 'a', name: 'Ada' })).agent
  const b = (await agents.create({ clientRequestId: 'b', name: 'Bea' })).agent
  const c = (await agents.create({ clientRequestId: 'c', name: 'Cora' })).agent
  const room = (await openAgentConversation(agents, rooms, a.id)).room
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate, dataDir: root,
    runTurn: (threadId, turnId) => h.loop.runTurn(threadId, turnId),
    model: () => ({ model: 'fake', providerId: 'fake' }), profiles: () => ({}), assertOwnership: async () => {} }
  const handoffs = new AgentHandoffService(deps, agents, rooms, () => {})
  deps.agentHandoffs = handoffs
  bindRoomPeerStore(h.threadStore, store)
  bindAgentHandoffService(h.threadStore, handoffs)
  const runner = new AgentHandoffRunner(handoffs), peers = new RoomPeerStore(store)
  const source = async (id: string, body: string, designatedAgentIds: string[] = []) => {
    const sent = await rooms.send(room.id, { clientRequestId: id, body, executionIntent: 'discussion', designatedAgentIds })
    const request = (await store.get<RoomRequestState>('request', sent.requestId))!
    await peers.initialize(request.value)
    return sent
  }
  const create = (sent: Awaited<ReturnType<typeof source>>, id: string, recipient = b.id) => handoffs.create({
    clientRequestId: id, sourceRoomId: room.id, sourceRootRequestId: sent.requestId,
    senderAgentId: a.id, recipientAgentId: recipient, body: 'Please inspect the supplied evidence.',
    sourceMessageIds: [sent.message.id] })
  const pump = async (check: () => Promise<void>) => {
    try { await vi.waitFor(async () => { await runner.tick(new Set()); await check() }, { timeout: 3500, interval: 10 }) }
    catch (error) { throw new Error(String(error) + '\nHandoffs: ' + JSON.stringify((await store.list('agent_handoff')).map((row) => row.value))) }
  }
  return { root, h, store, agents, rooms, a, b, c, room, deps, handoffs, runner, peers, calls, source, create, pump,
    hold: (promise: Promise<void> | undefined) => { hold = promise }, child: () => { childAgentId = c.id } }
}

describe('Agent handoffs through the native queue and tool host', () => {
  it('rejects another topic, a forged parent, and a same-named nonmember before creating a pair', async () => {
    const f = await fixture()
    const one = await f.source('one', 'PRIVATE_ALPHA')
    const two = await f.source('two', 'PRIVATE_BETA')
    const input = { clientRequestId: 'invalid', sourceRoomId: f.room.id, sourceRootRequestId: one.requestId,
      senderAgentId: f.a.id, recipientAgentId: f.b.id, body: 'Inspect only this topic', sourceMessageIds: [two.message.id] }
    await expect(f.handoffs.create(input)).rejects.toThrow('outside this topic')
    await expect(f.handoffs.create({ ...input, sourceMessageIds: [], parentHandoffId: 'forged' })).rejects.toThrow('host-bound')
    const sameName = (await f.agents.create({ clientRequestId: 'same-name', name: f.a.name })).agent
    await expect(f.handoffs.create({ ...input, sourceMessageIds: [], senderAgentId: sameName.id })).rejects.toThrow('source conversation member')
    expect(await f.store.list('agent_handoff')).toHaveLength(0)
    expect((await f.store.listRooms({ conversationKind: 'agent_agent' })).rooms).toHaveLength(0)
    expect(f.calls).toHaveLength(0)
  })

  it('enforces the same global Agent eight-response ceiling without borrowing another member identity', async () => {
    const f = await fixture(), sent = await f.source('source', 'A bounded member')
    const topic = (await f.peers.topic(sent.requestId))!
    await putRoomDocument(f.store, 'peer_topic', topic.id, topic.roomId!, {
      ...topic.value, responseCount: 8, memberResponses: { [f.b.id]: 8 }
    }, topic)
    const job = (await f.create(sent, 'over-member-limit')).handoff
    await f.runner.tick(new Set())
    expect((await f.handoffs.get(job.id)).status).toBe('budget_exhausted')
    expect((await f.peers.topic(sent.requestId))!.value.responseCount).toBe(8)
    expect(f.calls).toHaveLength(0)
  })

  it('runs a scoped peer response and atomically links the exact run without creating code tasks', async () => {
    const f = await fixture(), sent = await f.source('source', 'A private project requirement')
    const { handoff } = await f.create(sent, 'handoff')
    await f.pump(async () => expect((await f.handoffs.get(handoff.id)).status).toBe('completed'))
    expect(f.calls).toHaveLength(1)
    const result = await f.handoffs.get(handoff.id)
    const messages = await f.store.list<RoomMessage>('message', { roomId: result.pairRoomId })
    expect(messages.map((row) => row.value.authorAgentId).sort()).toEqual([f.a.id, f.b.id].sort())
    expect(messages.find((row) => row.id === result.resultMessageId)!.value.originRunId).toBe(result.runId)
    expect((await inspectRoomRun(f.deps, result.pairRoomId, result.runId!)).availability.status).toBe('available')
    expect((await f.peers.topic(sent.requestId))!.value.memberResponses[f.b.id]).toBe(1)
    expect(await f.store.list('task')).toHaveLength(0)
    expect((await f.store.list<RoomMessage>('message', { roomId: f.room.id })).filter((row) => row.value.authorKind === 'user')).toHaveLength(1)
    const before = f.calls.length
    await f.handoffs.get(handoff.id); await f.runner.tick(new Set())
    expect(f.calls).toHaveLength(before)
  })

  it('reuses a pair conversation but isolates two source topics in separate model threads', async () => {
    const f = await fixture()
    const one = await f.source('one', 'PRIVATE_ALPHA_ONLY')
    const first = (await f.create(one, 'first')).handoff
    await f.pump(async () => expect((await f.handoffs.get(first.id)).status).toBe('completed'))
    const two = await f.source('two', 'PRIVATE_BETA_ONLY')
    const second = (await f.create(two, 'second')).handoff
    await f.pump(async () => expect((await f.handoffs.get(second.id)).status).toBe('completed'))
    expect(first.pairRoomId).toBe(second.pairRoomId)
    expect(first.threadId).not.toBe(second.threadId)
    expect(JSON.stringify(f.calls[0].history)).toContain('PRIVATE_ALPHA_ONLY')
    expect(JSON.stringify(f.calls[1].history)).not.toContain('PRIVATE_ALPHA_ONLY')
    expect(JSON.stringify(f.calls[1].history)).toContain('PRIVATE_BETA_ONLY')
  })

  it('keeps the original admission after restart and stops late responses with the source topic', async () => {
    const f = await fixture(), sent = await f.source('source', 'Inspect the current requirement')
    const wait = gate(); f.hold(wait.promise)
    const job = (await f.create(sent, 'waiting')).handoff
    await f.pump(async () => expect(f.calls).toHaveLength(1))
    const row = (await f.store.get<AgentHandoff>('agent_handoff', job.id))!
    await putRoomDocument(f.store, 'agent_handoff', row.id, row.roomId!, { ...row.value, turnId: undefined }, row)
    const restarted = new AgentHandoffRunner(f.handoffs)
    await restarted.tick(new Set())
    expect(f.calls).toHaveLength(1)
    expect((await f.handoffs.get(job.id)).turnId).toBeTruthy()
    await f.peers.stop(sent.requestId)
    await vi.waitFor(async () => {
      await restarted.tick(new Set())
      expect((await f.handoffs.get(job.id)).phase).toBe('settled')
    }, { timeout: 3500, interval: 10 })
    wait.release()
    expect((await f.handoffs.get(job.id)).status).toBe('cancelled')
    expect((await f.store.list<RoomMessage>('message', { roomId: job.pairRoomId })).filter((row) => row.value.authorAgentId === f.b.id)).toHaveLength(0)
  })

  it('shares the 32 response ceiling with the source topic', async () => {
    const f = await fixture(), sent = await f.source('source', 'A bounded handoff')
    const topic = (await f.peers.topic(sent.requestId))!
    await putRoomDocument(f.store, 'peer_topic', topic.id, topic.roomId!, { ...topic.value, responseCount: 31 }, topic)
    const first = (await f.create(sent, 'last-slot')).handoff
    await f.pump(async () => expect((await f.handoffs.get(first.id)).status).toBe('completed'))
    expect((await f.peers.topic(sent.requestId))!.value.responseCount).toBe(32)
    expect((await f.peers.topic(sent.requestId))!.value.status).toBe('paused')
    await expect(f.create(sent, 'no-more', f.c.id)).rejects.toThrow('paused')
    expect(f.calls).toHaveLength(1)
  })

  it('delivers a child result to a fresh parent response under the same original budget', async () => {
    const f = await fixture()
    f.child()
    const sent = await f.source('source', 'Use only the current source evidence', [f.b.id, f.c.id])
    const parent = (await f.create(sent, 'parent')).handoff
    await f.pump(async () => expect((await f.handoffs.get(parent.id)).status).toBe('completed'))
    const children = (await f.store.list<AgentHandoff>('agent_handoff')).filter((row) => row.value.parentHandoffId === parent.id)
    expect(children).toHaveLength(1)
    expect(children[0].value.status).toBe('completed')
    expect((await f.handoffs.get(parent.id)).attempt).toBe(2)
    expect((await f.peers.topic(sent.requestId))!.value.responseCount).toBe(3)
    expect(f.calls).toHaveLength(3)
    expect(JSON.stringify(f.calls[2].history)).toContain('Child evidence')
  })
})
