import type { RouteHandler } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { isAuthorized } from '../server/auth.js'
import { ERRORS } from '../server/routes/runtime-error.js'

/**
 * Wraps a route handler with Bearer token authentication.
 * Returns 401 if authorization fails.
 */
export function authenticated(
  handler: RouteHandler,
  runtime: ServerRuntime
): RouteHandler {
  return async (request, context) => {
    if (!isAuthorized(request.headers, runtime.runtimeToken, runtime.insecure)) {
      return ERRORS.unauthorized()
    }
    return handler(request, context)
  }
}
