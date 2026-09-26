import { useRef, useState, type ReactElement } from 'react'
import {
  AlertCircle,
  ChevronDown,
  FileImage,
  FileSpreadsheet,
  FilePlus2,
  FileText,
  LibraryBig,
  Loader2,
  MoreHorizontal,
  Newspaper,
  PanelLeftClose,
  PanelRight,
  PanelTop,
  Plus,
  Rss,
  Search,
  Shapes,
  Trophy,
  Presentation,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  WriteDocumentSession,
  WriteEditorGroup,
  WriteEditorGroupId,
  WriteEditorItem,
  WorkWhiteboard
} from '../../write/write-workspace-store'
import { writeBasenameFromPath } from '../../write/write-workspace-store'
import {
  isWriteFileTab,
  isWritePaperViewTab,
  isWriteWhiteboardTab,
  writeEditorItemKey
} from '../../write/write-editor-layout'
import type { WritePaperViewId } from '../../write/write-workspace-store-types'
import { usePaperTabLabel } from '../../paper/use-paper-tab-label'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { WriteAssistantPanelToggleIcon } from './WriteAssistantIcons'

type Props = {
  group: WriteEditorGroup
  documentsByPath: Record<string, WriteDocumentSession>
  whiteboards?: Record<string, WorkWhiteboard>
  focused: boolean
  primary: boolean
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onActivate: (path: string) => void
  onClose: (path: string) => void
  onMove: (path: string, from: WriteEditorGroupId, to: WriteEditorGroupId, index?: number) => void
  onCreateDraft: () => void
  onCreateWhiteboard?: () => void
  onQuickOpen: () => void
  onSplit: (orientation: 'horizontal' | 'vertical') => void
  onCloseGroup: () => void
  hasSecondGroup: boolean
  assistantOpen: boolean
  showAssistantToggle: boolean
  onToggleAssistant: () => void
}

function fileIcon(document: WriteDocumentSession | undefined): ReactElement {
  if (document?.kind === 'image') return <FileImage className="h-3.5 w-3.5" strokeWidth={1.9} />
  if (document?.officePreview?.viewer === 'spreadsheet') return <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={1.9} />
  if (document?.officePreview?.viewer === 'presentation') return <Presentation className="h-3.5 w-3.5" strokeWidth={1.9} />
  return <FileText className="h-3.5 w-3.5" strokeWidth={1.9} />
}

const PAPER_VIEW_ICONS: Record<WritePaperViewId, ReactElement> = {
  library: <LibraryBig className="h-3.5 w-3.5" strokeWidth={1.9} />,
  'discover:search': <Search className="h-3.5 w-3.5" strokeWidth={1.9} />,
  'discover:arxiv': <Newspaper className="h-3.5 w-3.5" strokeWidth={1.9} />,
  'discover:feeds': <Rss className="h-3.5 w-3.5" strokeWidth={1.9} />,
  'discover:venue': <Trophy className="h-3.5 w-3.5" strokeWidth={1.9} />
}

function paperViewLabelKey(view: WritePaperViewId): string {
  return view === 'library'
    ? 'writePaperModeLibraryView'
    : `writePaperDiscoverTab_${view.slice('discover:'.length)}`
}

/**
 * Tab label resolver (U1): paper-view tabs get a fixed icon + i18n label; file
 * tabs inside a paper unit show the paper title (PDF) or title + kind suffix
 * (NOTES.md, -解读*.md) instead of the raw filename.
 */
function WriteEditorTabTitle({
  tab,
  document,
  board
}: {
  tab: WriteEditorItem
  document: WriteDocumentSession | undefined
  board: WorkWhiteboard | undefined
}): ReactElement {
  const { t } = useTranslation('common')
  const paperLabel = usePaperTabLabel(isWriteFileTab(tab) ? tab.path : null)
  if (isWritePaperViewTab(tab)) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        {PAPER_VIEW_ICONS[tab.view]}
        <span className="min-w-0 truncate">{t(paperViewLabelKey(tab.view))}</span>
      </span>
    )
  }
  const icon = board ? <Shapes className="h-3.5 w-3.5" strokeWidth={1.9} /> : fileIcon(document)
  const label = isWriteWhiteboardTab(tab)
    ? board?.title ?? t('rightPanelWhiteboard')
    : paperLabel
      ? paperLabel.kind === 'pdf'
        ? paperLabel.title
        : `${paperLabel.title} · ${t(
            paperLabel.kind === 'notes'
              ? 'writePaperTabNotes'
              : paperLabel.kind === 'interpretation'
                ? 'writePaperTabInterpret'
                : 'writePaperTabFile'
          )}`
      : writeBasenameFromPath(tab.path)
  return (
    <span className="flex min-w-0 items-center gap-2" title={isWriteFileTab(tab) ? tab.path : undefined}>
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}

