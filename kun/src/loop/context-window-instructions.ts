import type { TurnItem } from '../contracts/items.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ResolvedTurnAttachments } from './turn-execution-types.js'
import type {
  ModelHistoryRoute,
  ModelToolSpec
} from '../ports/model-client.js'
import type { TokenEconomyConfig } from './token-economy.js'
import { composeModelRequest } from './model-request-composer.js'

/** Durable per-window initialization items are keyed by this id prefix. */
export const WINDOW_INIT_ITEM_PREFIX = 'cw_init_'

/**
 * Model-visible window context for one request: the durable initialization
 * of the active window (persisted after each transition) plus one transient
 * budget notice. Only initialization items after the LATEST window boundary
 * are collected, so a stale window's context never leaks into the new one.
 * Everything here is injected after the immutable system prefix.
 */
export function collectWindowContextInstructions(
  history: readonly TurnItem[],
  notice?: string
): string[] {
  const instructions: string[] = []
  let boundaryIndex = -1
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.kind === 'context_window') {
      boundaryIndex = index
      break
    }
  }
  for (const item of history.slice(boundaryIndex + 1)) {
    if (
      item.kind === 'runtime_context_source' &&
      item.id.startsWith(WINDOW_INIT_ITEM_PREFIX) &&
      item.contextKind === 'host-control'
    ) {
      instructions.push(item.content)
    }
  }
  if (notice?.trim()) instructions.push(notice)
  return instructions
}

export type WindowPreflightEstimateInput = {
  threadId: string
  turnId: string
  model: string
  providerId?: string
  accountId?: string
  reasoningEffort?: string
  serviceTier?: 'priority'
  promptCachePartition: string
  immutablePrefix: ImmutablePrefix
  threadSystemPrompt?: string
  modeInstruction?: string
  contextInstructions: readonly string[]
  redactedRequestValues?: readonly string[]
  historyRoutesByTurnId?: Readonly<Record<string, ModelHistoryRoute>>
  attachments: ResolvedTurnAttachments
  tools: readonly ModelToolSpec[]
  requiredToolName?: string
  tokenEconomy?: TokenEconomyConfig
  signal: AbortSignal
}

/**
 * Pre-send capacity estimates for the compaction preflight. The overhead
 * pass (empty history) is the non-history floor the compaction service has
 * always used; the full pass adds the current history so window-mode budget
 * thresholds see the real upcoming request size instead of zero.
 */
export function composeWindowPreflightEstimates(
  input: WindowPreflightEstimateInput & { history: readonly TurnItem[] }
): { requestOverheadTokens: number; requestInputTokens: number } {
  const base = {
    threadId: input.threadId,
    turnId: input.turnId,
    model: input.model,
    providerId: input.providerId,
    accountId: input.accountId,
    reasoningEffort: input.reasoningEffort,
    serviceTier: input.serviceTier,
    promptCachePartition: input.promptCachePartition,
    immutablePrefix: input.immutablePrefix,
    threadSystemPrompt: input.threadSystemPrompt,
    modeInstruction: input.modeInstruction,
    contextInstructions: [...input.contextInstructions],
    redactedRequestValues: input.redactedRequestValues,
    historyRoutesByTurnId: input.historyRoutesByTurnId,
    attachments: input.attachments,
    tools: input.tools,
    requiredToolName: input.requiredToolName,
    tokenEconomy: input.tokenEconomy,
    signal: input.signal
  }
  const requestOverheadTokens = composeModelRequest({ ...base, history: [] }).sentInputTokens
  const requestInputTokens = composeModelRequest({ ...base, history: [...input.history] }).sentInputTokens
  return { requestOverheadTokens, requestInputTokens }
}
