import { create } from 'zustand'
import type {
  PaperHighlight,
  PaperHighlightColor,
  PaperVisualMark
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
  /**
   * Mark hovered on the page or in the comment gutter (R1.4) — shared so the
   * page overlay and gutter cards light up / draw connectors together.
   * Transient UI state; never persisted.
   */
  hoveredMarkId: string | null
  /** Card id opened in edit mode inside the gutter (fresh visual marks). */
  editingMarkId: string | null
  /** dataURL cache for visual-mark thumbnails captured this session. */
  visualMarkImages: Record<string, string>
}

const initialMarksState = (): PaperMarksState => ({
  unitDir: '',
  items: [],
  cards: {},
  removedIds: [],
  dirty: false,
  revision: 0,
  hoveredMarkId: null,
  editingMarkId: null,
  visualMarkImages: {}
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

/**
 * R2.4 visual marks live in `cards` (per-id files), not annotations.json.
 * Upserts mark the store dirty so the debounced flush persists them; the
 * freshly captured thumbnail is cached so the gutter shows it without a
 * round trip.
 */
export function upsertPaperMarkCard(card: unknown, dataUrl?: string): void {
  const id = (card as { id?: string }).id
  if (!id) return
  usePaperMarksStore.setState((state) => ({
    cards: { ...state.cards, [id]: card },
    editingMarkId: (card as { kind?: string }).kind === 'visual' ? id : state.editingMarkId,
    visualMarkImages: dataUrl ? { ...state.visualMarkImages, [id]: dataUrl } : state.visualMarkImages,
    dirty: true
  }))
}

/** Update a card's comment (visual marks) and mark the store dirty. */
export function setPaperMarkCardComment(id: string, comment: string): void {
  usePaperMarksStore.setState((state) => {
    const card = state.cards[id] as PaperVisualMark | undefined
    if (!card || card.kind !== 'visual') return state
    return {
      cards: {
        ...state.cards,
        [id]: { ...card, comment: comment || undefined, updatedAt: new Date().toISOString() }
      },
      dirty: true
    }
  })
}

/** Remove a per-id card (translate/ask/visual) — main also deletes the file. */
export function removePaperMarkCard(id: string): void {
  usePaperMarksStore.setState((state) => {
    if (!(id in state.cards)) return state
    const cards = { ...state.cards }
    delete cards[id]
    return {
      cards,
      editingMarkId: state.editingMarkId === id ? null : state.editingMarkId,
      removedIds: state.removedIds.includes(id) ? state.removedIds : [...state.removedIds, id],
      dirty: true
    }
  })
}

export function setPaperEditingMark(id: string | null): void {
  usePaperMarksStore.setState({ editingMarkId: id })
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