function statusMark(document: WriteDocumentSession | undefined): ReactElement | null {
  if (document?.saveStatus === 'saving') return <Loader2 className="h-3 w-3 animate-spin text-sky-500" />
  if (document?.saveStatus === 'error') return <AlertCircle className="h-3 w-3 text-red-500" />
  if (document?.saveStatus === 'dirty') return <span className="h-2 w-2 rounded-full bg-amber-500" />
  return null
}

export function WriteEditorTabBar({
  group,
  documentsByPath,
  whiteboards = {},
  focused,
  primary,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onActivate,
  onClose,
  onMove,
  onCreateDraft,
  onCreateWhiteboard = () => undefined,
  onQuickOpen,
  onSplit,
  onCloseGroup,
  hasSecondGroup,
  assistantOpen,
  showAssistantToggle,
  onToggleAssistant
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [addOpen, setAddOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const dragPathRef = useRef<string | null>(null)

  return (
    <div className={`write-editor-tabbar flex min-h-[44px] min-w-0 items-stretch border-b bg-ds-card/88 ${focused ? 'border-accent/35' : 'border-ds-border-muted'}`}>
      {primary ? (
        <div className={`flex shrink-0 items-center px-2 ${leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''}`}>
          <SidebarTitlebarToggleButton
            onClick={onToggleLeftSidebar}
            title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
            ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
          />
        </div>
      ) : null}
      <div
        role="tablist"
        aria-label={t('writeOpenFiles')}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const path = event.dataTransfer.getData('application/x-kun-write-tab') || dragPathRef.current
          const from = event.dataTransfer.getData('application/x-kun-write-group') as WriteEditorGroupId
          if (path && from) onMove(path, from, group.id)
        }}
      >
        {group.tabs.map((tab, index) => {
          const key = writeEditorItemKey(tab)
          const pinned = isWritePaperViewTab(tab) && tab.view === 'library'
          const board = isWriteWhiteboardTab(tab) ? whiteboards[tab.boardId] : undefined
          const document = isWriteFileTab(tab) ? documentsByPath[tab.path] : undefined
          const active = group.activePath === key
          return (
            <div
              key={key}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              draggable
              onDragStart={(event) => {
                dragPathRef.current = key
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('application/x-kun-write-tab', key)
                event.dataTransfer.setData('application/x-kun-write-group', group.id)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const path = event.dataTransfer.getData('application/x-kun-write-tab') || dragPathRef.current
                const from = event.dataTransfer.getData('application/x-kun-write-group') as WriteEditorGroupId
                if (path && from) onMove(path, from, group.id, index)
              }}
              onClick={() => onActivate(key)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onActivate(key)
                  return
                }
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const tabs = Array.from(
                  event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []
                )
                const current = tabs.indexOf(event.currentTarget)
                const next = event.key === 'Home' ? 0
                  : event.key === 'End' ? tabs.length - 1
                    : event.key === 'ArrowLeft' ? Math.max(0, current - 1)
                      : Math.min(tabs.length - 1, current + 1)
                tabs[next]?.focus()
                const nextTab = group.tabs[next]
                if (nextTab) onActivate(writeEditorItemKey(nextTab))
              }}
              onAuxClick={(event) => {
                if (event.button === 1 && !pinned) onClose(key)
              }}
              className={`group relative flex max-w-[220px] shrink-0 cursor-default items-center gap-2 border-r border-ds-border-muted px-3 text-[12.5px] transition ${
                active ? 'bg-ds-card font-semibold text-ds-ink' : 'bg-ds-hover/35 text-ds-muted hover:bg-ds-hover/70'
              }`}
            >
              <span className={`flex min-w-0 flex-1 items-center ${active ? 'text-ds-ink [&_svg]:text-accent' : 'text-ds-muted [&_svg]:text-ds-faint'}`}>
                <WriteEditorTabTitle tab={tab} document={document} board={board} />
              </span>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {pinned ? null : (
                  <>
                    <span className="group-hover:hidden">{statusMark(document)}</span>
                    <button
                      type="button"
                      className="hidden h-5 w-5 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink group-hover:flex"
                      title={t('writeCloseTab')}
                      aria-label={t('writeCloseTab')}
                      onClick={(event) => {
                        event.stopPropagation()
                        onClose(key)
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </span>
              {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" /> : null}
            </div>
          )
        })}
      </div>

      <div className="relative flex shrink-0 items-center gap-0.5 border-l border-ds-border-muted px-1.5">
        <button type="button" className="write-tabbar-action" onClick={() => setAddOpen((open) => !open)} title={t('writeAddTab')} aria-label={t('writeAddTab')}>
          <Plus className="h-4 w-4" />
        </button>
        {addOpen ? (
          <div className="absolute right-0 top-full z-40 mt-1.5 w-48 rounded-xl border border-ds-border bg-ds-card p-1.5 shadow-xl">
            <button type="button" className="write-tabbar-menu-item" onClick={() => { setAddOpen(false); onCreateDraft() }}>
              <FilePlus2 className="h-4 w-4" />{t('writeNewMarkdown')}
            </button>
            <button type="button" className="write-tabbar-menu-item" onClick={() => { setAddOpen(false); onCreateWhiteboard() }}>
              <Shapes className="h-4 w-4" />{t('writeCreateWhiteboard', { defaultValue: 'New whiteboard' })}
            </button>
            <div className="my-1 h-px bg-ds-border-muted" />
            <button type="button" className="write-tabbar-menu-item" onClick={() => { setAddOpen(false); onQuickOpen() }}>
              <Search className="h-4 w-4" />{t('writeQuickOpen')}
            </button>
          </div>
        ) : null}
        <button type="button" className="write-tabbar-action" onClick={() => onSplit('horizontal')} title={t('writeSplitRight')} aria-label={t('writeSplitRight')}>
          <PanelRight className="h-4 w-4" />
        </button>
        {showAssistantToggle ? (
          <>
            <span className="write-tabbar-action-divider" aria-hidden="true" />
            <button
              type="button"
              className="write-tabbar-action write-assistant-toggle"
              data-active={assistantOpen}
              aria-pressed={assistantOpen}
              onClick={onToggleAssistant}
              title={t('writeToggleAssistant')}
              aria-label={t('writeToggleAssistant')}
            >
              <WriteAssistantPanelToggleIcon className="h-[18px] w-[18px]" />
            </button>
          </>
        ) : null}
        <button type="button" className="write-tabbar-action" onClick={() => setOverflowOpen((open) => !open)} title={t('writeMoreActions')} aria-label={t('writeMoreActions')}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {overflowOpen ? (
          <div className="absolute right-0 top-full z-40 mt-1.5 w-52 rounded-xl border border-ds-border bg-ds-card p-1.5 shadow-xl">
            <button type="button" className="write-tabbar-menu-item" onClick={() => { setOverflowOpen(false); onSplit('horizontal') }}>
              <PanelRight className="h-4 w-4" />{t('writeSplitRight')}
            </button>
            <button type="button" className="write-tabbar-menu-item" onClick={() => { setOverflowOpen(false); onSplit('vertical') }}>
              <PanelTop className="h-4 w-4" />{t('writeSplitDown')}
            </button>
            {hasSecondGroup ? (
              <button type="button" className="write-tabbar-menu-item" onClick={() => { setOverflowOpen(false); onCloseGroup() }}>
                <PanelLeftClose className="h-4 w-4" />{t('writeCloseGroup')}
              </button>
            ) : null}
            {group.tabs.length > 0 ? <div className="my-1 h-px bg-ds-border-muted" /> : null}
            {group.tabs.map((tab) => (
              <button key={writeEditorItemKey(tab)} type="button" className="write-tabbar-menu-item" onClick={() => { setOverflowOpen(false); onActivate(writeEditorItemKey(tab)) }}>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <WriteEditorTabTitle
                    tab={tab}
                    document={isWriteFileTab(tab) ? documentsByPath[tab.path] : undefined}
                    board={isWriteWhiteboardTab(tab) ? whiteboards[tab.boardId] : undefined}
                  />
                </span>
                {group.activePath === writeEditorItemKey(tab) ? <ChevronDown className="h-3.5 w-3.5 text-accent" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
