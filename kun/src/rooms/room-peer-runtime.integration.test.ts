import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { QueuedTurnDispatcher } from '../server/queued-turn-dispatcher.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { RoomRequestState, RoomRuntimeDeps } from './room-runtime-types.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { RoomPeerRunner } from './room-peer-runner.js'
import { roomResultProvider } from './room-result-tools.js'
import { bindRoomPeerStore } from './room-peer-tools.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
type Call = { memberId: string; rootId: string; roomId: string; request: ModelRequest; attempt: number }
type Reply = { body?: string; skip?: boolean; inviteMemberIds?: string[]; partial?: string; wait?: Promise<void> }
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
async function awaitGate(promise: Promise<void>, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error('Cancelled')
  let abort!: () => void
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason ?? new Error('Cancelled'))
      signal.addEventListener('abort', abort, { once: true })
    })])
  } finally { signal.removeEventListener('abort', abort) }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'room-peer-runtime-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanups.push(() => store.close())
  const calls: Call[] = [], triages: Array<{ memberId: string; request: ModelRequest }> = []
  const attempts = new Map<string, number>(), steps = new Map<string, number>()
  let reply = (call: Call): Reply => ({ body: call.memberId + ' concrete finding' })
  let triage = (_memberId: string): 'skip' | 'respond' => 'skip'
  let malformedTriage = false
  const model: ModelClient = { provider: 'fake', model: 'fake', async *stream(request): AsyncIterable<ModelStreamChunk> {
    const step = (steps.get(request.turnId) ?? 0) + 1
    steps.set(request.turnId, step)
    if (step > 1) {
      yield { kind: 'assistant_text_delta', text: 'Submitted.' }
      yield { kind: 'completed', stopReason: 'stop' }
      return
    }
    const thread = await h.threadStore.get(request.threadId)
    const scope = thread?.roomContext
    if (!scope?.rootRequestId) throw new Error('Expected a scoped peer turn')
    const key = scope.rootRequestId + ':' + scope.memberId
    const attempt = (attempts.get(key) ?? 0) + 1
    attempts.set(key, attempt)
    const call = { memberId: scope.memberId, rootId: scope.rootRequestId, roomId: scope.roomId, request, attempt }
    calls.push(call)
    expect(request.tools.some((tool) => tool.name === 'send_room_message')).toBe(true)
    expect(request.tools.some((tool) => ['write', 'bash', 'delegate_task', 'submit_room_plan'].includes(tool.name))).toBe(false)
    const value = reply(call)
    if (value.partial) yield { kind: 'assistant_text_delta', text: value.partial }
    if (value.wait) await awaitGate(value.wait, request.abortSignal!)
    yield { kind: 'tool_call_complete', callId: 'public-reply', toolName: 'send_room_message',
      arguments: value.skip ? { skip: true } : { body: value.body ?? '', inviteMemberIds: value.inviteMemberIds ?? [] } }
    yield { kind: 'completed', stopReason: 'tool_calls' }
  } }
  const h = makeHarness(model)
  h.toolHost.replaceRuntimeComponents({ registry: new CapabilityRegistry([roomResultProvider(h.threadStore)]) })
  bindRoomPeerStore(h.threadStore, store)
  h.threads.updateRuntimeDefaults({ approvalPolicy: 'auto', sandboxMode: 'read-only',
    approvalReviewer: 'user', modelRequestCaptureEnabled: false })
  const classifier: ModelClient = { provider: 'fake', model: 'small', async *stream(request) {
    const text = request.history.find((item) => item.kind === 'user_message')
    const memberId = text?.kind === 'user_message' ? JSON.parse(text.text).member.id as string : ''
    triages.push({ memberId, request })
    yield { kind: 'assistant_text_delta', text: malformedTriage ? 'Malformed result' : JSON.stringify({ action: triage(memberId), reason: 'Fixture verdict' }) }
    yield { kind: 'usage', usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25, cacheHitRate: null, turns: 1 } }
    yield { kind: 'completed', stopReason: 'stop' }
  } }
  const dispatcher = new QueuedTurnDispatcher({ turns: h.turns, threadStore: h.threadStore,
    runTurn: (threadId, turnId) => h.loop.runTurn(threadId, turnId) })
  h.turns.setTurnQueuedHook((id) => dispatcher.requestDrain(id))
  h.turns.setTurnSettledHook((id, status) => dispatcher.onTurnSettled(id, status))
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (threadId, turnId) => h.loop.runTurn(threadId, turnId), dataDir: root,
    model: () => ({ model: 'fake', providerId: 'fake' }), profiles: () => ({}), assertOwnership: async () => {},
    peerModels: { client: classifier, roles: () => ({ smallModel: 'small', smallModelProviderId: 'fake' }) } }
  const runner = new RoomPeerRunner(deps, () => {}, { debounceMs: 0 })
  cleanups.push(async () => { await runner.close(); await h.turns.interruptActiveTurns(); await dispatcher.dispose() })
  const service = new RoomService(store, () => {})
  const room = (await service.create({ clientRequestId: 'room', name: 'Peer room', collaborationMode: 'peer' })).room
  const send = async (id: string, input: { room?: Room; mentions?: string[]; body?: string; rootRequestId?: string } = {}) => {
    const sent = await service.send((input.room ?? room).id, { clientRequestId: id, body: input.body ?? 'Compare alternatives only',
      rootRequestId: input.rootRequestId, executionIntent: 'discussion', mentionMemberIds: input.mentions ?? [] })
    const request = (await store.get<RoomRequestState>('request', sent.requestId))!.value
    await runner.state.initialize(request)
    return request
  }
  const pump = async (assertion: () => void | Promise<void>, busy = new Set<string>()) => {
    try { await vi.waitFor(async () => { await runner.tick(busy); await assertion() }, { timeout: 2500, interval: 10 }) }
    catch (error) {
      const states = await store.list('peer_member', { limit: 100 })
      throw new Error(String(error) + '\nPeer states: ' + JSON.stringify(states.map((row) => row.value)))
    }
  }
  const messages = async (rootId: string) => (await store.list<RoomMessage>('message', { rootRequestId: rootId, order: 'asc' }))
    .filter((row) => row.value.authorKind === 'member').map((row) => row.value)
  return { store, h, service, room, runner, calls, triages, send, pump, messages,
    reply: (handler: typeof reply) => { reply = handler }, triage: (handler: typeof triage) => { triage = handler },
    malformedTriage: () => { malformedTriage = true } }
}

