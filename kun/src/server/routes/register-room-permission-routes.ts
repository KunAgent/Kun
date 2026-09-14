import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { readJsonBody } from '../read-json-body.js'
import { ApprovalConsentVerifier, KUN_APPROVAL_CONSENT_HEADER } from '../approval-consent.js'
import { RoomPermissionRequestSchema, roomPermissionConsentSubject } from '../../contracts/room-permissions.js'
import { agentPermissions, setAgentPermissions } from '../../agents/agent-permissions.js'
import { jsonResponse } from '../response.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown>) => void
export function registerRoomPermissionRoutes(add: Add, runtime: ServerRuntime) {
  const consent = new ApprovalConsentVerifier(runtime.runtimeToken)
  add('GET', '/v1/rooms/:roomId/direct/permissions', (rooms, _request, { params }) => agentPermissions(rooms, params.roomId))
  add('PUT', '/v1/rooms/:roomId/direct/permissions', async (rooms, request, { params }) => {
    const raw = await readJsonBody(request)
    if (!raw.ok) return raw.response
    const input = RoomPermissionRequestSchema.parse(raw.value)
    if (!consent.verifyAndConsume({ token: request.headers.get(KUN_APPROVAL_CONSENT_HEADER),
      approvalId: roomPermissionConsentSubject(params.roomId, input), decision: 'allow' })) return jsonResponse({ error: 'Protected permission confirmation required' }, 403)
    return rooms.exclusive(() => setAgentPermissions(rooms, params.roomId, input))
  })
}
