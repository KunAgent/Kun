import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import {
  executionUnitCreateResponse,
  executionUnitExitResponse,
  executionUnitInterruptHintResponse
} from './execution-units.js'

/**
 * Host-launched execution units (05 §6.1). Called by the owning client
 * (desktop main process) with the ordinary runtime token — never by the
 * spawned harness itself.
 */
export function registerExecutionUnitRoutes(router: Router, runtime: ServerRuntime): void {
  const deps = () => {
    const registry = runtime.ade?.terminalAgents
    const tokens = runtime.harnessTokens
    const catalog = runtime.harnesses?.catalog
    if (!registry || !tokens || !catalog) return null
    return {
      registry,
      tokens,
      catalog,
      endpoint: () => runtime.harnesses?.gatewayEndpoint?.baseUrl
    }
  }
  router.add('POST', '/v1/execution-units', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const resolved = deps()
    if (!resolved) return ERRORS.unavailable('execution units are unavailable')
    return executionUnitCreateResponse(resolved, request)
  })
  router.add('POST', '/v1/execution-units/:unitId/exit', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.ade?.terminalAgents) return ERRORS.unavailable('execution units are unavailable')
    return executionUnitExitResponse(
      { registry: runtime.ade.terminalAgents }, request, ctx.params.unitId
    )
  })
  router.add('POST', '/v1/execution-units/:unitId/interrupt-hint', async (_request, ctx) => {
    if (!authorize(_request, runtime)) return ERRORS.unauthorized()
    if (!runtime.ade?.terminalAgents) return ERRORS.unavailable('execution units are unavailable')
    return executionUnitInterruptHintResponse(
      { registry: runtime.ade.terminalAgents }, ctx.params.unitId
    )
  })
}
