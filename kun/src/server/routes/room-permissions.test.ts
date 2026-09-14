import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeHarness, makeFakeModel } from '../../../tests/loop-test-harness.js'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { RoomRuntime } from '../../rooms/room-runtime.js'
import { quickCreateAgent } from '../../agents/agent-chat-entry.js'
import { registerRoomPermissionRoutes } from './register-room-permission-routes.js'
import { createApprovalConsentToken, KUN_APPROVAL_CONSENT_HEADER } from '../approval-consent.js'
import { roomPermissionConsentSubject } from '../../contracts/room-permissions.js'
import type { ServerRuntime } from './server-runtime.js'
import type { RouteContext } from '../router.js'
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
it('requires an exact protected consent and rejects altered, replayed or stale permission changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-policy-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') }); cleanup.push(() => store.close())
  const h = makeHarness(makeFakeModel([]))
  const rooms = new RoomRuntime({ store, dataDir: root, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, inputs: h.userInputGate, approvals: h.approvalGate, model: () => ({ model: 'test' }),
    profiles: () => ({}), runTurn: (id, turn) => h.loop.runTurn(id, turn), assertOwnership: async () => {} })
  cleanup.push(() => rooms.close())
  const created = await quickCreateAgent(rooms.agents, { clientRequestId: 'create' }, true)
  const handlers = new Map<string, Parameters<typeof registerRoomPermissionRoutes>[0] extends (method: string, path: string, handler: infer H) => void ? H : never>()
  registerRoomPermissionRoutes((method, path, handler) => { handlers.set(method, handler) }, { runtimeToken: 'secret' } as ServerRuntime)
  const input = { clientRequestId: 'change', expectedRevision: 0, mode: 'full-access' as const }
  const put = (body = input, token?: string) => handlers.get('PUT')!(rooms, new Request('http://localhost/permissions', {
    method: 'PUT', body: JSON.stringify(body), headers: token ? { [KUN_APPROVAL_CONSENT_HEADER]: token } : {} }), { params: { roomId: created.roomId } } as RouteContext)
  expect(await put()).toMatchObject({ status: 403 })
  const sign = (value: typeof input, roomId = created.roomId) => createApprovalConsentToken({ runtimeToken: 'secret',
    approvalId: roomPermissionConsentSubject(roomId, value), decision: 'allow', expiresAt: Date.now() + 30000 })
  expect(await put(input, sign(input, 'wrong-room'))).toMatchObject({ status: 403 })
  const token = sign(input)
  expect(await put(input, token)).toMatchObject({ mode: 'full-access', revision: 1 })
  expect(await put(input, token)).toMatchObject({ status: 403 })
  const stale = { ...input, clientRequestId: 'stale' }
  await expect(put(stale, sign(stale))).rejects.toThrow()
  expect((await rooms.service.get(created.roomId)).privateExecutionPolicy?.sandboxMode).toBe('danger-full-access')
})
