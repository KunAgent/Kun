import i18n from '../i18n'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import type { ViewerZoomLevel, ViewerZoomState } from '@extend-ai/react-docx'
import type { WorkspaceOfficePreviewSuccess, WorkspaceOfficeSelection } from '@shared/office-document'
import {
  OfficePageNav,
  OfficeToolbarStatus,
  OfficeZoomLevelControls,
  WorkspaceOfficeToolbar
} from './WorkspaceOfficeToolbar'
import { WorkspaceDocxSelectionToolbar } from './WorkspaceDocxSelectionToolbar'
import type { WorkspaceDocxPagesHandle } from './WorkspaceDocxPages'
import type { WorkspaceDocumentQuoteDraft } from '../lib/workspace-document-quote'
import { openWorkspaceOfficeExternalLink } from './workspace-office-external-link'
import {
  emptyWorkspaceOfficeSelection,
  pageFromDocxNode,
  selectionFromOfficeDom
} from './workspace-office-selection'
import { attachDocxDragSelection } from './workspace-docx-drag-selection'
import { registerDocxPreviewText } from './workspace-docx-text'
import { subscribeKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'

const WorkspaceDocxPages = lazy(() =>
  import('./WorkspaceDocxPages').then((module) => ({ default: module.WorkspaceDocxPages }))
)

/**
 * After a jump the viewer reports the page nearest the top while it scrolls, and
 * pages near the end can never reach the top. Those reports are ignored briefly.
 */
const NAVIGATION_SETTLE_MS = 700

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<WorkspaceDocxPagesHandle>(null)
  const navigationRef = useRef<{ page: number; until: number } | null>(null)
  const [page, setPage] = useState(1)
  const pageRef = useRef(1)
  pageRef.current = page
  const [pageCount, setPageCount] = useState(0)
  const pageCountRef = useRef(0)
  pageCountRef.current = pageCount
  const [zoom, setZoom] = useState<ViewerZoomLevel>('automatic')
  const [resolvedZoom, setResolvedZoom] = useState(100)
  const [error, setError] = useState<string | null>(null)
  // A reload of the same file keeps the reader's page; another file starts at the top.
  const loadedPathRef = useRef<string | null>(null)
  // A re-read of unchanged bytes keeps the parsed document instead of parsing it again.
  const sourceRef = useRef<{ key: string; data: Uint8Array } | null>(null)
  const sourceKey = `${result.path}\n${result.sourceSha256}`
  if (sourceRef.current?.key !== sourceKey) sourceRef.current = { key: sourceKey, data: result.data }
  const source = sourceRef.current.data

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    return registerDocxPreviewText(content, () => pagesRef.current?.fullText() ?? '')
  }, [])

  useEffect(() => {
    const content = contentRef.current
    return content ? attachDocxDragSelection(content, () => scrollRef.current) : undefined
  }, [])

  const handlePageInfo = useCallback((nextPage: number, count: number): void => {
    setPageCount(count)
    const navigation = navigationRef.current
    if (navigation && nextPage !== navigation.page && performance.now() < navigation.until) return
    pageRef.current = nextPage
    setPage(nextPage)
  }, [])

  const handleLoaded = useCallback((): void => {
    setError(null)
    if (loadedPathRef.current !== result.path) {
      loadedPathRef.current = result.path
      pageRef.current = 1
      setPage(1)
    }
  }, [result.path])

  const handleZoomChange = useCallback((state: ViewerZoomState): void => {
    setResolvedZoom(state.resolvedZoom)
  }, [])

  const clearSelection = useCallback((): void => {
    onSelectionChange?.(emptyWorkspaceOfficeSelection('word', result.sourceFormat))
    window.getSelection()?.removeAllRanges()
  }, [onSelectionChange, result.sourceFormat])

  const goToPage = useCallback((next: number): void => {
    const count = pageCountRef.current
    if (count < 1) return
    const safePage = Math.min(count, Math.max(1, next))
    navigationRef.current = { page: safePage, until: performance.now() + NAVIGATION_SETTLE_MS }
    pageRef.current = safePage
    setPage(safePage)
    clearSelection()
    pagesRef.current?.goToPage(safePage)
  }, [clearSelection])

  useEffect(() => subscribeKnowledgeSourceNavigation(result.path, (location) => {
    if (location.kind !== 'word') return false
    return pagesRef.current?.revealParagraph(location.paragraphStart) ?? false
  }), [result.path])

  useEffect(() => {
    if (!onSelectionChange) return
    const empty = (): void => onSelectionChange(
      emptyWorkspaceOfficeSelection('word', result.sourceFormat)
    )
    const sync = (): void => {
      const content = contentRef.current
      const selection = window.getSelection()
      if (!content || !selection?.anchorNode || !content.contains(selection.anchorNode)) return
      onSelectionChange(selectionFromOfficeDom(
        content,
        'word',
        result.sourceFormat,
        (node) => ({ page: pageFromDocxNode(node, content) })
      ))
    }
    empty()
    document.addEventListener('selectionchange', sync)
    return () => {
      document.removeEventListener('selectionchange', sync)
      empty()
    }
  }, [onSelectionChange, result.sourceFormat, result.sourceSha256])

  const openLink = (event: ReactMouseEvent<HTMLElement>): void => {
    if (event.button > 1) return
    openWorkspaceOfficeExternalLink(event)
  }

  return (
    <div className="kun-docx flex min-h-0 flex-1 flex-col">
      <WorkspaceOfficeToolbar
        leading={(
          <OfficePageNav
            summary={i18n.t('officePageSummary', { page, count: Math.max(pageCount, 1) })}
            prevLabel={i18n.t('officePreviousPage')}
            nextLabel={i18n.t('officeNextPage')}
            canPrev={page > 1}
            canNext={page < pageCount}
            onPrev={() => goToPage(page - 1)}
            onNext={() => goToPage(page + 1)}
          />
        )}
        status={<OfficeToolbarStatus loading={loading} message={error || refreshError} />}
        trailing={<OfficeZoomLevelControls zoom={zoom} resolvedZoom={resolvedZoom} disabled={pageCount === 0} onChange={setZoom} />}
      />
      <div ref={scrollRef} className="kun-office-scroll relative min-h-0 flex-1 overflow-auto">
        <div
          ref={contentRef}
          className="workspace-docx-preview select-text"
          onClickCapture={openLink}
          onAuxClickCapture={openLink}
        >
          <Suspense fallback={<div className="kun-office-state" role="status">{i18n.t('officeDocxOpening')}</div>}>
            <WorkspaceDocxPages
              source={source}
              fileName={result.name}
              zoom={zoom}
              scrollRef={scrollRef}
              handleRef={pagesRef}
              onPageInfo={handlePageInfo}
              onZoomChange={handleZoomChange}
              onLoaded={handleLoaded}
              onError={setError}
            />
          </Suspense>
        </div>
        {onQuoteSelection ? (
          <WorkspaceDocxSelectionToolbar
            bodyRef={contentRef}
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
