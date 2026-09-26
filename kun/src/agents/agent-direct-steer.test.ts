import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { defaultLocalTools } from '../adapters/tool/local-tool-host.js'
import { roomResultProvider } from '../rooms/room-result-tools.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { controlDirectRequest, directActivity } from './agent-direct-service.js'
import { AgentDirectRunner } from './agent-direct-runner.js'
import { enqueuePrivateContinuation } from '../rooms/room-continuation-service.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })

async function fixture(model?: ModelClient) {
  const root = await mkdtemp(join(tmpdir(), 'kun-direct-steer-'))
  const seen: ModelRequest[] = []
  const base: ModelClient = model ?? { provider: 'test', model: 'first', async *stream(request) {
    yield { kind: 'tool_call_complete', callId: 'say-' + request.turnId, toolName: 'send_im_message',
      arguments: { text: 'Noted.' } }
    yield { kind: 'completed', stopReason: 'tool_calls' }
  } }
  // A second model step after the send_im_message tool result finishes the turn.
  const client: ModelClient = { provider: base.provider, model: base.model, async *stream(request) {
    seen.push(request)
    const sent = request.history.some((item) => item.turnId === request.turnId &&
      item.kind === 'tool_result' && item.toolName === 'send_im_message' && item.isError !== true)
    if (sent) { yield { kind: 'completed', stopReason: 'stop' }; return }
    yield* base.stream(request)
  } }
  const h = makeHarness(client, { attachmentStore: { bindScopes: async () => [] } as unknown as
    import('../attachments/attachment-store.js').AttachmentStore })
  h.toolHost.replaceRuntimeComponents({ registry: new CapabilityRegistry([
    { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: defaultLocalTools },
    roomResultProvider(h.threadStore)
  ]) })
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'first', providerId: 'test' }), profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, runtime.service)
  const created = await quickCreateAgent(runtime.agents, { clientRequestId: 'create' }, true)
  const row = async (id: string) => (await store.get<RoomRequestState>('request', id))!
  const tick = async (id: string) => { await runner.tick(await row(id)); return (await row(id)).value }
  /** Drive a request through input preparation until its own turn is queued. */
  const prepare = async (id: string) => {
    await tick(id)
    const value = (await row(id)).value
    if (value.turnId) return value
    await tick(id)
    return (await row(id)).value
  }
  cleanup.push(async () => { await runtime.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, seen, h, store, deps, runtime, runner, created, row, tick, prepare }
}

/** Send the first message and promote its turn to a locally running execution. */
async function runningReply(f: Awaited<ReturnType<typeof fixture>>) {
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'a', body: 'First message' })
  const a = await f.prepare(sent.requestId)
  expect(a.turnId).toBeTruthy()
  await f.h.turns.startNextQueuedTurn(a.threadId)
  const thread = await f.h.threads.getMetadata(a.threadId)
  const turn = thread?.turns.find((entry) => entry.id === a.turnId)
  expect(turn?.status).toBe('running')
  expect(f.h.turns.isTurnExecutionActive(turn!.id)).toBe(true)
  return { sent, request: a, turn: turn! }
}

it('steers a plain message into the running reply instead of queueing a turn', async () => {
  const f = await fixture()
  const first = await runningReply(f)
  const second = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'b', body: 'Second message' })
  await f.tick(second.requestId) // input preparation
  const steer = vi.spyOn(f.h.turns, 'steerTurn')
  const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
  await f.tick(second.requestId)
  expect(steer).toHaveBeenCalledTimes(1)
  expect(enqueue).not.toHaveBeenCalled()
  const merged = (await f.row(second.requestId)).value
  expect(merged.steer?.targetTurnId).toBe(first.turn.id)
  expect(merged.steer?.targetRunId).toBe(first.request.privateRunId)
  expect(merged.turnId).toBeUndefined()
  expect(merged.status).toBe('running')
  const target = (await f.h.threads.getMetadata(first.request.threadId))?.turns.find((entry) => entry.id === first.turn.id)
  expect(target?.steeringDeliveries?.some((entry) => entry.operationId === merged.steer!.operationId)).toBe(true)
  await f.h.loop.runTurn(first.request.threadId, first.turn.id)
  const done = await f.tick(second.requestId)
  expect(done.status).toBe('completed')
  const run = await f.store.get<RoomRunRecord>('room_run', done.privateRunId!)
  expect(run?.value.mergedIntoRunId).toBe(first.request.privateRunId)
  expect(run?.value.turnId).toBe(first.turn.id)
  expect(run?.value.status).toBe('completed')
  const thread = await f.h.threads.getMetadata(first.request.threadId)
  expect(thread?.turns).toHaveLength(1)
  // The steered text reached the model inside the same turn.
  expect(f.seen.some((request) => JSON.stringify(request.history).includes('Second message'))).toBe(true)
})

