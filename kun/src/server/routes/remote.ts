import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import { TestRemoteConnectionRequest } from '../../contracts/remote.js'
import type { ServerRuntime } from './server-runtime.js'

/** GET /v1/remote/hosts — selectable SSH aliases from ~/.ssh/config. */
export async function listRemoteHosts(runtime: ServerRuntime): Promise<JsonResponse> {
  if (!runtime.remote) return ERRORS.unavailable('remote targets are not available')
  return jsonResponse(await runtime.remote.listHosts())
}

/** POST /v1/remote/test — read-only precheck against an alias + remote dir. */
export async function testRemoteConnection(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  if (!runtime.remote) return ERRORS.unavailable('remote targets are not available')
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return ERRORS.validation('invalid JSON body')
  }
  const parsed = TestRemoteConnectionRequest.safeParse(body)
  if (!parsed.success) return ERRORS.validation(parsed.error.message)
  return jsonResponse(await runtime.remote.testConnection(parsed.data))
}

/** GET /v1/remote/profiles — shareable, secret-free Remote Profiles. */
export async function listRemoteProfiles(runtime: ServerRuntime): Promise<JsonResponse> {
  if (!runtime.remote) return ERRORS.unavailable('remote targets are not available')
  return jsonResponse({ profiles: await runtime.remote.listProfiles() })
}
