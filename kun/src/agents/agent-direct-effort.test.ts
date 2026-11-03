import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient } from '../ports/model-client.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { AgentDirectRunner } from './agent-direct-runner.js'
import { updateDirectModel } from './agent-direct-model.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('admits private turns with the conversation reasoning effort', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-direct-effort-'))
  const model: ModelClient = { provider: 'test', model: 'test', async *stream() { yield { kind: 'completed', stopReason: 'stop' } } }
  const h = makeHarness(model)
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'test', providerId: 'test' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, runtime.service)
  cleanup.push(async () => { await runtime.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const created = await quickCreateAgent(runtime.agents, { clientRequestId: 'create' }, true)
  const room = await runtime.service.get(created.roomId)
  await updateDirectModel(runtime, room.id, { clientRequestId: 'effort', expectedRevision: room.revision, reasoningEffort: 'high' })
  const sent = await runtime.service.send(created.roomId, { clientRequestId: 'ask', body: 'Think it through' })
  for (let i = 0; i < 6; i++) {
    const row = (await store.get<RoomRequestState>('request', sent.requestId))!
    if (row.value.turnId) break
    await runner.tick(row)
  }
  const request = (await store.get<RoomRequestState>('request', sent.requestId))!.value
  expect(request.roomSnapshot.privateReasoningEffort).toBe('high')
  const turn = (await h.threads.getMetadata(request.threadId))!.turns.find((item) => item.id === request.turnId)
  expect(turn?.reasoningEffort).toBe('high')
})
