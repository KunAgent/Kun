import { execFileSync } from 'node:child_process'
import { setAgentPermissions, agentPermissions } from './agent-permissions.js'
import { RoomRunTextStream } from '../server/routes/room-run-text-stream.js'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { controlDirectRequest, updateDirectWorkspace, directActivity } from './agent-direct-service.js'
import { AgentDirectRunner } from './agent-direct-runner.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })
async function fixture(outputPath = 'hello.txt') {
  const root = await mkdtemp(join(tmpdir(), 'kun-direct-'))
  const seen: ModelRequest[] = []
  const client: ModelClient = { provider: 'test', model: 'first', async *stream(request) {
    seen.push(request)
    const wrote = request.history.some((item) => item.turnId === request.turnId && item.kind === 'tool_result')
    if (!wrote) yield { kind: 'tool_call_complete', callId: 'write-' + request.turnId, toolName: 'write', arguments: { path: outputPath, content: request.model === 'second' ? 'updated' : 'hello' } }
    else yield { kind: 'assistant_text_delta', text: 'The file is ready.' }
    yield { kind: 'completed', stopReason: wrote ? 'stop' : 'tool_calls' }
  } }
  const h = makeHarness(client)
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'first', providerId: 'test' }), profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, runtime.service)
  const created = await quickCreateAgent(runtime.agents, { clientRequestId: 'create' }, true)
  const advance = async (id: string) => {
    for (let i = 0; i < 15; i++) {
      const row = (await store.get<RoomRequestState>('request', id))!
      if (['completed', 'failed', 'cancelled'].includes(row.value.status)) return row.value
      await runner.tick(row)
      const next = (await store.get<RoomRequestState>('request', id))!
      if (next.value.turnId) {
        const thread = await h.threads.getMetadata(next.value.threadId)
        if (thread?.turns.find((turn) => turn.id === next.value.turnId)?.status === 'queued') {
          await h.turns.startNextQueuedTurn(next.value.threadId)
          const approve = setInterval(() => { for (const pending of h.approvalGate.pending()) h.approvalGate.decide(pending.id, 'allow') }, 10)
          try { await h.loop.runTurn(next.value.threadId, next.value.turnId) } finally { clearInterval(approve) }
        }
      }
    }
    throw new Error('did not finish: ' + JSON.stringify((await store.get<RoomRequestState>('request', id))?.value))
  }
  cleanup.push(async () => { await runtime.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, seen, h, store, deps, runtime, runner, created, advance }
}
it('creates one default Agent and private chat without calling a model', async () => {
  const f = await fixture()
  expect(await quickCreateAgent(f.runtime.agents, { clientRequestId: 'again' }, true)).toEqual(f.created)
  expect(await f.store.list('agent_identity')).toHaveLength(1)
  expect(await f.store.list('room')).toHaveLength(1)
  expect(f.seen).toEqual([])
})
it('writes and updates a real file with one persistent conversation and ordinary tool calls', async () => {
  const f = await fixture()
  const first = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'first', body: 'Create hello.txt.' })
  const a = await f.advance(first.requestId)
  expect(a.status).toBe('completed')
  expect(await readFile(join(a.privateWorkspace!, 'hello.txt'), 'utf8')).toBe('hello')
  const agent = await f.runtime.agents.get(f.created.agentId)
  await f.runtime.agents.update(agent.id, { clientRequestId: 'model', expectedRevision: agent.revision, modelRef: { model: 'second', providerId: 'test' } })
  const second = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'second', body: 'Update that file.' })
  const b = await f.advance(second.requestId)
  expect(b.status).toBe('completed'); expect(b.threadId).toBe(a.threadId)
  expect(await readFile(join(b.privateWorkspace!, 'hello.txt'), 'utf8')).toBe('updated')
  expect(f.seen.some((request) => request.model === 'second')).toBe(true)
  const messages = await f.store.list<import('../contracts/rooms.js').RoomMessage>('message', { roomId: f.created.roomId })
  expect(messages.filter((row) => row.value.authorKind === 'member')).toHaveLength(2)
  expect(messages.filter((row) => row.value.authorKind === 'member').every((row) => row.value.originRunId && !row.value.replyToMessageId)).toBe(true)
  expect(await f.store.list('task')).toHaveLength(0)
})

