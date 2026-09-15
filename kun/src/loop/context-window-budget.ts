import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  resolveModelContextProfile,
  type ModelContextProfile
} from './model-context-profile.js'
import { ordinaryOutputReserveTokens } from './model-request-composer.js'

export const CONTEXT_WINDOW_USAGE_THRESHOLDS = [0.25, 0.5, 0.75] as const
const OUTPUT_RESERVE_CAP_RATIO = 0.85
const CHARS_PER_TOKEN = 4

export type WindowBudgetState = {
  threadId: string
  windowId: string
  windowSeq: number
  model: string
  /** Effective capacity from the model profile. */
  capacityTokens: number
  /** Tokens consumed by emitted budget/threshold notices; they count into the budget. */
  noticeTokens: number
  /** Threshold fractions already announced for this window. */
  coveredThresholds: readonly number[]
  /** Provider-reported actual input tokens from the latest same-window response. */
  lastActualInputTokens: number | null
  updatedAt: string
}

export type WindowUsageSample = {
  /** Complete request estimate: system, tools, dynamic context, attachments, messages. */
  estimatedInputTokens: number
  /** Explicit output reservation; defaults to the bounded ordinary reserve. */
  outputReserveTokens?: number
  /** Provider actual input tokens for the latest same-window request (calibration only). */
  actualInputTokens?: number
}

export type WindowUsageReading = {
  usageRatio: number
  remainingTokens: number
  effectiveInputTokens: number
  outputReserveTokens: number
}

export type WindowThresholdNotice = WindowUsageReading & {
  notice: string | null
  /** The single highest threshold announced by this notice, if any. */
  threshold: number | null
}

/**
 * Per-window budget for the opt-in window-mode strategy. The budget is the
 * model profile's effective capacity minus the complete current request
 * estimate (including the output reservation and previously emitted notices),
 * floored at zero. The 25/50/75 percent thresholds each fire at most once per
 * window; crossing several thresholds in one request announces only the
 * highest and marks the lower ones covered. Provider actual usage calibrates
 * the reading but cumulative cross-window billing tokens are never used.
 */
export class ContextWindowBudget {
  private readonly profiles: readonly ModelContextProfile[]
  private readonly nowIso: () => string
  private readonly states = new Map<string, WindowBudgetState>()

  constructor(deps: { profiles?: readonly ModelContextProfile[]; nowIso?: () => string } = {}) {
    this.profiles = deps.profiles ?? []
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
  }

  private key(threadId: string, windowId: string): string {
    return `${threadId}${windowId}`
  }

  capacityFor(model: string): number {
    return resolveModelContextProfile(model, this.profiles)?.contextWindowTokens ??
      DEFAULT_CONTEXT_WINDOW_TOKENS
  }

  outputReserveFor(model: string, inputTokens: number): number {
    const profile = resolveModelContextProfile(model, this.profiles)
    const capacity = profile?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS
    return ordinaryOutputReserveTokens({
      inputTokens: Math.max(0, Math.floor(inputTokens)),
      contextCapTokens: Math.floor(capacity * OUTPUT_RESERVE_CAP_RATIO),
      ...(profile?.maxOutputTokens ? { declaredMaxOutputTokens: profile.maxOutputTokens } : {})
    })
  }

  startWindow(input: {
    threadId: string
    windowId: string
    windowSeq: number
    model: string
    capacityTokens?: number
  }): WindowBudgetState {
    const state: WindowBudgetState = {
      threadId: input.threadId,
      windowId: input.windowId,
      windowSeq: Math.max(0, Math.floor(input.windowSeq)),
      model: input.model,
      capacityTokens: Math.max(1, Math.floor(
        input.capacityTokens ?? this.capacityFor(input.model)
      )),
      noticeTokens: 0,
      coveredThresholds: [],
      lastActualInputTokens: null,
      updatedAt: this.nowIso()
    }
    this.states.set(this.key(input.threadId, input.windowId), state)
    return state
  }

  /**
   * The live state record for a window. Callers MUST treat it as read-only
   * except through `thresholdNotice`/`switchModel`, which own the mutation so
   * per-window dedup marks stay authoritative.
   */
  stateFor(threadId: string, windowId: string): WindowBudgetState | undefined {
    return this.states.get(this.key(threadId, windowId))
  }

