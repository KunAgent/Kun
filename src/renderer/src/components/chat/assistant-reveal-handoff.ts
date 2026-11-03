import {
  isTextRevealActive,
  MAX_FINISH_MS,
  retargetTextReveal,
  type TextRevealState
} from './assistant-text-reveal'

/**
 * When a live reply settles, the store swaps the live block for its persisted
 * block in one update, so the settled renderer mounts in the same commit the
 * live one unmounts. Unfinished reveals register here so the settled renderer
 * can continue the buffered tail instead of jumping to the full text.
 */
type RevealSource = {
  read: () => TextRevealState
  releasedAt: number | null
}

const sources = new Set<RevealSource>()

function prune(now: number): void {
  for (const source of sources) {
    if (source.releasedAt !== null && now - source.releasedAt > MAX_FINISH_MS) sources.delete(source)
  }
}

/** Registers an unfinished reveal; the returned release keeps a snapshot briefly. */
export function registerRevealSource(read: () => TextRevealState): (now: number) => void {
  const source: RevealSource = { read, releasedAt: null }
  sources.add(source)
  return (now) => {
    const snapshot = read()
    source.read = () => snapshot
    source.releasedAt = now
    prune(now)
  }
}

/**
 * Returns a reveal to continue for a settled renderer whose text extends an
 * unfinished one, or null. Adoption is not exclusive: StrictMode renders the
 * initializer twice, and duplicates only share an already-running fade.
 */
export function adoptRevealHandoff(
  text: string,
  streaming: boolean,
  now: number,
  hidden: boolean
): TextRevealState | null {
  if (streaming || hidden || !text) return null
  prune(now)
  const candidates = [...sources].reverse()
  for (const source of candidates) {
    const state = source.read()
    if (!state.text || !isTextRevealActive(state) || !text.startsWith(state.text)) continue
    return retargetTextReveal(
      {
        ...state,
        fading: state.fading.slice(),
        streaming: false,
        lastFrameAt: null,
        wakeAt: 0,
        endedAt: state.endedAt ?? now
      },
      text,
      false,
      now,
      false
    )
  }
  return null
}

export function resetRevealHandoffForTests(): void {
  sources.clear()
}
