/**
 * Unified document-editor handle for diff-review flows (implementation §6.1).
 *
 * Both the CodeMirror source editor and the rich editor expose these four
 * methods; `documentHandleRef` points at whichever editor is currently
 * mounted so callers no longer depend on `markdownHandleRef`.
 */
export type WriteDocumentReviewHandle = {
  beginDiffReview: (params: { original: string; nextDoc: string }) => boolean
  isDiffReviewActive: () => boolean
  acceptAllDiff: () => void
  rejectAllDiff: () => void
}
