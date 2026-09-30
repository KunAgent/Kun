import type { Router } from '../router.js'
import { jsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { GoogleWorkspaceError } from '../../google-workspace/process.js'

const base = '/v1/integrations/google-workspace'
/** Host-workbench control plane only. There is intentionally no arbitrary call or CLI route. */
export function registerGoogleWorkspaceRoutes(router: Router, runtime: ServerRuntime): void {
  for (const operation of ['status', 'authorization-url', 'login', 'setup', 'test', 'logout', 'cancel'] as const) {
    const method = operation === 'status' || operation === 'authorization-url' ? 'GET' : 'POST'
    router.add(method, `${base}/${operation}`, async request => {
      // Even insecure development mode cannot turn account control into an unauthenticated API.
      if (!runtime.runtimeToken || !authorize(request, { ...runtime, insecure: false })) return ERRORS.unauthorized()
      if (request.headers.get('x-kun-google-workspace-ui') !== '1') return ERRORS.forbidden('Use Google Workspace settings to manage this integration.')
      const service = runtime.googleWorkspace
      if (!service) return ERRORS.unavailable('Google Workspace is unavailable')
      // No caller-supplied scopes, raw flags, environment, paths or secrets accepted.
      if (new URL(request.url).search || (method === 'POST' && (await request.text()).trim())) {
        return ERRORS.validation('This operation does not accept arguments')
      }
      try {
        const result = operation === 'authorization-url' ? service.authorizationUrl()
          : operation === 'status' ? await service.status(true) : await service[operation]()
        const response = jsonResponse(result, ['login', 'test', 'logout'].includes(operation) ? 202 : 200)
        response.headers['cache-control'] = 'no-store'
        return response
      } catch (error) {
        return error instanceof GoogleWorkspaceError && error.code === 'validation'
          ? ERRORS.conflict('Another Google Workspace operation is running. Cancel it before starting another.')
          : ERRORS.internal('Google Workspace could not complete this operation')
      }
    })
  }
}
