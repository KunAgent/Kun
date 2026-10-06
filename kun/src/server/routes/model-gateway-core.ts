import { routeCapabilityGuarantees } from '../../adapters/model/route-capability-contract.js'
import { publicGatewayTarget } from '../../domain/model-gateway-export-policy.js'
import { randomUUID } from 'node:crypto'
import { ResponsesToolNamespaces } from './responses-tool-namespaces.js'
import { describeGatewayModel } from './gateway-models-catalog.js'
import { gatewaySnapshot } from './gateway-subscription-export.js'
import { extensionGatewayModels, resolveExtensionGatewayModel } from './gateway-extension-exports.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ModelConnectionSnapshot } from '../../contracts/model-connections.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { hasUsage } from '../../domain/usage.js'
import { formatGatewayModelId, GATEWAY_MODEL_PREFIX, parseGatewayModelId } from '../../harness/gateway-model-id.js'
import { exposableProvider, GatewayRouteChangedError, gatewayDirectTargets, gatewayPoolTargets, gatewayTargetExportable, gatewayTargetExportBlockReason } from '../../domain/model-gateway-export-policy.js'
import type { GatewayClientIdentity } from '../../services/gateway-credential-service.js'

import {
  HARNESS_TOKEN_PREFIX,
  type HarnessTokenGrant
} from '../../harness/harness-token-service.js'
import { estimateTokens } from '../../loop/request-history-hygiene.js'
import { IMAGE_TOOL_RESULT_TOKEN_ESTIMATE } from '../../loop/tool-result-image.js'
import type { ModelRequest, ModelStreamChunk, ModelToolSpec } from '../../ports/model-client.js'
import type { JsonResponse } from '../response.js'
import { gatewayJsonResponse as jsonResponse } from './gateway-json-response.js'
import { GatewayRequestGuard, type GatewayLease } from './gateway-request-guard.js'
import { gatewayPolicyActive, legacyGatewayClientPolicy, type GatewayClientPolicy } from '../../contracts/gateway-client-policy.js'
import { clientGuardFor, clientRouteTargets, clientDirectTargets, combinedGatewayLease, gatewayRequestProtocol } from './gateway-client-policy.js'
import { gatewaySessionHint } from './gateway-caller-agent.js'
import { GATEWAY_SESSION_HEADER, gatewaySessionId } from '../../services/gateway-usage-service.js'
import type { ServerRuntime } from './server-runtime.js'
import { rawGatewayCredential, splitAttributedKey } from './gateway-caller-agent.js'

export { exposableProvider } from '../../domain/model-gateway-export-policy.js'

/**
 * Transport-independent core of the local model gateway (docs/ade/04 §5.2):
 * credential guard, request body reading, inbound message → TurnItem
 * conversion, route-pool model resolution, and shared value/error helpers.
 * The OpenAI (`openai-model-gateway.ts`) and Anthropic
 * (`anthropic-messages-gateway.ts`) entry points keep only their wire-format
 * mapping on top of this module.
 */

export const MAX_GATEWAY_BODY_BYTES = 2 * 1024 * 1024
const GATEWAY_GUARDS = new WeakMap<object, GatewayRequestGuard>()

export function guardFor(runtime: ServerRuntime): GatewayRequestGuard | null {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return null
  let guard = GATEWAY_GUARDS.get(credentials)
  if (!guard) {
    guard = new GatewayRequestGuard(credentials)
    GATEWAY_GUARDS.set(credentials, guard)
  }
  return guard
}
export async function nextGatewayChunk(
  iterator: AsyncIterator<ModelStreamChunk>,
  signal: AbortSignal
): Promise<IteratorResult<ModelStreamChunk>> {
  if (signal.aborted) throw signal.reason ?? new Error('gateway request aborted')
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(signal.reason ?? new Error('gateway request aborted'))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    iterator.next().then(
      (result) => { cleanup(); resolve(result) },
      (error) => { cleanup(); reject(error) }
    )
  })
}

export function authorizePublicGateway(runtime: ServerRuntime, request: Request): JsonResponse | null {
  const guard = guardFor(runtime)
  if (!guard || !guard.authorize(request)) return openAiError('Invalid gateway API key.', 'invalid_api_key', 401)
  if (!guard.consumeToken()) return openAiError('Gateway rate limit exceeded.', 'rate_limit_exceeded', 429)
  return null
}

/**
 * Gateway caller identity (docs/ade/04 §5.2): either a public gateway
 * credential or a `kgw_` harness grant. Harness tokens are checked first and
 * fail closed — a `kgw_` token is never accepted as a public credential.
 */
export type GatewayAuth =
  | { kind: 'public'; client?: GatewayClientIdentity; policy?: GatewayClientPolicy; policyRevision?: number }
  | { kind: 'harness'; grant: HarnessTokenGrant }

