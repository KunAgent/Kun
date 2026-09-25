import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { listHarnesses, listHarnessModels, probeHarness } from './harnesses.js'

export function registerHarnessRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/harnesses', (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listHarnesses(runtime, request)
  })
  router.add('POST', '/v1/harnesses/:id/probe', (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return probeHarness(runtime, request, context.params)
  })
  router.add('GET', '/v1/harnesses/:id/models', (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listHarnessModels(runtime, request, context.params)
  })
}
