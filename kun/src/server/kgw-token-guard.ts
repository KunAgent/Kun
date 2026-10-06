import {
  HARNESS_TOKEN_PREFIX,
  type HarnessTokenGrant,
  type HarnessTokenScope,
  type HarnessTokenService
} from '../harness/harness-token-service.js'
import { jsonResponse, type JsonResponse } from './response.js'
import { splitAttributedKey } from './routes/gateway-caller-agent.js'

/**
 * Path prefixes each harness-token scope may reach (docs/ade/05 §4). A grant
 * carrying several scopes may reach the union of their prefixes; everything
 * else — including every other `/v1/*` route — is rejected before dispatch.
 */
const SCOPE_PATH_PREFIXES: Record<HarnessTokenScope, readonly string[]> = {
  gateway: ['/v1/messages', '/v1/chat/completions', '/v1/responses', '/v1/models', '/v1/kun/route'],
  'kun-tools': ['/mcp/kun'],
  'worker-callback': ['/v1/worker-callbacks/'],
  'hook-ingest': ['/v1/activity/hooks']
}

export type KgwRequestGuard = (request: Request) => JsonResponse | null

function pathAllowedForGrant(pathname: string, grant: HarnessTokenGrant): boolean {
  for (const scope of grant.scopes) {
    for (const prefix of SCOPE_PATH_PREFIXES[scope]) {
      // A listed prefix matches itself exactly or any path nested beneath it,
      // so `/v1/messages` also admits `/v1/messages/count_tokens`.
      if (pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
        return true
      }
    }
  }
  return false
}

function unauthorized(): JsonResponse {
  return jsonResponse({ code: 'unauthorized', message: 'unauthorized' }, 401)
}

/**
 * Dispatch-time fence for `kgw_` harness tokens (docs/ade/impl P1-07). Runs
 * before routing and before the ordinary runtime-token check, so a harness
 * credential can never widen into control-plane routes — even on insecure
 * loopback servers where route auth is a no-op. Non-`kgw_` credentials pass
 * through untouched.
 */
export function makeKgwTokenGuard(
  tokens: Pick<HarnessTokenService, 'verify'> | undefined
): KgwRequestGuard | undefined {
  if (!tokens) return undefined
  return (request) => {
    const bearer = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
    // An attribution prefix (`kun-<app>.`) must not hide a harness token from this fence.
    const candidate = splitAttributedKey(bearer ?? request.headers.get('x-api-key') ?? null).secret ?? undefined
    if (!candidate?.startsWith(HARNESS_TOKEN_PREFIX)) return null
    const grant = tokens.verify(candidate)
    if (!grant) return unauthorized()
    const pathname = new URL(request.url).pathname
    if (!pathAllowedForGrant(pathname, grant)) return unauthorized()
    return null
  }
}