it('reconciles lost admission and publication receipts without executing or publishing twice', async () => {
  const f = await fixture()
  const original = f.h.turns.enqueueTurn.bind(f.h.turns)
  vi.spyOn(f.h.turns, 'enqueueTurn').mockImplementationOnce(async (input) => { await original(input); throw new Error('lost receipt') })
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'lost', body: 'Create hello.txt' })
  const done = await f.advance(sent.requestId)
  expect(done.status).toBe('completed')
  expect(f.h.turns.enqueueTurn).toHaveBeenCalledTimes(1)
  const row = (await f.store.get<RoomRequestState>('request', sent.requestId))!
  await f.runner.tick(row)
  const repeated = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'lost', body: 'Create hello.txt' })
  expect(repeated.requestId).toBe(sent.requestId)
  expect((await f.store.list('room_run'))).toHaveLength(1)
  expect((await f.store.list<import('../contracts/rooms.js').RoomMessage>('message')).filter((row) => row.value.authorKind === 'member')).toHaveLength(1)
})
it('retains an unknown admission and never retries it on timeout or restart', async () => {
  const f = await fixture()
  vi.spyOn(f.h.turns, 'enqueueTurn').mockRejectedValueOnce(new Error('unknown acceptance'))
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'unknown', body: 'Create hello.txt' })
  for (let i = 0; i < 5; i++) await new AgentDirectRunner(f.deps, f.runtime.service).tick((await f.store.get<RoomRequestState>('request', sent.requestId))!)
  const row = (await f.store.get<RoomRequestState>('request', sent.requestId))!
  expect(row.value.status).toBe('recovery_required')
  expect(f.h.turns.enqueueTurn).toHaveBeenCalledTimes(1)
  await expect(controlDirectRequest(f.runtime, f.created.roomId, sent.requestId, { action: 'retry', clientRequestId: 'retry', expectedRevision: row.revision })).rejects.toThrow('Reconcile')
  expect(f.seen).toHaveLength(0)
})
it('cancels a queued response without consuming another turn or publishing a late result', async () => {
  const f = await fixture()
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'stop', body: 'Create hello.txt' })
  for (let i = 0; i < 2; i++) await f.runner.tick((await f.store.get<RoomRequestState>('request', sent.requestId))!)
  let row = (await f.store.get<RoomRequestState>('request', sent.requestId))!
  await controlDirectRequest(f.runtime, f.created.roomId, row.id, { action: 'stop', clientRequestId: 'stop-action', expectedRevision: 0 })
  for (let i = 0; i < 3; i++) await f.runner.tick((await f.store.get<RoomRequestState>('request', sent.requestId))!)
  row = (await f.store.get<RoomRequestState>('request', sent.requestId))!
  expect(row.value.status).toBe('cancelled')
  expect(f.seen).toHaveLength(0)
  expect((await f.store.list<import('../contracts/rooms.js').RoomMessage>('message')).filter((row) => row.value.authorKind === 'member')).toHaveLength(0)
})
it('preserves accepted model settings and separates Agent workspaces and history', async () => {
  const f = await fixture()
  const first = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'freeze', body: 'PRIVATE_ALPHA Create hello.txt' })
  const agent = await f.runtime.agents.get(f.created.agentId)
  await f.runtime.agents.update(agent.id, { clientRequestId: 'changed', expectedRevision: agent.revision, modelRef: { providerId: 'test', model: 'second' } })
  const a = await f.advance(first.requestId)
  expect(a.privateModel?.model).toBe('first')
  const other = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'other' })
  const sent = await f.runtime.service.send(other.roomId, { clientRequestId: 'other-chat', body: 'PRIVATE_BETA Create hello.txt' })
  const b = await f.advance(sent.requestId)
  expect(b.threadId).not.toBe(a.threadId)
  expect(b.privateWorkspace).not.toBe(a.privateWorkspace)
  expect(JSON.stringify(f.seen.filter((request) => request.threadId === b.threadId))).not.toContain('PRIVATE_ALPHA')
})
it('resets model context without erasing public history and retains active work beyond recent requests', async () => {
  const f = await fixture()
  const first = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'before', body: 'PRIVATE_ALPHA Create hello.txt' })
  const a = await f.advance(first.requestId)
  const room = await f.runtime.service.get(f.created.roomId)
  await updateDirectWorkspace(f.runtime, room.id, { clientRequestId: 'reset', expectedRevision: room.revision, action: 'reset' })
  const second = await f.runtime.service.send(room.id, { clientRequestId: 'after', body: 'PRIVATE_BETA Create hello.txt' })
  const b = await f.advance(second.requestId)
  expect(b.threadId).not.toBe(a.threadId)
  expect(JSON.stringify(f.seen.filter((request) => request.threadId === b.threadId))).not.toContain('PRIVATE_ALPHA')
  expect((await f.store.list('message'))).toHaveLength(4)
  const pending = await f.runtime.service.send(room.id, { clientRequestId: 'waiting-first', body: 'Wait' })
  for (let i = 0; i < 21; i++) await f.runtime.service.send(room.id, { clientRequestId: 'waiting-' + i, body: 'Wait next' })
  const activity = await directActivity(f.runtime, room.id)
  expect(activity.active?.id).toBe(pending.requestId)
  expect(activity.requests).toHaveLength(20)
  expect(activity.pendingCount).toBe(22)
})

