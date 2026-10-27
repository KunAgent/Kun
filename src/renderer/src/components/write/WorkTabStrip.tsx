import { useContext, useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { BookOpen, Columns2, Compass, Plus, X } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { WorkFileTypeIcon } from './WorkFileTypeIcon'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWorkSlotsStore } from '../../write/work-slots-store'
import { useWorkSessionStore } from '../../write/work-session-store'
import { writeWorkspaceKey } from '../../write/write-thread-registry'
import { openWorkSession, startWorkSession } from '../../write/work-session-actions'
import { useOpenSessionTabs, useWorkViewStore } from '../../write/work-view-store'
import { WorkStageChromeContext } from '../../write/work-conversation-stage'
import {
  isWriteFileTab,
  isWritePaperViewTab,
  isWriteWhiteboardTab,
  writeEditorItemKey
} from '../../write/write-editor-layout'
import type { WriteEditorGroupId, WriteEditorItem } from '../../write/write-workspace-store-types'

type DocumentTab = { key: string; groupId: WriteEditorGroupId; item: WriteEditorItem }

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * One row of tabs for the whole Work stage: every session is a tab of its own
 * next to the open files, papers and whiteboards. Picking a session shows the
 * conversation alone; picking a file shows the file alone; the split button
 * puts the two side by side.
 */
