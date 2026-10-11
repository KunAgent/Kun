import { useCallback, useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import type { PaperRect } from '@shared/paper/paper-marks-types'
import { nextPaperMarkId, upsertPaperMarkCard, usePaperMarksStore } from '../../../paper/paper-marks-store'
import { cropPageRegionPng } from '../../../paper/paper-visual-mark'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'

export function usePaperRegionCapture(input: {
  pdfDocument: PDFDocumentProxy | null
  pdfSha256?: string
  workspaceRoot: string
  unitDir: string
  onNotice: (message: string) => void
  onComplete: () => void
}): (page: number, rect: PaperRect) => void {
  const active = useRef(false)
  const alive = useRef(true)
  const latest = useRef(input)
  latest.current = input
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  return useCallback((page, rect) => {
    const doc = input.pdfDocument
    if (!doc || !input.pdfSha256 || active.current || usePaperMarksStore.getState().workspaceRoot !== input.workspaceRoot || usePaperMarksStore.getState().unitDir !== input.unitDir || useWriteWorkspaceStore.getState().workspaceRoot !== input.workspaceRoot) return
    active.current = true
    const stillCurrent = (): boolean => alive.current && latest.current.pdfDocument === doc &&
      latest.current.pdfSha256 === input.pdfSha256 && latest.current.unitDir === input.unitDir &&
      latest.current.workspaceRoot === input.workspaceRoot &&
      usePaperMarksStore.getState().workspaceRoot === input.workspaceRoot &&
      usePaperMarksStore.getState().unitDir === input.unitDir &&
      useWriteWorkspaceStore.getState().workspaceRoot === input.workspaceRoot
    void (async () => {
      try {
        const capture = await cropPageRegionPng(await doc.getPage(page), rect)
        if (!capture || !stillCurrent()) return
        const result = await window.kunGui.paperSaveVisualMark({
          workspaceRoot: input.workspaceRoot, unitDir: input.unitDir,
          mark: { id: nextPaperMarkId(), page, rect }, pngBase64: capture.base64,
          expectedPdfSha256: input.pdfSha256
        })
        if (!stillCurrent()) return
        if (!result.ok) throw new Error(result.message)
        input.onNotice('')
        upsertPaperMarkCard(result.mark, capture.dataUrl)
        input.onComplete()
      } catch (cause) { if (stillCurrent()) input.onNotice(cause instanceof Error ? cause.message : String(cause)) }
      finally { active.current = false }
    })()
  }, [input])
}