describe('peer store, queue and AgentLoop integration', () => {
  it('answers the user directly through the default member while other members triage and silently consume skips', async () => {
    const f = await fixture()
    const request = await f.send('default')
    await f.pump(async () => expect((await f.runner.state.topic(request.id))?.value.status).toBe('idle'))
    expect((await f.messages(request.id)).map((message) => message.authorMemberId)).toEqual([f.room.defaultMemberId])
    expect(f.calls).toHaveLength(1)
    expect(f.triages.map((entry) => entry.memberId)).toEqual(expect.arrayContaining(['developer', 'reviewer']))
    expect(f.triages.every((entry) => entry.request.model === 'small')).toBe(true)
    const states = await f.runner.state.members(request.id)
    expect(states.every((entry) => entry.value.handledInboxSeq > 0 && !entry.value.activation)).toBe(true)
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
    const count = f.calls.length + f.triages.length
    for (let i = 0; i < 3; i++) await f.runner.tick()
    expect(f.calls.length + f.triages.length).toBe(count)
  })

  it('invites a relevant peer directly and publishes only the submitted final message', async () => {
    const f = await fixture(), hold = gate()
    f.reply((call) => call.memberId === f.room.defaultMemberId
      ? { body: 'Review the cancellation contract.', inviteMemberIds: ['reviewer'], partial: 'Unfinished private draft', wait: hold.promise }
      : { body: 'The reviewer adds a concrete missing cancellation edge case.' })
    const request = await f.send('invite')
    await f.pump(() => expect(f.calls).toHaveLength(1))
    for (let i = 0; i < 3; i++) await f.runner.tick()
    expect(await f.messages(request.id)).toHaveLength(0)
    expect((await f.store.list('peer_inbox', { rootRequestId: request.id })).every((row) =>
      !JSON.stringify(row.value).includes('Unfinished private draft'))).toBe(true)
    hold.release()
    await f.pump(async () => expect((await f.messages(request.id)).map((message) => message.authorMemberId)).toEqual([f.room.defaultMemberId, 'reviewer']))
    expect(f.calls.filter((call) => call.memberId === 'reviewer')).toHaveLength(1)
    expect((await f.messages(request.id)).some((message) => message.body.includes('Submitted.') || message.body.includes('Unfinished'))).toBe(false)
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
  })

  it('discards a stale draft and regenerates against a peer result before publishing', async () => {
    const f = await fixture(), developer = gate(), reviewer = gate()
    f.reply((call) => call.memberId === 'developer' ? { body: 'Developer discovered the cancellation race.', wait: developer.promise }
      : call.attempt === 1 ? { body: 'STALE reviewer draft', wait: reviewer.promise } : { body: 'Reviewer now addresses the cancellation race.' })
    const request = await f.send('stale', { mentions: ['developer', 'reviewer'] })
    await f.pump(() => expect(f.calls.map((call) => call.memberId)).toEqual(['developer', 'reviewer']))
    developer.release()
    await f.pump(async () => expect(await f.messages(request.id)).toHaveLength(1))
    reviewer.release()
    await f.pump(async () => expect(await f.messages(request.id)).toHaveLength(2))
    const revised = f.calls.find((call) => call.memberId === 'reviewer' && call.attempt === 2)
    expect(JSON.stringify(revised?.request.history)).toContain('Developer discovered the cancellation race.')
    expect((await f.messages(request.id)).some((message) => message.body === 'STALE reviewer draft')).toBe(false)
    expect((await f.store.list<{ outcome: string }>('peer_metric', { rootRequestId: request.id }))
      .some((metric) => metric.value.outcome === 'stale')).toBe(true)
  })

  it('treats an explicit member skip as consumption without publishing its final prose', async () => {
    const f = await fixture()
    f.reply(() => ({ skip: true }))
    const request = await f.send('skip')
    await f.pump(async () => expect((await f.runner.state.topic(request.id))?.value.status).toBe('idle'))
    expect(await f.messages(request.id)).toHaveLength(0)
    expect(f.calls).toHaveLength(1)
    expect((await f.runner.state.member(request.id, f.room.defaultMemberId))?.value.handledInboxSeq).toBeGreaterThan(0)
  })

  it('promotes a positive small-model verdict into an actual member turn with recorded usage', async () => {
    const f = await fixture(), hold = gate()
    f.triage((memberId) => memberId === 'developer' ? 'respond' : 'skip')
    f.reply((call) => call.memberId === f.room.defaultMemberId ? { skip: true, wait: hold.promise }
      : { body: 'Developer has new evidence about cancellation.' })
    const request = await f.send('positive-triage')
    await f.pump(async () => expect((await f.messages(request.id)).map((message) => message.authorMemberId)).toEqual(['developer']))
    hold.release()
    await f.pump(async () => expect((await f.runner.state.topic(request.id))?.value.status).toBe('idle'))
    expect(f.triages.some((entry) => entry.memberId === 'developer' && entry.request.model === 'small')).toBe(true)
    expect(f.calls.filter((entry) => entry.memberId === 'developer')).toHaveLength(1)
    const metrics = await f.store.list<{ phase: string; outcome: string; usage?: { totalTokens: number } }>('peer_metric', { rootRequestId: request.id })
    expect(metrics.some((entry) => entry.value.phase === 'triage' && entry.value.outcome === 'respond' && entry.value.usage?.totalTokens === 25)).toBe(true)
  })

  it('keeps failed triage pending and does not escalate it into a member response', async () => {
    const f = await fixture()
    f.reply(() => ({ skip: true }))
    f.triage((memberId) => { if (memberId === 'developer') throw new Error('Participation provider unavailable'); return 'skip' })
    const request = await f.send('failed-triage')
    await f.pump(async () => expect((await f.runner.state.member(request.id, 'developer'))?.value.state).toBe('failed'))
    const state = (await f.runner.state.member(request.id, 'developer'))!.value
    expect(state.handledInboxSeq).toBe(0)
    expect(state.seenInboxSeq).toBeGreaterThan(0)
    expect(state.lastError).toContain('Participation provider unavailable')
    expect((await f.runner.state.readUpdates(request.id, 'developer'))?.items.length).toBeGreaterThan(0)
    expect(f.calls.some((call) => call.memberId === 'developer')).toBe(false)
    const count = f.triages.filter((entry) => entry.memberId === 'developer').length
    for (let i = 0; i < 3; i++) await f.runner.tick()
    expect(f.triages.filter((entry) => entry.memberId === 'developer')).toHaveLength(count)
  })

  it('records failed classifier usage even when the returned JSON cannot be parsed', async () => {
    const f = await fixture()
    f.reply(() => ({ skip: true }))
    f.malformedTriage()
    const request = await f.send('failed-triage-usage')
    await f.pump(async () => expect((await f.runner.state.member(request.id, 'developer'))?.value.state).toBe('failed'))
    const metrics = await f.store.list<{ memberId: string; phase: string; outcome: string; model?: string;
      usage?: { totalTokens: number } }>('peer_metric', { rootRequestId: request.id })
    expect(metrics.some((entry) => entry.value.memberId === 'developer' && entry.value.phase === 'triage' &&
      entry.value.outcome === 'failed' && entry.value.model === 'small' && entry.value.usage?.totalTokens === 25)).toBe(true)
    expect((await f.runner.state.member(request.id, 'developer'))?.value.handledInboxSeq).toBe(0)
    expect(f.calls.some((call) => call.memberId === 'developer')).toBe(false)
  })

  it('does not spend another model turn after the topic response budget is exhausted', async () => {
    const f = await fixture(), request = await f.send('budget')
    const row = (await f.runner.state.topic(request.id))!
    await putRoomDocument(f.store, 'peer_topic', row.id, f.room.id, { ...row.value, responseCount: 32 }, row)
    await f.pump(async () => expect((await f.runner.state.topic(request.id))?.value).toMatchObject({ status: 'paused', pauseReason: 'budget_exhausted' }))
    expect(f.calls).toHaveLength(0)
    expect(f.triages).toHaveLength(0)
    expect(await f.messages(request.id)).toHaveLength(0)
  })

  it('pauses when all individual member budgets are spent even below the topic-wide response cap', async () => {
    const f = await fixture(), request = await f.send('all-member-budgets')
    const row = (await f.runner.state.topic(request.id))!
    await putRoomDocument(f.store, 'peer_topic', row.id, f.room.id, { ...row.value,
      responseCount: f.room.members.length * 8,
      memberResponses: Object.fromEntries(f.room.members.map((member) => [member.id, 8])) }, row)
    await f.runner.tick()
    expect((await f.runner.state.topic(request.id))?.value).toMatchObject({ status: 'paused', pauseReason: 'budget_exhausted' })
    expect(f.calls).toHaveLength(0)
    expect(f.triages).toHaveLength(0)
  })

  it('stops a running response before publication and ignores later task activity until a new user topic', async () => {
    const f = await fixture(), hold = gate()
    f.reply(() => ({ body: 'Late response must not appear', wait: hold.promise }))
    const request = await f.send('stop')
    await f.pump(() => expect(f.calls).toHaveLength(1))
    await f.runner.state.stop(request.id)
    await f.pump(async () => expect((await f.runner.state.topic(request.id))?.value.status).toBe('stopped'))
    hold.release()
    await f.runner.state.deliverTask(request.id, { id: 'finished-task', revision: 1, body: 'Task finished' })
    for (let i = 0; i < 3; i++) await f.runner.tick()
    expect(f.calls).toHaveLength(1)
    expect(await f.messages(request.id)).toHaveLength(0)
    f.reply(() => ({ body: 'New user topic response' }))
    const next = await f.send('after-stop')
    await f.pump(async () => expect(await f.messages(next.id)).toHaveLength(1))
    expect(await f.messages(request.id)).toHaveLength(0)
  })

  it('lets another topic wait for its occupied member without invalidating or mixing the original draft', async () => {
    const f = await fixture(), hold = gate()
    const old = await f.send('old-topic')
    f.reply((call) => ({ body: call.rootId === old.id ? 'Old topic answer' : 'New topic answer',
      ...(call.rootId === old.id ? { wait: hold.promise } : {}) }))
    await f.pump(() => expect(f.calls).toHaveLength(1))
    const next = await f.send('new-topic')
    for (let i = 0; i < 3; i++) await f.runner.tick()
    expect(f.calls[0].request.abortSignal?.aborted).toBe(false)
    expect(await f.messages(next.id)).toHaveLength(0)
    hold.release()
    await f.pump(async () => expect(await f.messages(next.id)).toHaveLength(1))
    expect((await f.runner.state.topic(old.id))?.value.generation).toBe(1)
    expect((await f.messages(old.id)).map((message) => message.body)).toEqual(['Old topic answer'])
    expect((await f.messages(next.id))[0].body).toBe('New topic answer')
  })

  it('invalidates the old generation only when the user continues the same topic', async () => {
    const f = await fixture(), hold = gate()
    f.reply((call) => call.attempt === 1 ? { body: 'Old requirement draft', wait: hold.promise }
      : { body: 'Response to the updated requirement' })
    const old = await f.send('original-requirement')
    await f.pump(() => expect(f.calls).toHaveLength(1))
    await f.send('continued-requirement', { rootRequestId: old.id, body: 'Continue this topic with updated requirements' })
    await f.pump(async () => expect(await f.messages(old.id)).toHaveLength(1))
    hold.release()
    expect((await f.runner.state.topic(old.id))?.value.generation).toBe(2)
    expect(f.calls[0].request.abortSignal?.aborted).toBe(true)
    expect((await f.messages(old.id)).map((message) => message.body)).toEqual(['Response to the updated requirement'])
    expect(JSON.stringify(f.calls.at(-1)?.request.history)).toContain('updated requirements')
  })

  it('continues another room when the first room member is occupied by execution', async () => {
    const f = await fixture()
    const secondRoom = (await f.service.create({ clientRequestId: 'second-room', name: 'Other room', collaborationMode: 'peer' })).room
    const first = await f.send('busy-room'), second = await f.send('free-room', { room: secondRoom })
    const busy = new Set([f.room.id + ':' + f.room.defaultMemberId])
    await f.pump(async () => expect(await f.messages(second.id)).toHaveLength(1), busy)
    expect(await f.messages(first.id)).toHaveLength(0)
    await f.pump(async () => expect(await f.messages(first.id)).toHaveLength(1))
    expect(f.calls.some((call) => call.rootId === second.id)).toBe(true)
  })
})
