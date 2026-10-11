import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { jsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { HarnessIntegrationOpenRequest } from '../../contracts/harness-integration.js'

export function registerHarnessIntegrationRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/harnesses/:id/integration', async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const definition = runtime.harnesses?.catalog.get(context.params.id!)
    if (!definition) return ERRORS.notFound('Agent integration is unavailable')
    const info = await runtime.harnesses?.integration?.(definition.id)
    return info ? jsonResponse(info) : ERRORS.notFound('Agent integration is unavailable')
  })
  router.add('POST', '/v1/harnesses/:id/integration/resolve', async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = HarnessIntegrationOpenRequest.safeParse(body.value)
    if (!parsed.success || parsed.data.harnessId !== context.params.id) return ERRORS.validation('Invalid Agent integration action')
    const definition = runtime.harnesses?.catalog.get(parsed.data.harnessId)
    if (!definition) return ERRORS.notFound('Agent integration is unavailable')
    const target = await runtime.harnesses?.resolveIntegration?.(parsed.data)
    return target ? jsonResponse(target) : ERRORS.notFound('The selected Agent application or configuration is not installed')
  })
}
