import { ChevronLeft, ChevronRight } from 'lucide-react'
import i18n from '../i18n'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { WorkspaceOfficePreviewSuccess, WorkspaceOfficeSelection } from '@shared/office-document'
import { WorkspaceOfficePreviewToolbar } from './WorkspaceOfficePreviewToolbar'
import { WorkspaceDocxSelectionToolbar } from './WorkspaceDocxSelectionToolbar'
import type { WorkspaceDocumentQuoteDraft } from '../lib/workspace-document-quote'
import {
  openWorkspaceOfficeExternalLink,
  secureWorkspaceOfficeLinks
} from './workspace-office-external-link'
import {
  emptyWorkspaceOfficeSelection,
  pageFromDocxNode,
  selectionFromOfficeDom
} from './workspace-office-selection'
import { subscribeKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'

export const DOCX_PREVIEW_MIN_ZOOM = 0.25

export function WorkspaceDocxPreview({
  result,
  loading,
  refreshError,
  onSelectionChange,
  onQuoteSelection
}: {
  result: WorkspaceOfficePreviewSuccess
  loading: boolean
  refreshError?: string | null
  onSelectionChange?: (selection: WorkspaceOfficeSelection) => void
  onQuoteSelection?: (draft: WorkspaceDocumentQuoteDraft) => Promise<boolean> | boolean
}): ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const renderIdRef = useRef(0)
  const fitToWidthRef = useRef(true)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const fitToWidth = useCallback((): void => {
    if (!fitToWidthRef.current) return
    const viewport = scrollRef.current
    const firstPage = docxPages(bodyRef.current)[0]
    if (!viewport || !firstPage) return
    const viewportStyle = window.getComputedStyle(viewport)
    const wrapper = firstPage.closest<HTMLElement>('.docx-wrapper')
    const wrapperStyle = wrapper ? window.getComputedStyle(wrapper) : null
    const viewportWidth = viewport.clientWidth
      - numericCssValue(viewportStyle.paddingLeft)
      - numericCssValue(viewportStyle.paddingRight)
    const documentWidth = firstPage.offsetWidth
      + numericCssValue(wrapperStyle?.paddingLeft)
      + numericCssValue(wrapperStyle?.paddingRight)
    const nextZoom = fittedDocxPreviewZoom(viewportWidth, documentWidth)
    setZoom((current) => Math.abs(current - nextZoom) < 0.001 ? current : nextZoom)
  }, [])

  useEffect(() => {
    const body = bodyRef.current
    const style = styleRef.current
    if (!body || !style) return
    const renderId = ++renderIdRef.current
    const stagedBody = document.createElement('div')
    const stagedStyle = document.createElement('div')
    void import('docx-preview')
      .then(async ({ renderAsync }) => {
        await renderAsync(result.data, stagedBody, stagedStyle, {
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderAltChunks: false,
          useBase64URL: true
        })
        if (renderId !== renderIdRef.current) return
        secureWorkspaceOfficeLinks(stagedBody)
        body.replaceChildren(...Array.from(stagedBody.childNodes))
        style.replaceChildren(...Array.from(stagedStyle.childNodes))
        const count = Math.max(1, docxPages(body).length)
        setPageCount(count)
        setPage((current) => Math.min(current, count))
        setError(null)
        fitToWidth()
      })
      .catch((cause) => {
        if (renderId === renderIdRef.current) setError(errorMessage(cause))
      })
    return () => {
      renderIdRef.current += 1
    }
  }, [fitToWidth, result.data, result.sourceSha256])

  useEffect(() => {
    fitToWidthRef.current = true
    fitToWidth()
  }, [fitToWidth, result.path])

  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport) return
    fitToWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fitToWidth)
      return () => window.removeEventListener('resize', fitToWidth)
    }
    const observer = new ResizeObserver(fitToWidth)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [fitToWidth])

  useEffect(() => {
    if (!onSelectionChange) return
    const empty = (): void => onSelectionChange(
      emptyWorkspaceOfficeSelection('word', result.sourceFormat)
    )
    const sync = (): void => {
      const body = bodyRef.current
      const selection = window.getSelection()
      if (!body || !selection?.anchorNode || !body.contains(selection.anchorNode)) return
      onSelectionChange(selectionFromOfficeDom(
        body,
        'word',
        result.sourceFormat,
        (node) => ({ page: pageFromDocxNode(node, body) })
      ))
    }
    empty()
    document.addEventListener('selectionchange', sync)
    return () => {
      document.removeEventListener('selectionchange', sync)
      empty()
    }
  }, [onSelectionChange, result.sourceFormat, result.sourceSha256, zoom])

  useEffect(() => () => {
    renderIdRef.current += 1
    bodyRef.current?.replaceChildren()
    styleRef.current?.replaceChildren()
  }, [])

  const goToPage = (next: number): void => {
    const safePage = Math.min(pageCount, Math.max(1, next))
    onSelectionChange?.(emptyWorkspaceOfficeSelection('word', result.sourceFormat))
    window.getSelection()?.removeAllRanges()
    setPage(safePage)
    docxPages(bodyRef.current)[safePage - 1]?.scrollIntoView({ block: 'start' })
  }

  useEffect(() => subscribeKnowledgeSourceNavigation(result.path, (location) => {
    if (location.kind !== 'word') return false
    const paragraphs = bodyRef.current?.querySelectorAll<HTMLElement>('p')
    const target = paragraphs?.[Math.max(0, location.paragraphStart - 1)]
    if (!target) return false
    target.scrollIntoView({ block: 'center' })
    return true
  }), [pageCount, result.path])

  const onScroll = (): void => {
    const viewport = scrollRef.current
    if (!viewport) return
    const viewportTop = viewport.getBoundingClientRect().top
    let nearestPage = 1
    let nearestDistance = Number.POSITIVE_INFINITY
    docxPages(bodyRef.current).forEach((section, index) => {
      const distance = Math.abs(section.getBoundingClientRect().top - viewportTop)
      if (distance < nearestDistance) {
        nearestPage = index + 1
        nearestDistance = distance
      }
    })
    setPage(nearestPage)
  }

  const changeZoom = (nextZoom: number): void => {
    fitToWidthRef.current = false
    setZoom(nextZoom)
  }

  const resetZoom = (): void => {
    fitToWidthRef.current = true
    fitToWidth()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-ds-surface-subtle">
      <WorkspaceOfficePreviewToolbar
        result={result}
        loading={loading}
        refreshError={refreshError}
        viewerError={error}
        zoom={zoom}
        minZoom={DOCX_PREVIEW_MIN_ZOOM}
        onZoomChange={changeZoom}
        onResetZoom={resetZoom}
      >
        <div className="flex items-center gap-1 rounded border border-ds-border-muted px-1 py-0.5">
          <button type="button" aria-label={i18n.t('officePreviousPage')} disabled={page <= 1} className="rounded p-0.5 hover:bg-ds-hover disabled:opacity-40" onClick={() => goToPage(page - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span aria-label={i18n.t('officePageSummary', { page, count: pageCount })}>{i18n.t('officePageSummary', { page, count: pageCount })}</span>
          <button type="button" aria-label={i18n.t('officeNextPage')} disabled={page >= pageCount} className="rounded p-0.5 hover:bg-ds-hover disabled:opacity-40" onClick={() => goToPage(page + 1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </WorkspaceOfficePreviewToolbar>
      <div ref={styleRef} className="hidden" />
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto p-4" style={{ position: 'relative' }}>
        <div
          className="origin-top-left"
          style={{ width: `${100 / zoom}%`, transform: `scale(${zoom})` }}
          onClick={openWorkspaceOfficeExternalLink}
        >
          <div ref={bodyRef} className="workspace-docx-preview select-text" />
        </div>
        {onQuoteSelection ? (
          <WorkspaceDocxSelectionToolbar
            bodyRef={bodyRef}
            scrollRef={scrollRef}
            sourceName={result.name}
            sourceSha256={result.sourceSha256}
            onQuoteSelection={onQuoteSelection}
          />
        ) : null}
      </div>
    </div>
  )
}

function docxPages(container: HTMLElement | null): HTMLElement[] {
  return container ? Array.from(container.querySelectorAll<HTMLElement>('section.docx')) : []
}

export function fittedDocxPreviewZoom(viewportWidth: number, documentWidth: number): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(documentWidth) || viewportWidth <= 0 || documentWidth <= 0) {
    return 1
  }
  const fitted = Math.floor((viewportWidth / documentWidth) * 100) / 100
  return Math.max(DOCX_PREVIEW_MIN_ZOOM, Math.min(1, fitted))
}

function numericCssValue(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message || 'This Word document could not be rendered.'
}