it('keeps attachments, continuations, reminders, and setup interviews on the queue path', async () => {
  const f = await fixture()
  const first = await runningReply(f)
  const steer = vi.spyOn(f.h.turns, 'steerTurn')
  const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
  // A host continuation also keeps its own turn. It must be admitted while the
  // running turn is still the latest, before any newer user turn exists.
  expect(await enqueuePrivateContinuation(f.deps, { threadId: first.request.threadId, sourceTurnId: first.turn.id,
    kind: 'background_subagent', key: 'child', prompt: 'Follow up.' })).toBe('queued')
  const continuation = (await f.store.list<RoomRequestState>('request', { roomId: f.created.roomId }))
    .find((row) => row.value.privateContinuation)!
  await f.runner.tick(continuation)
  expect((await f.row(continuation.id)).value.steer).toBeUndefined()
  expect(enqueue).toHaveBeenCalledTimes(1)
  expect(steer).not.toHaveBeenCalled()
  // Attachments enqueue normally.
  const attached = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'attach', body: 'Look at this', attachmentIds: ['att-1'] })
  await f.tick(attached.requestId)
  await f.tick(attached.requestId)
  expect((await f.row(attached.requestId)).value.steer).toBeUndefined()
  expect(steer).not.toHaveBeenCalled()
  expect(enqueue).toHaveBeenCalledTimes(2)
  // Reminder wake requests never merge into a user reply.
  const base = (await f.row(attached.requestId)).value
  const reminder: RoomRequestState = { ...base, id: 'req-reminder', rootRequestId: 'req-reminder',
    message: { ...base.message, attachmentIds: [] },
    threadId: first.request.threadId, privateInput: 'Reminder wake text',
    turnId: undefined, privateRunId: undefined, admissionAttempted: false, status: 'pending', error: undefined,
    privateReminder: { reminderId: 'rem-1', chainDepth: 0, scheduledFor: new Date().toISOString(), lateSeconds: 0 } }
  await f.store.commit({ requestId: 'reminder-request',
    checks: [{ kind: 'request', id: 'req-reminder', expectedRevision: null }],
    puts: [{ kind: 'request', id: 'req-reminder', roomId: f.created.roomId, value: reminder }] })
  await f.tick('req-reminder')
  expect((await f.row('req-reminder')).value.steer).toBeUndefined()
  expect(enqueue).toHaveBeenCalledTimes(3)
  expect(steer).not.toHaveBeenCalled()
  // Setup interviews stay on their own admission path.
  const agentRow = await f.store.get<AgentIdentity>('agent_identity', f.created.agentId)
  await f.store.commit({ requestId: 'setup-pending',
    checks: [{ kind: 'agent_identity', id: f.created.agentId, expectedRevision: agentRow!.revision }],
    puts: [{ kind: 'agent_identity', id: f.created.agentId,
      value: { ...agentRow!.value, setup: { status: 'pending' as const, startedAt: new Date().toISOString() } } }] })
  const duringSetup = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'setup-msg', body: 'Interview answer' })
  await f.tick(duringSetup.requestId)
  await f.tick(duringSetup.requestId)
  expect((await f.row(duringSetup.requestId)).value.steer).toBeUndefined()
  expect(steer).not.toHaveBeenCalled()
  expect(enqueue).toHaveBeenCalledTimes(4)
})

it('clears the steer intent on a durable conflict and falls back to the queue', async () => {
  const f = await fixture()
  const first = await runningReply(f)
  f.h.steering.closeAdmission(first.turn.id)
  const second = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'b', body: 'Second message' })
  await f.tick(second.requestId)
  await f.tick(second.requestId)
  const cleared = (await f.row(second.requestId)).value
  expect(cleared.steer).toBeUndefined()
  expect(cleared.admissionAttempted).toBeFalsy()
  await f.h.loop.runTurn(first.request.threadId, first.turn.id)
  const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
  await f.tick(second.requestId)
  expect(enqueue).toHaveBeenCalledTimes(1)
  const queued = (await f.row(second.requestId)).value
  expect(queued.turnId).toBeTruthy()
  expect(queued.turnId).not.toBe(first.turn.id)
  await f.h.turns.startNextQueuedTurn(queued.threadId)
  await f.h.loop.runTurn(queued.threadId, queued.turnId!)
  const done = await f.tick(second.requestId)
  expect(done.status).toBe('completed')
  const thread = await f.h.threads.getMetadata(first.request.threadId)
  expect(thread?.turns).toHaveLength(2)
})

