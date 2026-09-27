import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient } from '../ports/model-client.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { roomResultProvider } from '../rooms/room-result-tools.js'
import { bindRoomAppAccess } from '../rooms/room-app-connection-tools.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { enqueuePrivateContinuation } from '../rooms/room-continuation-service.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { AgentDirectRunner } from './agent-direct-runner.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('lets a private Agent publish an in-chat Gmail connection card during its turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'room-app-turn-'))
  const model: ModelClient = { provider: 'test', model: 'test', async *stream(request) {
    const requested = request.history.some((item) => item.kind === 'tool_result' && item.turnId === request.turnId &&
      item.toolName === 'request_app_connection' && !item.isError)
    if (!requested) yield { kind: 'tool_call_complete', callId: 'connect-gmail',
      toolName: 'request_app_connection', arguments: { serverId: 'gmail', reason: 'I need Gmail to search your inbox.' } }
    yield { kind: 'completed', stopReason: requested ? 'stop' : 'tool_calls' }
  } }
  const h = makeHarness(model)
  h.toolHost.replaceRuntimeComponents({ registry: new CapabilityRegistry([roomResultProvider(h.threadStore)]) })
  bindRoomAppAccess(h.threadStore, () => ({ servers: {}, statuses: {} }))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: directory, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'test', providerId: 'test' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, runtime.service)
  cleanup.push(async () => { await runtime.close(); await h.turns.interruptActiveTurns(); await store.close();
    await rm(directory, { recursive: true, force: true }) })
  const created = await quickCreateAgent(runtime.agents, { clientRequestId: 'create-agent' }, true)
  const sent = await runtime.service.send(created.roomId, { clientRequestId: 'ask-gmail', body: 'Check Gmail' })
  for (let step = 0; step < 12; step++) {
    const row = (await store.get<RoomRequestState>('request', sent.requestId))!
    if (['completed', 'failed'].includes(row.value.status)) break
    await runner.tick(row)
    const current = (await store.get<RoomRequestState>('request', sent.requestId))!.value
    if (!current.turnId) continue
    const thread = await h.threads.getMetadata(current.threadId)
    if (thread?.turns.find((turn) => turn.id === current.turnId)?.status === 'queued') {
      await h.turns.startNextQueuedTurn(current.threadId)
      await h.loop.runTurn(current.threadId, current.turnId)
    }
  }
  const cards = (await store.list<RoomMessage>('message', { roomId: created.roomId }))
    .filter((row) => row.value.presentationKind === 'app_connection')
  expect(cards).toHaveLength(1)
  expect(cards[0].value.appConnection).toMatchObject({ serverId: 'google_gmail', status: 'requested' })
  expect(cards[0].value.originRunId).toBeTruthy()
  expect((await store.get<RoomRequestState>('request', sent.requestId))?.value.status).toBe('completed')
  const run = (await store.get<RoomRunRecord>('room_run', cards[0].value.originRunId!))!.value
  const continuation = { threadId: run.threadId!, sourceTurnId: run.turnId!, kind: 'app_connection' as const,
    key: cards[0].id, prompt: 'Gmail is connected. Continue the original task.' }
  expect(await enqueuePrivateContinuation(deps, continuation)).toBe('queued')
  expect(await enqueuePrivateContinuation(deps, continuation)).toBe('queued')
  expect((await store.list<RoomRequestState>('request', { roomId: created.roomId }))
    .filter((row) => row.value.privateContinuation?.kind === 'app_connection')).toHaveLength(1)
})
