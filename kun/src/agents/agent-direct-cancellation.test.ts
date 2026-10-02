import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileArtifactStore } from '../artifacts/artifact-store.js'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient } from '../ports/model-client.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { defaultLocalTools } from '../adapters/tool/local-tool-host.js'
import { roomResultProvider } from '../rooms/room-result-tools.js'
import { roomImMessageTool } from '../rooms/room-im-message-tool.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import { putRoomDocument, roomFingerprint } from '../rooms/room-service.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { AgentDirectRunner } from './agent-direct-runner.js'
import { controlDirectRequest, directActivity } from './agent-direct-service.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
async function fixture(model?: ModelClient, withParent = false) {
  const root = await mkdtemp(join(tmpdir(), 'kun-private-cancel-'))
  const h = makeHarness(model ?? { provider: 'test', model: 'first', async *stream() {
    yield { kind: 'completed', stopReason: 'stop' }
  } })
  h.toolHost.replaceRuntimeComponents({ registry: new CapabilityRegistry([
    { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: defaultLocalTools },
    roomResultProvider(h.threadStore)
  ]) })
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, artifacts: new FileArtifactStore(join(root, 'artifacts')), threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'first', providerId: 'test' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, runtime.service)
  const created = await quickCreateAgent(runtime.agents, { clientRequestId: 'create' }, true)
  const sent = await runtime.service.send(created.roomId, { clientRequestId: 'source', body: 'Write evidence.txt and report the result.' })
  const row = async (id = sent.requestId) => (await store.get<RoomRequestState>('request', id))!
  if (withParent) {
    const source = await row()
    await putRoomDocument(store, 'request', 'parent', created.roomId,
      { ...source.value, id: 'parent', rootRequestId: 'parent', status: 'completed' }, null)
    await putRoomDocument(store, 'request', source.id, created.roomId,
      { ...source.value, rootRequestId: 'parent' }, source)
  }
  await runner.tick(await row()); await runner.tick(await row())
  const request = (await row()).value
  await h.turns.startNextQueuedTurn(request.threadId)
  const approve = setInterval(() => { for (const pending of h.approvalGate.pending()) h.approvalGate.decide(pending.id, 'allow') }, 5)
  cleanup.push(async () => { clearInterval(approve); await runtime.close(); await h.turns.interruptActiveTurns();
    await store.close(); await rm(root, { recursive: true, force: true }) })
  const stop = (clientRequestId = 'stop') => controlDirectRequest(runtime, created.roomId, sent.requestId,
    { action: 'stop', clientRequestId, expectedRevision: 0 })
  const publish = (text: string, callId = text, attachments: Array<{ path: string }> = []) =>
    roomImMessageTool(h.threadStore).execute({ text, attachments }, {
    threadId: request.threadId, turnId: request.turnId!, workspace: request.privateWorkspace!,
    sandboxMode: 'workspace-write', approvalPolicy: 'auto', threadMode: 'agent', roomStepKind: 'conversation',
    roomAgent: true, activeToolCallId: callId, abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' })
  const messages = async () => (await store.list<RoomMessage>('message', { roomId: created.roomId }))
    .filter((row) => row.value.authorKind === 'member').map((row) => row.value.body)
  return { root, h, store, deps, runtime, runner, created, sent, row, request, stop, publish, messages }
}

it('fences a held model released after durable Stop, retaining earlier messages and tool success', async () => {
  const held = deferred(), entered = deferred()
  let step = 0
  const f = await fixture({ provider: 'test', model: 'first', async *stream() {
    if (step++ === 0) yield { kind: 'tool_call_complete', callId: 'start', toolName: 'send_im_message',
      arguments: { text: 'Working on the file.', phase: 'start' } }
    else if (step === 2) yield { kind: 'tool_call_complete', callId: 'write-evidence', toolName: 'write',
      arguments: { path: 'evidence.txt', content: 'real tool success' } }
    else if (step === 3) {
      entered.resolve(); await held.promise
      yield { kind: 'tool_call_complete', callId: 'late-final', toolName: 'send_im_message',
        arguments: { text: 'Late final must not appear.', phase: 'final' } }
    }
    yield { kind: 'completed', stopReason: step <= 3 ? 'tool_calls' : 'stop' }
  } })
  const execution = f.h.loop.runTurn(f.request.threadId, f.request.turnId!)
  try {
    await entered.promise
    expect(await readFile(join(f.request.privateWorkspace!, 'evidence.txt'), 'utf8')).toBe('real tool success')
    expect(await f.messages()).toEqual(['Working on the file.'])
    await f.stop()
    expect((await f.row()).value).toMatchObject({ status: 'stopping', cancellationRequested: true })
    expect((await directActivity(f.runtime, f.created.roomId)).execution).toBeUndefined()
    held.resolve(); await execution
    expect(await f.messages()).toEqual(['Working on the file.'])
    expect((await f.h.threads.getMetadata(f.request.threadId))?.turns.find((turn) => turn.id === f.request.turnId)?.status).toBe('aborted')
    await new AgentDirectRunner(f.deps, f.runtime.service).tick(await f.row())
    expect((await f.row()).value.status).toBe('cancelled')
    expect((await f.store.get<RoomRunRecord>('room_run', f.request.privateRunId!))?.value.outcome).toBe('cancelled')
  } finally { held.resolve(); await execution }
})

it('atomically rejects a publication already in flight when Stop wins the commit race', async () => {
  const f = await fixture(), held = deferred(), entered = deferred()
  expect((await f.publish('Already visible.')).isError).not.toBe(true)
  const commit = f.store.commit.bind(f.store)
  vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
    if (input.puts?.some((put) => put.kind === 'message' && (put.value as RoomMessage).body === 'Late final.')) {
      entered.resolve(); await held.promise
    }
    return commit(input)
  })
  const publication = f.publish('Late final.')
  try {
    await entered.promise
    await f.stop()
    held.resolve()
    expect((await publication).isError).toBe(true)
    expect(await f.messages()).toEqual(['Already visible.'])
    expect((await f.store.get<RoomRunRecord>('room_run', f.request.privateRunId!))?.value.lastVisibleAt)
      .toBe((await f.store.list<RoomMessage>('message')).find((row) => row.value.body === 'Already visible.')?.value.createdAt)
  } finally { held.resolve(); await publication }
})

