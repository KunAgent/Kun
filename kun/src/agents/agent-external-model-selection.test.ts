import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRequestState, RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { AgentExecutor } from '../contracts/agent-executor.js'
import type { WorkbenchRequest } from '../contracts/workbench-links.js'
import type { WorkbenchHarnessService } from '../workbench-bridge/harnesses.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { registerAgentChatRoutes } from '../server/routes/register-agent-chat-routes.js'
import { openAgentConversation } from './agent-conversations.js'
import { AgentDirectRunner } from './agent-direct-runner.js'
import { updateDirectModel } from './agent-direct-model.js'
import { agentModelOptions } from './agent-models.js'
import { controlDirectRequest, directActivity } from './agent-direct-service.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const original: AgentExecutor = { kind: 'harness', harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-old' }

async function fixture(executor = original) {
  const root = await mkdtemp(join(tmpdir(), 'kun-external-model-selection-'))
  const h = makeHarness(makeFakeModel([]))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: vi.fn(), model: () => ({ model: 'deepseek-flash', providerId: 'kun-provider' }),
    profiles: () => ({}), assertOwnership: async () => {} }
  const rooms = new RoomRuntime(deps), runner = new AgentDirectRunner(deps, rooms.service)
  const resolve = vi.fn(async (request: WorkbenchRequest) => {
    const selected = request.execution!.model!
    if (!['gpt-old', 'gpt-new', 'gpt-default'].includes(selected.model)) throw new Error('Model is unavailable from this coding Agent')
    return selected
  })
  rooms.workbench.attach({ harnesses: { resolve } as unknown as WorkbenchHarnessService })
  type Handler = Parameters<typeof registerAgentChatRoutes>[0] extends (method: string, path: string, handler: infer H) => void ? H : never
  const handlers = new Map<string, Handler>()
  registerAgentChatRoutes((method, path, handler) => { handlers.set(method + ' ' + path, handler) }, { rooms } as ServerRuntime)
  const call = (method: string, path: string, value?: unknown, params = {}, query = '') => handlers.get(method + ' ' + path)!(rooms,
    new Request('http://localhost' + path + query, { method, ...(value ? { body: JSON.stringify(value) } : {}) }), { params })
  const { agent } = await rooms.agents.create({ clientRequestId: 'codex', name: 'Codex', executor })
  const { room } = await openAgentConversation(rooms.agents, rooms.service, agent.id)
  cleanups.push(async () => { await rooms.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const request = async (id: string) => (await store.get<RoomRequestState>('request', id))!
  const admit = async (id: string) => {
    for (let i = 0; i < 6; i++) {
      const row = await request(id)
      if (row.value.turnId) return row.value
      await runner.tick(row)
    }
    throw new Error('The request was not admitted')
  }
  return { h, rooms, runner, store, resolve, call, agent, room, request, admit }
}

it('reports the external Agent model instead of the Kun default and preserves its own account', async () => {
  const f = await fixture({ ...original, credentialMode: 'kun-gateway', providerId: 'gateway-provider', accountId: 'gateway-account' })
  const binding = { model: 'gpt-old', providerId: 'gateway-provider', accountId: 'gateway-account' }
  const options = await f.call('GET', '/v1/agents/:agentId/models', undefined, { agentId: f.agent.id })
  expect(options).toMatchObject({ main: binding, inheritedMain: binding, mainSource: 'agent', options: [] })
  expect(options).not.toHaveProperty('fast.model')
  await updateDirectModel(f.rooms, f.room.id, { clientRequestId: 'switch', expectedRevision: f.room.revision, executorModel: 'gpt-new' })
  expect(await f.call('GET', '/v1/agents/:agentId/models', undefined, { agentId: f.agent.id }, '?room_id=' + f.room.id))
    .toMatchObject({ main: { ...binding, model: 'gpt-new' }, inheritedMain: binding,
      roomOverride: { ...binding, model: 'gpt-new' }, mainSource: 'room', options: [] })
  expect(await agentModelOptions(f.rooms.deps, f.agent, 'unrelated-room')).toMatchObject({ main: binding, roomOverride: undefined })
  expect(f.resolve.mock.calls.at(-1)?.[0].execution?.model).toEqual({ ...binding, model: 'gpt-new',
    harnessId: 'codex', credentialMode: 'kun-gateway' })
})

it('switches future turns on the same engine thread while running and queued messages keep their snapshots', async () => {
  const f = await fixture()
  const first = await f.rooms.service.send(f.room.id, { clientRequestId: 'running', body: 'First question' })
  const running = await f.admit(first.requestId)
  await f.h.turns.startNextQueuedTurn(running.threadId)
  await f.runner.tick(await f.request(first.requestId))
  const active = (await directActivity(f.rooms, f.room.id)).execution
  expect(active?.requestId).toBe(first.requestId)
  const queued = await f.rooms.service.send(f.room.id, { clientRequestId: 'queued', body: 'Queued question' })
  const before = await f.store.list('request', { roomId: f.room.id })
  await f.call('PUT', '/v1/rooms/:roomId/direct/model', { clientRequestId: 'switch', expectedRevision: f.room.revision,
    executorModel: 'gpt-new', reasoningEffort: 'high' }, { roomId: f.room.id })
  expect(await f.store.list('request', { roomId: f.room.id })).toEqual(before)
  expect((await directActivity(f.rooms, f.room.id)).execution).toEqual(active)
  expect((await f.rooms.agents.get(f.agent.id)).executor).toEqual(original)
  const next = await f.rooms.service.send(f.room.id, { clientRequestId: 'future', body: 'Use the new model' })
  expect((await f.request(next.requestId)).value).toMatchObject({ privateModel: { model: 'gpt-new' },
    roomSnapshot: { privateExecutorModel: 'gpt-new', privateReasoningEffort: 'high' } })
  const admittedQueued = await f.admit(queued.requestId), admittedNext = await f.admit(next.requestId)
  expect(admittedQueued.threadId).toBe(running.threadId)
  expect(admittedNext.threadId).toBe(running.threadId)
  const turns = (await f.h.threads.getMetadata(running.threadId))!.turns
  expect(turns.find((turn) => turn.id === admittedQueued.turnId)).toMatchObject({ model: 'gpt-old', harnessId: 'codex' })
  expect(turns.find((turn) => turn.id === admittedNext.turnId)).toMatchObject({ model: 'gpt-new', harnessId: 'codex',
    credentialMode: 'native-login', reasoningEffort: 'high' })
  expect(turns.find((turn) => turn.id === running.turnId)).toMatchObject({ model: 'gpt-old', status: 'running' })
})

it('keeps a room override when the Agent default changes and retries failed work with the corrected model', async () => {
  const f = await fixture()
  const sent = await f.rooms.service.send(f.room.id, { clientRequestId: 'failed', body: 'Try again' })
  const failed = await f.request(sent.requestId)
  await f.store.commit({ requestId: 'fail', checks: [{ kind: 'request', id: failed.id, expectedRevision: failed.revision }],
    puts: [{ kind: 'request', id: failed.id, roomId: f.room.id, value: { ...failed.value, status: 'failed' } }] })
  await updateDirectModel(f.rooms, f.room.id, { clientRequestId: 'switch', expectedRevision: f.room.revision, executorModel: 'gpt-new' })
  const { agent } = await f.rooms.agents.update(f.agent.id, { clientRequestId: 'new-default', expectedRevision: f.agent.revision,
    executor: { ...original, model: 'gpt-default' } })
  expect((await agentModelOptions(f.rooms.deps, agent, f.room.id)).main.model).toBe('gpt-new')
  expect((await agentModelOptions(f.rooms.deps, agent)).main.model).toBe('gpt-default')
  await controlDirectRequest(f.rooms, f.room.id, failed.id, { action: 'retry', clientRequestId: 'retry', expectedRevision: failed.revision + 1 })
  const requests = await f.store.list<RoomRequestState>('request', { roomId: f.room.id })
  expect(requests.find((row) => row.id === failed.id)?.value.privateModel).toEqual({ model: 'gpt-old' })
  expect(requests.find((row) => row.id !== failed.id)?.value).toMatchObject({ privateModel: { model: 'gpt-new' },
    roomSnapshot: { privateExecutorModel: 'gpt-new' } })
})

it('validates the native catalog, fixed route, revisions, and request replay before persisting a switch', async () => {
  const f = await fixture()
  const input = { clientRequestId: 'switch', expectedRevision: f.room.revision, executorModel: 'gpt-new' }
  await expect(updateDirectModel(f.rooms, f.room.id, { ...input, executorModel: 'deepseek-flash' })).rejects.toThrow('unavailable')
  f.resolve.mockResolvedValueOnce({ model: 'gpt-new', harnessId: 'codex', credentialMode: 'kun-gateway', providerId: 'other-account' })
  await expect(updateDirectModel(f.rooms, f.room.id, input)).rejects.toThrow('engine or account')
  expect((await f.rooms.service.get(f.room.id)).privateExecutorModel).toBeUndefined()
  const changed = await updateDirectModel(f.rooms, f.room.id, input)
  expect(await updateDirectModel(f.rooms, f.room.id, input)).toEqual(changed)
  await expect(updateDirectModel(f.rooms, f.room.id, { ...input, executorModel: 'gpt-old' })).rejects.toThrow('request changed')
  await expect(updateDirectModel(f.rooms, f.room.id, { ...input, clientRequestId: 'stale' })).rejects.toThrow()
  await expect(updateDirectModel(f.rooms, f.room.id, { ...input, clientRequestId: 'kun-model', expectedRevision: changed.revision,
    modelRef: { providerId: 'kun-provider', model: 'deepseek-flash' } })).rejects.toThrow('coding Agent')
})

it('supports effort-only updates for an external Agent and rejects an external model on a Kun Agent', async () => {
  const f = await fixture()
  const changed = await updateDirectModel(f.rooms, f.room.id, { clientRequestId: 'effort', expectedRevision: f.room.revision, reasoningEffort: 'low' })
  expect(changed.privateReasoningEffort).toBe('low')
  expect(changed.privateExecutorModel).toBeUndefined()
  const cleared = await updateDirectModel(f.rooms, f.room.id, { clientRequestId: 'reset-effort', expectedRevision: changed.revision, reasoningEffort: null })
  expect(cleared.privateReasoningEffort).toBeUndefined()
  const { agent } = await f.rooms.agents.create({ clientRequestId: 'kun', name: 'Kun' })
  const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
  await expect(updateDirectModel(f.rooms, room.id, { clientRequestId: 'invalid', expectedRevision: room.revision,
    executorModel: 'gpt-new' })).rejects.toThrow('configured model connections')
})
