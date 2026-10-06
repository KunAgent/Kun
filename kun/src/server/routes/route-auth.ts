import { isAuthorized } from '../auth.js'
import type { ServerRuntime } from './server-runtime.js'

export function authorize(request: Request, runtime: ServerRuntime): boolean {
  // A model gateway key must never inherit the development server's optional
  // admin authentication. Once gateway access is configured, admin stays token-bound.
  const gatewayAdmin = runtime.modelGateway?.requiresAdminToken?.() ?? runtime.modelGateway?.enabled() ?? false
  return isAuthorized(request.headers, runtime.runtimeToken, gatewayAdmin ? false : runtime.insecure)
}