it.each(['stopping', 'cancelled', 'recovery_required'] as const)('rejects a new private publication while request is %s', async (status) => {
  const f = await fixture(), row = await f.row()
  await putRoomDocument(f.store, 'request', row.id, row.roomId!, { ...row.value, status }, row)
  expect((await f.publish('Cannot appear.')).isError).toBe(true)
  expect(await f.messages()).toEqual([])
})

it('replaying Stop never interrupts a newer turn on the same conversation thread', async () => {
  const f = await fixture()
  const interrupt = vi.spyOn(f.h.turns, 'interruptTurn')
  await f.stop()
  expect(interrupt).toHaveBeenCalledWith({ threadId: f.request.threadId, turnId: f.request.turnId })
  await new AgentDirectRunner(f.deps, f.runtime.service).tick(await f.row())
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'newer', body: 'A separate new task.' })
  await f.runner.tick(await f.row(sent.requestId)); await f.runner.tick(await f.row(sent.requestId))
  const newer = (await f.row(sent.requestId)).value
  await f.h.turns.startNextQueuedTurn(newer.threadId)
  interrupt.mockClear()
  expect(await f.stop()).toEqual({ accepted: true })
  await f.stop('another-stop')
  expect(interrupt).not.toHaveBeenCalled()
  expect((await f.h.threads.getMetadata(newer.threadId))?.turns.find((turn) => turn.id === newer.turnId)?.status).toBe('running')
})

