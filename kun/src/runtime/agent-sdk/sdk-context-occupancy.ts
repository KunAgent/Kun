/**
 * What the Claude Agent SDK tells us about the context window, taken from the
 * stream it already emits: the usage of the last main-thread model request is
 * the real occupancy of the context, and the terminal `result` message carries
 * the real window of every model that served the query (`modelUsage`).
 * Neither needs a control request, so this also works for single-turn queries
 * whose stdin is already closed when `result` arrives.
 */
export type SdkContextOccupancy = {
  /** Prompt (input + cache reads/writes) plus the reply of the last main request. */
  usedTokens: number
  /** Real window reported by the SDK; absent when it cannot be matched safely. */
  contextWindowTokens?: number
}

type LastRequest = { model?: string; usedTokens: number }

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

export class SdkContextOccupancyTracker {
  private last?: LastRequest
  private readonly windows = new Map<string, number>()

  observe(message: { type?: unknown; [key: string]: unknown }): void {
    if (message.type === 'assistant') this.observeAssistant(message)
    else if (message.type === 'result') this.observeResult(message)
  }

  snapshot(): SdkContextOccupancy | undefined {
    if (!this.last) return undefined
    const { model, usedTokens } = this.last
    // `message.model` is the raw id the request was sent with, which is also the
    // key `modelUsage` uses. With a single reported model an alias mismatch is
    // still unambiguous; with several, guessing would pick the wrong window.
    const window = (model ? this.windows.get(model) : undefined) ??
      (this.windows.size === 1 ? [...this.windows.values()][0] : undefined)
    return { usedTokens, ...(window ? { contextWindowTokens: window } : {}) }
  }

  private observeAssistant(message: { [key: string]: unknown }): void {
    // Subagent requests run in their own context window.
    if (message.parent_tool_use_id) return
    const api = message.message as { model?: unknown; usage?: Record<string, unknown> } | undefined
    const usage = api?.usage
    if (!usage) return
    const usedTokens =
      count(usage.input_tokens) +
      count(usage.cache_read_input_tokens) +
      count(usage.cache_creation_input_tokens) +
      count(usage.output_tokens)
    if (usedTokens <= 0) return
    this.last = {
      ...(typeof api?.model === 'string' ? { model: api.model } : {}),
      usedTokens
    }
  }

  private observeResult(message: { [key: string]: unknown }): void {
    const modelUsage = message.modelUsage
    if (!modelUsage || typeof modelUsage !== 'object') return
    for (const [model, entry] of Object.entries(modelUsage)) {
      const window = count((entry as { contextWindow?: unknown } | null)?.contextWindow)
      if (window > 0) this.windows.set(model, window)
    }
  }
}

/**
 * The SDK reports one real figure for the whole request. Kun can only
 * attribute what it supplied itself (bridged tools, system prompt, skills), so
 * those estimates are clamped to the real total and the rest — Claude Code's
 * own prompt and tools plus the native history — is reported as `messages`.
 */
export function attributeSdkContext(
  estimates: { tools: number; system: number; skills: number },
  usedTokens: number
): { tools: number; system: number; skills: number; messages: number; other: number } {
  const tools = Math.min(estimates.tools, usedTokens)
  const system = Math.min(estimates.system, usedTokens - tools)
  const skills = Math.min(estimates.skills, usedTokens - tools - system)
  return { tools, system, skills, messages: usedTokens - tools - system - skills, other: 0 }
}

export type SdkContextProfile = {
  contextWindowTokens: number
  softThresholdTokens: number
  hardThresholdTokens: number
}

/**
 * Re-base a profile on the window the SDK actually reported, keeping its
 * threshold ratios, so a stale or conservative configured window never pairs
 * with thresholds computed for a different one.
 */
export function rebaseContextProfile(profile: SdkContextProfile, window: number): SdkContextProfile {
  if (window === profile.contextWindowTokens) return profile
  const ratio = window / profile.contextWindowTokens
  const rebase = (tokens: number): number => Math.max(1, Math.min(window, Math.round(tokens * ratio)))
  return {
    contextWindowTokens: window,
    softThresholdTokens: rebase(profile.softThresholdTokens),
    hardThresholdTokens: rebase(profile.hardThresholdTokens)
  }
}