  /**
   * Record a model switch inside the window: capacity and reservations are
   * recomputed from the new model; covered threshold marks stay per window.
   */
  switchModel(
    threadId: string,
    windowId: string,
    model: string,
    capacityTokens?: number
  ): WindowBudgetState | undefined {
    const state = this.states.get(this.key(threadId, windowId))
    if (!state) return undefined
    state.model = model
    state.capacityTokens = Math.max(1, Math.floor(capacityTokens ?? this.capacityFor(model)))
    state.updatedAt = this.nowIso()
    return { ...state, coveredThresholds: [...state.coveredThresholds] }
  }

  /** Pure usage reading; does not mutate covered thresholds. */
  readUsage(state: WindowBudgetState, sample: WindowUsageSample): WindowUsageReading {
    const effectiveInputTokens = Math.max(0, Math.floor(
      sample.actualInputTokens ?? sample.estimatedInputTokens
    ))
    const outputReserveTokens = Math.max(0, Math.floor(
      sample.outputReserveTokens ?? this.outputReserveFor(state.model, effectiveInputTokens)
    ))
    const used = effectiveInputTokens + outputReserveTokens + state.noticeTokens
    const remainingTokens = Math.max(0, state.capacityTokens - used)
    const usageRatio = state.capacityTokens > 0
      ? Math.min(1, used / state.capacityTokens)
      : 1
    return { usageRatio, remainingTokens, effectiveInputTokens, outputReserveTokens }
  }

  /**
   * Evaluate one request against the window budget and emit at most one
   * threshold notice. Queued input, tool output, and model switches simply
   * call this again with a fresh estimate; dedup is per window.
   */
  thresholdNotice(state: WindowBudgetState, sample: WindowUsageSample): WindowThresholdNotice {
    if (sample.actualInputTokens !== undefined) {
      state.lastActualInputTokens = Math.max(0, Math.floor(sample.actualInputTokens))
    }
    const reading = this.readUsage(state, sample)
    const crossed = CONTEXT_WINDOW_USAGE_THRESHOLDS.filter(
      (threshold) => reading.usageRatio >= threshold &&
        !state.coveredThresholds.includes(threshold)
    )
    if (crossed.length === 0) {
      return { ...reading, notice: null, threshold: null }
    }
    const announced = crossed[crossed.length - 1]!
    state.coveredThresholds = [...state.coveredThresholds, ...crossed]
    const notice = renderThresholdNotice({
      windowSeq: state.windowSeq,
      threshold: announced,
      usageRatio: reading.usageRatio,
      remainingTokens: reading.remainingTokens
    })
    state.noticeTokens += estimateNoticeTokens(notice)
    state.updatedAt = this.nowIso()
    return { ...reading, notice, threshold: announced }
  }

  /** Persist/restore seam for resume: threshold marks survive a restart. */
  snapshot(): WindowBudgetState[] {
    return [...this.states.values()].map((state) => ({
      ...state,
      coveredThresholds: [...state.coveredThresholds]
    }))
  }

  restore(states: readonly WindowBudgetState[]): void {
    this.states.clear()
    for (const state of states) {
      this.states.set(this.key(state.threadId, state.windowId), {
        ...state,
        coveredThresholds: [...state.coveredThresholds]
      })
    }
  }
}

export function renderThresholdNotice(input: {
  windowSeq: number
  threshold: number
  usageRatio: number
  remainingTokens: number
}): string {
  const percent = Math.round(input.usageRatio * 100)
  const hint = input.threshold >= 0.75
    ? 'Consider saving working notes and starting a fresh window with new_context when the current step completes.'
    : 'Consider trimming tool output or saving progress notes.'
  return `[context window ${input.windowSeq}: ${percent}% used ` +
    `(${(input.remainingTokens / 1000).toFixed(0)}k tokens remaining). ${hint}]`
}

function estimateNoticeTokens(notice: string): number {
  return Math.max(1, Math.ceil(notice.length / CHARS_PER_TOKEN))
}
