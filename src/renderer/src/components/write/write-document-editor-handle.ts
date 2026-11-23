import type { WriteSelectionAnchorRect } from './write-markdown-editor-types'

export type WriteReviewOrigin = 'agent' | 'selection'
export type WriteSelectionReview = {
  range: { from: number; to: number }
  original: string
  replacement: string
  instruction: string
}

/** Shared review contract; rich ranges use projection offsets, source ranges use file offsets. */
export type WriteDocumentReviewHandle = {
  beginDiffReview: (params: { original: string; nextDoc: string; origin?: WriteReviewOrigin }) => boolean
  beginSelectionReview: (params: WriteSelectionReview) => { hunks: number } | null
  isDiffReviewActive: () => boolean
  acceptAllDiff: () => void
  /** A transient preview may be discarded after another editor has published a newer draft. */
  rejectAllDiff: (options?: { preserveDraft?: boolean }) => void
  getReviewAnchorRect: () => WriteSelectionAnchorRect | null
  subscribeReviewLayout: (listener: () => void) => () => void
  setSelectionHold: (range: { from: number; to: number } | null) => void
  restoreSelection: (range: { from: number; to: number }) => void
  getElement: () => HTMLElement | null
  undoLast: () => boolean
}
