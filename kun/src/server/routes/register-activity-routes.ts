import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import {
  activityEventsResponse,
  activityFactResponse,
  activityForegroundResponse,
  activitySnapshotResponse
} from './activity.js'

/** Activity read surface (docs/ade/06 §9). The hooks entry lands in P2-03. */
export function registerActivityRoutes(router: Router, runtime: ServerRuntime): void {
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
