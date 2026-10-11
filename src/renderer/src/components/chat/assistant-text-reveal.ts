const FRAME_MS = 1000 / 60
const REVEAL_HORIZON_MS = 120
export const MAX_REVEAL_DELAY_MS = 200
export const MAX_REVEAL_BACKLOG = 2048

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

export type TextRevealState = {
  text: string
  streaming: boolean
  visibleLength: number
  pendingSince: number | null
  lastFrameAt: number | null
}

/** First sight of history, including an in-progress reply, is already revealed. */
export function createTextReveal(text: string, streaming: boolean): TextRevealState {
  return { text, streaming, visibleLength: text.length, pendingSince: null, lastFrameAt: null }
}

export function completeTextReveal(state: TextRevealState): TextRevealState {
  if (state.visibleLength === state.text.length && state.pendingSince === null) return state
  return createTextReveal(state.text, state.streaming)
}

export function retargetTextReveal(
  state: TextRevealState,
  text: string,
  streaming: boolean,
  now: number,
  hidden: boolean
): TextRevealState {
  if (state.text === text && state.streaming === streaming) {
    return hidden ? completeTextReveal(state) : state
  }
  // Catch-up snapshots, resets and phase changes establish a new baseline.
  // Only ordinary append-only live growth should spend time in the reveal queue.
  if (
    !streaming || state.streaming !== streaming || hidden ||
    !text.startsWith(state.text) || text.length - state.visibleLength >= MAX_REVEAL_BACKLOG
  ) return createTextReveal(text, streaming)

  return {
    text,
    streaming,
    visibleLength: state.visibleLength,
    pendingSince: state.pendingSince ?? now,
    lastFrameAt: state.lastFrameAt ?? now
  }
}

export function nextVisibleLength(current: number, target: number, elapsedMs = FRAME_MS): number {
  if (current >= target) return target
  const backlog = target - current
  if (backlog >= MAX_REVEAL_BACKLOG || elapsedMs >= MAX_REVEAL_DELAY_MS) return target
  if (elapsedMs <= 0) return current
  return Math.min(target, current + Math.max(1, Math.ceil(backlog * elapsedMs / REVEAL_HORIZON_MS)))
}

function nextTextBoundary(text: string, visibleLength: number): number {
  const length = Math.max(0, Math.min(visibleLength, text.length))
  if (length === 0 || length === text.length) return length
  // Indexed lookup avoids walking all preceding graphemes on every frame of a
  // long reply. Without Segmenter, prefer complete text over broken clusters.
  const segment = graphemeSegmenter?.segment(text).containing(length - 1)
  return segment ? segment.index + segment.segment.length : text.length
}

export function visibleTextForTypewriter(text: string, visibleLength: number): string {
  return text.slice(0, nextTextBoundary(text, visibleLength))
}

export function advanceTextReveal(state: TextRevealState, now: number): TextRevealState {
  if (state.pendingSince === null || state.lastFrameAt === null) return state
  // Bound the age of the oldest pending text, even if new deltas keep arriving.
  // A delayed frame or timer must not turn a completed burst into seconds of typing.
  if (now - state.pendingSince >= MAX_REVEAL_DELAY_MS) return completeTextReveal(state)
  const nextLength = nextVisibleLength(state.visibleLength, state.text.length, now - state.lastFrameAt)
  const visibleLength = nextTextBoundary(state.text, nextLength)
  if (visibleLength >= state.text.length) return completeTextReveal(state)
  return { ...state, visibleLength, lastFrameAt: now }
}
