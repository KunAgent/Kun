import { useCallback, useState, type ComponentType, type MutableRefObject, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import type { WriteSelectionPageRect } from '../../write/write-markdown-editor-types'
import type { PaperHighlight, PaperVisualMark } from '@shared/paper/paper-marks-types'
import { WritePdfPage, type PageText } from '../../write/WritePdfPage'
import { PaperPageMarksLayer } from './PaperPageMarksLayer'
import { PaperPageTranslateTab } from './PaperPageTranslateTab'
import type { PageTranslateStatus } from './use-paper-page-translate'

export type PaperPageViewport = { width: number; height: number }

/** Overlay contract for R1–R3 layers (translation mask, link layer, region select). */
export type PaperPageLayerProps = {
  page: number
  /** CSS-pixel page size reported by WritePdfPage; undefined until rendered. */
  viewport: PaperPageViewport | undefined
}

/**
 * Per-page render stack (R0): canvas + text layer (WritePdfPage), marks
 * overlay, extension layers positioned via normalized rects × viewport, the
 * page-edge translate rail, and the page label. Page viewports are collected
 * into a Map so every overlay scales from the same normalized coordinates.
 */
export function PaperPageStack({
  pdfDocument,
  scale,
  selectionRects,
  marksByPage,
  visualMarksByPage,
  pageRefs,
  onPageText,
  onDeleteMark,
  pdfHasText,
  layers,
  flashPage,
  pageTranslateStatus,
  onPageTranslateToggle,
  t
}: {
  pdfDocument: PDFDocumentProxy
  scale: number
  selectionRects: WriteSelectionPageRect[]
  marksByPage: ReadonlyMap<number, PaperHighlight[]>
  /** R2.4 region marks (dashed rects) keyed by page. */
  visualMarksByPage?: ReadonlyMap<number, PaperVisualMark[]>
  pageRefs: MutableRefObject<Map<number, HTMLElement>>
  onPageText: (page: PageText) => void
  onDeleteMark: (id: string) => void
  pdfHasText: boolean
  layers?: ReadonlyArray<ComponentType<PaperPageLayerProps>>
  /** Page number pulsing a yellow flash after an internal-link jump (R2.5). */
  flashPage?: number | null
  /** R2.2: per-page 「译」 tab state; absent → the rail is hidden. */
  pageTranslateStatus?: (page: number) => PageTranslateStatus
  onPageTranslateToggle?: (page: number) => void
  t: TFunction
}): ReactElement {
  const [viewports, setViewports] = useState<Map<number, PaperPageViewport>>(new Map())
  const reportViewport = useCallback(
    (page: number, size: PaperPageViewport): void => {
      setViewports((prev) => {
        const existing = prev.get(page)
        if (existing && existing.width === size.width && existing.height === size.height) {
          return prev
        }
        const next = new Map(prev)
        next.set(page, size)
        return next
      })
    },
    []
  )

  return (
    <>
      {Array.from({ length: pdfDocument.numPages }, (_, i) => i + 1).map((pageNumber) => (
        <div
          key={pageNumber}
          ref={(node) => {
            if (node) pageRefs.current.set(pageNumber, node)
            else pageRefs.current.delete(pageNumber)
          }}
        >
          <div
            data-paper-page={pageNumber}
            className={`group/page relative w-fit${flashPage === pageNumber ? ' paper-page-flash' : ''}`}
          >
            <WritePdfPage
              document={pdfDocument}
              pageNumber={pageNumber}
              scale={scale}
              selectionRects={selectionRects.filter((r) => r.page === pageNumber)}
              onPageText={onPageText}
              onViewport={reportViewport}
            />
            <PaperPageMarksLayer
              marks={marksByPage.get(pageNumber) ?? []}
              visualMarks={visualMarksByPage?.get(pageNumber) ?? []}
              onDelete={onDeleteMark}
            />
            {layers?.map((Layer, index) => (
              <Layer key={index} page={pageNumber} viewport={viewports.get(pageNumber)} />
            ))}
            {pdfHasText && pageTranslateStatus && onPageTranslateToggle ? (
              <PaperPageTranslateTab
                status={pageTranslateStatus(pageNumber)}
                onClick={() => onPageTranslateToggle(pageNumber)}
                t={t}
              />
            ) : null}
          </div>
          <div className="mt-1 select-none text-center text-[11px] text-ds-faint">
            {t('writePdfPageLabel', { page: pageNumber })}
          </div>
        </div>
      ))}
    </>
  )
}
