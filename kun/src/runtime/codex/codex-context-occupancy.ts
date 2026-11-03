/**
 * Context occupancy from Codex's `thread/tokenUsage/updated`.
 *
 * `tokenUsage.last` is the latest model call; `total` adds up every call in
 * the thread, each of which re-sent the whole context, so it measures
 * consumption and passes the window after a few tool steps. Codex's own
 * context meter uses `last.totalTokens` against `modelContextWindow`, and so
 * does Kun.
 *
 * `modelContextWindow` is already Codex's effective window (95% of the
 * model's by default). Codex compacts automatically at 90% of the model's
 * window unless a lower limit is configured, which is about 90/95 of the
 * reported figure.
 */
export const CODEX_EFFECTIVE_WINDOW_PERCENT = 95
export const CODEX_AUTO_COMPACT_PERCENT = 90

export type CodexContextOccupancy = { usedTokens: number; windowTokens: number; autoCompactTokens: number }

export function codexContextOccupancy(usage: {
  last?: { totalTokens?: number }
  modelContextWindow?: number | null
} | undefined): CodexContextOccupancy | undefined {
  const window = usage?.modelContextWindow
  if (typeof window !== 'number' || !Number.isFinite(window) || window < 1) return undefined
  const windowTokens = Math.trunc(window)
  const usedTokens = Math.max(0, Math.trunc(usage?.last?.totalTokens ?? 0))
  const autoCompactTokens = Math.max(1, Math.min(windowTokens,
    Math.floor((windowTokens * CODEX_AUTO_COMPACT_PERCENT) / CODEX_EFFECTIVE_WINDOW_PERCENT)))
  return { usedTokens, windowTokens, autoCompactTokens }
}
