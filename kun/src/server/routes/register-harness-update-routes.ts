import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { jsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { HarnessUpdateCheckSchema, HarnessUpdateRequestSchema, HarnessUpdateCancelSchema } from '../../contracts/harness-update.js'

export function registerHarnessUpdateRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/harnesses/:id/updates', async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    try {
      if (!runtime.harnesses?.updates) return ERRORS.validation('Agent updates are unavailable')
      return jsonResponse(await runtime.harnesses.updates.check(context.params.id!))
    } catch (error) { return ERRORS.validation(error instanceof Error ? error.message : 'Agent update check failed') }
  })
  for (const action of ['check', 'start', 'cancel', 'activate', 'rollback'] as const) {
    router.add('POST', `/v1/harnesses/:id/updates/${action}`, async (request, context) => {
      if (!authorize(request, runtime)) return ERRORS.unauthorized()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const updates = runtime.harnesses?.updates
      if (!updates) return ERRORS.validation('Agent updates are unavailable')
      const id = context.params.id!
      try {
        if (action === 'check') {
          const parsed = HarnessUpdateCheckSchema.safeParse(body.value)
          if (!parsed.success) return ERRORS.validation('Invalid Agent update check')
          return jsonResponse(await updates.check(id, parsed.data.force === true))
        }
        if (action === 'start') {
          const parsed = HarnessUpdateRequestSchema.safeParse(body.value)
          if (!parsed.success) return ERRORS.validation('Invalid Agent update request')
          return jsonResponse(await updates.start(id, parsed.data.action, parsed.data.expectedFingerprint), 202)
        }
        const parsed = HarnessUpdateCancelSchema.safeParse(body.value)
        if (!parsed.success) return ERRORS.validation('Invalid Agent update job')
        if (action === 'rollback') return jsonResponse(await updates.rollback(id, parsed.data.jobId), 202)
        if (action === 'cancel') updates.cancel(id, parsed.data.jobId)
        else await updates.activated(id, parsed.data.jobId)
        return jsonResponse({ ok: true })
      } catch (error) { return ERRORS.conflict(error instanceof Error ? error.message : 'Agent update failed') }
    })
  }
}
