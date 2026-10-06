import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { gatewayCallerAgent } from './gateway-caller-agent.js'
import { captureGatewayContinuations, gatewayContinuationStore, restoreGatewayContinuations } from './gateway-continuations.js'
import { gatewayRouteTraceStore, traceGatewayStream } from './gateway-route-trace.js'
import { gatewayAffinityIdentity, type GatewayAuth } from './model-gateway-core.js'
import type { ServerRuntime } from './server-runtime.js'

export function gatewayCallerId(auth: GatewayAuth): string {
  return auth.kind === 'harness' ? `harness:${auth.grant.grantId}` : `client:${auth.client?.clientId ?? 'legacy'}`
}

/**
 * The upstream half every gateway protocol shares: provider continuation
 * state is restored onto replayed tool calls and captured from new ones, and
 * the session's live route trace follows the stream.
 */
export function gatewayUpstream(runtime: ServerRuntime, request: Request, auth: GatewayAuth,
  modelRequest: ModelRequest, asked: string, accountId?: string): AsyncIterable<ModelStreamChunk> {
  if (accountId) modelRequest.accountId = accountId
  const owner = runtime.modelGateway ?? runtime
  const callerId = gatewayCallerId(auth)
  const continuations = gatewayContinuationStore(owner)
  restoreGatewayContinuations(modelRequest, continuations, callerId)
  let session: string | undefined
  try { session = gatewayAffinityIdentity(request, auth).session } catch { session = undefined }
  const agent = gatewayCallerAgent(request)
  if (agent && modelRequest.gatewayRouting) modelRequest.gatewayRouting.agent = agent
  const middleware = runtime.modelGateway?.middleware
  const middlewareContext = { model: asked, ...(agent ? { agent } : {}) }
  middleware?.transformRequest(modelRequest, middlewareContext)
  const trace = gatewayRouteTraceStore(owner).begin(session, { requestId: modelRequest.turnId, asked,
    ...(agent ? { agent } : {}), ...(modelRequest.reasoningEffort ? { effort: modelRequest.reasoningEffort } : {}) })
  const upstream = runtime.modelClient!.stream(modelRequest)
  return traceGatewayStream(captureGatewayContinuations(middleware ? middleware.wrapStream(upstream, middlewareContext) : upstream,
    continuations, callerId), trace)
}