export type GatewayAuthVerdict =
  | { ok: true; auth: GatewayAuth }
  | { ok: false; reason: 'unauthorized' | 'rate_limited' | 'forbidden' | 'unavailable' }

/** The verified credential: an attribution prefix (`kun-<app>.`) is stripped before verification. */
export function bearerCandidate(request: Request): string | null {
  return splitAttributedKey(rawGatewayCredential(request)).secret
}

export async function authorizeGateway(runtime: ServerRuntime, request: Request): Promise<GatewayAuthVerdict> {
  const candidate = bearerCandidate(request)
  const alternate = request.headers.get('x-api-key')
  if (request.headers.get('authorization')?.trim() && alternate && request.headers.get('authorization') !== `Bearer ${alternate}`) {
    return { ok: false, reason: 'unauthorized' }
  }
  if (candidate?.startsWith(HARNESS_TOKEN_PREFIX)) {
    const grant = runtime.harnessTokens?.verifyScope(candidate, 'gateway')
    if (grant?.turnId) {
      try { if (await gatewayRunningTurnId(runtime, grant.threadId) !== grant.turnId) return { ok: false, reason: 'unauthorized' } }
      catch { return { ok: false, reason: 'unauthorized' } }
    }
    return grant ? { ok: true, auth: { kind: 'harness', grant } } : { ok: false, reason: 'unauthorized' }
  }
  const guard = guardFor(runtime)
  if (!guard || !guard.authorize(request)) return { ok: false, reason: 'unauthorized' }
  const client = runtime.modelGateway?.credentials.identify?.(candidate) ?? undefined
  let policy = client ? runtime.modelGateway?.credentials.defaultClientPolicy?.(client.clientId) ?? legacyGatewayClientPolicy()
    : legacyGatewayClientPolicy()
  let policyRevision: number | undefined
  try {
    const current = await runtime.modelConnections?.gatewayClientPolicy?.(client?.clientId ?? 'legacy')
    if (current) { policy = current.policy ?? policy; policyRevision = current.revision }
  } catch { return { ok: false, reason: 'unavailable' } }
  if (!gatewayPolicyActive(policy)) return { ok: false, reason: 'unauthorized' }
  const protocol = gatewayRequestProtocol(request)
  if (protocol && !policy.allowedProtocols.includes(protocol)) return { ok: false, reason: 'forbidden' }
  if (!clientGuardFor(runtime, client?.clientId ?? 'legacy', policy).consumeToken() || !guard.consumeToken()) {
    return { ok: false, reason: 'rate_limited' }
  }
  return { ok: true, auth: { kind: 'public', policy, policyRevision, ...(client ? { client } : {}) } }
}

export function acquirePublicGatewayLease(runtime: ServerRuntime, request: Request, auth: GatewayAuth): GatewayLease | null {
  const global = guardFor(runtime)?.acquire(request.signal) ?? null
  if (auth.kind !== 'public' || !auth.policy) return global
  return combinedGatewayLease(global, clientGuardFor(runtime, auth.client?.clientId ?? 'legacy', auth.policy).acquire(request.signal))
}

export function gatewayClientInput(input: Record<string, unknown>, auth: GatewayAuth): Record<string, unknown> {
  const max = auth.kind === 'public' ? auth.policy?.maxOutputTokens : undefined
  if (max === undefined) return input
  const requested = input.max_tokens ?? input.max_completion_tokens ?? input.max_output_tokens
  if (typeof requested === 'number' && requested > max) throw new Error('max_tokens exceeds the gateway client policy')
  return requested === undefined ? { ...input, max_tokens: max } : input
}

export function gatewayAffinityIdentity(request: Request, auth: GatewayAuth, turnId?: string, body?: Record<string, unknown>): { turn?: string; session?: string } {
  if (auth.kind === 'harness') return { session: auth.grant.threadId, turn: turnId ?? auth.grant.turnId }
  const caller = auth.client?.clientId ?? 'legacy'
  const explicit = request.headers.get(GATEWAY_SESSION_HEADER)
  let session: string | undefined
  if (explicit !== null) session = gatewaySessionId(caller, explicit)
  else {
    // Optional client-owned session ids (headers, Claude Code metadata, Kimi cache key).
    try { session = gatewaySessionId(caller, gatewaySessionHint(request, body) ?? null) } catch { session = undefined }
  }
  return { session,
    turn: gatewaySessionId(`${caller}:turn`, request.headers.get('x-kun-gateway-turn-id')) }
}

