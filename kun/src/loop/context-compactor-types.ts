export type CompactionMode = 'normal' | 'aggressive' | 'force'

/**
 * Provider `prompt_tokens` is trusted only while it stays within this multiple
 * of our local estimate of the sent request. Beyond it the count is treated as
 * a provider accounting artifact (e.g. MiniMax-M3 summing cumulative cache
 * reads into prompt_tokens) and ignored in favour of the estimate. The factor
 * is wide enough to absorb legitimate under-counting (image tool results,
 * formatting/role tokens) while still catching the order-of-magnitude inflation
 * that strands a thread at "100%".
 */
export const PROMPT_TOKEN_TRUST_FACTOR = 6

export type CompactionPlan = {
  mode: CompactionMode
  keepRecent: number
  reason: string
}

export type CompactionTriggerOptions = {
  model?: string
  providerId?: string
  /** Provider-reported prompt token count for the last request, when known. */
  promptTokens?: number
  frozenMessageCount?: number
  /**
   * Estimated per-request overhead (system prompt + tool schemas + few-shot
   * prefix) that is not part of the stored items. Added to the item estimate
   * as a safety floor for the no-usage path. Ignored when a larger
   * `promptTokens` is available.
   */
  overheadTokens?: number
  /**
   * Exact local input-token estimate of the already-constructed request
   * (history + dynamic context + attachments + tools). Acts as a floor on
   * the input pressure; it never replaces provider usage or the stored-item
   * estimate, it just prevents the compaction heuristic from under-counting
   * parts of the request that are not part of the stored history.
   */
  requestInputTokens?: number
  /**
   * Tokens reserved for the model output on this request. When combined with
   * `requestHardCapTokens` it lets compaction fire *before* the send-time
   * `input + output` guard rejects the request, closing the dead zone where
   * input is below the soft threshold but the full budget is over the cap.
   */
  outputBudgetTokens?: number
  /**
   * Same hard cap used by the send-time guard (`input + output` may not
   * exceed it). Only when both this and `outputBudgetTokens` are present
   * does the budget-driven force compaction apply.
   */
  /** Independent model maximum input, excluding the output reservation. */
  requestMaxInputTokens?: number
  requestHardCapTokens?: number
}
