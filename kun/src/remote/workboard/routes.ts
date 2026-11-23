import type { Router } from '../../server/router.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { authorize } from '../../server/routes/route-auth.js'
import { jsonResponse } from '../../server/response.js'
import { workboardSnapshot } from './snapshot.js'
export function registerWorkboardRoutes(router: Router, runtime: ServerRuntime) {
  let flight: Promise<unknown> | undefined
  router.add('GET', '/v1/remote/workboard', async request => {
    if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
    try {
      flight ??= workboardSnapshot(runtime).finally(() => { flight = undefined })
      return { ...jsonResponse(await flight), headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
    } catch { return jsonResponse({ code: 'WORKBOARD_UNAVAILABLE' }, 503) }
  })
}