it('keeps explicit reply branches while ordinary assistant messages have no automatic quote', async () => {
  const f = await fixture()
  const first = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'first-thread', body: 'Create hello.txt' })
  await f.advance(first.requestId)
  const reply = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'explicit-reply', body: 'Explain this file', replyToMessageId: first.message.id })
  const done = await f.advance(reply.requestId)
  const response = (await f.store.list<import('../contracts/rooms.js').RoomMessage>('message')).find((row) => row.value.originRunId === done.privateRunId)!.value
  expect(response.replyToMessageId).toBeUndefined()
  expect(response.displayThreadRootId).toBe(first.message.id)
})

it('hydrates a scoped stream and drops late text after persisted cancellation without new execution', async () => {
  const f = await fixture()
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'stream', body: 'Create hello.txt' })
  const done = await f.advance(sent.requestId)
  const values: Array<import('../contracts/rooms.js').RoomMessage | null> = []
  const feed = new RoomRunTextStream(f.deps, f.h.bus, f.created.roomId, done.privateRunId!, (message) => { values.push(message); return true })
  await feed.start()
  await vi.waitFor(() => expect(values.at(-1)?.body).toContain('The file is ready'))
  const count = f.seen.length
  const row = (await f.store.get<RoomRequestState>('request', done.id))!
  await f.store.commit({ requestId: 'stream-stop', checks: [{ kind: 'request', id: done.id, expectedRevision: row.revision }],
    puts: [{ kind: 'request', id: done.id, roomId: done.roomId, value: { ...row.value, cancellationRequested: true, status: 'cancelled' } }] })
  f.h.bus.publish({ kind: 'assistant_text_delta', threadId: done.threadId, turnId: done.turnId,
    seq: 99999, deltaOffset: 0, item: { id: 'late', threadId: done.threadId, turnId: done.turnId, kind: 'assistant_text', text: 'LATE_TEXT' } } as import('../contracts/events.js').RuntimeEvent)
  await vi.waitFor(() => expect(values.at(-1)).toBeNull())
  expect(JSON.stringify(values)).not.toContain('LATE_TEXT')
  expect(f.seen.length).toBe(count)
  feed.close()
})

it('replays durable deltas beyond a stale checkpoint without depending on bus history', async () => {
  const f = await fixture()
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'checkpoint', body: 'Create hello.txt' })
  const done = await f.advance(sent.requestId)
  const load = f.h.sessionStore.loadItemPage.bind(f.h.sessionStore)
  vi.spyOn(f.h.sessionStore, 'loadItemPage').mockImplementationOnce(async (...args) => {
    const page = await load(...args)
    return { ...page, replayAfterSeq: 0, items: page.items.map((item) => item.kind === 'assistant_text' ? { ...item, text: 'The' } : item) }
  })
  vi.spyOn(f.h.bus, 'snapshotSince').mockImplementation(() => { throw new Error('production has no bus tail') })
  const values: Array<import('../contracts/rooms.js').RoomMessage | null> = []
  const feed = new RoomRunTextStream(f.deps, f.h.bus, f.created.roomId, done.privateRunId!, (message) => { values.push(message); return true })
  await feed.start()
  await vi.waitFor(() => expect(values.at(-1)?.body).toBe('The file is ready.'))
  feed.close()
})

