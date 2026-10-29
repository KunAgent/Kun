import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import {
  paperReaderAutoMarkReading,
  paperReaderRecordOpened,
  paperReaderRecordPage
} from '../../../paper/paper-reader-actions'

const PAGE_RECORD_DEBOUNCE_MS = 1200

/** The translated mirror never restores or records position; global readers do not publish Work context. */
export function usePaperReaderPosition({
  pdfDocument, unitDir, workspaceRoot, libraryEntry, currentPage, pageCount,
  scrollToPage, enabled = true, publishContext = true
}: {
  pdfDocument: PDFDocumentProxy | null
  unitDir: string
  workspaceRoot: string
  libraryEntry: PaperLibraryEntry | undefined
  currentPage: number
  pageCount: number
  scrollToPage: (page: number) => void
  enabled?: boolean
  publishContext?: boolean
}): void {
  const lastRecordedPage = useRef('')

  useEffect(() => {
    if (!enabled || !pdfDocument) return
    let active = true
    void paperReaderRecordOpened(unitDir, workspaceRoot)
    if (typeof window.kunGui?.paperLocalStateRead === 'function') {
      void window.kunGui.paperLocalStateRead({ libraryRoot: workspaceRoot }).then((state) => {
        if (!active) return
        const lastPage = state.units[unitDir]?.lastPage
        if (lastPage && lastPage > 1) scrollToPage(lastPage)
      }).catch(() => undefined)
    }
    return () => { active = false }
  }, [enabled, pdfDocument, scrollToPage, unitDir, workspaceRoot])

  useEffect(() => {
    if (enabled && pdfDocument && libraryEntry) void paperReaderAutoMarkReading(libraryEntry, workspaceRoot)
  }, [enabled, pdfDocument, libraryEntry, workspaceRoot])

  useEffect(() => {
    if (!enabled || !pdfDocument || !currentPage) return
    const key = JSON.stringify([workspaceRoot, unitDir, currentPage, pageCount])
    if (key === lastRecordedPage.current) return
    const timer = window.setTimeout(() => {
      lastRecordedPage.current = key
      void paperReaderRecordPage(unitDir, currentPage, pageCount, workspaceRoot)
    }, PAGE_RECORD_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [enabled, pdfDocument, currentPage, pageCount, unitDir, workspaceRoot])

  useEffect(() => {
    if (!enabled || !publishContext || !currentPage) return
    usePaperModeStore.getState().setReaderPage({ unitDir, page: currentPage, pageCount })
  }, [enabled, publishContext, currentPage, pageCount, unitDir])
  useEffect(() => {
    if (!enabled || !publishContext) return
    return () => usePaperModeStore.getState().setReaderPage(null)
  }, [enabled, publishContext, unitDir])
}
