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
export type PaperMarksDraft = {
  /** Identical unit paths in different libraries are distinct. */
  workspaceRoot: string
  unitDir: string
  items: PaperHighlight[]
  cards: Record<string, unknown>
  /** Ids deleted locally since the last successful write. */
  removedIds: string[]
  dirty: boolean
  revision: number
  /** Captured thumbnails stay with unsaved visual marks. */
  visualMarkImages: Record<string, string>
}

export type PaperMarksState = PaperMarksDraft & {
  /** Unsaved units remain app-owned when another reader takes over this store. */
  pendingDrafts: Record<string, PaperMarksDraft>
  /** Hover/edit selection is transient and resets when switching source. */
  hoveredMarkId: string | null
  editingMarkId: string | null
}

const initialMarksState = (): PaperMarksState => ({
  pendingDrafts: {},
  workspaceRoot: '',
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

function draftKey(root: string, unitDir: string): string {
  return JSON.stringify([root, unitDir])
}

function snapshot(state: PaperMarksDraft): PaperMarksDraft {
  const { workspaceRoot, unitDir, items, cards, removedIds, dirty, revision, visualMarkImages } = state
  return { workspaceRoot, unitDir, items, cards, removedIds, dirty, revision, visualMarkImages }
}

export function activatePaperMarksUnit(workspaceRoot: string, unitDir: string): void {
  usePaperMarksStore.setState((state) => {
    if (state.workspaceRoot === workspaceRoot && state.unitDir === unitDir) return state
    const pendingDrafts = { ...state.pendingDrafts }
    if (state.dirty && state.workspaceRoot && state.unitDir) pendingDrafts[draftKey(state.workspaceRoot, state.unitDir)] = snapshot(state)
    return { ...initialMarksState(), ...pendingDrafts[draftKey(workspaceRoot, unitDir)], workspaceRoot, unitDir, pendingDrafts }
  })
}

export function getPaperMarksDraft(workspaceRoot: string, unitDir: string): PaperMarksDraft | undefined {
  const state = usePaperMarksStore.getState()
  return state.workspaceRoot === workspaceRoot && state.unitDir === unitDir
    ? state : state.pendingDrafts[draftKey(workspaceRoot, unitDir)]
}

/** Late saves update their own pending unit, never whichever reader is now active. */
export function updatePaperMarksDraft(workspaceRoot: string, unitDir: string, update: (draft: PaperMarksDraft) => Partial<PaperMarksDraft>): void {
  usePaperMarksStore.setState((state) => {
    const active = state.workspaceRoot === workspaceRoot && state.unitDir === unitDir
    const key = draftKey(workspaceRoot, unitDir)
    const current = active ? snapshot(state) : state.pendingDrafts[key]
    if (!current) return state
    const draft = { ...current, ...update(current) }
    const pendingDrafts = { ...state.pendingDrafts }
    if (draft.dirty) pendingDrafts[key] = draft
    else delete pendingDrafts[key]
    return active ? { ...draft, pendingDrafts } : { pendingDrafts }
  })
}

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
  pdfSha256?: string
}): PaperHighlight {
  const now = new Date().toISOString()
  return {
    id: nextPaperMarkId(),
    kind: 'highlight',
    color: input.color,
    page: input.page,
    rects: input.rects,
    quote: input.quote.slice(0, 8000),
    ...(input.pdfSha256 ? { pdfSha256: input.pdfSha256 } : {}),
    createdAt: now,
    updatedAt: now
  }
}