it('a repeated Stop recovers an interruption failure without retargeting or undoing durable cancellation', async () => {
  const f = await fixture()
  const interrupt = vi.spyOn(f.h.turns, 'interruptTurn').mockRejectedValueOnce(new Error('interrupt transport unavailable'))
  await expect(f.stop()).rejects.toThrow('interrupt transport unavailable')
  expect((await f.row()).value).toMatchObject({ cancellationRequested: true, status: 'stopping' })
  expect((await f.publish('Must stay blocked.')).isError).toBe(true)
  expect(await f.stop()).toEqual({ accepted: true })
  expect(interrupt).toHaveBeenCalledTimes(2)
  expect(interrupt.mock.calls.every(([input]) => input.threadId === f.request.threadId && input.turnId === f.request.turnId)).toBe(true)
  await new AgentDirectRunner(f.deps, f.runtime.service).tick(await f.row())
  expect((await f.row()).value.status).toBe('cancelled')
})

it('stopping a merged input atomically fences its response owner before the interrupt completes', async () => {
  const f = await fixture()
  const sent = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'merged', body: 'An extra instruction.' })
  await f.runner.tick(await f.row(sent.requestId)); await f.runner.tick(await f.row(sent.requestId))
  const merged = await f.row(sent.requestId)
  expect(merged.value.steer?.targetTurnId).toBe(f.request.turnId)
  const held = deferred(), entered = deferred()
  const interrupt = f.h.turns.interruptTurn.bind(f.h.turns)
  vi.spyOn(f.h.turns, 'interruptTurn').mockImplementation(async (input) => {
    entered.resolve(); await held.promise; return interrupt(input)
  })
  const stop = controlDirectRequest(f.runtime, f.created.roomId, merged.id,
    { action: 'stop', clientRequestId: 'stop-merged', expectedRevision: merged.revision })
  try {
    await entered.promise
    expect((await f.row()).value).toMatchObject({ cancellationRequested: true, status: 'stopping' })
    expect((await f.row(merged.id)).value).toMatchObject({ cancellationRequested: true, status: 'stopping' })
    expect((await f.h.threads.getMetadata(f.request.threadId))?.turns.find((turn) => turn.id === f.request.turnId)?.status).toBe('running')
    expect((await f.publish('No final after merged Stop.')).isError).toBe(true)
    expect(await f.messages()).toEqual([])
  } finally { held.resolve(); await stop }
  await new AgentDirectRunner(f.deps, f.runtime.service).tick(await f.row(merged.id))
  await new AgentDirectRunner(f.deps, f.runtime.service).tick(await f.row())
  expect((await f.row()).value.status).toBe('cancelled')
  expect((await f.row(merged.id)).value.status).toBe('cancelled')
})

it('fails closed on an unrelated recorded turn instead of interrupting it', async () => {
  const f = await fixture()
  const unrelated = await f.h.turns.enqueueTurn({ threadId: f.request.threadId,
    request: { prompt: 'Unrelated queued work', clientRequestId: 'unrelated', enqueueIfBusy: true } })
  const row = await f.row()
  await putRoomDocument(f.store, 'request', row.id, row.roomId!, { ...row.value, turnId: unrelated.turnId }, row)
  const interrupt = vi.spyOn(f.h.turns, 'interruptTurn')
  await f.stop()
  await new AgentDirectRunner(f.deps, f.runtime.service).tick(await f.row())
  expect(interrupt).not.toHaveBeenCalled()
  expect((await f.row()).value.status).toBe('recovery_required')
  expect((await f.h.threads.getMetadata(f.request.threadId))?.turns.find((turn) => turn.id === unrelated.turnId)?.status).toBe('queued')
})

it('checks the continuation root in the same transaction as the new publication', async () => {
  const f = await fixture(undefined, true)
  const root = await f.row('parent')
  const held = deferred(), entered = deferred(), commit = f.store.commit.bind(f.store)
  vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
    if (input.puts?.some((put) => put.kind === 'message')) { entered.resolve(); await held.promise }
    return commit(input)
  })
  const publication = f.publish('Continuation final cannot escape root Stop.')
  try {
    await entered.promise
    await putRoomDocument(f.store, 'request', root.id, root.roomId!, { ...root.value, cancellationRequested: true }, root)
    held.resolve()
    expect((await publication).isError).toBe(true)
    expect(await f.messages()).toEqual([])
  } finally { held.resolve(); await publication }
})

