import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { AgentCommitmentQuery } from '../../contracts/agent-commitments.js'
import { AgentArtifactQuery, AgentArtifactVersionQuery } from '../../contracts/agent-artifacts.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown>) => void
const Id = z.string().min(1).max(256)
const Action = z.object({ clientRequestId: Id, expectedRevision: z.number().int().nonnegative() }).strict()
async function body(request: Request) {
  const result = await readJsonBody(request)
  if (!result.ok) throw new Error('invalid Agent work request')
  return result.value
}
const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)
export function registerAgentWorkRoutes(add: Add) {
  add('GET', '/v1/agents/:agentId/commitments', (rooms, request, { params }) =>
    rooms.commitments.list(Id.parse(params.agentId), AgentCommitmentQuery.parse(query(request))))
  add('POST', '/v1/agents/:agentId/commitments', async (rooms, request, { params }) => {
    const input = await body(request)
    return rooms.exclusive(() => rooms.commitments.create(Id.parse(params.agentId), input))
  })
  add('GET', '/v1/agents/:agentId/commitments/:commitmentId', (rooms, _request, { params }) =>
    rooms.commitments.get(Id.parse(params.agentId), Id.parse(params.commitmentId)))
  add('PATCH', '/v1/agents/:agentId/commitments/:commitmentId', async (rooms, request, { params }) => {
    const input = await body(request)
    return rooms.exclusive(() => rooms.commitments.update(Id.parse(params.agentId), Id.parse(params.commitmentId), input))
  })
  add('POST', '/v1/agents/:agentId/commitments/:commitmentId/cancel', async (rooms, request, { params }) => {
    const input = Action.parse(await body(request))
    return rooms.exclusive(() => rooms.commitments.update(Id.parse(params.agentId), Id.parse(params.commitmentId), { ...input, status: 'cancelled' }))
  })
  add('GET', '/v1/agents/:agentId/artifacts', (rooms, request, { params }) =>
    rooms.artifactLibrary.list(Id.parse(params.agentId), AgentArtifactQuery.parse(query(request))))
  add('GET', '/v1/agents/:agentId/artifacts/:artifactId', (rooms, _request, { params }) =>
    rooms.artifactLibrary.get(Id.parse(params.agentId), Id.parse(params.artifactId)))
  add('GET', '/v1/agents/:agentId/artifacts/:artifactId/versions', (rooms, request, { params }) =>
    rooms.artifactLibrary.versions(Id.parse(params.agentId), Id.parse(params.artifactId), AgentArtifactVersionQuery.parse(query(request))))
  add('GET', '/v1/agents/:agentId/artifacts/:artifactId/export', (rooms, request, { params }) => {
    const input = z.object({ version: z.coerce.number().int().positive().optional(),
      offset: z.coerce.number().int().nonnegative().optional(), length: z.coerce.number().int().min(1).max(1024 * 1024).optional() }).strict().parse(query(request))
    return rooms.artifactLibrary.export(Id.parse(params.agentId), Id.parse(params.artifactId), input)
  })
  add('PATCH', '/v1/agents/:agentId/artifacts/:artifactId', async (rooms, request, { params }) => {
    const input = Action.extend({ archived: z.boolean() }).strict().parse(await body(request))
    return rooms.exclusive(() => rooms.artifactLibrary.archive(Id.parse(params.agentId), Id.parse(params.artifactId), input))
  })
}
