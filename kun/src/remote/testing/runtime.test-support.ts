import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeHarness, makeFakeModel } from '../../../tests/loop-test-harness.js'
import { RoomRuntime } from '../../rooms/room-runtime.js'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { Router } from '../../server/router.js'
import { registerRoomRoutes } from '../../server/routes/register-room-routes.js'
import { registerThreadRoutes } from '../../server/routes/register-thread-routes.js'
import { ApprovalConsentVerifier } from '../../server/approval-consent.js'
import { RemoteFacade } from '../facade.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
export async function remoteFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-remote-fixture-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') }), h = makeHarness(makeFakeModel([]))
  const rooms = new RoomRuntime({ store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    dataDir: root, model: () => ({ model: 'fake' }), profiles: () => ({}),
    assertOwnership: () => store.assertOwnership(), runTurn: (id, turnId) => h.loop.runTurn(id, turnId) })
  const cleanups = new Set<() => Promise<void>>()
  const runtime = { registerRemoteCleanup: (cleanup: () => Promise<void>) => { cleanups.add(cleanup) }, rooms, runtimeToken: 'token', insecure: false, threadService: h.threads,
    turnService: h.turns, events: h.events, eventBus: h.bus, sessionStore: h.sessionStore,
    approvalGate: h.approvalGate, userInputGate: h.userInputGate, defaultModel: 'fake', runTurn: () => {} } as unknown as ServerRuntime
  const router = new Router()
  registerRoomRoutes(router, runtime)
  registerThreadRoutes(router, runtime, new ApprovalConsentVerifier('token'))
  const facade = new RemoteFacade(runtime, router)
  let sequence = 0
  const envelope = (method: string, params: unknown, requestId = 'request_' + ++sequence, deviceId = 'phone') => ({
    accountId: 'owner', deviceId, authorizationId: 'connection',
    call: { method, params, requestId, expiresAt: Date.now() + 60000 } })
  return { root, store, h, rooms, runtime, router, facade, envelope,
    call: async (method: string, params: unknown, requestId?: string, deviceId?: string) =>
      facade.execute(envelope(method, params, requestId, deviceId)) as Promise<any>,
    code: async (title = 'Code task', model = 'fake') => h.threads.create({ workspace: root, title, model,
      agentSurface: 'code', workspaceMode: 'code', mode: 'agent' }),
    close: async () => { await Promise.all([...cleanups].map((cleanup) => cleanup())); await rooms.close(); await store.close(); await rm(root, { recursive: true, force: true }) }
  }
}
