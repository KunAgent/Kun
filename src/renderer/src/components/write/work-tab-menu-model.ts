import type { WriteEditorGroupId, WriteEditorItem } from '../../write/write-workspace-store-types'
import type { WorkLibraryTab } from '../../write/work-view-store'

/** One tab of the Work strip, in the order it is drawn: sessions, the draft, then documents. */
export type WorkStripEntry =
  | { kind: 'session'; key: string; id: string }
  | { kind: 'draft'; key: string }
  | { kind: 'document'; key: string; groupId: WriteEditorGroupId; item: WriteEditorItem }
  | { kind: 'library'; key: string; tab: WorkLibraryTab }

export type WorkTabCloseScope = 'self' | 'others' | 'right' | 'all'

/** Tabs a close action removes. The draft is never closed: it is the strip's empty session. */
export function workTabCloseTargets(entries: WorkStripEntry[], key: string, scope: WorkTabCloseScope): WorkStripEntry[] {
  const index = entries.findIndex((entry) => entry.key === key)
  if (index < 0) return []
  const picked = scope === 'self' ? [entries[index]]
    : scope === 'others' ? entries.filter((entry) => entry.key !== key)
      : scope === 'right' ? entries.slice(index + 1)
        : entries
  return picked.filter((entry) => entry.kind !== 'draft')
}

/**
 * The neighbour a tab swaps with when moved. Sessions always sit before documents, so a
 * session only trades places with a session, and a document with a document of its own group.
 */
export function workTabMoveNeighbor(entries: WorkStripEntry[], key: string, direction: -1 | 1): WorkStripEntry | null {
  const index = entries.findIndex((entry) => entry.key === key)
  const entry = entries[index]
  const neighbor = entries[index + direction]
  if (!entry || !neighbor || entry.kind === 'draft' || entry.kind === 'library' || neighbor.kind !== entry.kind) return null
  if (entry.kind === 'document' && neighbor.kind === 'document' && neighbor.groupId !== entry.groupId) return null
  return neighbor
}
