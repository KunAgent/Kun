import { validGatewayClientName } from '../../services/gateway-credential-service.js'
import { readJsonBody } from '../read-json-body.js'
import type { JsonResponse } from '../response.js'
import { gatewayJsonResponse as privateResponse } from './gateway-json-response.js'
import type { ServerRuntime } from './server-runtime.js'
import { GatewayClientPolicySchema } from '../../contracts/gateway-client-policy.js'
import { resolveGatewayModel } from './model-gateway-core.js'
import { cancelGatewayClientRequests } from './gateway-client-policy.js'

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
    Object.keys(body).some((key) => key !== 'name' && key !== 'modelId') || !validGatewayClientName(body.name) ||
    (body.modelId !== undefined && (typeof body.modelId !== 'string' || !body.modelId.trim() || body.modelId.length > 512))) {
    return ERRORS.validation('Provide a client name and an optional public model alias.')
  }
  let createdId: string | undefined
  try {
    const modelId = typeof body.modelId === 'string' ? body.modelId : undefined
    const resolved = modelId ? await resolveGatewayModel(runtime, modelId) : undefined
    if (modelId && !resolved) return ERRORS.validation('Select an exportable public model alias.')
    // Return the secret exactly once to the authenticated control-plane caller.
    const created = await credentials.createClient(body.name)
    createdId = created.client.clientId
    if (resolved && runtime.modelConnections) {
      const pool = runtime.modelGateway?.pools().find((entry) => entry.modelId === modelId)
      const policy = GatewayClientPolicySchema.parse({
        allowedRouteIds: pool ? [pool.id] : [], allowedModelIds: pool ? [] : [modelId],
        allowedConnectionIds: [...new Set(resolved.gatewayRouting.allowedTargets.map((target) => target.providerId))]
      })
      const snapshot = await runtime.modelConnections.snapshot()
      const preview = await runtime.modelConnections.previewConfiguration({ expectedRevision: snapshot.revision,
        operations: [{ kind: 'set-client-policy', clientId: createdId, policy }] })
      const committed = await runtime.modelConnections.commitConfiguration({ previewId: preview.previewId,
        expectedRevision: preview.expectedRevision, idempotencyKey: `gateway-client:${createdId}` })
      if (!committed.applied) throw new Error('Gateway policy could not be activated')
    }
    return privateResponse(created, 201)
  } catch {
    if (createdId) await credentials.revokeClient(createdId).catch(() => undefined)
    return ERRORS.unavailable('Gateway client could not be saved. Check storage and the client record limit.')
  }
}

export async function rotateGatewayClient(runtime: ServerRuntime, clientId: string): Promise<JsonResponse> {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return ERRORS.unavailable('Gateway credentials are unavailable.')
  try { return privateResponse(await credentials.rotateClient(clientId)) }
  catch { return ERRORS.unavailable('Gateway client could not be rotated.') }
}

export async function revokeGatewayClient(runtime: ServerRuntime, clientId: string, request?: Request): Promise<JsonResponse> {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return ERRORS.unavailable('Gateway credentials are unavailable.')
  if (!credentials.listClients().some((client) => client.clientId === clientId)) return ERRORS.notFound('Gateway client not found.')
  const cancel = request ? new URL(request.url).searchParams.get('cancel_active') : null
  if (cancel !== null && cancel !== 'true' && cancel !== 'false') return ERRORS.validation('cancel_active must be true or false.')
  try {
    const revoked = await credentials.revokeClient(clientId)
    return privateResponse({ revoked, ...(cancel === 'true' ? { cancelledRequests: cancelGatewayClientRequests(runtime, clientId) } : {}) })
  } catch {
    return ERRORS.unavailable('Gateway client could not be revoked. Check storage and retry.')
  }
}

export async function gatewayClientUsage(runtime: ServerRuntime, clientId: string): Promise<JsonResponse> {
  const gateway = runtime.modelGateway
  if (!gateway?.usage) return ERRORS.unavailable('Gateway usage is unavailable.')
  if (clientId !== 'legacy' && !gateway.credentials.listClients().some((client) => client.clientId === clientId)) {
    return ERRORS.notFound('Gateway client not found.')
  }
  try {
    const policy = (await runtime.modelConnections?.gatewayClientPolicy(clientId))?.policy?.tokenBudget
    const clientPolicy = await runtime.modelConnections?.gatewayClientPolicy(clientId)
    return privateResponse({ ...await gateway.usage.summary(clientId), budget: await gateway.budget?.summary(clientId, policy, clientPolicy?.policy?.costAlert) })
  } catch {
    return ERRORS.unavailable('Gateway usage storage is unavailable.')
  }
}

const ERRORS = {
  unavailable: (message: string) => privateResponse({ code: 'capability_unavailable', message }, 503),
  notFound: (message: string) => privateResponse({ code: 'not_found', message }, 404),
  validation: (message: string) => privateResponse({ code: 'validation_error', message }, 400)
}
