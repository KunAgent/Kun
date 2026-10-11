import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient } from '../ports/model-client.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { defaultLocalTools } from '../adapters/tool/local-tool-host.js'
import { roomResultProvider } from '../rooms/room-result-tools.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { AgentDirectRunner } from './agent-direct-runner.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function runRequest(model: ModelClient) {
  const root = await mkdtemp(join(tmpdir(), 'kun-direct-delivery-'))
  const h = makeHarness(model)
  h.toolHost.replaceRuntimeComponents({ registry: new CapabilityRegistry([
    { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: defaultLocalTools },
    roomResultProvider(h.threadStore)
  ]) })
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'test', providerId: 'test' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, runtime.service)
  cleanup.push(async () => { await runtime.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const approve = setInterval(() => { for (const item of h.approvalGate.pending()) h.approvalGate.decide(item.id, 'allow') }, 10)
  cleanup.push(async () => { clearInterval(approve) })
  const created = await quickCreateAgent(runtime.agents, { clientRequestId: 'create' }, true)
  const sent = await runtime.service.send(created.roomId, { clientRequestId: 'request', body: 'Create hello.txt' })
  for (let i = 0; i < 12; i++) {
    const row = (await store.get<RoomRequestState>('request', sent.requestId))!
    if (['completed', 'failed', 'cancelled'].includes(row.value.status)) break
    await runner.tick(row)
    const current = (await store.get<RoomRequestState>('request', sent.requestId))!.value
    if (!current.turnId) continue
    const thread = await h.threads.getMetadata(current.threadId)
    if (thread?.turns.find((turn) => turn.id === current.turnId)?.status === 'queued') {
      await h.turns.startNextQueuedTurn(current.threadId)
      await h.loop.runTurn(current.threadId, current.turnId)
    }
  }
  const request = (await store.get<RoomRequestState>('request', sent.requestId))!.value
  const messages = (await store.list<RoomMessage>('message', { roomId: created.roomId }))
    .filter((row) => row.value.authorKind === 'member').map((row) => row.value).reverse()
  const items = await h.sessionStore.loadItems(request.threadId)
  const run = request.privateRunId ? (await store.get<RoomRunRecord>('room_run', request.privateRunId))?.value : undefined
  return { root, request, messages, items, run }
}

it('publishes a start message before work and a final message after it', async () => {
  const model: ModelClient = { provider: 'test', model: 'test', async *stream(request) {
    const results = request.history.filter((item) => item.kind === 'tool_result' && item.turnId === request.turnId)
    const triedWrite = results.some((item) => item.kind === 'tool_result' && item.toolName === 'write')
    const started = results.some((item) => item.kind === 'tool_result' && item.toolName === 'send_im_message' &&
      (item.output as { phase?: string })?.phase === 'start' && item.isError !== true)
    const wrote = results.some((item) => item.kind === 'tool_result' && item.toolName === 'write' && item.isError !== true)
    const finished = results.some((item) => item.kind === 'tool_result' && item.toolName === 'send_im_message' &&
      (item.output as { phase?: string })?.phase === 'final' && item.isError !== true)
    if (!triedWrite) yield { kind: 'tool_call_complete', callId: 'premature-write', toolName: 'write',
      arguments: { path: 'hello.txt', content: 'too early' } }
    else if (!started) yield { kind: 'tool_call_complete', callId: 'start', toolName: 'send_im_message',
      arguments: { text: 'I will create the file.', phase: 'start' } }
    else if (!wrote) yield { kind: 'tool_call_complete', callId: 'write', toolName: 'write',
      arguments: { path: 'hello.txt', content: 'ready' } }
    else if (!finished) yield { kind: 'tool_call_complete', callId: 'finish', toolName: 'send_im_message',
      arguments: { text: 'The file is ready.', phase: 'final' } }
    yield { kind: 'completed', stopReason: finished ? 'stop' : 'tool_calls' }
  } }
  const f = await runRequest(model)
  expect(f.request.status).toBe('completed')
  expect(await readFile(join(f.request.privateWorkspace!, 'hello.txt'), 'utf8')).toBe('ready')
  expect(f.messages.map((message) => message.deliveryPhase)).toEqual(['start', 'final'])
  expect(f.run?.firstResponseMs).toEqual(expect.any(Number))
  expect(f.run?.lastDeliveryPhase).toBe('final')
  const results = f.items.filter((item) => item.kind === 'tool_result' && item.turnId === f.request.turnId)
  expect(results.some((item) => item.kind === 'tool_result' && item.callId === 'premature-write' && item.isError)).toBe(true)
  const firstVisible = results.findIndex((item) => item.kind === 'tool_result' && item.toolName === 'send_im_message' &&
    (item.output as { phase?: string })?.phase === 'start')
  const actualWrite = results.findIndex((item) => item.kind === 'tool_result' && item.toolName === 'write' && item.isError !== true)
  expect(firstVisible).toBeGreaterThanOrEqual(0)
  expect(actualWrite).toBeGreaterThan(firstVisible)
})

it('answers a simple request with one final message and no start bubble', async () => {
  const model: ModelClient = { provider: 'test', model: 'test', async *stream(request) {
    const sent = request.history.some((item) => item.kind === 'tool_result' && item.turnId === request.turnId &&
      item.toolName === 'send_im_message' && item.isError !== true)
    if (!sent) yield { kind: 'tool_call_complete', callId: 'answer', toolName: 'send_im_message',
      arguments: { text: 'Here is the answer.', phase: 'final' } }
    yield { kind: 'completed', stopReason: sent ? 'stop' : 'tool_calls' }
  } }
  const f = await runRequest(model)
  expect(f.request.status).toBe('completed')
  expect(f.messages.map((message) => message.deliveryPhase)).toEqual(['final'])
})
