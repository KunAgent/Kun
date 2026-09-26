import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import {
  activityEventsResponse,
  activityFactResponse,
  activityForegroundResponse,
  activityHookResponse,
  activitySnapshotResponse
} from './activity.js'

/** Activity read surface (docs/ade/06 §9) + hook-ingest (05 §6.2). */
export function registerActivityRoutes(router: Router, runtime: ServerRuntime): void {
  // Authenticated by the unit's own hook-ingest kgw_ grant — never the
  // runtime token — so this intentionally skips `authorize`.
  router.add('POST', '/v1/activity/hooks', async (request) => {
    const tokens = runtime.harnessTokens
    const registry = runtime.ade?.terminalAgents
    const catalog = runtime.harnesses?.catalog
    if (!tokens || !registry || !catalog) {
      return ERRORS.unavailable('hook ingest is unavailable')
    }
    return activityHookResponse(
      { tokens, registry, catalog, activity: runtime.activityStore },
      request
    )
  })
  router.add('GET', '/v1/activity', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.activityStore) return ERRORS.unavailable('activity is unavailable')
    return activitySnapshotResponse(runtime.activityStore, request)
  })
  router.add('GET', '/v1/activity/events', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.activityStore) return ERRORS.unavailable('activity is unavailable')
    return activityEventsResponse(runtime.activityStore, request)
  })
  router.add('POST', '/v1/activity/foreground', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.activityHibernation) {
      return ERRORS.unavailable('activity is unavailable')
    }
    return activityForegroundResponse(runtime.activityHibernation, request)
  })
  for (const mutation of ['ack', 'dismiss', 'pin'] as const) {
    router.add('POST', `/v1/activity/:unitId/${mutation}`, async (request, ctx) => {
      if (!authorize(request, runtime)) return ERRORS.unauthorized()
      if (!runtime.activityStore || !runtime.activityFacts) {
        return ERRORS.unavailable('activity is unavailable')
      }
      return activityFactResponse(
        runtime.activityStore,
        runtime.activityFacts,
        request,
        ctx.params.unitId,
        mutation,
        runtime.nowIso
      )
    })
  }
}
