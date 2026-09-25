import { useCallback, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import { extractPdfTextBlocks, type PdfTextBlock } from '../../../paper/pdf-text-blocks'
import { maskBlockText } from '../../../paper/translate-mask'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'

export type PageTranslateStatus = 'idle' | 'translating' | 'done' | 'hidden' | 'error'

export type PageBlocksResult = { blocks: PdfTextBlock[]; pageWidth: number }

/**
 * R2.2 per-page overlay translation: extracts text blocks via
 * `extractPdfTextBlocks`, masks math/URLs/citations, sends them through
 * `paper-reader:translate-blocks` (batched + cached main-side), restores the
 * ⟦n⟧ placeholders, and tracks per-page status for the 「译」 tab.
 * `reference` blocks are never translated (spec).
 */
export function usePaperPageTranslate({
  pdfDocument,
  unitDir,
  workspaceRoot
}: {
  pdfDocument: PDFDocumentProxy | null
  unitDir: string
  workspaceRoot: string
}): {
  statusByPage: ReadonlyMap<number, PageTranslateStatus>
  translationsByPage: ReadonlyMap<number, Record<string, string>>
  translatePage: (page: number) => Promise<void>
  togglePageOverlay: (page: number) => void
  /** Sequential whole-document flow: translate `fromPage`..`pageCount`. */
  translateAllFrom: (fromPage: number, pageCount: number) => void
  stopTranslateAll: () => void
  translatingAll: boolean
  /** Progress of the sequential sweep (`{done,total}`) while it runs. */
  allProgress: { done: number; total: number } | null
  getPageBlocks: (page: number) => Promise<PageBlocksResult>
} {
  const [statusByPage, setStatusByPage] = useState<Map<number, PageTranslateStatus>>(new Map())
  const [translationsByPage, setTranslationsByPage] = useState<Map<number, Record<string, string>>>(new Map())
  const [translatingAll, setTranslatingAll] = useState(false)
  const [allProgress, setAllProgress] = useState<{ done: number; total: number } | null>(null)
  const blocksCacheRef = useRef(new Map<number, Promise<PageBlocksResult>>())
  const stopAllRef = useRef(false)

  const getPageBlocks = useCallback(
    (page: number): Promise<PageBlocksResult> => {
      const cache = blocksCacheRef.current
      const cached = cache.get(page)
      if (cached) return cached
      const promise = (async () => {
        if (!pdfDocument) return { blocks: [], pageWidth: 1 }
        const pageProxy = await pdfDocument.getPage(page)
        const [content, viewport] = await Promise.all([
          pageProxy.getTextContent(),
          Promise.resolve(pageProxy.getViewport({ scale: 1 }))
        ])
        const items = content.items
          .filter((item) => item.str && item.transform)
          .map((item) => ({
            str: item.str ?? '',
            transform: item.transform ?? [],
            width: item.width,
            height: item.height,
            fontName: item.fontName
          }))
        return {
          blocks: extractPdfTextBlocks(items, page, viewport.width, viewport.height),
          pageWidth: viewport.width
        }
      })()
      promise.catch(() => cache.delete(page))
      cache.set(page, promise)
      return promise
    },
    [pdfDocument]
  )

  const setStatus = useCallback((page: number, status: PageTranslateStatus): void => {
    setStatusByPage((prev) => {
      const next = new Map(prev)
      next.set(page, status)
      return next
    })
  }, [])

  const translatePage = useCallback(
    async (page: number): Promise<void> => {
      const status = statusByPage.get(page)
      if (status === 'translating' || status === 'done') return
      setStatus(page, 'translating')
      try {
        const { blocks } = await getPageBlocks(page)
        const translatable = blocks.filter(
          (block) => block.kind !== 'reference' && block.text.trim()
        )
        if (!translatable.length) {
          setStatus(page, 'done')
          return
        }
        const masked = new Map(translatable.map((b) => [b.id, maskBlockText(b.text)]))
        const translate = useWriteWorkspaceStore.getState().paperMode.translate
        const result = await window.kunGui.paperTranslateBlocks({
          workspaceRoot,
          unitDir,
          blocks: translatable.map((b) => ({ id: b.id, text: masked.get(b.id)?.masked ?? b.text })),
          targetLanguage: translate.targetLanguage,
          providerId: translate.inheritModel ? undefined : translate.providerId || undefined,
          model: translate.inheritModel ? undefined : translate.model || undefined
        })
        if (!result.ok) {
          setStatus(page, 'error')
          return
        }
        const restored: Record<string, string> = {}
        for (const block of translatable) {
          const raw = result.translations[block.id]
          if (raw) restored[block.id] = masked.get(block.id)?.restore(raw) ?? raw
        }
        setTranslationsByPage((prev) => new Map(prev).set(page, restored))
        setStatus(page, 'done')
      } catch {
        setStatus(page, 'error')
      }
    },
    [statusByPage, getPageBlocks, setStatus, workspaceRoot, unitDir]
  )

  const togglePageOverlay = useCallback(
    (page: number): void => {
      const status = statusByPage.get(page)
      if (status === 'done') setStatus(page, 'hidden')
      else if (status === 'hidden') setStatus(page, 'done')
      else void translatePage(page)
    },
    [statusByPage, setStatus, translatePage]
  )

  const translateAllFrom = useCallback(
    (fromPage: number, pageCount: number): void => {
      if (translatingAll) return
      stopAllRef.current = false
      setTranslatingAll(true)
      const total = pageCount - fromPage + 1
      setAllProgress({ done: 0, total })
      void (async () => {
        for (let page = fromPage; page <= pageCount; page += 1) {
          if (stopAllRef.current) break
          // Sequential per-page flow: each page shows as soon as it lands.
          await translatePage(page)
          setAllProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
        }
        setTranslatingAll(false)
        setAllProgress(null)
      })()
    },
    [translatingAll, translatePage]
  )

  const stopTranslateAll = useCallback((): void => {
    stopAllRef.current = true
    setTranslatingAll(false)
  }, [])

  return useMemo(
    () => ({
      statusByPage,
      translationsByPage,
      translatePage,
      togglePageOverlay,
      translateAllFrom,
      stopTranslateAll,
      translatingAll,
      allProgress,
      getPageBlocks
    }),
    [
      statusByPage,
      translationsByPage,
      translatePage,
      togglePageOverlay,
      translateAllFrom,
      stopTranslateAll,
      translatingAll,
      allProgress,
      getPageBlocks
    ]
  )
}