export function gatewayDispatchAuthorization(runtime: ServerRuntime, request: Request, auth: GatewayAuth,
  existing?: () => Promise<void>): () => Promise<void> {
  const candidate = bearerCandidate(request)
  return async () => {
    const valid = auth.kind === 'harness'
      ? Boolean(candidate && runtime.harnessTokens?.verifyScope(candidate, 'gateway') === auth.grant)
      : Boolean(runtime.modelGateway?.credentials.verify(candidate)) && (!auth.policy || gatewayPolicyActive(auth.policy))
    if (!valid) throw new GatewayRouteChangedError()
    await existing?.()
  }
}

/**
 * Harness grants carry their own concurrency budget (default 4). Each grant
 * gets a dedicated guard so its leases share the public guard's timeout and
 * abort semantics without consuming public slots.
 */
const GRANT_GUARDS = new WeakMap<HarnessTokenGrant, GatewayRequestGuard>()

export function acquireHarnessGrantLease(grant: HarnessTokenGrant, signal: AbortSignal): GatewayLease | null {
  let guard = GRANT_GUARDS.get(grant)
  if (!guard) {
    guard = new GatewayRequestGuard({ verify: () => false }, { get maxConcurrency() { return grant.maxConcurrent } })
    GRANT_GUARDS.set(grant, guard)
  }
  return guard.acquire(signal)
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
export function openAiError(message: string, code: string, status: number): JsonResponse {
  return jsonResponse({ error: { message, type: status >= 500 ? 'server_error' : 'invalid_request_error', param: null, code } }, status)
}
export function errorStatus(chunk: Extract<ModelStreamChunk, { kind: 'error' }>): number { return chunk.failure?.httpStatus && chunk.failure.httpStatus >= 400 ? chunk.failure.httpStatus : 502 }
export function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
export function stringValue(value: unknown): string { return typeof value === 'string' ? value : '' }
export function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
export function parseArguments(value: unknown): Record<string, unknown> { try { return typeof value === 'string' ? asRecord(JSON.parse(value)) : asRecord(value) } catch { return {} } }

/** Resolved export scope is internal and must never be accepted from request JSON. */
export type ResolvedGatewayModel = {
  model: string
  providerId?: string
  /** Account an exported extension provider's requests use. */
  accountId?: string
  gatewayRouting: NonNullable<ModelRequest['gatewayRouting']>
}

/**
 * Grants narrow authorization; they never turn a subscription or whole-agent
 * provider into a model API. Native harness sign-in remains independent.
 */
export async function resolveGatewayModel(
  runtime: ServerRuntime,
  model: string,
  grant?: HarnessTokenGrant,
  policy?: GatewayClientPolicy,
  policyRevision?: number
): Promise<ResolvedGatewayModel | null> {
  // Middleware may serve an asked name by another model; admission below checks the served one.
  model = runtime.modelGateway?.middleware?.rewriteModel(model) ?? model
  const registry = runtime.modelConnections
  const assertCurrent = runtime.directModelClient?.gatewayDispatchGuard?.()
  const snapshot = registry ? await gatewaySnapshot(runtime) : undefined
  if (!snapshot) return null
  await registry?.assertActiveConfiguration?.(snapshot.revision)
  if (policyRevision !== undefined && snapshot.revision !== policyRevision) throw new GatewayRouteChangedError()
  try { assertCurrent?.() } catch { return null }
  const dispatchProof = assertCurrent ? {
    assertCurrent,
    beforeDispatch: async () => {
      try {
        assertCurrent()
        await registry!.assertRevision(snapshot.revision)
        await registry!.assertActiveConfiguration?.(snapshot.revision)
        assertCurrent()
      } catch { throw new GatewayRouteChangedError() }
    }
  } : {}
  if (grant) {
    const alias = grant.aliasRoutes?.find((entry) => entry.alias === model)
    if (alias) {
      const pool = runtime.modelGateway?.pools().find((entry) => entry.id === alias.routeId && entry.enabled && entry.modelId === alias.alias)
      const allowedTargets = pool ? gatewayPoolTargets(snapshot.providers, pool).filter((target) =>
        alias.targets.some((approved) => approved.providerId === target.providerId && approved.modelId === target.modelId)) : []
      return allowedTargets.length ? { model, gatewayRouting: { allowedTargets, ...dispatchProof } } : null
    }
    const direct = parseGatewayModelId(model)
    if (!direct) return null
    const requested = { providerId: direct.providerId, modelId: direct.model }
    const allowed = grant.routes.map((route) => ({ providerId: route.providerId, modelId: route.model }))
    if (!allowed.some((route) => route.providerId === requested.providerId && route.modelId === requested.modelId) ||
      !gatewayTargetExportable(snapshot.providers, requested)) return null
    const allowedTargets = gatewayDirectTargets(snapshot, requested, allowed)
    return allowedTargets.length ? { ...direct, gatewayRouting: { allowedTargets, ...dispatchProof } } : null
  }
  if (model.startsWith(GATEWAY_MODEL_PREFIX)) return null
  const pool = runtime.modelGateway?.pools().find((entry) => entry.enabled && entry.modelId === model)
  if (pool) {
    const allowedTargets = clientRouteTargets(policy, pool, gatewayPoolTargets(snapshot.providers, pool))
    return allowedTargets.length ? { model, gatewayRouting: { allowedTargets, ...dispatchProof } } : null
  }
  if (!runtime.modelGateway?.exposeProviderModels()) return null
  const requested = publicGatewayTarget(snapshot.providers, model)
  if (!requested) return resolveExtensionGatewayModel(runtime, model, policy)
  if (!gatewayTargetExportable(snapshot.providers, requested)) return null
  const allowedTargets = clientDirectTargets(policy, requested, gatewayDirectTargets(snapshot, requested))
  return allowedTargets.length
    ? { model: requested.modelId, providerId: requested.providerId, gatewayRouting: { allowedTargets, ...dispatchProof } }
    : null
}

/** Discovery applies the same export policy as request admission and failover. */
export async function listGatewayModels(runtime: ServerRuntime, grant?: HarnessTokenGrant, policy?: GatewayClientPolicy, policyRevision?: number) {
  const snapshot = await gatewaySnapshot(runtime)
  if (!snapshot) return []
  await runtime.modelConnections?.assertActiveConfiguration?.(snapshot.revision)
  if (policyRevision !== undefined && snapshot.revision !== policyRevision) throw new GatewayRouteChangedError()
  const capabilities = runtime.modelGateway?.modelCapabilities?.bind(runtime.modelGateway)
  return gatewayModelsFromSnapshot(runtime, snapshot, grant, policy).map((entry) => {
    const pool = runtime.modelGateway?.pools().find((candidate) => candidate.modelId === entry.id)
    if (!pool) {
      const direct = entry.id.startsWith(GATEWAY_MODEL_PREFIX) ? parseGatewayModelId(entry.id) : undefined
      const target = direct ? { providerId: direct.providerId, modelId: direct.model } : publicGatewayTarget(snapshot.providers, entry.id)
      const provider = target ? snapshot.providers.find((candidate) => candidate.id === target.providerId) : undefined
      return { ...entry, ...(target ? describeGatewayModel(snapshot, [target], capabilities,
        { displayName: provider ? `${target.modelId} · ${provider.name}` : undefined, routed: false }) : {}) }
    }
    const allowed = clientRouteTargets(policy, pool, gatewayPoolTargets(snapshot.providers, pool))
      .filter((target) => !grant || grant.aliasRoutes?.some((alias) => alias.alias === entry.id &&
        alias.targets.some((approved) => approved.providerId === target.providerId && approved.modelId === target.modelId)))
    return { ...entry, ...describeGatewayModel(snapshot, allowed, capabilities, { displayName: pool.name, routed: true }),
      x_kun: { capabilityMode: pool.capabilityMode ?? 'request-filter',
        guarantees: routeCapabilityGuarantees(allowed.map((target) => runtime.modelGateway?.modelCapabilities?.(target.modelId, target.providerId))) } }
  })
}

function gatewayModelsFromSnapshot(runtime: ServerRuntime, snapshot: ModelConnectionSnapshot, grant?: HarnessTokenGrant, policy?: GatewayClientPolicy): {
  id: string; object: 'model'; created: number; owned_by: string
}[] {
  if (grant) {
    const allowed = grant.routes.map((route) => ({ providerId: route.providerId, modelId: route.model }))
    const aliases = (grant.aliasRoutes ?? []).filter((alias) => {
      const pool = runtime.modelGateway?.pools().find((entry) => entry.id === alias.routeId && entry.enabled && entry.modelId === alias.alias)
      return pool && gatewayPoolTargets(snapshot.providers, pool).some((target) => alias.targets.some((approved) =>
        approved.providerId === target.providerId && approved.modelId === target.modelId))
    }).map((alias) => ({ id: alias.alias, object: 'model' as const, created: 0, owned_by: `kun-harness:${alias.role}` }))
      .filter((alias, index, all) => all.findIndex((candidate) => candidate.id === alias.id) === index)
    return [...aliases, ...grant.routes.filter((route) => gatewayTargetExportable(snapshot.providers, {
      providerId: route.providerId, modelId: route.model
    }) && gatewayDirectTargets(snapshot, { providerId: route.providerId, modelId: route.model }, allowed).length > 0)
      .map((route) => ({ id: formatGatewayModelId(route.providerId, route.model), object: 'model' as const, created: 0,
        owned_by: `kun-harness:${route.role}` }))]
  }
  const data: { id: string; object: 'model'; created: number; owned_by: string }[] =
    (runtime.modelGateway?.pools() ?? []).filter((pool) => !pool.modelId.startsWith(GATEWAY_MODEL_PREFIX) &&
      clientRouteTargets(policy, pool, gatewayPoolTargets(snapshot.providers, pool)).length > 0)
      .map((pool) => ({ id: pool.modelId, object: 'model', created: 0, owned_by: 'kun-route-pool' }))
  if (runtime.modelGateway?.exposeProviderModels()) {
    const seen = new Set(data.map((entry) => entry.id))
    for (const provider of snapshot.providers.filter(exposableProvider)) {
      for (const modelId of providerModelIds(provider)) {
        const id = `${provider.id}/${modelId}`
        const target = { providerId: provider.id, modelId }
        if (id.startsWith(GATEWAY_MODEL_PREFIX) || seen.has(id) ||
            publicGatewayTarget(snapshot.providers, id)?.providerId !== provider.id ||
            !clientDirectTargets(policy, target, gatewayDirectTargets(snapshot, target)).length) continue
        seen.add(id)
        data.push({ id, object: 'model', created: 0, owned_by: provider.id })
      }
    }
    data.push(...extensionGatewayModels(runtime, policy, seen))
  }
  return data
}

/** Runtime-admin status distinguishes configured native routes from exported API aliases. */
export async function gatewayExportStatus(runtime: ServerRuntime) {
  const snapshot = await gatewaySnapshot(runtime)
  const exportableModelIds = snapshot ? gatewayModelsFromSnapshot(runtime, snapshot).map((entry) => entry.id) : []
  const gatewayExportPools = (runtime.modelGateway?.configuredPools() ?? []).map((pool) => {
    const targets = pool.targets.map((target) => {
      const reason = !pool.enabled || !target.enabled ? 'disabled'
        : !snapshot ? 'provider_registry_unavailable'
          : gatewayTargetExportBlockReason(snapshot.providers, target)
      return { id: target.id, providerId: target.providerId, modelId: target.modelId,
        exportable: !reason, ...(reason ? { reason } : {}) }
    })
    return { id: pool.id, modelId: pool.modelId, exportable: exportableModelIds.includes(pool.modelId), targets }
  })
  return { exportableModelIds, gatewayExportPools }
}

/** Sorted unique model ids a provider advertises (`selectedModel` + `models`). */
export function providerModelIds(provider: {
  models?: string[]
  selectedModel?: string
}): string[] {
  return [...new Set(
    [provider.selectedModel, ...(provider.models ?? [])]
      .filter((model): model is string => typeof model === 'string' && model.length > 0)
  )].sort()
}

/**
 * Assemble a chat-shaped `messages` array (OpenAI/normalized Anthropic input)
 * into the canonical ModelRequest: system/developer messages fold into
 * `systemPrompt`, assistant tool_calls and tool results become TurnItems, and
 * image parts become attachments.
 */
export function makeModelRequest(
  input: Record<string, unknown>,
  signal: AbortSignal,
  providerId?: string,
  identity?: { threadId: string; turnId: string }
): ModelRequest {
  const model = stringValue(input.model)
  if (!model) throw new Error('model is required')
  const rawMessages = Array.isArray(input.messages) ? input.messages : []
  if (rawMessages.length === 0) throw new Error('messages or input is required')
  for (const field of ['stream', 'store', 'background']) {
    if (input[field] != null && typeof input[field] !== 'boolean') throw new Error(`${field} must be a boolean`)
  }
  if (input.store === true || input.background === true) throw new Error('Stored or background generation is not supported by the local gateway')
  const tools = parseTools(input.tools)
  for (const field of ['stop', 'logit_bias', 'logprobs', 'top_logprobs', 'seed', 'frequency_penalty', 'presence_penalty']) {
    if (input[field] != null) throw new Error(`${field} is not supported by the local gateway`)
  }
  if (input.parallel_tool_calls != null && typeof input.parallel_tool_calls !== 'boolean') throw new Error('parallel_tool_calls must be a boolean')
  if (input.n != null && input.n !== 1) throw new Error('Only n=1 is supported by the local gateway')
  const choice = asRecord(input.tool_choice)
  const requiredToolName = choice.type === 'function'
    ? stringValue(asRecord(choice.function).name) || stringValue(choice.name) : ''
  if (input.tool_choice != null && input.tool_choice !== 'auto' && !requiredToolName) throw new Error('Only auto or a named function tool_choice is supported')
  if (requiredToolName && !tools.some((tool) => tool.name === requiredToolName)) throw new Error('tool_choice must name an advertised tool')
  const format = asRecord(input.response_format)
  if (format.type != null && format.type !== 'text' && format.type !== 'json_object') throw new Error('response_format is not supported by the local gateway')
  const maxTokens = numberValue(input.max_tokens ?? input.max_completion_tokens ?? input.max_output_tokens)
  if ((input.max_tokens ?? input.max_completion_tokens ?? input.max_output_tokens) != null && (!maxTokens || !Number.isInteger(maxTokens) || maxTokens < 1)) throw new Error('max_tokens must be a positive integer')
  for (const [field, max] of [['temperature', 2], ['top_p', 1]] as const) {
    if (input[field] != null && (numberValue(input[field]) === undefined || Number(input[field]) < 0 || Number(input[field]) > max)) throw new Error(`${field} must be a number between 0 and ${max}`)
  }
  const now = new Date().toISOString()
  const threadId = identity?.threadId ?? `gateway_${randomUUID()}`
  const turnId = identity?.turnId ?? `turn_${randomUUID()}`
  const history: TurnItem[] = []
  const inputCalls = new Map<string, string>()
  const resolvedCalls = new Set<string>()
  const attachments: NonNullable<ModelRequest['attachments']> = []
  const messageAttachments: Record<string, NonNullable<ModelRequest['messageAttachments']>[string]> = {}
  const lastUserIndex = rawMessages.reduce((last, message, index) => asRecord(message).role === 'user' ? index : last, -1)
  let systemPrompt = ''
  for (let index = 0; index < rawMessages.length; index += 1) {
    const message = asRecord(rawMessages[index])
    const role = stringValue(message.role)
    if (!['system', 'developer', 'assistant', 'tool', 'user'].includes(role)) throw new Error(`Unsupported message role '${role}'`)
    const images: NonNullable<ModelRequest['attachments']> = []
    const extracted = messageContent(message.content, images, index)
    if (images.length) {
      if (role !== 'user') throw new Error('Image inputs are supported only in user messages')
      if (index === lastUserIndex) attachments.push(...images)
      else messageAttachments[`gateway_item_${index}`] = { images, textFallbacks: [], documents: [], unavailable: [] }
    }
    if (role === 'system' || role === 'developer') {
      systemPrompt += `${systemPrompt ? '\n\n' : ''}${extracted}`
      continue
    }
    const base = { id: `gateway_item_${index}`, turnId, threadId, status: 'completed' as const, createdAt: now }
    if (role === 'assistant') {
      if (message.tool_calls != null && !Array.isArray(message.tool_calls)) throw new Error('tool_calls must be an array')
      if (message.reasoning_content != null) {
        if (typeof message.reasoning_content !== 'string') throw new Error('reasoning_content must be a string')
        if (message.reasoning_content) history.push({ ...base, id: `${base.id}_reasoning`, kind: 'assistant_reasoning', role: 'assistant', text: message.reasoning_content })
      }
      if (extracted) history.push({ ...base, kind: 'assistant_text', role: 'assistant', text: extracted })
      for (const rawCall of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        const call = asRecord(rawCall)
        const fn = asRecord(call.function)
        if (!stringValue(call.id) || !stringValue(fn.name) || (call.type != null && call.type !== 'function')) throw new Error('tool_calls require function type, id and name')
        if (inputCalls.has(String(call.id))) throw new Error('tool_calls must have unique ids')
        inputCalls.set(String(call.id), String(fn.name))
        history.push({
          ...base,
          id: `${base.id}_tool_${history.length}`,
          kind: 'tool_call', role: 'assistant', toolKind: 'tool_call',
          callId: stringValue(call.id) || `call_${history.length}`,
          toolName: stringValue(fn.name) || 'unknown',
          arguments: strictToolArguments(fn.arguments)
        })
      }
    } else if (role === 'tool') {
      const callId = stringValue(message.tool_call_id)
      if (!callId || !inputCalls.has(callId) || resolvedCalls.has(callId)) throw new Error('tool messages must reference a preceding unresolved tool call')
      resolvedCalls.add(callId)
      history.push({
        ...base, kind: 'tool_result', role: 'tool', toolKind: 'tool_call',
        callId: stringValue(message.tool_call_id) || `call_${index}`,
        toolName: inputCalls.get(callId)!, output: extracted, isError: message.is_error === true
      })
    } else {
      history.push({ ...base, kind: 'user_message', role: 'user', text: extracted })
    }
  }
  return {
    threadId,
    turnId,
    model,
    providerId: providerId ?? LOCAL_MODEL_GATEWAY_PROVIDER_ID,
    systemPrompt,
    prefix: [],
    history,
    ...(attachments.length ? { attachments } : {}),
    ...(Object.keys(messageAttachments).length ? { messageAttachments } : {}),
    tools: requiredToolName ? tools.filter((tool) => tool.name === requiredToolName) : tools,
    ...(requiredToolName ? { requiredToolName } : {}),
    ...(typeof input.parallel_tool_calls === 'boolean' ? { parallelToolCalls: input.parallel_tool_calls } : {}),
    ...(format.type === 'json_object' ? { responseFormat: 'json_object' as const } : {}),
    stream: input.stream !== false,
    ...(maxTokens ? { maxTokens } : {}),
    ...(numberValue(input.top_p) !== undefined ? { topP: numberValue(input.top_p) } : {}),
    ...(numberValue(input.temperature) !== undefined ? { temperature: numberValue(input.temperature) } : {}),
    ...(stringValue(input.reasoning_effort) ? { reasoningEffort: stringValue(input.reasoning_effort) } : {}),
    abortSignal: signal
  }
}

function strictToolArguments(value: unknown): Record<string, unknown> {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { throw new Error('tool call arguments must be valid JSON') }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('tool call arguments must be an object')
  return parsed as Record<string, unknown>
}

export function responsesToChatInput(input: Record<string, unknown>, namespaces = new ResponsesToolNamespaces(input)): Record<string, unknown> {
  input = namespaces.input
  for (const field of ['previous_response_id', 'conversation', 'truncation']) {
    if (input[field] != null) throw new Error(`Responses ${field} is not supported by the local gateway`)
  }
  // This is an optional output expansion: the canonical model may not have any
  // encrypted state to return. Never invent provider-private replay tokens.
  if (input.include != null && (!Array.isArray(input.include) || input.include.some((entry) => entry !== 'reasoning.encrypted_content'))) {
    throw new Error('Requested Responses include expansion is not supported by the local gateway')
  }
  if (input.store === true || input.background === true) throw new Error('Stored or background Responses are not supported by the local gateway')
  const messages: Record<string, unknown>[] = []
  if (input.instructions != null) {
    if (typeof input.instructions !== 'string') throw new Error('instructions must be a string')
    messages.push({ role: 'system', content: input.instructions })
  }
  const raw = input.input
  if (typeof raw === 'string') messages.push({ role: 'user', content: raw })
  else if (Array.isArray(raw)) {
    for (const item of raw) {
      const record = asRecord(item)
      const type = stringValue(record.type)
      if (!type || type === 'message') {
        messages.push({ role: stringValue(record.role) || 'user', content: record.content })
      } else if (type === 'function_call') {
        if (!stringValue(record.call_id) || !stringValue(record.name)) throw new Error('function_call requires call_id and name')
        messages.push({ role: 'assistant', content: null, tool_calls: [{
          id: record.call_id, type: 'function', function: { name: record.name, arguments: record.arguments }
        }] })
      } else if (type === 'function_call_output') {
        if (!stringValue(record.call_id)) throw new Error('function_call_output requires call_id')
        messages.push({ role: 'tool', tool_call_id: record.call_id, content: record.output })
      } else if (type === 'reasoning') {
        // Clients (Codex) replay the reasoning items the gateway returned. Their
        // text goes back as reasoning history; encrypted_content is never issued
        // by the gateway, and real provider state is restored by tool-call id.
        const text = responsesReasoningText(record)
        if (text) messages.push({ role: 'assistant', content: null, reasoning_content: text })
      } else {
        throw new Error(`Responses input item '${type}' is not supported by the local gateway`)
      }
    }
  } else throw new Error('input must be a string or an array')
  const reasoning = asRecord(input.reasoning)
  if (reasoning.summary != null && !['auto', 'concise', 'detailed'].includes(String(reasoning.summary))) throw new Error('Unsupported reasoning.summary')
  const format = asRecord(asRecord(input.text).format)
  if (format.type && format.type !== 'text' && format.type !== 'json_object') throw new Error('Responses text.format is not supported by the local gateway')
  return { ...input, messages, tools: input.tools, max_tokens: input.max_output_tokens,
    reasoning_effort: reasoning.effort, response_format: format.type === 'json_object' ? format : undefined }
}

function responsesReasoningText(record: Record<string, unknown>): string {
  const parts: string[] = []
  for (const field of ['summary', 'content']) {
    const list = record[field]
    if (list == null) continue
    if (!Array.isArray(list)) throw new Error(`reasoning ${field} must be an array`)
    for (const entry of list) {
      const part = asRecord(entry)
      if (!['summary_text', 'reasoning_text'].includes(stringValue(part.type)) || typeof part.text !== 'string') {
        throw new Error(`reasoning ${field} entries must be summary_text or reasoning_text`)
      }
      if (part.text) parts.push(part.text)
    }
  }
  return parts.join('\n')
}

export function parseTools(value: unknown): ModelToolSpec[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 128) throw new Error('tools must be an array of at most 128 function tools')
  return value.map((raw) => {
    const tool = asRecord(raw)
    if (tool.type != null && tool.type !== 'function') throw new Error(`Tool type '${String(tool.type)}' is not supported by the local gateway`)
    if (tool.strict === true || asRecord(tool.function).strict === true) throw new Error('Strict tool schemas are not supported by the local gateway')
    const nested = asRecord(tool.function)
    const fn = stringValue(tool.type) === 'function' && Object.keys(nested).length > 0 ? nested : tool
    const name = stringValue(fn.name)
    if (!name) throw new Error('Every tool requires a name')
    const schema = fn.parameters ?? fn.input_schema
    if (schema != null && (typeof schema !== 'object' || Array.isArray(schema))) throw new Error('Tool parameters must be an object schema')
    return { name, description: stringValue(fn.description), inputSchema: asRecord(schema) }
  })
}

