import { PolicyMutationRejected } from '../../domain/remote-policy-revision.js'
import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { AgentImportPreviewRequest, AgentImportCommitRequest } from '../../contracts/agent-profile-import.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown>) => void
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
async function body(request: Request) {
  const parsed = await readJsonBody(request, 65536)
  if (!parsed.ok) throw new Error('Invalid Agent lifecycle request')
  return parsed.value
}
/** Native HTTP keeps its local authority; remote controllers use their trusted account/device adapter. */
export function registerAgentLifecycleRoutes(rawAdd: Add) {
  const add: Add = (method, path, handle) => rawAdd(method, path, async (...args) => {
    try { return await handle(...args) } catch (error) {
      if (error instanceof PolicyMutationRejected) return new Response(JSON.stringify({ code: error.code }),
        { status: 409, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
      throw error
    }
  })
  const owner = { accountId: 'local', deviceId: 'desktop', authorizationId: 'native-agent-profile' }
  add('GET', '/v1/agents/:agentId/lifecycle', (rooms, _request, { params }) => rooms.lifecycle.get(Id.parse(params.agentId)))
  add('POST', '/v1/agents/:agentId/restart', async (rooms, request, { params }) => {
    const input = z.object({ clientRequestId: Id, expectedRevision: z.number().int().nonnegative(),
      expectedLifecycleRevision: z.string().regex(/^agent-life-v1:(0|[1-9]\d*)$/) }).strict().parse(await body(request))
    return await rooms.lifecycle.restart({ ...input, agentId: Id.parse(params.agentId) }) ?? { accepted: true, state: 'restarting' }
  })
  add('POST', '/v1/agents/import/preview', async (rooms, request) => {
    const input = AgentImportPreviewRequest.extend({ clientRequestId: Id }).parse(await body(request))
    return rooms.profileImport.preview(owner, input.clientRequestId, { ...input.document.profile,
      ...(input.name !== undefined ? { name: input.name } : {}) })
  })
  add('POST', '/v1/agents/import/commit', async (rooms, request) => {
    const input = AgentImportCommitRequest.extend({ clientRequestId: Id }).parse(await body(request))
    return rooms.profileImport.commit(owner, input.clientRequestId, input)
  })
}
