import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import {
  createHarnessSecret,
  deleteHarnessSecret,
  listHarnesses,
  listHarnessModels,
  probeHarness,
  probeHarnessDefinition,
  testHarness
} from './harnesses.js'

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
  router.add('POST', '/v1/harnesses/:id/test', (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return testHarness(runtime, request, context.params)
  })
  // P4-12: unsaved-definition handshake + credential-store refs for
  // `secretEnv` (docs/ade/impl/p4 §3.7). `secrets` is a fixed segment, so
  // it can never collide with `:id` harness routes.
  router.add('POST', '/v1/harnesses/probe-definition', (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return probeHarnessDefinition(runtime, request)
  })
  router.add('POST', '/v1/harness-secrets', (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return createHarnessSecret(runtime, request)
  })
  router.add('DELETE', '/v1/harness-secrets/:ref', (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return deleteHarnessSecret(runtime, request, context.params)
  })
}