export function messageContent(value: unknown, attachments: NonNullable<ModelRequest['attachments']>, messageIndex: number): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (!Array.isArray(value)) throw new Error('message content must be a string or an array')
  const text: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const part = asRecord(value[index])
    const type = stringValue(part.type)
    if (['text', 'input_text', 'output_text'].includes(type)) {
      if (typeof part.text !== 'string') throw new Error('text content requires text')
      text.push(part.text)
      continue
    }
    if (type !== 'image_url' && type !== 'input_image') throw new Error(`Content type '${type}' is not supported by the local gateway`)
    const url = stringValue(asRecord(part.image_url).url) || stringValue(part.image_url)
    const match = /^data:(image\/[^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url)
    if (!match) throw new Error('gateway image inputs must use a base64 image data URL')
    attachments.push({ id: `gateway_image_${messageIndex}_${index}`, name: `image-${messageIndex}-${index}`, mimeType: match[1], dataBase64: match[2] })
  }
  return text.join('\n')
}

/**
 * The currently running turn for a grant's thread, per the admissionPending
 * convention shared with delegated runtimes. When no turn is running the
 * caller attributes usage at thread level only.
 */
export async function gatewayRunningTurnId(runtime: ServerRuntime, threadId: string): Promise<string | undefined> {
  const thread = await runtime.threadService.get(threadId).catch(() => undefined)
  return thread?.turns.find((turn) => turn.status === 'running' && !turn.admissionPending)?.id
}

