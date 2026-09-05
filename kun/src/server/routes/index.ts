import { Router } from '../router.js'
import { ApprovalConsentVerifier } from '../approval-consent.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerCoreRoutes } from './register-core-routes.js'
import { registerGraphRoutes } from './register-graph-routes.js'
import { registerResourceRoutes } from './register-resource-routes.js'
import { registerThreadRoutes } from './register-thread-routes.js'
import { registerProjectBoardRoutes } from './register-project-board-routes.js'

/** Build the full HTTP router while preserving first-match registration order. */
export function buildRouter(runtime: ServerRuntime): Router {
  const router = new Router()
  const approvalConsent = new ApprovalConsentVerifier(runtime.runtimeToken)
  registerCoreRoutes(router, runtime)
  registerGraphRoutes(router, runtime)
  registerResourceRoutes(router, runtime)
  registerProjectBoardRoutes(router, runtime)
  registerThreadRoutes(router, runtime, approvalConsent)
  return router
}
