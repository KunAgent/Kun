import { create } from 'zustand'
import type {
  PaperHighlight,
  PaperHighlightColor
} from '@shared/paper/paper-marks-types'

/**
 * Reader marks state for the open paper unit. `items` is the merged highlight
 * list; `dirty` tracks local edits pending a debounced `paperMarksWrite`
 * (600ms, see use-paper-marks). Cards (translate/ask) arrive in the same IPC
 * payload but are keyed under `cards` by mark id.
 */
export type PaperMarksState = {
  /** Unit dir the marks belong to ('' = unloaded). */
  unitDir: string
  items: PaperHighlight[]
  cards: Record<string, unknown>
  /** Ids deleted locally since the last successful write. */
  removedIds: string[]
  dirty: boolean
  /** Bump when a write finishes so late external merges stay consistent. */
  revision: number
}

const initialMarksState = (): PaperMarksState => ({
  unitDir: '',
  items: [],
  cards: {},
  removedIds: [],
  dirty: false,
  revision: 0
})

export const usePaperMarksStore = create<PaperMarksState>(() => initialMarksState())

let nextMarkSeq = 0

export function nextPaperMarkId(): string {
  nextMarkSeq = (nextMarkSeq + 1) % Number.MAX_SAFE_INTEGER
  return `m${Date.now().toString(36)}${nextMarkSeq.toString(36)}`
}

export function upsertPaperHighlight(mark: PaperHighlight): void {
  usePaperMarksStore.setState((state) => {
    const rest = state.items.filter((item) => item.id !== mark.id)
    return { items: [...rest, mark], dirty: true }
  })
}

export function removePaperHighlight(id: string): void {
  usePaperMarksStore.setState((state) => ({
    items: state.items.filter((item) => item.id !== id),
    removedIds: state.removedIds.includes(id) ? state.removedIds : [...state.removedIds, id],
    dirty: true
  }))
}

export function setPaperHighlightComment(id: string, comment: string): void {
  usePaperMarksStore.setState((state) => ({
    items: state.items.map((item) =>
      item.id === id ? { ...item, comment: comment || undefined, updatedAt: new Date().toISOString() } : item
    ),
    dirty: true
  }))
}

export function newPaperHighlight(input: {
  color: PaperHighlightColor
  page: number
  rects: [number, number, number, number][]
  quote: string
}): PaperHighlight {
  const now = new Date().toISOString()
  return {
    id: nextPaperMarkId(),
    kind: 'highlight',
    color: input.color,
    page: input.page,
    rects: input.rects,
    quote: input.quote.slice(0, 8000),
    createdAt: now,
    updatedAt: now
  }
}
