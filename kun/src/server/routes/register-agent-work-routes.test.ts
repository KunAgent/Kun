import { afterEach, expect, it } from 'vitest'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { workbenchFixture } from '../../workbench-bridge/workbench-test-support.js'
import { AgentCommitmentService } from '../../agents/agent-commitment-service.js'
import { AgentArtifactLibrary } from '../../agents/agent-artifact-library.js'
import { AgentIdentityService } from '../../agents/agent-identity-service.js'
import { RoomMessageSchema } from '../../contracts/rooms.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import { registerAgentWorkRoutes } from './register-agent-work-routes.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
it('registers usable creation, read, update, list and cancel APIs', async () => {
  const f = await workbenchFixture(); cleanups.push(f.cleanup)
  const rooms = { commitments: new AgentCommitmentService(f.deps, new AgentIdentityService(f.store, () => ({}))),
    artifactLibrary: new AgentArtifactLibrary(f.deps), exclusive: async (operation: () => Promise<unknown>) => operation() } as RoomRuntime
  const routes = new Map<string, Parameters<typeof registerAgentWorkRoutes>[0] extends
    (method: string, path: string, handle: infer H) => void ? H : never>()
  registerAgentWorkRoutes((method, path, handler) => routes.set(method + ' ' + path, handler))
  await putRoomDocument(f.store, 'message', 'user-request', f.room.id, RoomMessageSchema.parse({
    id: 'user-request', roomId: f.room.id, messageSeq: 1, authorKind: 'user', authorLabelSnapshot: 'You', body: 'Track the trip',
    bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt: new Date().toISOString() }), null)
  const call = async (method: string, path: string, value?: unknown, commitmentId?: string) => {
    const handle = routes.get(method + ' ' + path)!
    return handle(rooms, new Request('http://localhost' + path, { method, ...(value ? { body: JSON.stringify(value) } : {}) }),
      { params: { agentId: 'agent-1', ...(commitmentId ? { commitmentId } : {}) } })
  }
  const result = await call('POST', '/v1/agents/:agentId/commitments', { clientRequestId: 'api-create',
    objective: 'Plan trip', acceptance: 'Itinerary agreed', sourceRoomId: f.room.id, sourceMessageId: 'user-request' }) as { id: string }
  expect(await call('GET', '/v1/agents/:agentId/commitments/:commitmentId', undefined, result.id)).toMatchObject({ objective: 'Plan trip', status: 'open' })
  expect(await call('PATCH', '/v1/agents/:agentId/commitments/:commitmentId', { clientRequestId: 'api-update', expectedRevision: 0,
    waitingOn: 'Travel dates', status: 'waiting' }, result.id)).toMatchObject({ revision: 1 })
  expect(await call('POST', '/v1/agents/:agentId/commitments/:commitmentId/cancel', { clientRequestId: 'api-cancel', expectedRevision: 1 }, result.id))
    .toMatchObject({ status: 'cancelled', revision: 2 })
  expect(await call('GET', '/v1/agents/:agentId/commitments')).toMatchObject({ commitments: [{ id: result.id }] })
  expect(routes.has('GET /v1/agents/:agentId/artifacts/:artifactId/export')).toBe(true)
})
