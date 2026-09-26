import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import {
  paperReaderAutoMarkReading,
  paperReaderRecordOpened,
  paperReaderRecordPage
} from '../../../paper/paper-reader-actions'

const PAGE_RECORD_DEBOUNCE_MS = 1200

/**
 * Reader position persistence (R0): restores `lastPage` once the document is
 * ready, records opened/page activity (debounced), auto-marks a fresh import
 * 「reading」, and publishes the current page to the mode store so the
 * assistant composer chip can show it.
 */
export function usePaperReaderPosition({
  pdfDocument,
  unitDir,
  workspaceRoot,
  libraryEntry,
  currentPage,
  pageCount,
  scrollToPage,
  enabled = true
}: {
  pdfDocument: PDFDocumentProxy | null
  unitDir: string
  workspaceRoot: string
  libraryEntry: PaperLibraryEntry | undefined
  currentPage: number
  pageCount: number
  scrollToPage: (page: number) => void
  /** R2.3: the translated mirror never records or restores position. */
  enabled?: boolean
}): void {
  const [restoredPage, setRestoredPage] = useState<number | null>(null)
  const lastRecordedPageRef = useRef(0)

  useEffect(() => {
    if (!enabled || !pdfDocument || restoredPage !== null) return
    setRestoredPage(-1)
    void paperReaderRecordOpened(unitDir)
    if (libraryEntry) void paperReaderAutoMarkReading(libraryEntry)
    if (typeof window.kunGui?.paperLocalStateRead !== 'function') return
    void window.kunGui.paperLocalStateRead({ libraryRoot: workspaceRoot }).then((state) => {
      const lastPage = state.units[unitDir]?.lastPage
      if (lastPage && lastPage > 1) scrollToPage(lastPage)
    }).catch(() => undefined)
  }, [enabled, pdfDocument, restoredPage, scrollToPage, unitDir, workspaceRoot, libraryEntry])

  useEffect(() => {
    if (!enabled || !currentPage || currentPage === lastRecordedPageRef.current) return
    lastRecordedPageRef.current = currentPage
    const timer = window.setTimeout(() => {
      void paperReaderRecordPage(unitDir, currentPage, pageCount)
    }, PAGE_RECORD_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [enabled, currentPage, pageCount, unitDir])

  // Paper/page context for the assistant composer chip (U5).
  useEffect(() => {
    if (!enabled || !currentPage) return
    usePaperModeStore.getState().setReaderPage({ unitDir, page: currentPage, pageCount })
  }, [enabled, currentPage, pageCount, unitDir])
  useEffect(() => () => usePaperModeStore.getState().setReaderPage(null), [unitDir])
}
