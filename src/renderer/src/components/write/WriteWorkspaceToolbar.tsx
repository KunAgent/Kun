import type { ReactElement, ReactNode, RefObject } from 'react'
import {
  BookOpen,
  Copy,
  Images,
  FileCode2,
  FileText,
  Loader2,
  Presentation,
  Save,
  Search,
  Share,
  WandSparkles
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WriteExportFormat } from '@shared/write-export'
import type { WriteSaveStatus } from '../../write/write-workspace-store'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { WriteFontSizeControl } from './WriteFontSizeControl'
import {
  WRITE_EXPORT_FORMATS,
  exportFormatLabel,
  toolbarIconButtonClass
} from './write-workspace-view-utils'

type Props = {
  embedded?: boolean
  showSidebarToggle?: boolean
  activeFileIsImage: boolean
  activeFileIsPdf?: boolean
  activeFileIsOffice?: boolean
  activeFileIsEditableSpreadsheet?: boolean
  activeFileIsCode?: boolean
  activeFileIsText: boolean
  activeFileLabel: string
  activeFileName: string
  activeFilePath: string
  /** Rich-surface format bar shown at the leading edge (markdown only). */
  formatToolbar?: ReactNode
  onOpenFind?: (() => void) | null
  inlineCompletionEnabled: boolean
  exportInFlight: boolean
  exportMenuOpen: boolean
  exportMenuRef: RefObject<HTMLDivElement | null>
  leftSidebarCollapsed: boolean
  /** Single-view surface state for the text file (§8.3). */
  isMarkdown: boolean
  surfacePlain: boolean
  onToggleSurface: () => void
  onCopyRichText: () => void
  onCopyMarkdown?: (() => void) | null
  onCopyXArticle: () => void
  onCopyXArticleImage: () => void
  xArticleImageCount: number
  xArticleImageIndex: number
  onExportFile: (format: WriteExportFormat) => void
  onGeneratePresentation: () => void
  onSave: () => void
  onToggleInlineCompletion: () => void
  onToggleLeftSidebar: () => void
  presentationEnabled: boolean
  presentationInFlight: boolean
  readOnly: boolean
  saveLabel: string
  saveStatus: WriteSaveStatus
  setExportMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void
}

