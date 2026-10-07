import type { WriteRightPanelId } from '../../write/write-right-panel-state'

export type WriteRailBadge = { count: number; tone: 'accent' | 'neutral' }

/** Rail tools that only make sense with a document open. */
export const WRITE_DOCUMENT_PANEL_IDS: ReadonlySet<WriteRightPanelId> = new Set(['outline', 'review', 'references'])

export type WriteRailItem = {
  id: WriteRightPanelId
  group: 'primary' | 'secondary'
  badge?: WriteRailBadge
  running?: boolean
}

/**
 * Work rail order (design: assistant, outline, review, references, history,
 * subagents, then shared MCP/usage tools under a divider). Pending review
 * chunks get an accent badge; reference counts stay neutral.
 */
export function resolveWriteRailItems({
  reviewCount,
  referenceCount,
  assistantRunning,
  documentTools = true
}: {
  reviewCount: number
  referenceCount: number
  assistantRunning: boolean
  /** False while the assistant fills the center with nothing open. */
  documentTools?: boolean
}): WriteRailItem[] {
  const items: WriteRailItem[] = [
    { id: 'assistant', group: 'primary', ...(assistantRunning ? { running: true } : {}) },
    { id: 'outline', group: 'primary' },
    {
      id: 'review',
      group: 'primary',
      ...(reviewCount > 0 ? { badge: { count: reviewCount, tone: 'accent' as const } } : {})
    },
    {
      id: 'references',
      group: 'primary',
      ...(referenceCount > 0 ? { badge: { count: referenceCount, tone: 'neutral' as const } } : {})
    },
    { id: 'history', group: 'primary' },
    { id: 'subagents', group: 'primary' },
    { id: 'mcpSkills', group: 'secondary' },
    { id: 'usage', group: 'secondary' }
  ]
  return documentTools ? items : items.filter((item) => !WRITE_DOCUMENT_PANEL_IDS.has(item.id))
}

export function formatWriteRailBadge(count: number): string {
  return count > 99 ? '99+' : String(count)
}
