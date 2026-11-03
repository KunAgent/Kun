import type { ContextSnapshotEvent } from '../contracts/context-snapshot.js'

export type ContextCategoryKey = 'tools' | 'system' | 'skills' | 'messages' | 'other'

export type ContextCategory = {
  key: ContextCategoryKey
  label: string
  tokens: number
  /** Share of the whole window, not of the used part. */
  ratio: number
}

/**
 * The latest request against the model's window, split the way the GUI's
 * context capacity popover splits it: categories plus free space sum to the
 * window, and the auto-compaction threshold is marked on the same scale.
 */
export type ContextCapacity = {
  used: number
  window: number
  percent: number
  categories: ContextCategory[]
  free: { tokens: number; ratio: number }
  /** Auto-compaction threshold as a share of the window. */
  compactRatio?: number
  activeSkills: number
  /** Why the split or the total is partial, when it is. */
  note?: string
}

const CATEGORY_ORDER: readonly ContextCategoryKey[] = ['tools', 'system', 'skills', 'messages', 'other']

const CATEGORY_LABELS: Record<ContextCategoryKey, string> = {
  tools: 'System tools',
  system: 'System prompt',
  skills: 'Skills',
  messages: 'Messages',
  other: 'Other'
}

export function contextCapacity(snapshot: ContextSnapshotEvent): ContextCapacity | undefined {
  const window = snapshot.contextWindowTokens
  if (!(window > 0)) return undefined
  const used = Math.max(0, snapshot.estimatedInputTokens)
  // An Agent that measured its own request without splitting it reports one
  // figure; calling it "Messages" would claim a split nobody made.
  const agentTotal = snapshot.occupancySource === 'agent' && snapshot.breakdownSource !== 'agent'
  const raw: Record<ContextCategoryKey, number> = agentTotal
    ? { tools: 0, system: 0, skills: 0, messages: 0, other: used }
    : { ...snapshot.breakdown }
  const sum = CATEGORY_ORDER.reduce((total, key) => total + Math.max(0, raw[key]), 0)
  // The categories are estimates; keep them summing to the measured total.
  const scale = sum > used && sum > 0 ? used / sum : 1
  const tokens = Object.fromEntries(CATEGORY_ORDER.map((key) => [key, Math.round(Math.max(0, raw[key]) * scale)])) as Record<ContextCategoryKey, number>
  const counted = CATEGORY_ORDER.reduce((total, key) => total + tokens[key], 0)
  if (counted < used) tokens.other += used - counted
  const categories = CATEGORY_ORDER
    .filter((key) => tokens[key] > 0)
    .map((key) => ({
      key,
      label: agentTotal ? 'Reported by agent' : CATEGORY_LABELS[key],
      tokens: tokens[key],
      ratio: tokens[key] / window
    }))
  const free = Math.max(0, window - used)
  const compactRatio = snapshot.softThresholdTokens / window
  return {
    used,
    window,
    percent: Math.round((used / window) * 100),
    categories,
    free: { tokens: free, ratio: free / window },
    ...(compactRatio > 0 && compactRatio <= 1 ? { compactRatio } : {}),
    activeSkills: snapshot.activeSkillIds.length,
    ...(snapshot.contextManagement === 'sdk-managed' && snapshot.nativeHistory !== 'known'
      ? { note: 'SDK-managed history · sent this turn' }
      : {})
  }
}

export type ContextBarCell = ContextCategoryKey | 'free' | 'marker'

/**
 * Runs of cells for a `width`-cell window bar. Every category that holds
 * tokens keeps at least one cell, so a small prompt still shows its parts;
 * the compaction threshold replaces the cell it falls on.
 */
export function contextBarRuns(capacity: ContextCapacity, width: number): { kind: ContextBarCell; count: number }[] {
  const cellsWide = Math.max(1, Math.floor(width))
  const counts = capacity.categories.map((category) => Math.max(1, Math.round(category.ratio * cellsWide)))
  while (counts.reduce((total, count) => total + count, 0) > cellsWide) {
    const largest = counts.indexOf(Math.max(...counts))
    if (counts[largest]! <= 1) break
    counts[largest]! -= 1
  }
  const cells: ContextBarCell[] = []
  capacity.categories.forEach((category, index) => {
    for (let cell = 0; cell < counts[index]! && cells.length < cellsWide; cell += 1) cells.push(category.key)
  })
  while (cells.length < cellsWide) cells.push('free')
  if (capacity.compactRatio !== undefined) {
    cells[Math.min(cellsWide - 1, Math.round(capacity.compactRatio * cellsWide))] = 'marker'
  }
  const runs: { kind: ContextBarCell; count: number }[] = []
  for (const kind of cells) {
    const last = runs.at(-1)
    if (last?.kind === kind) last.count += 1
    else runs.push({ kind, count: 1 })
  }
  return runs
}

/** "1.8%", "<0.1%" for a sliver, "0%" for nothing. */
export function formatWindowShare(ratio: number): string {
  if (!(ratio > 0)) return '0%'
  const percent = ratio * 100
  if (percent < 0.1) return '<0.1%'
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`
}