it('freezes accepted permissions and applies full access only to the next private turn', async () => {
  const f = await fixture()
  const approvals = vi.spyOn(f.h.approvalGate, 'request')
  const first = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'before-policy', body: 'Keep context: ALPHA. Create hello.txt.' })
  const state = await agentPermissions(f.runtime, f.created.roomId)
  expect(state.mode).toBe('ask-for-approval')
  await setAgentPermissions(f.runtime, f.created.roomId, { clientRequestId: 'full-policy', expectedRevision: state.revision, mode: 'full-access' })
  expect(f.seen).toHaveLength(0)
  const a = await f.advance(first.requestId)
  expect(a.roomSnapshot.privateExecutionPolicy?.sandboxMode).toBe('workspace-write')
  expect(approvals).toHaveBeenCalledTimes(1)
  const next = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'after-policy', body: 'Update hello.txt.' })
  const b = await f.advance(next.requestId)
  expect(b.roomSnapshot.privateExecutionPolicy?.sandboxMode).toBe('danger-full-access')
  expect(b.threadId).not.toBe(a.threadId)
  expect(approvals).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(f.seen.filter((request) => request.threadId === b.threadId))).toContain('ALPHA')
  const other = await quickCreateAgent(f.runtime.agents, { clientRequestId: 'other-policy' })
  expect((await agentPermissions(f.runtime, other.roomId)).mode).toBe('ask-for-approval')
})
it('full access performs an explicitly selected external file write and respects later Agent directory limits', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'kun-permission-external-'))
  cleanup.push(() => rm(outside, { recursive: true, force: true }))
  const file = join(outside, 'hello.txt'), f = await fixture(file)
  const state = await agentPermissions(f.runtime, f.created.roomId)
  await setAgentPermissions(f.runtime, f.created.roomId, { clientRequestId: 'external-permission', expectedRevision: state.revision, mode: 'full-access' })
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'external-file', body: 'Create the requested file at ' + file })
  await f.advance(sent.requestId)
  expect(await readFile(file, 'utf8')).toBe('hello')
  execFileSync('git', ['init', '--quiet', outside])
  execFileSync('git', ['-C', outside, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'test: initialize scope'])
  const agent = await f.runtime.agents.get(f.created.agentId)
  await f.runtime.agents.update(agent.id, { clientRequestId: 'limit-after', expectedRevision: agent.revision, allowedRepositoryRoots: [outside] })
  await expect(f.runtime.service.send(f.created.roomId, { clientRequestId: 'after-limit', body: 'Write again' })).rejects.toThrow('Agent limits changed')
})

it('uses current confirmed permissions for a new retry while retaining the original workspace', async () => {
  const f = await fixture()
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'retry-policy', body: 'Create hello.txt' })
  const original = (await f.store.get<RoomRequestState>('request', sent.requestId))!
  await controlDirectRequest(f.runtime, f.created.roomId, sent.requestId, { action: 'stop', clientRequestId: 'cancel-retry', expectedRevision: original.revision })
  await f.advance(sent.requestId)
  const policy = await agentPermissions(f.runtime, f.created.roomId)
  await setAgentPermissions(f.runtime, f.created.roomId, { clientRequestId: 'retry-full', expectedRevision: policy.revision, mode: 'full-access' })
  const cancelled = (await f.store.get<RoomRequestState>('request', sent.requestId))!
  await controlDirectRequest(f.runtime, f.created.roomId, sent.requestId, { action: 'retry', clientRequestId: 'retry-now', expectedRevision: cancelled.revision })
  const retry = (await f.store.list<RoomRequestState>('request', { roomId: f.created.roomId }))[0]
  expect(retry.value.roomSnapshot.privateExecutionPolicy?.sandboxMode).toBe('danger-full-access')
  expect(retry.value.roomSnapshot.privateWorkspace).toBe(original.value.roomSnapshot.privateWorkspace)
})
