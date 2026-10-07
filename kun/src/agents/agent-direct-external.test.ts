import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient } from '../ports/model-client.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { AgentDirectRunner } from './agent-direct-runner.js'
import { openAgentConversation } from './agent-conversations.js'
import { ensureRoomThread, enqueueRoomTurn } from '../rooms/room-execution.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('routes a private chat to the coding Agent engine and posts its final reply', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-direct-external-'))
  const prompts: string[] = []
  // The test loop stands in for the engine; production admission routes by harnessId.
  const model: ModelClient = { provider: 'test', model: 'test', async *stream(request) {
    prompts.push(JSON.stringify(request.history.filter((item) => item.kind === 'user_message')))
    yield { kind: 'assistant_text_delta', text: 'Looked at the repo. The bug is in parser.ts.' }
    yield { kind: 'completed', stopReason: 'stop' }
  } }
  const h = makeHarness(model)
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'kun-model', providerId: 'kun' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, runtime.service)
  cleanup.push(async () => { await runtime.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  runtime.agents.setExecutorValidator(async (executor) => executor)
  const { agent } = await runtime.agents.create({ clientRequestId: 'codex', name: 'Codex',
    executor: { kind: 'harness', harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-5.5' } })
  const { room } = await openAgentConversation(runtime.agents, runtime.service, agent.id)
  const sent = await runtime.service.send(room.id, { clientRequestId: 'ask', body: 'Why does parsing fail?' })
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
  expect(request.status).toBe('completed')
  const thread = (await h.threads.getMetadata(request.threadId))!
  expect(thread.harnessId).toBe('codex')
  expect(thread.model).toBe('gpt-5.5')
  expect(thread.mode).toBe('agent')
  expect(thread.roomContext?.blockedToolNames).toContain('send_im_message')
  expect(thread.systemPrompt).toContain('You are Codex, a coding Agent')
  expect(thread.turns[0]).toMatchObject({ harnessId: 'codex', credentialMode: 'native-login' })
  expect(prompts.join('\n')).toContain('Why does parsing fail?')
  const messages = (await store.list<RoomMessage>('message', { roomId: room.id }))
    .filter((row) => row.value.authorKind === 'member').map((row) => row.value)
  expect(messages.map((message) => message.body)).toEqual(['Looked at the repo. The bug is in parser.ts.'])
  const run = (await store.get<RoomRunRecord>('room_run', request.privateRunId!))!.value
  expect(run).toMatchObject({ outcome: 'published', publishedMessageId: messages[0].id })
  expect(run.communicationRequired).toBe(false)
})

it('runs a coding Agent group member read-only in discussion and never as a task owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-external-'))
  const h = makeHarness({ provider: 'test', model: 'test', async *stream() { yield { kind: 'completed', stopReason: 'stop' } } })
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'kun-model', providerId: 'kun' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps)
  cleanup.push(async () => { await runtime.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  runtime.agents.setExecutorValidator(async (executor) => executor)
  const coder = (await runtime.agents.create({ clientRequestId: 'codex', name: 'Codex',
    executor: { kind: 'harness', harnessId: 'codex', credentialMode: 'kun-gateway', model: 'kun/api/model' } })).agent
  const lead = (await runtime.agents.create({ clientRequestId: 'lead', name: 'Ada' })).agent
  const { room } = await runtime.service.create({ clientRequestId: 'team', name: 'Team', defaultMemberId: 'lead', collaborationMode: 'peer',
    members: [{ ...runtime.agents.asMember(lead), id: 'lead' }, { ...runtime.agents.asMember(coder), id: 'coder' }] })
  const sent = await runtime.service.send(room.id, { clientRequestId: 'ask', body: '@Codex what do you think?', mentionMemberIds: ['coder'] })
  const request = (await store.get<RoomRequestState>('request', sent.requestId))!.value
  const member = request.roomSnapshot.members.find((item) => item.id === 'coder')!
  await expect(ensureRoomThread(deps, { id: 'exec-thread', roomId: room.id, requestId: request.id, member, kind: 'execution' }))
    .rejects.toThrow('编程 Agent 只参与对话和讨论')
  const thread = await ensureRoomThread(deps, { id: 'discuss-thread', roomId: room.id, requestId: request.id, member,
    kind: 'discussion', collaborationProtocol: 'peer' })
  expect(thread).toMatchObject({ harnessId: 'codex', model: 'kun/api/model', mode: 'agent', sandboxMode: 'read-only', approvalPolicy: 'never' })
  expect(thread.roomContext?.allowedToolNames).not.toContain('propose_room_action')
  expect(thread.roomContext?.allowedToolNames).toContain('send_room_message')
  expect(thread.systemPrompt).toContain('This discussion is read-only')
  const turnId = await enqueueRoomTurn(deps, thread.id, 'peer-turn-1', 'Discuss the parser')
  expect((await h.threads.getMetadata(thread.id))!.turns.find((turn) => turn.id === turnId))
    .toMatchObject({ harnessId: 'codex', credentialMode: 'kun-gateway' })
})