it.each([false, true])('rejects replaying a Stop receipt against another request (other room: %s)', async (otherRoom) => {
  const f = await fixture()
  await f.stop()
  const room = otherRoom ? await quickCreateAgent(f.runtime.agents, { clientRequestId: 'another-agent', setupMode: 'form' }) : f.created
  const sent = await f.runtime.service.send(room.roomId, { clientRequestId: 'another-request', body: 'Separate work.' })
  const row = await f.row(sent.requestId)
  const interrupt = vi.spyOn(f.h.turns, 'interruptTurn')
  await expect(controlDirectRequest(f.runtime, room.roomId, sent.requestId,
    { action: 'stop', clientRequestId: 'stop', expectedRevision: 0 })).rejects.toThrow('request changed')
  expect(interrupt).not.toHaveBeenCalled()
  expect((await f.row(sent.requestId)).revision).toBe(row.revision)
  expect((await f.row(sent.requestId)).value.cancellationRequested).toBeUndefined()
})

it('fences a late saved-file version at metadata commit while preserving published snapshots', async () => {
  const f = await fixture(), path = join(f.request.privateWorkspace!, 'report.txt')
  await writeFile(path, 'Already saved bytes.')
  expect((await f.publish('Earlier attachment.', 'earlier-attachment', [{ path }])).isError).not.toBe(true)
  const before = (await f.runtime.artifactLibrary.list(f.created.agentId)).artifacts
  expect(before).toHaveLength(1)
  const artifact = before[0]
  expect(artifact.version).toBe(1)
  await writeFile(path, 'Late bytes must not become a saved version.')
  const held = deferred(), entered = deferred(), commit = f.store.commit.bind(f.store)
  vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
    if (input.puts?.some((put) => put.kind === 'agent_artifact')) { entered.resolve(); await held.promise }
    return commit(input)
  })
  const publication = f.publish('Late attachment.', 'late-attachment', [{ path }])
  try {
    await entered.promise
    await f.stop()
    held.resolve()
    expect((await publication).isError).toBe(true)
    expect((await f.runtime.artifactLibrary.list(f.created.agentId)).artifacts).toEqual(before)
    expect((await f.runtime.artifactLibrary.versions(f.created.agentId, artifact.id)).versions).toHaveLength(1)
    expect((await f.runtime.artifactLibrary.read(f.created.agentId, artifact.id, 1)).data.toString()).toBe('Already saved bytes.')
    expect(await f.messages()).toEqual(['Earlier attachment.'])
  } finally { held.resolve(); await publication }
})

it('replays an older unscoped Stop receipt only for the exact request recorded in its event', async () => {
  const f = await fixture(), row = await f.row()
  const input = { action: 'stop' as const, clientRequestId: 'legacy-stop', expectedRevision: 0 }
  await f.store.commit({ requestId: 'private-control:legacy-stop', fingerprint: roomFingerprint(input),
    checks: [{ kind: 'request', id: row.id, expectedRevision: row.revision }],
    puts: [{ kind: 'request', id: row.id, roomId: row.roomId,
      value: { ...row.value, status: 'stopping', cancellationRequested: true } }],
    events: [{ roomId: row.roomId!, kind: 'request.updated', payload: { id: row.id } }] })
  const other = await f.runtime.service.send(f.created.roomId, { clientRequestId: 'another', body: 'Another task.' })
  const interrupt = vi.spyOn(f.h.turns, 'interruptTurn')
  await expect(controlDirectRequest(f.runtime, f.created.roomId, other.requestId, input)).rejects.toThrow('request changed')
  expect(interrupt).not.toHaveBeenCalled()
  expect(await controlDirectRequest(f.runtime, f.created.roomId, row.id, input)).toEqual({ accepted: true })
  expect(interrupt).toHaveBeenCalledWith({ threadId: f.request.threadId, turnId: f.request.turnId })
})
