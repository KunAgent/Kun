import { registerGoogleWorkspaceRoutes } from './google-workspace.js'
import { Router } from '../router.js'
import { ApprovalConsentVerifier } from '../approval-consent.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerCoreRoutes } from './register-core-routes.js'
import { registerGraphRoutes } from './register-graph-routes.js'
import { registerResourceRoutes } from './register-resource-routes.js'
import { registerThreadRoutes } from './register-thread-routes.js'
import { registerProjectBoardRoutes } from './register-project-board-routes.js'
import { registerRoomRoutes } from './register-room-routes.js'
import { registerWorkbenchDirectoryRoutes } from './register-workbench-link-routes.js'
import { registerHistoryReferenceRoutes } from './register-history-reference-routes.js'
import { registerHarnessRoutes } from './register-harness-routes.js'
import { registerActivityRoutes } from './register-activity-routes.js'
import { registerTaskWorkspaceRoutes } from './register-task-workspace-routes.js'
import { registerTeamsRoutes } from './register-teams-routes.js'
import { registerReviewRoutes } from './register-review-routes.js'
import { registerHandoffRoutes } from './register-handoff-routes.js'
import { registerExecutionUnitRoutes } from './register-execution-unit-routes.js'
import { registerWorkerCallbackRoutes } from './register-worker-callback-routes.js'

/** Build the full HTTP router while preserving first-match registration order. */
export function buildRouter(runtime: ServerRuntime): Router {
  const router = new Router()
  const approvalConsent = new ApprovalConsentVerifier(runtime.runtimeToken)
  registerCoreRoutes(router, runtime)
  registerGoogleWorkspaceRoutes(router, runtime)
  registerHarnessRoutes(router, runtime)
  registerActivityRoutes(router, runtime)
  registerTaskWorkspaceRoutes(router, runtime)
  registerTeamsRoutes(router, runtime)
  registerReviewRoutes(router, runtime)
  registerHandoffRoutes(router, runtime)
  registerExecutionUnitRoutes(router, runtime)
  registerWorkerCallbackRoutes(router, runtime)
  registerGraphRoutes(router, runtime)
  registerResourceRoutes(router, runtime)
  registerProjectBoardRoutes(router, runtime)
  registerRoomRoutes(router, runtime)
  registerWorkbenchDirectoryRoutes(router, runtime)
  registerHistoryReferenceRoutes(router, runtime)
  registerThreadRoutes(router, runtime, approvalConsent)
  return router
}