/**
 * Persist usage observed on a grant-scoped request (docs/ade/04 §6): one
 * `source: 'harness-gateway'` event per completed call, counted into the
 * usage service with the grant's thread (and running turn, when present).
 * The event carries the service's cumulative snapshot so it lands on the
 * same persisted axis as native `usage` events.
 */
export async function recordHarnessGatewayUsage(
  runtime: ServerRuntime,
  grant: HarnessTokenGrant,
  resolved: { model: string; providerId?: string },
  usage: UsageSnapshot | undefined,
  turnId?: string
): Promise<void> {
  if (!usage || !hasUsage(usage)) return
  const cumulative = runtime.usageService.record(grant.threadId, usage, undefined, turnId)
  await runtime.events.record({
    kind: 'usage',
    threadId: grant.threadId,
    ...(turnId ? { turnId } : {}),
    model: usage.actualModelId ?? resolved.model,
    ...(usage.actualProviderId ?? resolved.providerId ? { providerId: usage.actualProviderId ?? resolved.providerId } : {}),
    source: 'harness-gateway',
    harnessId: grant.harnessId,
    usage: cumulative
  })
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (output == null) return ''
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

/**
 * Rough input-token estimate for a gateway ModelRequest, reusing the loop's
 * context-hygiene estimator (and its per-image flat estimate) so gateway
 * accounting matches how the runtime itself budgets context.
 */
export function estimateModelRequestTokens(request: ModelRequest): number {
  let tokens = estimateTokens(request.systemPrompt ?? '')
  for (const item of request.history) {
    if (item.kind === 'user_message' || item.kind === 'assistant_text') {
      tokens += estimateTokens(item.text)
    } else if (item.kind === 'tool_call') {
      tokens += estimateTokens(item.toolName) + estimateTokens(JSON.stringify(item.arguments ?? {}))
    } else if (item.kind === 'tool_result') {
      tokens += estimateTokens(stringifyToolOutput(item.output))
    }
  }
  for (const tool of request.tools) {
    tokens += estimateTokens(tool.name)
    tokens += estimateTokens(tool.description ?? '')
    tokens += estimateTokens(JSON.stringify(tool.inputSchema ?? {}))
  }
  if (request.attachments?.length) {
    tokens += request.attachments.length * IMAGE_TOOL_RESULT_TOKEN_ESTIMATE
  }
  return tokens
}
