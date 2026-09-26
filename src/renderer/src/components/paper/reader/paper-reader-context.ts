import { createContext, useContext } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import type { PaperReferenceItem } from '@shared/paper/paper-references-types'
import type { PaperFigureItemV1 } from '@shared/paper/paper-types'
import type { PageBlocksResult } from './use-paper-page-translate'
import type { PaperRect } from '@shared/paper/paper-marks-types'

/**
 * Per-reader services consumed by page layers (R2.5 link/citation layer,
 * R2.4 region marks): paper unit identity, lazy preprocess artifacts
 * (references.json / figures index) and page navigation. Provided by
 * PaperUnitPdfReader so layers stay prop-drill free inside PageStack.
 */
export type PaperReaderServices = {
  workspaceRoot: string
  /** Relative unit dir, e.g. `papers/1706.03762`. */
  unitDir: string
  pdfDocument: PDFDocumentProxy | null
  /** Scroll a page into view and pulse a yellow flash on it. */
  jumpToPage: (page: number) => void
  /** references.json items; cached — repeated calls share the load. */
  getReferences: () => Promise<PaperReferenceItem[]>
  /** figures/index.json items; cached. */
  getFigures: () => Promise<PaperFigureItemV1[]>
  /**
   * True while hitboxes must stay inert: an active text selection, the
   * selection menu / ask popover, or region-select mode owns the pointer.
   */
  linksSuppressed: boolean
  /** Best-effort "References" section page for unresolved citation jumps. */
  referencesPage: number | null
  /** R2.1/R2.2: cached per-page text-block extraction for overlay layers. */
  getPageBlocks: (page: number) => Promise<PageBlocksResult>
  /** R2.2 overlay: translated text per block id, or null when not shown. */
  pageTranslations: (page: number) => Record<string, string> | null
  /** R2.4: crosshair region-select mode is active. */
  regionSelectActive: boolean
  /** R2.4: capture the dragged region → PNG + visual mark + gutter card. */
  captureRegion?: (page: number, rect: PaperRect) => void
}

export const PaperReaderContext = createContext<PaperReaderServices | null>(null)

export function usePaperReaderServices(): PaperReaderServices | null {
  return useContext(PaperReaderContext)
}