export function WriteWorkspaceToolbar({
  embedded = false,
  showSidebarToggle = true,
  activeFileIsImage,
  activeFileIsPdf = false,
  activeFileIsOffice = false,
  activeFileIsEditableSpreadsheet = false,
  activeFileIsCode = false,
  activeFileIsText,
  activeFileLabel,
  activeFileName,
  activeFilePath,
  formatToolbar,
  onOpenFind,
  inlineCompletionEnabled,
  exportInFlight,
  exportMenuOpen,
  exportMenuRef,
  leftSidebarCollapsed,
  isMarkdown,
  surfacePlain,
  onToggleSurface,
  onCopyRichText,
  onCopyMarkdown,
  onCopyXArticle,
  onCopyXArticleImage,
  xArticleImageCount,
  xArticleImageIndex,
  onExportFile,
  onGeneratePresentation,
  onSave,
  onToggleInlineCompletion,
  onToggleLeftSidebar,
  presentationEnabled,
  presentationInFlight,
  readOnly,
  saveLabel,
  saveStatus,
  setExportMenuOpen
}: Props): ReactElement {
  const { t } = useTranslation('common')
  if (activeFileIsPdf || activeFileIsOffice || activeFileIsCode) {
    return (
      <div className={embedded ? 'shrink-0' : `ds-stage-inset shrink-0 -mr-3 sm:-mr-4 md:-mr-6 lg:-mr-8 ${leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : '-ml-3 sm:-ml-4 md:-ml-6 lg:-ml-8'}`}>
        <header className={`ds-topbar-surface write-pdf-topbar relative z-10 flex min-h-[52px] w-full items-stretch overflow-visible ${embedded ? 'rounded-none border-x-0 border-t-0' : 'mt-3 rounded-[18px]'}`}>
          <div className="write-pdf-topbar-grid grid w-full min-w-0 items-center gap-2 px-3 py-2 sm:px-4 md:pl-5 md:pr-3">
            <div
              className={`flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
              }`}
            >
              {showSidebarToggle ? (
                <SidebarTitlebarToggleButton
                  onClick={onToggleLeftSidebar}
                  title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                  ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                />
              ) : null}
              <span className="write-pdf-topbar-file-icon">
                {activeFileIsCode
                  ? <FileCode2 className="h-4 w-4" strokeWidth={1.9} />
                  : <FileText className="h-4 w-4" strokeWidth={1.9} />}
              </span>
              <div className="min-w-0 flex-1 leading-none">
                <div className="truncate text-[15px] font-semibold text-ds-ink">
                  {activeFileName}
                </div>
                <div className="mt-1.5 truncate text-[12px] text-ds-faint">
                  {activeFileLabel}
                </div>
              </div>
            </div>

            <div className="write-pdf-topbar-status">
              <BookOpen className="h-4 w-4" strokeWidth={1.85} />
              <span>
                {activeFileIsOffice
                  ? activeFileIsEditableSpreadsheet ? t('writeSpreadsheetEditable') : t('writeOfficePreview')
                  : activeFileIsCode
                    ? t('writeModeSource')
                    : t('writePdfPreview')}
              </span>
              <span className="write-pdf-topbar-dot" aria-hidden="true" />
              <span>{activeFileIsEditableSpreadsheet ? saveLabel : t('writeReadOnly')}</span>
            </div>

            <div className="write-pdf-topbar-actions">
              {activeFileIsEditableSpreadsheet ? (
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saveStatus === 'saved' || saveStatus === 'saving'}
                  className={`${toolbarIconButtonClass} disabled:cursor-default disabled:opacity-45`}
                  title={saveLabel}
                  aria-label={saveLabel}
                >
                  {saveStatus === 'saving'
                    ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
                    : <Save className="h-4 w-4" strokeWidth={1.9} />}
                </button>
              ) : null}
            </div>
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="shrink-0">
      <header className="write-format-bar">
        <div className="flex min-w-0 flex-1 items-center">
          {formatToolbar ?? (
            <span className="truncate px-2 text-[12.5px] text-ds-faint">{activeFileLabel}</span>
          )}
        </div>
        <div className="write-format-bar-trailing">
          {activeFileIsText ? <WriteFontSizeControl /> : null}
          <button
            type="button"
            onClick={onToggleInlineCompletion}
            disabled={!activeFileIsText || readOnly}
            data-inline-completion-state={inlineCompletionEnabled ? 'on' : 'off'}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-40 ${
              inlineCompletionEnabled ? 'text-accent hover:bg-accent/10' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
            }`}
            title={`${t(inlineCompletionEnabled ? 'writeInlineCompletionOn' : 'writeInlineCompletionOff')} · ${t('writeInlineCompletionShortcut')}`}
            aria-label={t(inlineCompletionEnabled ? 'writeInlineCompletionOn' : 'writeInlineCompletionOff')}
            aria-pressed={inlineCompletionEnabled}
          >
            <WandSparkles className="h-4 w-4" strokeWidth={1.9} />
            <span className="hidden 2xl:inline">{t('writeInlineCompletionToggle')}</span>
            <span
              aria-hidden="true"
              className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${
                inlineCompletionEnabled ? 'bg-accent' : 'bg-slate-300 dark:bg-white/20'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                  inlineCompletionEnabled ? 'translate-x-3' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
          <span className="write-format-toolbar-separator" aria-hidden="true" />
          <button
            type="button"
            onClick={onGeneratePresentation}
            disabled={!presentationEnabled || presentationInFlight}
            className="write-format-toolbar-button"
            title={presentationInFlight ? t('writePptPreparing') : presentationEnabled ? t('writePptGenerate') : t('writePptMarkdownOnly')}
            aria-label={presentationInFlight ? t('writePptPreparing') : presentationEnabled ? t('writePptGenerate') : t('writePptMarkdownOnly')}
          >
            {presentationInFlight
              ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
              : <Presentation className="h-4 w-4" strokeWidth={1.9} />}
          </button>
          <div ref={exportMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setExportMenuOpen((open) => !open)}
              disabled={!activeFilePath || !activeFileIsText || exportInFlight}
              className="write-format-toolbar-button"
              data-pressed={exportMenuOpen || undefined}
              title={exportInFlight ? t('writeExporting') : t('writeExport')}
              aria-label={exportInFlight ? t('writeExporting') : t('writeExport')}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
            >
              {exportInFlight
                ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
                : <Share className="h-4 w-4" strokeWidth={1.9} />}
            </button>
            {exportMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-2 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-ds-border bg-ds-card/95 p-1.5 shadow-[0_22px_48px_rgba(20,47,95,0.16)] backdrop-blur-xl"
              >
                {activeFileIsText && isMarkdown ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onToggleSurface()
                      setExportMenuOpen(false)
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover/80"
                  >
                    <span>{t(surfacePlain ? 'writeOpenAsDocument' : 'writeOpenAsPlainText')}</span>
                    <FileCode2 className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={onCopyRichText}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover/80"
                >
                  <span>{t('writeCopyRichText')}</span>
                  <Copy className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
                </button>
                {activeFileIsText && isMarkdown && onCopyMarkdown ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onCopyMarkdown()
                      setExportMenuOpen(false)
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover/80"
                  >
                    <span>{t('writeCopyMarkdown')}</span>
                    <Copy className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={onCopyXArticle}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover/80"
                >
                  <span>{t('writeCopyXArticle')}</span>
                  <Copy className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={xArticleImageCount <= 0}
                  onClick={onCopyXArticleImage}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover/80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span>
                    {xArticleImageCount > 0
                      ? t('writeCopyXArticleImage', {
                          current: xArticleImageIndex + 1,
                          total: xArticleImageCount
                        })
                      : t('writeCopyXArticleImageEmpty')}
                  </span>
                  <Images className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
                </button>
                <div className="my-1 h-px bg-ds-border-muted" />
                {WRITE_EXPORT_FORMATS.map((format) => (
                  <button
                    key={format}
                    type="button"
                    role="menuitem"
                    onClick={() => onExportFile(format)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover/80"
                  >
                    <span>{exportFormatLabel(format, t)}</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ds-faint">
                      {format}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {onOpenFind ? (
            <button
              type="button"
              onClick={onOpenFind}
              className="write-format-toolbar-button"
              title={`${t('writeToolbarFind')} · ⌘/Ctrl + F`}
              aria-label={t('writeToolbarFind')}
            >
              <Search className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
      </header>
    </div>
  )
}
