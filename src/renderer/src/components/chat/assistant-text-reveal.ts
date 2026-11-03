/**
 * Paces live assistant text and records when each newly shown grapheme was
 * born, so the renderer can fade in only the in-flight tail.
 *
 * The rhythm reveals toward the measured arrival rate while holding a small
 * lag buffer, then drains the buffer once input goes idle. A network stall
 * keeps text flowing out of the buffer and a burst is spread over several
 * commits instead of painting each chunk the moment it lands.
 */

export const STREAM_FADE_MS = 180
/** Catch-up snapshots this large are shown at once, without pacing or fades. */
export const MAX_REVEAL_BACKLOG = 2048
/** A finished reply keeps revealing its buffered tail for at most this long. */
export const MAX_FINISH_MS = 1000

const RHYTHM = {
  activeInputWindowMs: 220,
  defaultCps: 38,
  emaAlpha: 0.2,
  flushCps: 120,
  largeAppendChars: 120,
  maxActiveCps: 132,
  maxCps: 72,
  maxFlushCps: 280,
  minCommitIntervalMs: 48,
  minCps: 18,
  settleAfterMs: 360,
  settleDrainMaxMs: 520,
  settleDrainMinMs: 180,
  targetBufferMs: 120
} as const
const MAX_COMMIT_INTERVAL_MS = 96
const COMMIT_INTERVAL_TAIL_UNITS = 256
const MIN_CHAR_PACE_MS = 2
const MAX_CHAR_PACE_MS = 18
const MAX_REVEAL_GAP_MS = 160
/** A single append up to this size still fades in as a quick wave; larger ones appear at once. */
const MAX_FADED_APPEND = 600

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

export type RevealBirth = { offset: number; birth: number }

