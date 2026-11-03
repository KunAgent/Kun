import type { WriteDocumentReviewHandle } from './write-document-editor-handle'
import type { WriteInlineFormatKind } from '../../write/inline-format'
import type { WriteBlockType } from '../../write/block-type'
import type { OfficeDocumentPreviewFormat } from '@shared/office-document'

export type WriteSelectionSourceKind =
  | 'text'
  | 'pdf'
  | 'word'
  | 'presentation'
  | 'spreadsheet'

export type WriteSelectionAnchorRect = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export type WriteSelectionPageRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type WriteSelectionRange = {
  from: number
  to: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text: string
  charCount: number
  page?: number
}

export type WriteEditorSelectionState = {
  text: string
  ranges: WriteSelectionRange[]
  charCount: number
  anchorRect?: WriteSelectionAnchorRect
  rects?: WriteSelectionPageRect[]
  sourceKind?: WriteSelectionSourceKind
  sourceFormat?: OfficeDocumentPreviewFormat
  pageStart?: number
  pageEnd?: number
  slide?: number
  sheetName?: string
  cellRange?: string
  formulas?: string[]
  /** Block type of the line at the selection start (selection toolbar). */
  activeFormats?: WriteInlineFormatKind[]
  blockType?: WriteBlockType
  /** Set when a single raster image is selected (TipTap node selection or a
   * caret on an image markdown line in source mode). */
  selectedImage?: WriteSelectedImage
}

export type WriteSelectedImage = {
  src: string
  alt: string
  /** Source-mode only: the document offsets of the image markdown line. */
  line?: { from: number; to: number }
}

/**
 * Imperative surface for the selection toolbar: replaces a document range
 * through the editor so undo history stays granular and the selection ends up
 * covering the replacement (allowing chained formatting).
 */
export type WriteMarkdownEditorHandle = WriteDocumentReviewHandle & {
  applyRangeReplacement: (
    range: { from: number; to: number },
    original: string,
    replacement: string,
    selection?: { from: number; to: number }
  ) => boolean
  /** Rewrite the block markers of the lines spanning the current selection. */
  setBlockType: (type: WriteBlockType) => boolean
}
