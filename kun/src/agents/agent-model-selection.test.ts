import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomRuntimeDeps, RoomRequestState } from '../rooms/room-runtime-types.js'
import { ModelConnectionSnapshotSchema } from '../contracts/model-connections.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { agentModelOptions, assertExplicitAgentModel } from './agent-models.js'
import { controlDirectRequest } from './agent-direct-service.js'
import { updateDirectModel } from './agent-direct-model.js'
import { registerAgentChatRoutes } from '../server/routes/register-agent-chat-routes.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const first = { providerId: 'one', accountId: 'account-one', model: 'main' }
const second = { providerId: 'one', accountId: 'account-one', model: 'other' }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-model-selection-'))
  const h = makeHarness(makeFakeModel([]))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const snapshot = ModelConnectionSnapshotSchema.parse({ schemaVersion: 1, proxyRoutingVersion: 1, revision: 0,
    defaultProviderId: 'one', defaultAccountId: 'account-one', defaultModel: 'main', providers: [{
      id: 'one', accountId: 'account-one', name: 'One', kind: 'http', authType: 'api-key',
      endpointFormat: 'chat_completions', useProxy: false, configured: true, credentialStatus: 'ready', models: ['main', 'other']
    }] })
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: vi.fn(), model: () => first, profiles: () => ({}), modelSnapshot: async () => snapshot,
    assertOwnership: async () => {} }
  const rooms = new RoomRuntime(deps)
  type Handler = Parameters<typeof registerAgentChatRoutes>[0] extends (method: string, path: string, handler: infer H) => void ? H : never
  const handlers = new Map<string, Handler>()
  registerAgentChatRoutes((method, path, handler) => { handlers.set(method + ' ' + path, handler) }, {
    rooms, modelConnections: { snapshot: async () => snapshot }
  } as unknown as ServerRuntime)
  cleanups.push(async () => { await rooms.close(); await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const call = (method: string, path: string, value?: unknown, params = {}) => handlers.get(method + ' ' + path)!(rooms,
    new Request('http://localhost' + path, { method, ...(value ? { body: JSON.stringify(value) } : {}) }), { params })
  const create = (id = 'create', modelRef = first) => call('POST', '/v1/agents/quick-create', {
    clientRequestId: id, setupMode: 'chat', modelRef
  }) as Promise<{ agentId: string; roomId: string }>
  return { rooms, store, snapshot, call, create }
}

it('discovery and missing choice create nothing; explicit creation pins setup and deduplicates', async () => {
  const f = await fixture()
  expect(await f.call('GET', '/v1/agents/creation-models')).toMatchObject({ options: expect.arrayContaining([expect.objectContaining({ available: true })]) })
  expect(await f.store.list('agent_identity')).toHaveLength(0)
  await expect(f.call('POST', '/v1/agents/quick-create', { clientRequestId: 'missing', setupMode: 'chat' })).rejects.toThrow('Choose a provider')
  expect(await f.store.list('agent_identity')).toHaveLength(0)
  const [a, b] = await Promise.all([f.create(), f.create()])
  expect(a).toEqual(b)
  expect(await f.store.list('agent_identity')).toHaveLength(1)
  expect((await f.rooms.agents.get(a.agentId)).modelRef).toEqual(first)
  const requests = await f.store.list<RoomRequestState>('request', { roomId: a.roomId })
  expect(requests).toHaveLength(1)
  expect(requests[0].value.privateModel).toEqual(first)
  f.snapshot.providers = []
  expect(await f.create()).toEqual(a) // Response loss cannot create a second Agent.
})

it.each(['deleted', 'disabled', 'missing-credential', 'removed-model', 'replaced-account', 'omitted-account', 'unsupported'])(
  'rejects a %s choice before any role or conversation is persisted', async (kind) => {
    const f = await fixture(), selected = { ...first }
    if (kind === 'deleted') f.snapshot.providers = []
    if (kind === 'disabled') f.snapshot.providers[0].configured = false
    if (kind === 'missing-credential') f.snapshot.providers[0].credentialStatus = 'missing'
    if (kind === 'removed-model') f.snapshot.providers[0].models = ['other']
    if (kind === 'replaced-account') f.snapshot.providers[0].accountId = 'replacement'
    if (kind === 'omitted-account') delete (selected as { accountId?: string }).accountId
    if (kind === 'unsupported') f.rooms.deps.unsupportedProviderIds = () => ['one']
    await expect(f.create('invalid', selected)).rejects.toThrow('unavailable')
    expect(await f.store.list('agent_identity')).toHaveLength(0)
    expect(await f.store.list('room')).toHaveLength(0)
    expect(await f.store.list('request')).toHaveLength(0)
  }
)

it('switches only future messages in this room and preserves active/queued work and role defaults', async () => {
  const f = await fixture(), created = await f.create()
  const before = await f.store.list<RoomRequestState>('request', { roomId: created.roomId })
  const room = await f.rooms.service.get(created.roomId)
  const input = { clientRequestId: 'switch', expectedRevision: room.revision, modelRef: second }
  const changed = await updateDirectModel(f.rooms, room.id, input)
  expect(changed.privateModelRef).toEqual(second)
  expect(changed.privateEpoch).toEqual(room.privateEpoch)
  expect(changed.privateExecutionPolicy).toEqual(room.privateExecutionPolicy)
  expect(await f.store.list('request', { roomId: room.id })).toEqual(before)
  const agent = await f.rooms.agents.get(created.agentId)
  expect(agent.modelRef).toEqual(first)
  expect((await agentModelOptions(f.rooms.deps, agent, room.id)).main).toEqual(second)
  expect((await agentModelOptions(f.rooms.deps, agent)).main).toEqual(first)
  expect(await f.rooms.service.directBinding(await f.rooms.agents.freeze(changed))).toEqual(second)
  expect(await updateDirectModel(f.rooms, room.id, input)).toEqual(changed)
  await expect(updateDirectModel(f.rooms, room.id, { ...input, modelRef: first })).rejects.toThrow('request changed')
  await expect(updateDirectModel(f.rooms, room.id, { ...input, clientRequestId: 'stale', modelRef: first })).rejects.toThrow()
  expect((await f.rooms.service.get(room.id)).privateModelRef).toEqual(second)
})

it('revalidates the account at switch commit and rejects unrelated or archived rooms', async () => {
  const f = await fixture(), created = await f.create()
  const room = await f.rooms.service.get(created.roomId)
  f.snapshot.providers[0].accountId = 'replacement'
  await expect(updateDirectModel(f.rooms, room.id, { clientRequestId: 'stale-account', expectedRevision: room.revision, modelRef: second })).rejects.toThrow('unavailable')
  expect((await f.rooms.service.get(room.id)).privateModelRef).toBeUndefined()
  expect((await agentModelOptions(f.rooms.deps, await f.rooms.agents.get(created.agentId), 'other-room')).roomOverride).toBeUndefined()
  f.snapshot.providers[0].accountId = first.accountId
  await f.rooms.service.update(room.id, { clientRequestId: 'archive', expectedRevision: room.revision, archived: true })
  await expect(updateDirectModel(f.rooms, room.id, { clientRequestId: 'archived', expectedRevision: room.revision + 1, modelRef: second })).rejects.toThrow('Restore')
})

it('does not accept an arbitrary fallback model without a registry', async () => {
  const f = await fixture()
  f.rooms.deps.modelSnapshot = undefined
  await expect(assertExplicitAgentModel(f.rooms.deps, { providerId: 'made-up', model: 'unusable' })).rejects.toThrow('unavailable')
  await expect(assertExplicitAgentModel(f.rooms.deps, first)).resolves.toBeUndefined()
  await expect(quickCreateAgent(f.rooms.agents, { clientRequestId: 'bypass' })).rejects.toThrow('Choose a provider')
})

it('retry after a failed interview uses the explicitly corrected conversation model', async () => {
  const f = await fixture(), created = await f.create()
  const old = (await f.store.list<RoomRequestState>('request', { roomId: created.roomId }))[0]
  await f.store.commit({ requestId: 'mark-failed', checks: [{ kind: 'request', id: old.id, expectedRevision: old.revision }],
    puts: [{ kind: 'request', id: old.id, roomId: created.roomId, value: { ...old.value, status: 'failed' } }] })
  const room = await f.rooms.service.get(created.roomId)
  await updateDirectModel(f.rooms, room.id, { clientRequestId: 'correct-model', expectedRevision: room.revision, modelRef: second })
  await controlDirectRequest(f.rooms, room.id, old.id, { action: 'retry', clientRequestId: 'retry-corrected', expectedRevision: old.revision + 1 })
  const requests = await f.store.list<RoomRequestState>('request', { roomId: room.id })
  expect(requests.find((row) => row.id !== old.id)?.value.privateModel).toEqual(second)
  expect(requests.find((row) => row.id === old.id)?.value.privateModel).toEqual(first)
})

it('reconciliation waits behind an in-flight creation before reporting missing or created', async () => {
  const f = await fixture()
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const entered = vi.fn()
  f.rooms.deps.modelSnapshot = async () => { entered(); await blocked; return f.snapshot }
  const creating = f.create('pending-create')
  await vi.waitFor(() => expect(entered).toHaveBeenCalled())
  const settled = vi.fn()
  const reconciling = f.call('GET', '/v1/agents/creation-requests/:requestId', undefined, { requestId: 'pending-create' }).then((result) => { settled(); return result })
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  release()
  expect(await reconciling).toEqual({ created: await creating })
  expect(await f.call('GET', '/v1/agents/creation-requests/:requestId', undefined, { requestId: 'never-confirmed' })).toEqual({ created: null })
})

it('role-default changes leave the explicit conversation override and accepted requests unchanged', async () => {
  const f = await fixture(), created = await f.create()
  const room = await f.rooms.service.get(created.roomId)
  await updateDirectModel(f.rooms, room.id, { clientRequestId: 'room-choice', expectedRevision: room.revision, modelRef: first })
  const before = await f.store.list('request', { roomId: room.id })
  const agent = await f.rooms.agents.get(created.agentId)
  await f.call('PUT', '/v1/agents/:agentId/models', { clientRequestId: 'role-choice', expectedRevision: agent.revision,
    modelRef: second, fastModelRef: null }, { agentId: agent.id })
  const latest = await f.rooms.agents.get(agent.id)
  expect((await agentModelOptions(f.rooms.deps, latest)).main).toEqual(second)
  expect((await agentModelOptions(f.rooms.deps, latest, room.id)).main).toEqual(first)
  expect(await f.store.list('request', { roomId: room.id })).toEqual(before)
})
