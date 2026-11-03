import { jsonResponse } from '../response.js'
import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'

const SURFACES = new Set(['code', 'write', 'design'])

/** Read-only agent roster: every dispatchable role with its engine and lane status. */
export function registerAgentRosterRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/agent-roster', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const roster = runtime.agentRoster
    if (!roster) return ERRORS.unavailable('The agent roster is unavailable')
    const params = new URL(request.url).searchParams
    const surfaceParam = params.get('surface')?.trim() || 'code'
    if (!SURFACES.has(surfaceParam)) return ERRORS.validation(`unknown surface ${surfaceParam}`)
    const surface = surfaceParam as 'code' | 'write' | 'design'
    const workspace = params.get('workspace')?.trim() || undefined
    return jsonResponse({ surface, entries: await roster.list({ workspace, surface }) })
  })
}
