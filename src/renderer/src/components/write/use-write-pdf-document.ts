import { useCallback, useEffect, useMemo, useState } from 'react'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import { bytesFromBase64, emptyPdfSelection, type PageText } from './WritePdfPage'
import type { WriteEditorSelectionState } from './WriteMarkdownEditor'

/**
 * Owns the PDF.js document lifecycle: decoding base64 data, loading state,
 * errors, page text accumulation, and document destruction. The PDF loading
 * task must be rebuilt only when the underlying resource changes, so callers
 * pass a stable `publishSelection` callback (see WritePdfViewer).
 */
export function useWritePdfDocument(input: {
  filePath: string
  dataBase64: string
  mtimeMs: number
  publishSelection: (selection: WriteEditorSelectionState) => void
}): {
  pdfDocument: PDFDocumentProxy | null
  loading: boolean
  error: string
  pageCount: number
  pageTexts: PageText[]
  allPageTextLoaded: boolean
  pdfHasText: boolean
  updatePageText: (page: PageText) => void
  resetTransientState: () => void
} {
  const { filePath, dataBase64, mtimeMs, publishSelection } = input
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pageTexts, setPageTexts] = useState<PageText[]>([])

  const resetTransientState = useCallback((): void => {
    setPageTexts([])
    publishSelection(emptyPdfSelection())
  }, [publishSelection])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPdfDocument(null)
    setPageTexts([])
    publishSelection(emptyPdfSelection())
    const task = getDocument({
      data: bytesFromBase64(dataBase64),
      isEvalSupported: false
    })
    void task.promise.then((pdf) => {
      if (cancelled) {
        void pdf.destroy()
        return
      }
      setPdfDocument(pdf)
      setLoading(false)
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
      task.destroy()
    }
  }, [dataBase64, filePath, mtimeMs, publishSelection])

  useEffect(() => {
    return () => {
      if (pdfDocument) void pdfDocument.destroy()
    }
  }, [pdfDocument])

  const updatePageText = useCallback((page: PageText): void => {
    setPageTexts((current) => {
      const existing = current.find((item) => item.page === page.page)
      if (existing?.text === page.text) return current
      const next = current.filter((item) => item.page !== page.page)
      next.push(page)
      return next.sort((a, b) => a.page - b.page)
    })
  }, [])

  const pageCount = pdfDocument?.numPages ?? 0
  const allPageTextLoaded = pageCount > 0 && pageTexts.length >= pageCount
  const pdfHasText = useMemo(
    () => pageTexts.some((page) => page.text.trim().length > 0),
    [pageTexts]
  )

  return {
    pdfDocument,
    loading,
    error,
    pageCount,
    pageTexts,
    allPageTextLoaded,
    pdfHasText,
    updatePageText,
    resetTransientState
  }
}
