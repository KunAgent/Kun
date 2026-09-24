import type { ReactElement } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Minus,
  PanelLeft,
  Plus,
  Search
} from 'lucide-react'
import type { TFunction } from 'i18next'
import { formatSize } from '../../write/WritePdfPage'

/**
 * Reader toolbar: back-to-library + drawer toggle on the left, then the same
 * zoom/page/search cluster as the ordinary PDF viewer.
 */
export function PaperReaderToolbar({
  t,
  filePath,
  workspaceRoot,
  size,
  scale,
  setScale,
  currentPage,
  pageInput,
  setPageInput,
  pageCount,
  scrollToPage,
  searchQuery,
  setSearchQuery,
  searchMatches,
  searchIndex,
  jumpSearch,
  drawerOpen,
  onToggleDrawer,
  onBackToLibrary
}: {
  t: TFunction
  filePath: string
  workspaceRoot: string
  size: number
  scale: number
  setScale: (fn: (value: number) => number) => void
  currentPage: number
  pageInput: string
  setPageInput: (value: string) => void
  pageCount: number
  scrollToPage: (page: number) => void
  searchQuery: string
  setSearchQuery: (value: string) => void
  searchMatches: number[]
  searchIndex: number
  jumpSearch: (direction: 1 | -1) => void
  drawerOpen: boolean
  onToggleDrawer: () => void
  onBackToLibrary: () => void
}): ReactElement {
  return (
    <div className="write-pdf-toolbar shrink-0 border-b border-ds-border-muted bg-white/88 px-3 py-2 dark:bg-ds-card/95">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          className="write-pdf-icon-button"
          title={t('writePaperReaderBackToLibrary')}
          aria-label={t('writePaperReaderBackToLibrary')}
          onClick={onBackToLibrary}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          className={`write-pdf-icon-button ${drawerOpen ? 'bg-ds-accent/15 text-ds-accent' : ''}`}
          title={t('writePaperReaderDrawer')}
          aria-label={t('writePaperReaderDrawer')}
          onClick={onToggleDrawer}
        >
          <PanelLeft className="h-4 w-4" strokeWidth={1.9} />
        </button>
        <div className="min-w-0 flex-1 truncate text-[12px] text-ds-muted">
          {formatSize(size)} · {workspaceRoot ? filePath.replace(`${workspaceRoot}/`, '') : filePath}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
          <button
            type="button"
            className="write-pdf-icon-button"
            title={t('writePdfZoomOut')}
            aria-label={t('writePdfZoomOut')}
            onClick={() => setScale((value) => Math.max(0.5, Number((value - 0.1).toFixed(2))))}
          >
            <Minus className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <span className="min-w-[52px] text-center text-[12px] font-semibold text-ds-muted">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            className="write-pdf-icon-button"
            title={t('writePdfZoomIn')}
            aria-label={t('writePdfZoomIn')}
            onClick={() => setScale((value) => Math.min(3, Number((value + 0.1).toFixed(2))))}
          >
            <Plus className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
          <button
            type="button"
            className="write-pdf-icon-button"
            title={t('writePdfPrevPage')}
            aria-label={t('writePdfPrevPage')}
            onClick={() => scrollToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              scrollToPage(Number(pageInput))
            }}
          >
            <input
              className="write-pdf-page-input"
              value={pageInput}
              aria-label={t('writePdfPageInput')}
              onChange={(event) => setPageInput(event.target.value)}
            />
            <span className="text-[12px] text-ds-faint">/ {pageCount || '-'}</span>
          </form>
          <button
            type="button"
            className="write-pdf-icon-button"
            title={t('writePdfNextPage')}
            aria-label={t('writePdfNextPage')}
            onClick={() => scrollToPage(currentPage + 1)}
            disabled={!pageCount || currentPage >= pageCount}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        <div className="flex min-w-[180px] flex-1 items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 dark:bg-white/6 sm:max-w-[260px]">
          <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
          <input
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
            value={searchQuery}
            placeholder={t('writePdfSearchPlaceholder')}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <span className="shrink-0 text-[11px] text-ds-faint">
            {searchQuery.trim() ? `${searchMatches.length ? searchIndex + 1 : 0}/${searchMatches.length}` : ''}
          </span>
          <button
            type="button"
            className="write-pdf-icon-button"
            title={t('writePdfPrevMatch')}
            aria-label={t('writePdfPrevMatch')}
            disabled={searchMatches.length === 0}
            onClick={() => jumpSearch(-1)}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="write-pdf-icon-button"
            title={t('writePdfNextMatch')}
            aria-label={t('writePdfNextMatch')}
            disabled={searchMatches.length === 0}
            onClick={() => jumpSearch(1)}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </div>
  )
}
