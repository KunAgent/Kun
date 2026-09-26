import { z } from 'zod'
import type { AppSessionOwner } from '../contracts/app-session-owner.js'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse } from '../server/response.js'
import type { Router } from '../server/router.js'
import { authorizedAsync } from './service-manager-router-auth.js'
import type { ServiceManagerState } from './service-manager-state.js'

export function addIdleManagerRetirementRoute(router: Router, input: {
  managerToken: string
  instanceId: string
  appOwner?: AppSessionOwner
  state: ServiceManagerState
  beginDrain?: () => void
  requestShutdown?: () => void
}): void {
  router.add('POST', '/v1/manager/retire-idle', (request) => authorizedAsync(
    request, input.managerToken, async () => {
      if (input.appOwner) return jsonResponse({ code: 'manager_owner_control_required' }, 403)
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      if (!z.object({ instanceId: z.literal(input.instanceId) }).strict().safeParse(body.value).success) {
        return jsonResponse({ code: 'manager_instance_changed' }, 409)
      }
      const snapshot = input.state.durableSnapshot()
      if (snapshot.slots.length || snapshot.leases.length || snapshot.resourceLeases.length) {
        return jsonResponse({ code: 'manager_has_live_owner' }, 409)
      }
      input.beginDrain?.()
      input.requestShutdown?.()
      return jsonResponse({ accepted: true, instanceId: input.instanceId })
    }
  ))
}
