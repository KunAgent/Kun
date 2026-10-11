import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JsonResponse } from '../response.js'
import type { Router } from '../router.js'
import { gatewayJsonResponse as privateResponse } from './gateway-json-response.js'
import { gatewayClientLimitStatus } from './gateway-limit.js'
import { gatewayRouteTraceStore } from './gateway-route-trace.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Admin-only gateway views for the settings page: per-client limits, the
 * recent route list and the middleware script folder. All require the
 * runtime admin token.
 */
export const EXAMPLE_MIDDLEWARE_FILE = 'example-middleware.js'
const EXAMPLE_MIDDLEWARE = `// Kun gateway middleware. Enable it in Settings > Providers > Gateway > Middleware.
// Each hook may return a new value, or undefined to keep the input.
// ctx = { model, agent, options } where options come from the middleware entry.

// Choose the model a request is served by.
export function onModel(model, ctx) {
  return undefined
}

// Rewrite the system prompt sent upstream.
export function onSystemPrompt(text, ctx) {
  return undefined
}

// Rewrite each streamed text delta; return null to drop it.
export function onText(text, ctx) {
  return undefined
}
`

export async function gatewayAdminClientLimit(runtime: ServerRuntime, clientId: string): Promise<JsonResponse> {
  const client = runtime.modelGateway?.credentials.listClients().find((entry) => entry.clientId === clientId && !entry.revokedAt)
  if (!client || !runtime.modelConnections) return privateResponse({ code: 'not_found', message: 'Gateway client not found.' }, 404)
  try {
    const { policy } = await runtime.modelConnections.gatewayClientPolicy(clientId)
    if (!policy) return privateResponse({ client: { id: clientId, name: client.name }, limited: false, models: 'all' })
    return privateResponse(await gatewayClientLimitStatus(runtime, { id: clientId, name: client.name }, policy))
  } catch {
    return privateResponse({ code: 'capability_unavailable', message: 'Gateway budget storage is unavailable.' }, 503)
  }
}

/** `GET /v1/model-gateway/route-traces?after=<seq>&wait=<seconds>`: recent requests of every caller. */
export async function gatewayAdminRouteTraces(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  if (!runtime.modelGateway) return privateResponse({ seq: 0, traces: [] })
  const params = new URL(request.url).searchParams
  const after = Number(params.get('after') ?? 0)
  const wait = Number(params.get('wait') ?? 0)
  if (!Number.isFinite(after) || after < 0 || !Number.isFinite(wait) || wait < 0) {
    return privateResponse({ code: 'validation_error', message: 'after and wait must be non-negative numbers.' }, 400)
  }
  const store = gatewayRouteTraceStore(runtime.modelGateway)
  return privateResponse(wait > 0 ? await store.waitRecent(after, wait * 1_000, request.signal) : store.recent(after))
}

function middlewareFolder(runtime: ServerRuntime): { folder: string; files: string[] } | null {
  const folder = runtime.modelGateway?.middleware?.folder
  if (!folder) return null
  let files: string[] = []
  try { files = readdirSync(folder).filter((name) => /^[A-Za-z0-9._-]+\.js$/.test(name)).sort() } catch { /* not created yet */ }
  return { folder, files }
}

/** Middleware counters plus the script folder and the scripts in it. */
export function gatewayAdminMiddlewareState(runtime: ServerRuntime): JsonResponse {
  const host = runtime.modelGateway?.middleware
  const folder = middlewareFolder(runtime)
  return privateResponse({ middleware: host?.stats() ?? [], ...(folder ? { directory: folder.folder, files: folder.files } : {}) })
}

/** Writes a commented starter script into the middleware folder; never overwrites. */
export function gatewayAdminMiddlewareExample(runtime: ServerRuntime): JsonResponse {
  const folder = middlewareFolder(runtime)
  if (!folder) return privateResponse({ code: 'capability_unavailable', message: 'Gateway middleware is unavailable.' }, 503)
  const file = join(folder.folder, EXAMPLE_MIDDLEWARE_FILE)
  if (existsSync(file)) return privateResponse({ code: 'conflict', message: `${EXAMPLE_MIDDLEWARE_FILE} already exists.`, file: EXAMPLE_MIDDLEWARE_FILE }, 409)
  try {
    mkdirSync(folder.folder, { recursive: true, mode: 0o700 })
    writeFileSync(file, EXAMPLE_MIDDLEWARE, { mode: 0o600, flag: 'wx' })
  } catch {
    return privateResponse({ code: 'capability_unavailable', message: 'The example script could not be written.' }, 503)
  }
  return privateResponse({ file: EXAMPLE_MIDDLEWARE_FILE, directory: folder.folder }, 201)
}

/** Whether the discovery file is published now, and where. */
export function gatewayAdminDiscovery(runtime: ServerRuntime): JsonResponse {
  const status = runtime.modelGateway?.discovery?.status()
  return privateResponse(status ?? { allowed: false, advertised: false })
}

export function registerGatewayAdminExtras(router: Router, runtime: ServerRuntime, admin: (request: Request) => boolean): void {
  const denied = (): JsonResponse => privateResponse({ code: 'unauthorized', message: 'unauthorized' }, 401)
  router.add('GET', '/v1/model-gateway/clients/:id/limit', (request, ctx) => admin(request) ? gatewayAdminClientLimit(runtime, ctx.params.id) : denied())
  router.add('GET', '/v1/model-gateway/route-traces', (request) => admin(request) ? gatewayAdminRouteTraces(runtime, request) : denied())
  router.add('GET', '/v1/model-gateway/discovery', (request) => admin(request) ? gatewayAdminDiscovery(runtime) : denied())
  router.add('GET', '/v1/model-gateway/middleware', (request) => admin(request) ? gatewayAdminMiddlewareState(runtime) : denied())
  router.add('POST', '/v1/model-gateway/middleware/example', (request) => admin(request) ? gatewayAdminMiddlewareExample(runtime) : denied())
}
