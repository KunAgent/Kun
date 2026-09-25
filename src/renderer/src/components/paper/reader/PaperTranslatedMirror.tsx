import type { MutableRefObject, ReactElement, RefObject } from 'react'
import { Loader2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { PaperHighlight, PaperVisualMark } from '@shared/paper/paper-marks-types'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import type { PageText } from '../../write/WritePdfPage'
import type { PageTranslateStatus } from './use-paper-page-translate'
import { PaperPageStack } from './PaperPageStack'
import { PaperTranslateOverlay } from './PaperTranslateOverlay'
import { PaperReaderContext, type PaperReaderServices } from './paper-reader-context'

const MIRROR_LAYERS = [PaperTranslateOverlay]
const EMPTY_MARKS = new Map<number, PaperHighlight[]>()
const EMPTY_VISUAL = new Map<number, PaperVisualMark[]>()

/**
 * R2.3 translated mirror: pages + translation overlay only — no marks,
 * selection, drawer, gutter, or floating chrome. Scroll/zoom follow the
 * primary reader through the sync bus owned by the caller.
 */
export function PaperTranslatedMirror({
  readerServices,
  localRootRef,
  scrollerRef,
  onScrollerScroll,
  loading,
  error,
  pdfDocument,
  scale,
  pageRefs,
  onPageText,
  pdfHasText,
  statusByPage,
  t
}: {
  readerServices: PaperReaderServices
  localRootRef: RefObject<HTMLDivElement | null>
  scrollerRef: RefObject<HTMLDivElement | null>
  onScrollerScroll: () => void
  loading: boolean
  error: string | null
  pdfDocument: PDFDocumentProxy | null
  scale: number
  pageRefs: MutableRefObject<Map<number, HTMLElement>>
  onPageText: (page: PageText) => void
  pdfHasText: boolean
  statusByPage: ReadonlyMap<number, PageTranslateStatus>
  t: TFunction
}): ReactElement {
  return (
    <PaperReaderContext.Provider value={readerServices}>
      <div
        ref={localRootRef}
        data-immersive={undefined}
        className="write-pdf-viewer write-pdf-viewer--translated relative flex h-full min-h-0 min-w-0 flex-col"
      >
        <div
          ref={scrollerRef}
          className="write-pdf-scroller min-h-0 flex-1 overflow-auto bg-ds-main/55 px-4 py-5 dark:bg-black/20"
          onScroll={onScrollerScroll}
        >
          {loading ? (
            <div className="flex h-full min-h-[320px] items-center justify-center gap-2 text-[13px] text-ds-muted">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
              {t('writePdfLoading')}
            </div>
          ) : error ? (
            <div className="flex h-full min-h-[320px] items-center justify-center text-[13px] text-red-600 dark:text-red-300">
              {t('writePdfLoadFailed', { message: error })}
            </div>
          ) : pdfDocument ? (
            <div className="mx-auto flex w-max max-w-full flex-col items-center gap-5">
              <PaperPageStack
                pdfDocument={pdfDocument}
                scale={scale}
                selectionRects={[]}
                marksByPage={EMPTY_MARKS}
                visualMarksByPage={EMPTY_VISUAL}
                pageRefs={pageRefs}
                onPageText={onPageText}
                onDeleteMark={() => undefined}
                pdfHasText={pdfHasText}
                layers={MIRROR_LAYERS}
                pageTranslateStatus={(p) => statusByPage.get(p) ?? 'idle'}
                t={t}
              />
            </div>
          ) : null}
        </div>
      </div>
    </PaperReaderContext.Provider>
  )
}
