import { create } from 'zustand'

/**
 * 找论文 in the Work composer: paper search runs inside the current session
 * instead of on a separate discover page. While the chip is on, each turn
 * carries the `[paper-research]` scope line Kun's Work-mode guidance already
 * understands; the bubble shows only what the user typed.
 */
export type WorkPaperSearchDepth = 'quick' | 'deep'

type WorkPaperSearchModeState = {
  enabled: boolean
  depth: WorkPaperSearchDepth
  /** Bumped to ask the composer to take focus (home quick action). */
  focusRequest: number
  setEnabled: (enabled: boolean) => void
  setDepth: (depth: WorkPaperSearchDepth) => void
  /** Turn the chip on and focus the composer. */
  start: () => void
}

export const useWorkPaperSearchMode = create<WorkPaperSearchModeState>((set) => ({
  enabled: false,
  depth: 'quick',
  focusRequest: 0,
  setEnabled: (enabled) => set(enabled ? { enabled } : { enabled, depth: 'quick' }),
  setDepth: (depth) => set({ depth }),
  start: () => set((state) => ({ enabled: true, focusRequest: state.focusRequest + 1 }))
}))

/** The scope line for one turn; `deep` asks for the full research method. */
export function workPaperSearchScopeLine(depth: WorkPaperSearchDepth): string {
  return `[paper-research] depth=${depth}; sources=default; years=any`
}

/** Appends the scope line when the chip is on; otherwise returns the prompt unchanged. */
export function withWorkPaperSearchScope(
  prompt: string,
  mode: Pick<WorkPaperSearchModeState, 'enabled' | 'depth'>
): string {
  if (!mode.enabled) return prompt
  return `${prompt}\n\n${workPaperSearchScopeLine(mode.depth)}`
}