it('requeues the message when the target turn ends without the steering receipt', async () => {
  const f = await fixture()
  const first = await runningReply(f)
  const second = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'b', body: 'Second message' })
  await f.tick(second.requestId)
  const steer = vi.spyOn(f.h.turns, 'steerTurn').mockRejectedValueOnce(new Error('admission lost'))
  await f.tick(second.requestId)
  expect((await f.row(second.requestId)).value.steer).toBeTruthy()
  steer.mockRestore()
  await f.h.loop.runTurn(first.request.threadId, first.turn.id)
  const enqueue = vi.spyOn(f.h.turns, 'enqueueTurn')
  const attempt = await f.tick(second.requestId)
  expect(attempt.steer).toBeUndefined()
  expect(attempt.stepAttempt).toBe(1)
  expect(attempt.turnId).toBeTruthy()
  expect(enqueue).toHaveBeenCalledTimes(1)
  const abandoned = await f.store.get<RoomRunRecord>('room_run', (await f.row(second.requestId)).value.privateRunId!)
  // The retried run replaces the abandoned one, which stays cancelled with an explanation.
  const runs = await f.store.list<RoomRunRecord>('room_run', { roomId: f.created.roomId })
  const old = runs.find((row) => row.value.id !== abandoned?.value.id && row.value.requestId === second.requestId)
  expect(old?.value.status).toBe('cancelled')
  expect(old?.value.error).toContain('Steering was not accepted')
  await f.h.turns.startNextQueuedTurn(attempt.threadId)
  await f.h.loop.runTurn(attempt.threadId, attempt.turnId!)
  const done = await f.tick(second.requestId)
  expect(done.status).toBe('completed')
})

it('replays the same operation id without duplicating the steering delivery', async () => {
  const f = await fixture()
  const first = await runningReply(f)
  const second = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'b', body: 'Second message' })
  await f.tick(second.requestId)
  await f.tick(second.requestId)
  const merged = (await f.row(second.requestId)).value
  // Re-admission on the next tick hits the existing receipt instead of duplicating it.
  await f.tick(second.requestId)
  await f.tick(second.requestId)
  const target = (await f.h.threads.getMetadata(first.request.threadId))?.turns.find((entry) => entry.id === first.turn.id)
  expect(target?.steeringDeliveries?.filter((entry) => entry.operationId === merged.steer!.operationId)).toHaveLength(1)
  await f.h.turns.interruptTurn({ threadId: first.request.threadId, turnId: first.turn.id })
  const done = await f.tick(second.requestId)
  expect(done.status).toBe('cancelled')
})

it('cancelling the target turn cancels both the original and the merged request', async () => {
  const f = await fixture()
  const first = await runningReply(f)
  const second = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'b', body: 'Second message' })
  await f.tick(second.requestId)
  await f.tick(second.requestId)
  const merged = (await f.row(second.requestId)).value
  expect(merged.steer?.targetTurnId).toBe(first.turn.id)
  await f.h.turns.interruptTurn({ threadId: first.request.threadId, turnId: first.turn.id })
  const a = await f.tick(first.request.id)
  const b = await f.tick(second.requestId)
  expect(a.status).toBe('cancelled')
  expect(b.status).toBe('cancelled')
  const run = await f.store.get<RoomRunRecord>('room_run', b.privateRunId!)
  expect(run?.value.status).toBe('cancelled')
  expect(run?.value.mergedIntoRunId).toBe(first.request.privateRunId)
  const activity = await directActivity(f.runtime, f.created.roomId)
  expect(activity.requests.find((entry) => entry.id === second.requestId)?.steer).toBeTruthy()
})

it('stopping the merged request interrupts the target turn', async () => {
  const f = await fixture()
  const first = await runningReply(f)
  const second = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'b', body: 'Second message' })
  await f.tick(second.requestId)
  await f.tick(second.requestId)
  const row = await f.row(second.requestId)
  await controlDirectRequest(f.runtime, f.created.roomId, second.requestId,
    { action: 'stop', clientRequestId: 'stop-b', expectedRevision: row.revision })
  await f.tick(second.requestId)
  const target = (await f.h.threads.getMetadata(first.request.threadId))?.turns.find((entry) => entry.id === first.turn.id)
  expect(target?.status).toBe('aborted')
  const b = await f.tick(second.requestId)
  expect(b.status).toBe('cancelled')
})
