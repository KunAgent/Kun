import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import type { PageText } from './WritePdfPage'
import { subscribeKnowledgeSourceNavigation } from '../../lib/knowledge-source-navigation'

/**
 * Owns viewer navigation state: current page tracking (scroll-synced via the
 * page element refs), the page-number input, in-document text search with
 * match cycling, and external knowledge-source navigation requests.
 */
export function useWritePdfNavigation(input: {
  filePath: string
  pdfDocument: PDFDocumentProxy | null
  pageCount: number
  pdfSha256?: string
  pageTexts: PageText[]
  scrollerRef: RefObject<HTMLDivElement | null>
  preservePosition?: boolean
  renderScale?: number
}): {
  currentPage: number
  pageInput: string
  setPageInput: (value: string) => void
  searchQuery: string
  setSearchQuery: (value: string) => void
  searchMatches: number[]
  searchIndex: number
  pageRefs: RefObject<Map<number, HTMLDivElement>>
  scrollToPage: (page: number) => void
  schedulePageSync: () => void
  jumpSearch: (direction: 1 | -1) => void
  onPageViewport: (page: number, size: { width: number; height: number }) => void
} {
  const { filePath, pdfDocument, pageCount, pageTexts, scrollerRef, pdfSha256, preservePosition = false, renderScale = 1 } = input
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const scrollRafRef = useRef<number | null>(null)
  const [pageInput, setPageInput] = useState('1')
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const retained = useRef({ filePath, page: 1, offset: 0 })
  const pendingRestore = useRef<{ page: number; offset: number } | null>(null)
  const readyPages = useRef(new Set<number>())
  const restoreRaf = useRef<number | null>(null)
  const rendered = useRef<{ filePath: string; pdfDocument: PDFDocumentProxy | null; preservePosition: boolean } | null>(null)
  const currentFrame = useRef({ pdfDocument, renderScale })
  currentFrame.current = { pdfDocument, renderScale }

  useLayoutEffect(() => {
    const previous = rendered.current
    rendered.current = { filePath, pdfDocument, preservePosition }
    if (!preservePosition && previous?.filePath === filePath && previous.pdfDocument === pdfDocument && !previous.preservePosition) return
    readyPages.current.clear()
    if (preservePosition && retained.current.filePath === filePath) {
      const page = Math.max(1, Math.min(pdfDocument?.numPages ?? retained.current.page, retained.current.page))
      retained.current.page = page
      pendingRestore.current = { page, offset: retained.current.offset }
      setCurrentPage(page)
      setPageInput(String(page))
      return
    }
    retained.current = { filePath, page: 1, offset: 0 }
    pendingRestore.current = null
    setPageInput('1')
    setCurrentPage(1)
  }, [filePath, pdfDocument, preservePosition, renderScale])

  const scheduleRestore = useCallback((): void => {
    if (restoreRaf.current !== null) window.cancelAnimationFrame(restoreRaf.current)
    restoreRaf.current = window.requestAnimationFrame(() => {
      restoreRaf.current = null
      const anchor = pendingRestore.current
      const scroller = scrollerRef.current
      if (!anchor || !scroller) return
      for (let number = 1; number <= anchor.page; number++) if (!readyPages.current.has(number)) return
      const node = pageRefs.current.get(anchor.page)
      if (!node) return
      const rect = node.getBoundingClientRect()
      const frame = scroller.getBoundingClientRect()
      if (rect.height <= 0 || frame.height <= 0) return
      const uiScale = scroller.clientHeight > 0 ? frame.height / scroller.clientHeight : 1
      scroller.scrollTop += (rect.top - frame.top + anchor.offset * rect.height) / uiScale
      pendingRestore.current = null
    })
  }, [scrollerRef])

  const onPageViewport = useCallback((page: number, _size: { width: number; height: number }): void => {
    if (!preservePosition || !pdfDocument || currentFrame.current.pdfDocument !== pdfDocument || currentFrame.current.renderScale !== renderScale) return
    readyPages.current.add(page)
    scheduleRestore()
  }, [pdfDocument, preservePosition, renderScale, scheduleRestore])

  useEffect(() => {
    if (!preservePosition || !scrollerRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(scheduleRestore)
    observer.observe(scrollerRef.current)
    return () => observer.disconnect()
  }, [preservePosition, scrollerRef, scheduleRestore])

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return []
    return pageTexts
      .filter((page) => page.text.toLowerCase().includes(query))
      .map((page) => page.page)
      .sort((a, b) => a - b)
  }, [pageTexts, searchQuery])

  const scrollToPage = useCallback((page: number): void => {
    const clamped = Math.max(1, Math.min(pageCount || 1, Math.round(page)))
    setCurrentPage(clamped)
    setPageInput(String(clamped))
    retained.current = { filePath, page: clamped, offset: 0 }
    pendingRestore.current = null
    pageRefs.current.get(clamped)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [pageCount, filePath])

  useEffect(() => subscribeKnowledgeSourceNavigation(filePath, (location) => {
    if (location.kind !== 'pdf' || !pdfDocument) return false
    // A racing file replacement must never reuse a verified old page anchor.
    if (location.expectedSha256 && !pdfSha256) return false
    if (location.expectedSha256 && location.expectedSha256 !== pdfSha256) return true
    scrollToPage(location.pageStart)
    return true
  }), [filePath, pdfDocument, scrollToPage, pdfSha256])

  const updateCurrentPageFromScroll = useCallback((): void => {
    const scroller = scrollerRef.current
    if (!scroller || pageRefs.current.size === 0 || (preservePosition && (!pdfDocument || pendingRestore.current))) return
    const scrollerRect = scroller.getBoundingClientRect()
    if (preservePosition && scrollerRect.height <= 0) return
    const targetY = scrollerRect.top + scrollerRect.height * 0.42
    let bestPage = 1
    let bestDistance = Number.POSITIVE_INFINITY

    pageRefs.current.forEach((node, page) => {
      const rect = node.getBoundingClientRect()
      const distance = targetY >= rect.top && targetY <= rect.bottom
        ? 0
        : Math.min(Math.abs(targetY - rect.top), Math.abs(targetY - rect.bottom))
      if (distance < bestDistance) {
        bestDistance = distance
        bestPage = page
      }
    })

    setCurrentPage((value) => value === bestPage ? value : bestPage)
    setPageInput((value) => value === String(bestPage) ? value : String(bestPage))
    const rect = pageRefs.current.get(bestPage)?.getBoundingClientRect()
    retained.current = { filePath, page: bestPage, offset: rect && rect.height > 0 ? (scrollerRect.top - rect.top) / rect.height : 0 }
  }, [scrollerRef, filePath, pdfDocument, preservePosition])

  const schedulePageSync = useCallback((): void => {
    if (scrollRafRef.current != null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      updateCurrentPageFromScroll()
    })
  }, [updateCurrentPageFromScroll])

  const jumpSearch = useCallback((direction: 1 | -1): void => {
    if (searchMatches.length === 0) return
    const nextIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length
    setSearchIndex(nextIndex)
    scrollToPage(searchMatches[nextIndex])
  }, [searchIndex, searchMatches, scrollToPage])

  useEffect(() => {
    setSearchIndex(0)
    if (searchMatches.length > 0) scrollToPage(searchMatches[0])
  }, [scrollToPage, searchMatches])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
      if (restoreRaf.current !== null) window.cancelAnimationFrame(restoreRaf.current)
    }
  }, [])

  return {
    currentPage,
    pageInput,
    setPageInput,
    searchQuery,
    setSearchQuery,
    searchMatches,
    searchIndex,
    pageRefs,
    scrollToPage,
    schedulePageSync,
    jumpSearch,
    onPageViewport
  }
}