export type TextRevealState = {
  text: string
  streaming: boolean
  visibleLength: number
  /** Revealed grapheme starts whose fade may still be running, in offset order. */
  fading: readonly RevealBirth[]
  emaCps: number
  chunkEma: number
  arrivalEma: number
  lastInputAt: number
  lastInputLength: number
  /** Commit clock; null while paused, so the next frame only primes it. */
  lastFrameAt: number | null
  lastCommitAt: number
  wakeAt: number
  /** When live input stopped with text still buffered or fading. */
  endedAt: number | null
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** First sight of history, including an in-progress reply, is already revealed. */
export function createTextReveal(text: string, streaming: boolean, now = 0): TextRevealState {
  return {
    text,
    streaming,
    visibleLength: text.length,
    fading: [],
    emaCps: RHYTHM.defaultCps,
    chunkEma: 1,
    arrivalEma: RHYTHM.defaultCps,
    lastInputAt: now,
    lastInputLength: text.length,
    lastFrameAt: null,
    lastCommitAt: now,
    wakeAt: 0,
    endedAt: null
  }
}

export function isTextRevealActive(state: TextRevealState): boolean {
  return state.visibleLength < state.text.length || state.fading.length > 0
}

export function completeTextReveal(state: TextRevealState): TextRevealState {
  if (!isTextRevealActive(state) && state.lastFrameAt === null && state.endedAt === null) return state
  return {
    ...state,
    visibleLength: state.text.length,
    fading: [],
    lastFrameAt: null,
    wakeAt: 0,
    endedAt: null
  }
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
  // Catch-up snapshots, corrections and a new live phase establish a new
  // baseline. A settled renderer keeps pacing only to finish a reveal it
  // already owns, never to type out replayed history.
  if (
    hidden ||
    !text.startsWith(state.text) ||
    (streaming && !state.streaming) ||
    (!streaming && !isTextRevealActive(state)) ||
    text.length - state.visibleLength >= MAX_REVEAL_BACKLOG
  ) return createTextReveal(text, streaming, now)

  let next: TextRevealState = { ...state, text, streaming }
  if (!streaming && next.endedAt === null) next = { ...next, endedAt: now }
  const appended = text.length - state.text.length
  if (appended <= 0) return next
  next = recordArrival(next, appended, now)
  if (appended <= RHYTHM.largeAppendChars) return next
  // A relay that buffers and flushes in large blocks is shown block by block.
  if (appended > MAX_FADED_APPEND) return { ...next, visibleLength: text.length }
  return commitReveal(next, text.length - next.visibleLength, now)
}

function recordArrival(state: TextRevealState, appended: number, now: number): TextRevealState {
  const deltaChars = state.text.length - state.lastInputLength
  const deltaMs = Math.max(1, now - state.lastInputAt)
  let { emaCps, chunkEma, arrivalEma } = state
  if (deltaChars > 0) {
    const instantCps = (deltaChars * 1000) / deltaMs
    chunkEma = chunkEma * 0.65 + appended * 0.35
    arrivalEma = arrivalEma * 0.65 + clamp(instantCps, RHYTHM.minCps, RHYTHM.maxFlushCps * 2) * 0.35
    emaCps = emaCps * (1 - RHYTHM.emaAlpha) +
      clamp(instantCps, RHYTHM.minCps, RHYTHM.maxActiveCps) * RHYTHM.emaAlpha
  }
  return {
    ...state,
    emaCps,
    chunkEma,
    arrivalEma,
    lastInputAt: now,
    lastInputLength: state.text.length,
    wakeAt: 0
  }
}

function tailUnits(state: TextRevealState): number {
  const boundary = state.text.lastIndexOf('\n\n', state.visibleLength - 1)
  return boundary === -1 ? state.visibleLength : state.visibleLength - boundary - 2
}

/** Number of code units to reveal on this commit, or null when the buffer should hold. */
function revealCount(state: TextRevealState, now: number, dtSeconds: number): number | null {
  const backlog = state.text.length - state.visibleLength
  const idleMs = now - state.lastInputAt
  const inputActive = state.streaming && idleMs <= RHYTHM.activeInputWindowMs
  const settling = !inputActive && (!state.streaming || idleMs >= RHYTHM.settleAfterMs)
  const baseCps = clamp(state.emaCps, RHYTHM.minCps, RHYTHM.maxCps)
  const baseLag = Math.max(1, Math.round((baseCps * RHYTHM.targetBufferMs) / 1000))
  const lagUpperBound = Math.max(baseLag + 2, baseLag * 3)
  const targetLag = inputActive
    ? Math.round(clamp(baseLag + state.chunkEma * 0.35, baseLag, lagUpperBound))
    : 0

  let cps: number
  if (inputActive) {
    const pressure = clamp(
      (backlog / targetLag) * 0.6 +
        (state.chunkEma / targetLag) * 0.25 +
        (state.arrivalEma / Math.max(baseCps, 1)) * 0.15,
      1,
      4.5
    )
    const activeCap = clamp(
      RHYTHM.maxActiveCps + state.chunkEma * 6,
      RHYTHM.maxActiveCps,
      RHYTHM.maxFlushCps
    )
    cps = clamp(baseCps * pressure, RHYTHM.minCps, activeCap)
  } else if (settling) {
    const drainMs = clamp(backlog * 8, RHYTHM.settleDrainMinMs, RHYTHM.settleDrainMaxMs)
    cps = clamp((backlog * 1000) / drainMs, RHYTHM.flushCps, RHYTHM.maxFlushCps)
  } else {
    cps = clamp(
      Math.max(RHYTHM.flushCps, baseCps * 1.8, state.arrivalEma * 0.8),
      RHYTHM.flushCps,
      RHYTHM.maxFlushCps
    )
  }

  const urgent = inputActive && backlog > targetLag * 2.2
  const bursty = inputActive && state.chunkEma >= targetLag * 0.9
  const minimum = inputActive ? (urgent || bursty ? 2 : 1) : 2
  let count = Math.max(minimum, Math.round(cps * dtSeconds))
  if (inputActive) {
    const shortfall = state.text.length - targetLag - state.visibleLength
    if (shortfall <= 0) return null
    count = Math.min(count, shortfall, backlog)
  } else {
    count = Math.min(count, backlog)
  }
  // A paragraph that is complete behind the cursor is released at once; it
  // still fades in as one quick sweep.
  if (backlog > count) {
    const boundary = state.text.lastIndexOf('\n\n')
    if (boundary >= state.visibleLength) count = Math.max(count, boundary + 2 - state.visibleLength)
  }
  return count
}

export function advanceTextReveal(state: TextRevealState, now: number): TextRevealState {
  const backlog = state.text.length - state.visibleLength
  if (backlog <= 0) {
    const last = state.fading.at(-1)
    if (last && last.birth + STREAM_FADE_MS > now) return state
    return isTextRevealActive(state) || state.lastFrameAt !== null || state.endedAt !== null
      ? completeTextReveal(state)
      : state
  }
  if (state.endedAt !== null && now - state.endedAt >= MAX_FINISH_MS) {
    return { ...commitReveal(state, backlog, now), lastFrameAt: now }
  }
  if (now < state.wakeAt) return state
  if (state.lastFrameAt === null) return { ...state, lastFrameAt: now }

  const commitIntervalMs = Math.min(
    MAX_COMMIT_INTERVAL_MS,
    RHYTHM.minCommitIntervalMs * (1 + tailUnits(state) / COMMIT_INTERVAL_TAIL_UNITS)
  )
  const frameIntervalMs = now - state.lastFrameAt
  if (frameIntervalMs < commitIntervalMs) return state
  // A throttled or stalled clock must not turn received text into seconds of
  // typing once frames resume.
  if (frameIntervalMs >= MAX_FINISH_MS) return { ...commitReveal(state, backlog, now), lastFrameAt: now }
  const count = revealCount(state, now, clamp(frameIntervalMs / 1000, 0.001, 0.12))
  if (count === null) {
    const idleMs = now - state.lastInputAt
    return { ...state, lastFrameAt: null, wakeAt: now + (RHYTHM.activeInputWindowMs - idleMs) }
  }
  return { ...commitReveal(state, count, now), lastFrameAt: now }
}

function graphemeStarts(text: string, from: number, to: number): number[] {
  const starts: number[] = []
  if (graphemeSegmenter) {
    for (const segment of graphemeSegmenter.segment(text.slice(from, to))) {
      starts.push(from + segment.index)
    }
    return starts
  }
  let offset = from
  for (const char of text.slice(from, to)) {
    starts.push(offset)
    offset += char.length
  }
  return starts
}

function commitReveal(state: TextRevealState, count: number, now: number): TextRevealState {
  const from = state.visibleLength
  const to = nextTextBoundary(state.text, Math.min(state.text.length, from + count))
  if (to <= from) return state
  const settled = state.fading.findIndex((entry) => entry.birth + STREAM_FADE_MS > now)
  const fading = settled === -1 ? [] : state.fading.slice(settled)
  const starts = graphemeStarts(state.text, from, to)
  // Births chain a few ms apart within the time since the last commit, so a
  // commit reads as a short wave rather than a block popping in.
  const gapMs = clamp(now - state.lastCommitAt, 16, MAX_REVEAL_GAP_MS)
  const pace = Math.min(MAX_CHAR_PACE_MS, Math.max(gapMs / starts.length, MIN_CHAR_PACE_MS))
  const latest = now + gapMs + STREAM_FADE_MS
  let previous = fading.at(-1)?.birth
  for (const offset of starts) {
    const chained = previous === undefined ? now : previous + pace
    const birth = Math.min(latest, Math.max(chained, now))
    fading.push({ offset, birth })
    previous = birth
  }
  return { ...state, visibleLength: to, fading, lastCommitAt: now }
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