export function WorkTabStrip(): ReactElement | null {
  const { t } = useTranslation('common')
  const chrome = useContext(WorkStageChromeContext)
  const { workspaceRoot, layout, whiteboards, activateTab, closeTab } = useWriteWorkspaceStore(useShallow((state) => ({
    workspaceRoot: state.workspaceRoot,
    layout: state.editorLayout,
    whiteboards: state.whiteboards,
    activateTab: state.activateTab,
    closeTab: state.closeTab
  })))
  const sessionMain = useWorkSlotsStore((state) => state.assistantMain)
  const current = useWorkSessionStore((state) => state.current[writeWorkspaceKey(workspaceRoot)] ?? '')
  const titles = useWorkSessionStore((state) => state.titles)
  const busy = useChatStore((state) => state.busy)
  const openSessions = useOpenSessionTabs(workspaceRoot)
  const { split, peek, showSession, showDocument, toggleSplit, closeSessionTab } = useWorkViewStore(useShallow((state) => ({
    split: state.split,
    peek: state.peek,
    showSession: state.showSession,
    showDocument: state.showDocument,
    toggleSplit: state.toggleSplit,
    closeSessionTab: state.closeSessionTab
  })))
  // A file opened from anywhere else (home cards, the library, an Agent) must come on
  // stage; only the session's own chips peek or split instead.
  const focusedPath = (layout.groups.find((group) => group.id === layout.focusedGroupId) ?? layout.groups[0])?.activePath ?? ''
  const seenPath = useRef(focusedPath)
  useEffect(() => {
    if (seenPath.current === focusedPath) return
    seenPath.current = focusedPath
    if (focusedPath && sessionMain && !split && !peek) showDocument()
  }, [focusedPath, sessionMain, split, peek, showDocument])
  if (!workspaceRoot) return null

  const documents: DocumentTab[] = []
  for (const group of layout.groups) {
    for (const item of group.tabs) {
      const key = writeEditorItemKey(item)
      if (!documents.some((tab) => tab.key === key)) documents.push({ key, groupId: group.id, item })
    }
  }
  const focusedGroup = layout.groups.find((group) => group.id === layout.focusedGroupId) ?? layout.groups[0]
  const shownDocument = focusedGroup?.activePath ?? ''
  const hasDocuments = documents.length > 0
  const sessionOnStage = sessionMain || !hasDocuments
  const sessionIds = current && !openSessions.includes(current) ? [...openSessions, current] : openSessions
  const draftOpen = !current

  const documentLabel = (item: WriteEditorItem): string => {
    if (isWriteWhiteboardTab(item)) return whiteboards[item.boardId]?.title || t('writeCreateWhiteboard')
    if (isWritePaperViewTab(item)) return item.view === 'library' ? t('workSidebarLibrary') : t('workSidebarDiscover')
    return basename(item.path)
  }
  const documentIcon = (item: WriteEditorItem): ReactElement => {
    if (isWritePaperViewTab(item)) {
      const Icon = item.view === 'library' ? BookOpen : Compass
      return <Icon className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
    }
    if (isWriteWhiteboardTab(item)) return <WorkFileTypeIcon kind="whiteboard" size={16} />
    return <WorkFileTypeIcon name={isWriteFileTab(item) ? item.path : ''} size={16} />
  }

  const openSession = (id: string): void => {
    showSession()
    if (id === current) return
    void openWorkSession({ id, title: titles[id] ?? '', updatedAt: null, anchor: { kind: 'space' } }, undefined, { restoreWorkbench: false })
  }
  const closeSession = (id: string): void => {
    closeSessionTab(workspaceRoot, id)
    if (id !== current) return
    const next = sessionIds.find((other) => other !== id)
    if (next) openSession(next)
    else if (hasDocuments) showDocument()
  }
  const openDocument = (tab: DocumentTab): void => {
    activateTab(tab.groupId, tab.key)
    showDocument()
  }

  return (
    <div className="work-tab-strip ds-no-drag" data-work-tab-strip>
      {chrome ? (
        <div className={`flex shrink-0 items-center ${chrome.leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''}`}>
          <SidebarTitlebarToggleButton
            onClick={chrome.onToggleLeftSidebar}
            title={chrome.leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
            ariaLabel={chrome.leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
          />
        </div>
      ) : null}
      <div role="tablist" aria-label={t('workTabsLabel')} className="work-tab-list">
        {sessionIds.map((id) => {
          const selected = sessionOnStage && id === current
          return (
            <div key={`session:${id}`} className="work-tab" data-kind="session" data-selected={selected ? 'true' : undefined}>
              <button type="button" role="tab" aria-selected={selected} className="work-tab-main" title={titles[id] || t('workSessionNew')}
                onClick={() => openSession(id)}>
                <span className="work-tab-session-mark" aria-hidden="true">K</span>
                <span className="work-tab-label">{titles[id] || t('workSessionNew')}</span>
                {busy && id === current ? <span className="work-tab-running" aria-label={t('sidebarThreadRunning')} /> : null}
              </button>
              <button type="button" className="work-tab-close" aria-label={t('workTabClose')} title={t('workTabClose')}
                onClick={() => closeSession(id)}>
                <X className="h-3 w-3" strokeWidth={2.4} />
              </button>
            </div>
          )
        })}
        {draftOpen ? (
          <div className="work-tab" data-kind="session" data-selected={sessionOnStage ? 'true' : undefined}>
            <button type="button" role="tab" aria-selected={sessionOnStage} className="work-tab-main" onClick={showSession}>
              <span className="work-tab-session-mark" aria-hidden="true">K</span>
              <span className="work-tab-label">{t('workSessionNew')}</span>
            </button>
          </div>
        ) : null}
        {documents.map((tab) => {
          const selected = !sessionOnStage && tab.key === shownDocument
          const beside = sessionOnStage && (split || peek) && tab.key === shownDocument
          return (
            <div key={tab.key} className="work-tab" data-kind="document" data-selected={selected ? 'true' : undefined}
              data-beside={beside ? 'true' : undefined}>
              <button type="button" role="tab" aria-selected={selected} className="work-tab-main" title={documentLabel(tab.item)}
                onClick={() => openDocument(tab)}>
                <span className="work-tab-icon">{documentIcon(tab.item)}</span>
                <span className="work-tab-label">{documentLabel(tab.item)}</span>
              </button>
              <button type="button" className="work-tab-close" aria-label={t('workTabClose')} title={t('workTabClose')}
                onClick={() => void closeTab(tab.groupId, tab.key)}>
                <X className="h-3 w-3" strokeWidth={2.4} />
              </button>
            </div>
          )
        })}
        <button type="button" className="work-tab-add" aria-label={t('workSidebarNewSession')} title={t('workSidebarNewSession')}
          onClick={() => {
            showSession()
            void startWorkSession()
          }}>
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {hasDocuments ? (
        <button type="button" className="work-tab-split" aria-pressed={split} aria-label={t('workTabSplit')} title={t('workTabSplit')}
          onClick={toggleSplit}>
          <Columns2 className="h-4 w-4" strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  )
}

/** Title row of the file shown beside a session: open it as its own tab, or close the peek / split. */
export function WorkSideDocumentHeader({ mode }: { mode: 'peek' | 'split' }): ReactElement | null {
  const { t } = useTranslation('common')
  const layout = useWriteWorkspaceStore((state) => state.editorLayout)
  const whiteboards = useWriteWorkspaceStore((state) => state.whiteboards)
  const { showDocument, setPeek, toggleSplit } = useWorkViewStore(useShallow((state) => ({
    showDocument: state.showDocument,
    setPeek: state.setPeek,
    toggleSplit: state.toggleSplit
  })))
  const group = layout.groups.find((candidate) => candidate.id === layout.focusedGroupId) ?? layout.groups[0]
  const item = group?.tabs.find((tab) => writeEditorItemKey(tab) === group.activePath)
  if (!item) return null
  const label = isWriteWhiteboardTab(item)
    ? whiteboards[item.boardId]?.title || t('writeCreateWhiteboard')
    : isWritePaperViewTab(item) ? t('workSidebarLibrary') : basename(item.path)
  return (
    <div className="work-side-document-header" data-mode={mode}>
      <span className="work-tab-icon">
        {isWriteFileTab(item) ? <WorkFileTypeIcon name={item.path} size={16} /> : <BookOpen className="h-3.5 w-3.5" strokeWidth={1.9} />}
      </span>
      <span className="work-side-document-title">{label}</span>
      {mode === 'peek' ? (
        <button type="button" className="work-side-document-action" onClick={showDocument}>
          {t('workPeekOpenTab')}
        </button>
      ) : null}
      <button type="button" className="work-side-document-close" aria-label={mode === 'peek' ? t('workPeekClose') : t('workSplitClose')}
        title={mode === 'peek' ? t('workPeekClose') : t('workSplitClose')}
        onClick={() => (mode === 'peek' ? setPeek(false) : toggleSplit())}>
        <X className="h-3 w-3" strokeWidth={2.4} />
      </button>
    </div>
  )
}
