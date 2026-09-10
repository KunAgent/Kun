import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import type {
  ModelHistoryRoute,
  ModelRequest,
  ModelToolSpec
} from '../ports/model-client.js'
import type { ResolvedTurnAttachments } from './turn-execution-types.js'
import {
  applyTokenEconomyToRequest,
  normalizeTokenEconomyConfig,
  type NormalizedTokenEconomyConfig,
  type TokenEconomyConfig
} from './token-economy.js'
import { applyRequestHistoryHygiene } from './request-history-hygiene.js'
import { estimateModelRequestInputTokens } from './model-request-estimator.js'
import { capToolResultImages } from './tool-result-image.js'
import { buildThreadProfileInstruction } from '../prompt/kun-prompt-context.js'

const MAX_FORWARDED_TOOL_IMAGES = 3

export const DEFAULT_EFFECTIVE_OUTPUT_BUDGET_TOKENS = 32_768

/**
 * Output budget actually forwarded as the request's `max_tokens`. A configured
 * model limit is authoritative and is only clamped to the remaining safe
 * context capacity, so raising "max output" in provider settings takes effect
 * instead of silently stopping at the runtime default. Omitting the declaration
 * falls back to {@link DEFAULT_EFFECTIVE_OUTPUT_BUDGET_TOKENS}.
 */
export function effectiveOutputBudgetTokens(input: {
  inputTokens: number
  contextCapTokens: number
  declaredMaxOutputTokens?: number
  fallbackTokens?: number
}): number {
  const fallback = Math.max(1, Math.floor(input.fallbackTokens ?? DEFAULT_EFFECTIVE_OUTPUT_BUDGET_TOKENS))
  const declared = input.declaredMaxOutputTokens === undefined
    ? fallback
    : Math.max(1, Math.floor(input.declaredMaxOutputTokens))
  const remaining = Math.max(1, Math.floor(input.contextCapTokens - input.inputTokens))
  return Math.min(declared, remaining)
}

/**
 * Output budget reserved by the compaction preflight. `maxOutputTokens` is
 * provider capability metadata, and some catalogs advertise the whole context
 * window (e.g. 500k), so reserving the declared value in full would make
 * `input + output > hard cap` true on every request and force compaction
 * endlessly. Keep this ordinary reservation bounded by the runtime default;
 * the value actually sent as `max_tokens` comes from
 * {@link effectiveOutputBudgetTokens} and is still clamped to the remaining
 * safe context capacity.
 */
export function ordinaryOutputReserveTokens(input: {
  inputTokens: number
  contextCapTokens: number
  declaredMaxOutputTokens?: number
  fallbackTokens?: number
}): number {
  const fallback = Math.max(1, Math.floor(input.fallbackTokens ?? DEFAULT_EFFECTIVE_OUTPUT_BUDGET_TOKENS))
  const declared = input.declaredMaxOutputTokens === undefined
    ? fallback
    : Math.max(1, Math.floor(input.declaredMaxOutputTokens))
  const remaining = Math.max(1, Math.floor(input.contextCapTokens - input.inputTokens))
  return Math.min(declared, fallback, remaining)
}

export type ModelRequestComposerInput = Readonly<{
  threadId: string
  turnId: string
  model: string
  providerId?: string
  accountId?: string
  reasoningEffort?: string
  serviceTier?: 'priority'
  promptCachePartition?: string
  immutablePrefix: ImmutablePrefix
  threadSystemPrompt?: string
  modeInstruction?: string
  contextInstructions: readonly string[]
  redactedRequestValues?: readonly string[]
  history: readonly TurnItem[]
  historyRoutesByTurnId?: Readonly<Record<string, ModelHistoryRoute>>
  attachments: ResolvedTurnAttachments
  tools: readonly ModelToolSpec[]
  requiredToolName?: string
  messageAttachments?: ModelRequest['messageAttachments']
  tokenEconomy?: TokenEconomyConfig
  signal: AbortSignal
}>

export type ComposedModelRequest = Readonly<{
  request: ModelRequest
  rawInputTokens: number
  sentInputTokens: number
  tokenEconomy: NormalizedTokenEconomyConfig
}>

/**
 * Pure send-time request construction. The ordering is load-bearing: image
 * payloads are capped first, token-economy transforms run next, and history
 * hygiene is the final boundary before token estimation and model transport.
 */
export function composeModelRequest(input: ModelRequestComposerInput): ComposedModelRequest {
  const tokenEconomy = normalizeTokenEconomyConfig(input.tokenEconomy)
  const threadProfileInstruction = buildThreadProfileInstruction(input.threadSystemPrompt)
  const baseRequest: ModelRequest = {
    threadId: input.threadId,
    turnId: input.turnId,
    model: input.model,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    systemPrompt: input.immutablePrefix.systemPrompt,
    ...(threadProfileInstruction ? { threadProfileInstruction } : {}),
    ...(input.modeInstruction ? { modeInstruction: input.modeInstruction } : {}),
    ...(input.contextInstructions.length
      ? { contextInstructions: [...input.contextInstructions] }
      : {}),
    ...(input.redactedRequestValues?.length
      ? { redactedRequestValues: [...input.redactedRequestValues] }
      : {}),
    prefix: input.immutablePrefix.fewShots,
    history: capToolResultImages([...input.history], MAX_FORWARDED_TOOL_IMAGES),
    ...(input.historyRoutesByTurnId ? { historyRoutesByTurnId: input.historyRoutesByTurnId } : {}),
    ...(input.attachments.imageAttachments.length
      ? { attachments: [...input.attachments.imageAttachments] }
      : {}),
    ...(input.attachments.textFallbacks.length
      ? { attachmentTextFallbacks: [...input.attachments.textFallbacks] }
      : {}),
    ...(input.attachments.documents.length
      ? { attachmentDocuments: [...input.attachments.documents] }
      : {}),
    ...(input.messageAttachments
      ? { messageAttachments: input.messageAttachments }
      : {}),
    tools: [...input.tools],
    ...(input.requiredToolName ? { requiredToolName: input.requiredToolName } : {}),
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    ...(input.promptCachePartition
      ? { promptCachePartition: input.promptCachePartition }
      : {}),
    abortSignal: input.signal
  }
  const rawInputTokens = tokenEconomy.enabled
    ? estimateModelRequestInputTokens(baseRequest)
    : 0
  const economyRequest = applyTokenEconomyToRequest(baseRequest, tokenEconomy)
  const request: ModelRequest = {
    ...economyRequest,
    history: applyRequestHistoryHygiene(
      economyRequest.history,
      tokenEconomy.historyHygiene,
      { currentTurnId: input.turnId }
    )
  }
  return {
    request,
    rawInputTokens,
    sentInputTokens: estimateModelRequestInputTokens(request),
    tokenEconomy
  }
}
