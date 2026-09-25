import { useState, type ReactElement } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Languages,
  Loader2,
  Minus,
  PanelLeft,
  Plus,
  Search,
  X
} from 'lucide-react'
import type { TFunction } from 'i18next'
import type { WritePaperModeReaderSettingsV1 } from '@shared/app-settings-types-paper-mode'

type Tone = WritePaperModeReaderSettingsV1['paperTone']
const TONES: Tone[] = ['white', 'sepia', 'green', 'dark']

const PILL =
  'pointer-events-auto flex items-center gap-0.5 rounded-full border border-ds-border bg-ds-card/92 px-1.5 py-1 shadow-lg backdrop-blur'
const ICON = 'write-pdf-icon-button'

/**
 * Floating reader chrome (U1): a compact pill pinned to the top-right corner
 * (back, drawer, search, zoom, translate-document, export notes) and a
 * page/theme capsule centered at the bottom edge. Both float above the PDF —
 * no fixed toolbar/bottom bar eats reading space.
 */
export function PaperFloatingControls({
  t,
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
  onBackToLibrary,
  tone,
  setTone,
  translating,
  translateLabel,
  onTranslateDocument,
  onCancelTranslate,
  marksCount,
  onExportNotes
}: {
  t: TFunction
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
  tone: Tone
  setTone: (tone: Tone) => void
  translating: boolean
  translateLabel: string | null
  onTranslateDocument: () => void
  onCancelTranslate: () => void
  marksCount: number
  onExportNotes: () => void
}): ReactElement {
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <>
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-start gap-1.5">
        <div className={PILL}>
          <button
            type="button"
            className={ICON}
            title={t('writePaperReaderBackToLibrary')}
            aria-label={t('writePaperReaderBackToLibrary')}
            onClick={onBackToLibrary}
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className={`${ICON} ${drawerOpen ? 'bg-accent/15 text-accent' : ''}`}
            title={t('writePaperReaderDrawer')}
            aria-label={t('writePaperReaderDrawer')}
            onClick={onToggleDrawer}
          >
            <PanelLeft className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <span className="mx-0.5 h-4 w-px bg-ds-border-muted" />
          <button
            type="button"
            className={`${ICON} ${searchOpen ? 'bg-accent/15 text-accent' : ''}`}
            title={t('writePdfSearchPlaceholder')}
            aria-label={t('writePdfSearchPlaceholder')}
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className={ICON}
            title={t('writePdfZoomOut')}
            aria-label={t('writePdfZoomOut')}
            onClick={() => setScale((value) => Math.max(0.5, Number((value - 0.1).toFixed(2))))}
          >
            <Minus className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <span className="min-w-[44px] text-center text-[11.5px] font-semibold text-ds-muted">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            className={ICON}
            title={t('writePdfZoomIn')}
            aria-label={t('writePdfZoomIn')}
            onClick={() => setScale((value) => Math.min(3, Number((value + 0.1).toFixed(2))))}
          >
            <Plus className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <span className="mx-0.5 h-4 w-px bg-ds-border-muted" />
          {translating ? (
            <button
              type="button"
              className={`${ICON} text-accent`}
              title={t('writePaperReaderTranslating')}
              aria-label={translateLabel ?? t('writePaperReaderTranslating')}
              onClick={onCancelTranslate}
            >
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
            </button>
          ) : (
            <button
              type="button"
              className={ICON}
              title={t('writePaperReaderTranslateDoc')}
              aria-label={t('writePaperReaderTranslateDoc')}
              onClick={onTranslateDocument}
            >
              <Languages className="h-4 w-4" strokeWidth={1.9} />
            </button>
          )}
          <button
            type="button"
            className={ICON}
            title={t('writePaperReaderExportNotes')}
            aria-label={t('writePaperReaderExportNotes')}
            disabled={marksCount === 0}
            onClick={onExportNotes}
          >
            <FileDown className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        {searchOpen ? (
          <div className={`${PILL} min-w-[220px]`}>
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
              value={searchQuery}
              placeholder={t('writePdfSearchPlaceholder')}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') jumpSearch(event.shiftKey ? -1 : 1)
                if (event.key === 'Escape') setSearchOpen(false)
              }}
            />
            <span className="shrink-0 text-[11px] text-ds-faint">
              {searchQuery.trim()
                ? `${searchMatches.length ? searchIndex + 1 : 0}/${searchMatches.length}`
                : ''}
            </span>
            <button
              type="button"
              className={ICON}
              title={t('writePdfPrevMatch')}
              aria-label={t('writePdfPrevMatch')}
              disabled={searchMatches.length === 0}
              onClick={() => jumpSearch(-1)}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className={ICON}
              title={t('writePdfNextMatch')}
              aria-label={t('writePdfNextMatch')}
              disabled={searchMatches.length === 0}
              onClick={() => jumpSearch(1)}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className={ICON}
              aria-label={t('close')}
              onClick={() => setSearchOpen(false)}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
        <div className={PILL}>
          <button
            type="button"
            className={ICON}
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
            <span className="text-[11.5px] text-ds-faint">/ {pageCount || '-'}</span>
          </form>
          <button
            type="button"
            className={ICON}
            title={t('writePdfNextPage')}
            aria-label={t('writePdfNextPage')}
            onClick={() => scrollToPage(currentPage + 1)}
            disabled={!pageCount || currentPage >= pageCount}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <span className="mx-0.5 h-4 w-px bg-ds-border-muted" />
          <div className="flex items-center gap-1 px-1" role="group" aria-label={t('writePaperReaderTone')}>
            {TONES.map((item) => (
              <button
                key={item}
                type="button"
                title={t(`writePaperReaderTone_${item}`)}
                aria-label={t(`writePaperReaderTone_${item}`)}
                aria-pressed={tone === item}
                className={`paper-tone-${item} h-[14px] w-[14px] rounded-full border ${
                  tone === item ? 'ring-2 ring-accent ring-offset-1' : 'border-black/15'
                }`}
                onClick={() => setTone(item)}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
