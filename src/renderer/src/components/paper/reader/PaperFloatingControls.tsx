import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Bot,
  BoxSelect,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileDown,
  Languages,
  LayoutPanelLeft,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  NotebookPen,
  PanelLeft,
  Plus,
  Search,
  X
} from 'lucide-react'
import type { TFunction } from 'i18next'
import type { WritePaperModeReaderSettingsV1 } from '@shared/app-settings-types-paper-mode'
import type { PaperReaderLayoutPreset } from '../../../paper/paper-reader-layout'

type Tone = WritePaperModeReaderSettingsV1['paperTone']
const TONES: Tone[] = ['white', 'sepia', 'green', 'dark']

const PILL =
  'pointer-events-auto flex items-center gap-0.5 rounded-full border border-ds-border bg-ds-elevated px-1.5 py-1 shadow-lg backdrop-blur'
const ICON = 'write-pdf-icon-button'

const LAYOUT_OPTIONS: ReadonlyArray<{
  preset: PaperReaderLayoutPreset
  icon: typeof BookOpen
  shortcut: string
}> = [
  { preset: 'read', icon: BookOpen, shortcut: '⌥1' },
  { preset: 'notes', icon: NotebookPen, shortcut: '⌥2' },
  { preset: 'assistant', icon: Bot, shortcut: '⌥3' }
]

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
  layoutPreset,
  onApplyLayout,
  immersive,
  onToggleImmersive,
  tone,
  setTone,
  translating,
  translateLabel,
  onTranslateDocument,
  onCancelTranslate,
  onToggleMirror,
  pageTranslating,
  pageTranslateProgress,
  onTranslatePagesToggle,
  marksCount,
  onExportNotes,
  regionSelectActive,
  onToggleRegionSelect
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
  layoutPreset: PaperReaderLayoutPreset
  onApplyLayout: (preset: PaperReaderLayoutPreset) => void
  immersive: boolean
  onToggleImmersive: () => void
  tone: Tone
  setTone: (tone: Tone) => void
  translating: boolean
  translateLabel: string | null
  onTranslateDocument: () => void
  onCancelTranslate: () => void
  /** R2.3: toggle the side-by-side translated mirror in the secondary group. */
  onToggleMirror: () => void
  /** R2.2: sequential per-page overlay translation running (click = stop). */
  pageTranslating: boolean
  /** "done/total" for the running page sweep. */
  pageTranslateProgress: string | null
  onTranslatePagesToggle: () => void
  marksCount: number
  onExportNotes: () => void
  /** R2.4: crosshair region-capture mode for figures/tables. */
  regionSelectActive: boolean
  onToggleRegionSelect: () => void
}): ReactElement {
  const [searchOpen, setSearchOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [translateMenuOpen, setTranslateMenuOpen] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const translateMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!translateMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (translateMenuRef.current && !translateMenuRef.current.contains(event.target as Node)) {
        setTranslateMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [translateMenuOpen])

  useEffect(() => {
    if (!layoutOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (layoutRef.current && !layoutRef.current.contains(event.target as Node)) {
        setLayoutOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [layoutOpen])

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
            className={`${ICON} ${drawerOpen ? 'bg-accent-tint/15 text-accent' : ''}`}
            title={t('writePaperReaderDrawer')}
            aria-label={t('writePaperReaderDrawer')}
            onClick={onToggleDrawer}
          >
            <PanelLeft className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <span className="mx-0.5 h-4 w-px bg-ds-border-muted" />
          <div ref={layoutRef} className="relative flex">
            <button
              type="button"
              className={`${ICON} ${layoutOpen ? 'bg-accent-tint/15 text-accent' : ''}`}
              title={t('writePaperReaderLayout')}
              aria-label={t('writePaperReaderLayout')}
              aria-expanded={layoutOpen}
              onClick={() => setLayoutOpen((open) => !open)}
            >
              <LayoutPanelLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            {layoutOpen ? (
              <div className="ds-no-drag absolute right-0 top-[calc(100%+8px)] w-[200px] rounded-xl border border-ds-border bg-ds-card p-1 shadow-xl">
                {LAYOUT_OPTIONS.map(({ preset, icon: Icon, shortcut }) => (
                  <button
                    key={preset}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition hover:bg-ds-hover ${
                      layoutPreset === preset ? 'text-accent' : 'text-ds-ink'
                    }`}
                    onClick={() => {
                      setLayoutOpen(false)
                      onApplyLayout(preset)
                    }}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                    <span className="min-w-0 flex-1">
                      {t(`writePaperReaderLayout_${preset}`)}
                    </span>
                    <kbd className="text-[10px] text-ds-faint">{shortcut}</kbd>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="mx-0.5 h-4 w-px bg-ds-border-muted" />
          <button
            type="button"
            className={`${ICON} ${searchOpen ? 'bg-accent-tint/15 text-accent' : ''}`}
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
          {translating || pageTranslating ? (
            <button
              type="button"
              className={`${ICON} text-accent`}
              title={
                pageTranslating
                  ? t('writePaperReaderTranslateStop')
                  : t('writePaperReaderTranslating')
              }
              aria-label={
                pageTranslating
                  ? `${t('writePaperReaderTranslateStop')} ${pageTranslateProgress ?? ''}`
                  : translateLabel ?? t('writePaperReaderTranslating')
              }
              onClick={pageTranslating ? onTranslatePagesToggle : onCancelTranslate}
            >
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
            </button>
          ) : (
            <div ref={translateMenuRef} className="relative flex">
              <button
                type="button"
                className={`${ICON} ${translateMenuOpen ? 'bg-accent-tint/15 text-accent' : ''}`}
                title={t('writePaperReaderTranslateDoc')}
                aria-label={t('writePaperReaderTranslateDoc')}
                aria-expanded={translateMenuOpen}
                onClick={() => setTranslateMenuOpen((open) => !open)}
              >
                <Languages className="h-4 w-4" strokeWidth={1.9} />
              </button>
              {translateMenuOpen ? (
                <div className="ds-no-drag absolute right-0 top-[calc(100%+8px)] w-[210px] rounded-xl border border-ds-border bg-ds-card p-1 shadow-xl">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
                    onClick={() => {
                      setTranslateMenuOpen(false)
                      onTranslatePagesToggle()
                    }}
                  >
                    <Languages className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                    {t('writePaperReaderTranslatePages')}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
                    onClick={() => {
                      setTranslateMenuOpen(false)
                      onTranslateDocument()
                    }}
                  >
                    <FileDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                    {t('writePaperReaderTranslateMarkdown')}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
                    onClick={() => {
                      setTranslateMenuOpen(false)
                      onToggleMirror()
                    }}
                  >
                    <Columns2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                    {t('writePaperReaderMirror')}
                  </button>
                </div>
              ) : null}
            </div>
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
          <span className="mx-0.5 h-4 w-px bg-ds-border-muted" />
          <button
            type="button"
            className={`${ICON} ${regionSelectActive ? 'bg-accent-tint/15 text-accent' : ''}`}
            title={`${t('writePaperReaderRegionSelect')} · ⌘.`}
            aria-label={t('writePaperReaderRegionSelect')}
            aria-pressed={regionSelectActive}
            onClick={onToggleRegionSelect}
          >
            <BoxSelect className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className={`${ICON} ${immersive ? 'bg-accent-tint/15 text-accent' : ''}`}
            title={`${t(immersive ? 'writePaperReaderExitImmersive' : 'writePaperReaderImmersive')} · F`}
            aria-label={t(immersive ? 'writePaperReaderExitImmersive' : 'writePaperReaderImmersive')}
            aria-pressed={immersive}
            onClick={onToggleImmersive}
          >
            {immersive ? (
              <Minimize2 className="h-4 w-4" strokeWidth={1.9} />
            ) : (
              <Maximize2 className="h-4 w-4" strokeWidth={1.9} />
            )}
          </button>
        </div>
      </div>
    </>
  )
}
