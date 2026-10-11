import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { startServiceManager } from '../manager/service-manager.js'
import { registerRuntimeWithManager } from '../manager/manager-client.js'
import { RoomCoordinatorUnavailableError } from '../rooms/room-store.js'
import { createRuntimeRoomComposition } from './runtime-composition-rooms.js'
import { Router } from './router.js'
import { dispatchRequest } from './http-server.js'
import { registerRoomRoutes } from './routes/register-room-routes.js'
import type { ServerRuntime } from './routes/server-runtime.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-readiness-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const manager = await startServiceManager({ controlDir: join(root, 'control'), dataDir: join(root, 'data'),
    settingsPath: join(root, 'settings.json'), managerToken: 'readiness-manager', instanceId: 'readiness-manager',
    startedAt: new Date().toISOString() })
  cleanups.push(() => manager.close())
  const h = makeHarness(makeFakeModel([]))
  const serviceManager = { discovery: manager.discovery }
  const composition = createRuntimeRoomComposition({ options: () => ({ host: '127.0.0.1', port: 0,
    dataDir: join(root, 'data'), runtimeToken: 'readiness-runtime', apiKey: 'fixture', baseUrl: 'http://127.0.0.1:1',
    model: 'fake', approvalPolicy: 'auto', sandboxMode: 'workspace-write', tokenEconomyMode: false,
    insecure: false, instanceId: 'readiness-runtime', serviceManager }),
    services: { threads: h.threads, threadStore: h.threadStore, turns: h.turns, sessions: h.sessionStore,
      approvals: h.approvalGate, inputs: h.userInputGate, runTurn: (id, turnId) => h.loop.runTurn(id, turnId) } })
  cleanups.push(() => composition.close())
  // This regression exercises real HTTP persistence/admission, without dispatching a model turn.
  vi.spyOn(composition.rooms, 'start').mockImplementation(() => undefined)
  const router = new Router()
  registerRoomRoutes(router, { rooms: composition.rooms, runtimeToken: 'readiness-runtime', insecure: false } as ServerRuntime)
  const call = async (path: string, value?: unknown) => {
    const response = await dispatchRequest(router, new Request('http://localhost' + path, {
      method: value === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer readiness-runtime',
        'content-type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }))
    return { status: response.status, body: await response.json() }
  }
  const start = async () => {
    await registerRuntimeWithManager({ manager: serviceManager, registration: { flavor: 'production',
      instanceId: 'readiness-runtime', pid: process.pid, startedAt: new Date().toISOString(), host: '127.0.0.1',
      port: 1, baseUrl: 'http://127.0.0.1:1', runtimeToken: 'readiness-runtime' } })
    composition.start()
  }
  return { composition, call, start }
}

describe('Rooms managed mutation readiness', () => {
  it('admits chat quick-create received before coordinator startup and replays without duplicate setup', async () => {
    const { composition, call, start } = await fixture()
    const settled = vi.fn()
    const input = { clientRequestId: 'chat-before-start', setupMode: 'chat', modelRef: { providerId: 'default', model: 'fake' } }
    const creating = call('/v1/agents/quick-create', input).then((result) => { settled(); return result })
    expect((await call('/v1/rooms')).status).toBe(200)
    expect(settled).not.toHaveBeenCalled()
    expect(await composition.rooms.deps.store.list('agent_identity')).toEqual([])
    await start()
    const created = await creating
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    expect(await call('/v1/agents/quick-create', input)).toEqual(created)
    expect(await composition.rooms.deps.store.list('agent_identity')).toHaveLength(1)
    const requests = await composition.rooms.deps.store.list('request', { roomId: created.body.roomId })
    expect(requests).toHaveLength(1)
    expect(requests[0].value).toMatchObject({ privateProtocol: 'direct-v1', status: 'pending' })
    expect(await composition.rooms.deps.store.list('message', { roomId: created.body.roomId })).toHaveLength(1)
  })

  it('returns retryable unavailability instead of a revision conflict and keeps history readable', async () => {
    const { composition, call } = await fixture()
    composition.rooms.deps.waitForOwnership = async () => { throw new RoomCoordinatorUnavailableError() }
    const result = await call('/v1/agents/quick-create', { clientRequestId: 'not-ready', setupMode: 'chat' })
    expect(result).toMatchObject({ status: 503, body: { code: 'room_coordinator_unavailable' } })
    expect(result.body.message).not.toMatch(/\blease\b/)
    expect((await call('/v1/rooms')).status).toBe(200)
    expect(await composition.rooms.deps.store.list('agent_identity')).toEqual([])
  })

  it('settles queued startup mutations on shutdown without writing or hanging the drain', async () => {
    const { composition, call } = await fixture()
    const waiting = call('/v1/agents/quick-create', { clientRequestId: 'shutdown', setupMode: 'chat' })
    await composition.close()
    expect(await waiting).toMatchObject({ status: 503, body: { code: 'room_coordinator_unavailable' } })
    expect(await composition.rooms.deps.store.list('agent_identity')).toEqual([])
  })
})
