import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
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
  pageTexts: PageText[]
  scrollerRef: RefObject<HTMLDivElement | null>
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
} {
  const { filePath, pdfDocument, pageCount, pageTexts, scrollerRef } = input
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const scrollRafRef = useRef<number | null>(null)
  const [pageInput, setPageInput] = useState('1')
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)

  useEffect(() => {
    setPageInput('1')
    setCurrentPage(1)
  }, [pdfDocument])

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
    pageRefs.current.get(clamped)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [pageCount])

  useEffect(() => subscribeKnowledgeSourceNavigation(filePath, (location) => {
    if (location.kind !== 'pdf' || !pdfDocument) return false
    scrollToPage(location.pageStart)
    return true
  }), [filePath, pdfDocument, scrollToPage])

  const updateCurrentPageFromScroll = useCallback((): void => {
    const scroller = scrollerRef.current
    if (!scroller || pageRefs.current.size === 0) return
    const scrollerRect = scroller.getBoundingClientRect()
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
  }, [scrollerRef])

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
    jumpSearch
  }
}
