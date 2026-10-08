import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import type { UsageSnapshot } from '../contracts/usage.js'

/**
 * Streaming speed of a delegated Agent, measured by Kun at the moment each
 * notification arrives (not when it is persisted: the recorder queue adds
 * milliseconds per delta). An Agent reports tokens per call or per turn but
 * never when it generated them, so the numbers here come from its output
 * stream:
 *
 * - TTFT: from the instant the prompt reached the Agent (or its last tool
 *   finished) to the first non-empty text/reasoning delta. A call that opens
 *   with a tool call has no clean first token and yields no sample.
 * - Generation: only the time the stream was actually flowing. Deltas closer
 *   than `BURST_GAP_MS` form a burst; a pause, a tool call or the end of the
 *   window closes it. The first delta of a burst only marks its start, so its
 *   tokens (generated before that instant) are excluded from the numerator.
 *   Tokens are estimated from the streamed text and capped by the usage the
 *   Agent reported for the same window, so a bad estimate cannot inflate the
 *   rate; hidden reasoning, tool arguments and several model calls per turn
 *   cannot either, because only streamed text is counted.
 */
const BURST_GAP_MS = 2_000
const MIN_GENERATION_MS = 250
const MIN_GENERATION_TOKENS = 12
const MAX_TOKENS_PER_SECOND = 3_000
const MAX_TRACKERS = 64

export type HarnessTimingSample = Pick<
  UsageSnapshot,
  'requestTtftMs' | 'requestGenerationMs' | 'requestGenerationTokens'
>

type Burst = { startedAt: number; lastAt: number; tokens: number }

/** Rough token count of streamed text: Han/kana/hangul ~1.1 tokens per char, other scripts ~2 chars, ASCII ~3.5 chars. */
export function estimateStreamedTokens(text: string): number {
  let han = 0
  let wide = 0
  let ascii = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) ascii += 1
    else if (
      (code >= 0x2e80 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) || code >= 0x20000
    ) han += 1
    else wide += 1
  }
  return han * 1.1 + wide * 0.5 + ascii / 3.5
}

export class HarnessTurnTiming {
  /** A model call is in flight since this instant and has produced nothing yet. */
  private armedAt: number | null = null
  private ttftMs: number | undefined
  private burst: Burst | null = null
  private generationMs = 0
  private generationTokens = 0

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** The prompt was handed to the Agent. */
  requestStarted(): void {
    this.armedAt = this.now()
  }

  /**
   * Feed the drafts a runtime just mapped from one notification, in arrival
   * order. Usage drafts are stamped in place with the window measured so far.
   */
  observe(drafts: readonly RuntimeEventDraft[]): void {
    for (const draft of drafts) {
      switch (draft.kind) {
        case 'assistant_text_delta':
        case 'assistant_reasoning_delta':
          this.delta(deltaText(draft))
          break
        case 'tool_call_ready':
        case 'tool_call_started':
          this.closeBurst()
          this.armedAt = null
          break
        case 'tool_call_finished':
          this.closeBurst()
          this.armedAt = this.now()
          break
        case 'usage':
          this.stamp(draft)
          break
        default:
          break
      }
    }
  }

  private delta(text: string): void {
    if (!text) return
    const at = this.now()
    if (this.armedAt !== null) {
      this.ttftMs ??= Math.max(0, at - this.armedAt)
      this.armedAt = null
    }
    const tokens = estimateStreamedTokens(text)
    if (this.burst && at - this.burst.lastAt <= BURST_GAP_MS) {
      this.burst.tokens += tokens
      this.burst.lastAt = at
    } else {
      this.closeBurst()
      this.burst = { startedAt: at, lastAt: at, tokens: 0 }
    }
  }

  private closeBurst(): void {
    if (!this.burst) return
    this.generationMs += this.burst.lastAt - this.burst.startedAt
    this.generationTokens += this.burst.tokens
    this.burst = null
  }

  private stamp(draft: Extract<RuntimeEventDraft, { kind: 'usage' }>): void {
    this.closeBurst()
    // Streamed reasoning counts as generation, and some Agents report it apart
    // from the completion (ACP `thoughtTokens`), so the ceiling is both.
    const reported = draft.usage.completionTokens + (draft.usage.reasoningTokens ?? 0)
    const sample = this.drain(reported)
    if (sample) draft.usage = { ...draft.usage, ...sample }
  }

  private drain(reportedTokens: number): HarnessTimingSample | undefined {
    const sample: HarnessTimingSample = {}
    if (this.ttftMs !== undefined) sample.requestTtftMs = Math.round(this.ttftMs)
    const tokens = reportedTokens > 0
      ? Math.min(this.generationTokens, reportedTokens)
      : this.generationTokens
    if (
      this.generationMs >= MIN_GENERATION_MS &&
      tokens >= MIN_GENERATION_TOKENS &&
      tokens / (this.generationMs / 1_000) <= MAX_TOKENS_PER_SECOND
    ) {
      sample.requestGenerationMs = Math.round(this.generationMs)
      sample.requestGenerationTokens = Math.round(tokens)
    }
    this.ttftMs = undefined
    this.generationMs = 0
    this.generationTokens = 0
    return Object.keys(sample).length ? sample : undefined
  }
}

function deltaText(draft: RuntimeEventDraft): string {
  const text = (draft as { item?: { text?: unknown } }).item?.text
  return typeof text === 'string' ? text : ''
}

const trackers = new Map<string, HarnessTurnTiming>()
let clock: (() => number) | undefined

/** Test seam: replace the monotonic clock of trackers created afterwards. */
export function setHarnessTimingClock(now: (() => number) | undefined): void {
  clock = now
  trackers.clear()
}

/**
 * The timing tracker of one turn. Runtimes share it by id, so the code that
 * sees a notification and the code that later records the turn's usage need
 * no common object. Bounded: an abandoned turn is simply evicted.
 */
export function harnessTurnTiming(threadId: string, turnId: string): HarnessTurnTiming {
  const key = `${threadId}\u0000${turnId}`
  const existing = trackers.get(key)
  if (existing) {
    trackers.delete(key)
    trackers.set(key, existing)
    return existing
  }
  const created = new HarnessTurnTiming(clock)
  trackers.set(key, created)
  if (trackers.size > MAX_TRACKERS) trackers.delete(trackers.keys().next().value!)
  return created
}
