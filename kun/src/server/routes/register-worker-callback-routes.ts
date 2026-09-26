import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { workerCallbackResponse } from './worker-callbacks.js'

/**
 * Worker callback routes (05 §5.2). These authenticate with scoped `kgw_`
 * grants verified inside the handler — never the ordinary runtime token —
 * so they intentionally skip `authorize`.
 */
export function registerWorkerCallbackRoutes(
  router: Router,
  runtime: ServerRuntime,
  opts?: { askHeartbeatMs?: number }
): void {
  router.add('POST', '/v1/worker-callbacks/:action', (request, ctx) =>
    workerCallbackResponse(runtime, request, ctx.params.action ?? '', opts))
}
