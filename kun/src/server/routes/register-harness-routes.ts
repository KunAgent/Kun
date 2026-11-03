import { registerHarnessUpdateRoutes } from './register-harness-update-routes.js'
import { registerHarnessIntegrationRoutes } from './register-harness-integration-routes.js'
import { readComposerSubscriptionQuota } from './composer-subscription-quota.js'
import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { registerHarnessInstallRoutes } from './register-harness-install-routes.js'
import {
  createHarnessSecret,
  deleteHarnessSecret,
  listHarnesses,
  listHarnessModels,
  probeHarness,
  probeHarnessDefinition,
  testHarness,
  warmHarness
} from './harnesses.js'

export function registerHarnessRoutes(router: Router, runtime: ServerRuntime): void {
  registerHarnessInstallRoutes(router, runtime)
  registerHarnessUpdateRoutes(router, runtime)
  registerHarnessIntegrationRoutes(router, runtime)
  router.add('GET', '/v1/harnesses/:id/subscription-quota', (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return readComposerSubscriptionQuota(runtime, request, context.params)
  })
  router.add('GET', '/v1/harnesses', (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listHarnesses(runtime, request)
  })
  router.add('POST', '/v1/harnesses/:id/probe', (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return probeHarness(runtime, request, context.params)
  })
  // Composer selection re-validates a stale proof ahead of the turn, so
  // background polling never has to spawn Agents to keep them fresh.
  router.add('POST', '/v1/harnesses/:id/warm', (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return warmHarness(runtime, context.params)
  })
  router.add('GET', '/v1/harnesses/:id/models', (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listHarnessModels(runtime, request, context.params)
  })
  router.add('POST', '/v1/harnesses/:id/test', (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return testHarness(runtime, request, context.params)
  })
  // unsaved-definition handshake + credential-store refs for
  // `secretEnv`. `secrets` is a fixed segment, so
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
