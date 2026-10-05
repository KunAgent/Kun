import { useCallback, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import type { PaperRect } from '@shared/paper/paper-marks-types'
import { nextPaperMarkId, upsertPaperMarkCard } from '../../../paper/paper-marks-store'
import { cropPageRegionPng } from '../../../paper/paper-visual-mark'

export function usePaperRegionCapture(input: {
  pdfDocument: PDFDocumentProxy | null
  pdfSha256?: string
  workspaceRoot: string
  unitDir: string
  onNotice: (message: string) => void
  onComplete: () => void
}): (page: number, rect: PaperRect) => void {
  const active = useRef(false)
  return useCallback((page, rect) => {
    const doc = input.pdfDocument
    if (!doc || !input.pdfSha256 || active.current) return
    active.current = true
    void (async () => {
      try {
        const capture = await cropPageRegionPng(await doc.getPage(page), rect)
        if (!capture) return
        const result = await window.kunGui.paperSaveVisualMark({
          workspaceRoot: input.workspaceRoot, unitDir: input.unitDir,
          mark: { id: nextPaperMarkId(), page, rect }, pngBase64: capture.base64,
          expectedPdfSha256: input.pdfSha256
        })
        if (!result.ok) throw new Error(result.message)
        input.onNotice('')
        upsertPaperMarkCard(result.mark, capture.dataUrl)
        input.onComplete()
      } catch (cause) { input.onNotice(cause instanceof Error ? cause.message : String(cause)) }
      finally { active.current = false }
    })()
  }, [input])
}
