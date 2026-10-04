import { validGatewayClientName } from '../../services/gateway-credential-service.js'
import { readJsonBody } from '../read-json-body.js'
import type { JsonResponse } from '../response.js'
import { gatewayJsonResponse as privateResponse } from './gateway-json-response.js'
import type { ServerRuntime } from './server-runtime.js'

export function listGatewayClients(runtime: ServerRuntime): JsonResponse {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return ERRORS.unavailable('Gateway credentials are unavailable.')
  return privateResponse({ clients: credentials.listClients() })
}

export async function createGatewayClient(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return ERRORS.unavailable('Gateway credentials are unavailable.')
  const parsed = await readJsonBody(request, 1_024, request.signal)
  if (!parsed.ok) {
    parsed.response.headers['cache-control'] = 'no-store'
    return parsed.response
  }
  const body = parsed.value as Record<string, unknown> | null
  if (!body || Array.isArray(body) || typeof body !== 'object' ||
    Object.keys(body).some((key) => key !== 'name') || !validGatewayClientName(body.name)) {
    return ERRORS.validation('Provide only a client name, 1-80 characters without control characters.')
  }
  try {
    // Return the secret exactly once to the authenticated control-plane caller.
    return privateResponse(await credentials.createClient(body.name), 201)
  } catch {
    return ERRORS.unavailable('Gateway client could not be saved. Check storage and the client record limit.')
  }
}

export async function revokeGatewayClient(runtime: ServerRuntime, clientId: string): Promise<JsonResponse> {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return ERRORS.unavailable('Gateway credentials are unavailable.')
  if (!credentials.listClients().some((client) => client.clientId === clientId)) return ERRORS.notFound('Gateway client not found.')
  try { return privateResponse({ revoked: await credentials.revokeClient(clientId) }) } catch {
    return ERRORS.unavailable('Gateway client could not be revoked. Check storage and retry.')
  }
}

export async function gatewayClientUsage(runtime: ServerRuntime, clientId: string): Promise<JsonResponse> {
  const gateway = runtime.modelGateway
  if (!gateway?.usage) return ERRORS.unavailable('Gateway usage is unavailable.')
  if (clientId !== 'legacy' && !gateway.credentials.listClients().some((client) => client.clientId === clientId)) {
    return ERRORS.notFound('Gateway client not found.')
  }
  try { return privateResponse(await gateway.usage.summary(clientId)) } catch {
    return ERRORS.unavailable('Gateway usage storage is unavailable.')
  }
}

const ERRORS = {
  unavailable: (message: string) => privateResponse({ code: 'capability_unavailable', message }, 503),
  notFound: (message: string) => privateResponse({ code: 'not_found', message }, 404),
  validation: (message: string) => privateResponse({ code: 'validation_error', message }, 400)
}
