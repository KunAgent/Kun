import type { TurnItem } from '../contracts/items.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'

export type HistoryHealingResult = {
  items: TurnItem[]
  changed: boolean
}

export function healLoadedHistoryItems(items: readonly TurnItem[]): HistoryHealingResult {
  // Detect changes by identity rather than a deep stringify: normalizeLoadedItem
  // returns the original reference untouched when nothing needs rewriting, and
  // repairModelHistoryItems returns its input array unchanged when it removes
  // nothing. Two full-history JSON.stringify calls per turn step blocked the
  // event loop for seconds on large threads, starving /health (KunAgent/Kun#621).
  let changed = false
  const normalized: TurnItem[] = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const healedItem = normalizeLoadedItem(item, index)
    if (healedItem === null) {
      changed = true // an item was dropped
      continue
    }
    if (healedItem !== item) changed = true // an id was synthesized
    normalized.push(healedItem)
  }
  const repaired = repairModelHistoryItems(normalized)
  if (repaired !== normalized) changed = true // unpaired tool call/result removed
  return { items: repaired, changed }
}

function normalizeLoadedItem(item: TurnItem, index: number): TurnItem | null {
  if (!item || typeof item !== 'object') return null
  const candidate = item as TurnItem & Record<string, unknown>
  const kind = typeof candidate.kind === 'string' ? candidate.kind : ''
  if (!kind) return null
  switch (kind) {
    case 'tool_call':
    case 'tool_result':
      if (!candidate.callId || !candidate.toolName) return null
      break
    case 'assistant_text':
    case 'assistant_reasoning':
    case 'user_message':
    case 'approval':
    case 'user_input':
    case 'compaction':
    case 'review':
    case 'error':
      break
    default:
      return null
  }
  // Preserve the original reference when the id is already valid so callers can
  // detect "unchanged" by identity; only allocate when synthesizing an id.
  if (typeof candidate.id === 'string' && candidate.id.trim()) return item
  return { ...candidate, id: `item_healed_${index}_${kind}` } as TurnItem
}
