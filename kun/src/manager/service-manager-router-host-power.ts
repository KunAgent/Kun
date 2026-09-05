import { z } from 'zod'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse } from '../server/response.js'
import type { Router } from '../server/router.js'
import type { ServiceManagerState } from './service-manager-state.js'
import { authorizedAsync, validation } from './service-manager-router-auth.js'

export function addHostPowerRoute(
  router: Router,
  input: {
    managerToken: string
    state: ServiceManagerState
    flushState?: () => Promise<void>
  }
): void {
  router.add('POST', '/v1/manager/host-power', (request) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({
        phase: z.enum(['suspend', 'resume']),
        sourceId: z.string().min(1).max(256),
        sequence: z.number().int().positive(),
        observedAt: z.string().datetime()
      }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid host power report', parsed.error.issues)
      const accepted = input.state.reportHostPower({
        ...parsed.data,
        observedAt: new Date(parsed.data.observedAt)
      })
      if (accepted) await input.flushState?.()
      return jsonResponse({ accepted })
    }
  ))
}
