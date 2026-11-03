import { useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { BookOpen, Columns2, Compass, LibraryBig, Plus, Shapes, X } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { WorkFileTypeIcon } from './WorkFileTypeIcon'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWorkSlotsStore } from '../../write/work-slots-store'
import { useWorkSessionStore } from '../../write/work-session-store'
import { writeWorkspaceKey } from '../../write/write-thread-registry'
import { openWorkSession, startWorkSession } from '../../write/work-session-actions'
import { useOpenSessionTabs, useWorkViewStore, type WorkLibraryTab } from '../../write/work-view-store'
import { openArtifactsPage, useArtifactLibraryStore } from '../../artifacts/artifact-library-store'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { preparePaperNotesForNavigation } from '../../paper/paper-notes-draft'
import { WorkStageChromeContext } from '../../write/work-conversation-stage'
import { RailReopenButton } from '../workbench/rail-collapse'
import {
  isWriteFileTab,
  isWritePaperViewTab,
  isWriteWhiteboardTab,
  writeEditorItemKey
} from '../../write/write-editor-layout'
import type { WriteEditorGroupId, WriteEditorItem } from '../../write/write-workspace-store-types'
import { WorkTabContextMenu, type WorkTabMenuAction, type WorkTabMenuState } from './WorkTabContextMenu'
import { contextMenuPoint, type KunContextMenuPoint } from '../context-menu/KunContextMenu'
import { workTabCloseTargets, workTabMoveNeighbor, type WorkStripEntry, type WorkTabCloseScope } from './work-tab-menu-model'

type DocumentTab = { key: string; groupId: WriteEditorGroupId; item: WriteEditorItem }

const DRAFT_KEY = 'session:draft'

const CLOSE_SCOPES: Partial<Record<WorkTabMenuAction, WorkTabCloseScope>> = {
  close: 'self',
  closeOthers: 'others',
  closeRight: 'right',
  closeAll: 'all'
}

function absolutePath(workspaceRoot: string, path: string): string {
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(path)) return path
  return `${workspaceRoot.replace(/[\\/]+$/, '')}/${path}`
}

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
  const { workspaceRoot, layout, whiteboards, activateTab, closeTab, moveTab } = useWriteWorkspaceStore(useShallow((state) => ({
    workspaceRoot: state.workspaceRoot,
    layout: state.editorLayout,
    whiteboards: state.whiteboards,
    activateTab: state.activateTab,
    closeTab: state.closeTab,
    moveTab: state.moveTab
  })))
  const sessionMain = useWorkSlotsStore((state) => state.assistantMain)
  const current = useWorkSessionStore((state) => state.current[writeWorkspaceKey(workspaceRoot)] ?? '')
  const titles = useWorkSessionStore((state) => state.titles)
  const busy = useChatStore((state) => state.busy)
  const route = useChatStore((state) => state.route)
  const artifactSource = useArtifactLibraryStore((state) => state.source)
  const artifactRoot = useArtifactLibraryStore((state) => state.workRoot)
  const activeLibrary: WorkLibraryTab | null = route === 'papers' ? 'papers'
    : route === 'artifacts' && artifactSource === 'work' ? 'artifacts' : null
  const openSessions = useOpenSessionTabs(workspaceRoot)
  const { split, peek, libraryTabs, openLibraryTab, closeLibraryTab, showSession, showDocument, toggleSplit, closeSessionTab, reorderSessionTabs } = useWorkViewStore(useShallow((state) => ({
    split: state.split,
    peek: state.peek,
    libraryTabs: state.libraryTabs,
    openLibraryTab: state.openLibraryTab,
    closeLibraryTab: state.closeLibraryTab,
    showSession: state.showSession,
    showDocument: state.showDocument,
    toggleSplit: state.toggleSplit,
    closeSessionTab: state.closeSessionTab,
    reorderSessionTabs: state.reorderSessionTabs
  })))
  const [menu, setMenu] = useState<{ key: string; point: KunContextMenuPoint } | null>(null)
  const dismissMenu = useCallback(() => setMenu(null), [])
  useEffect(() => {
    if (activeLibrary) openLibraryTab(activeLibrary)
  }, [activeLibrary, openLibraryTab])
  useEffect(() => {
    if (activeLibrary === 'artifacts' && normalizeWorkspaceRoot(artifactRoot ?? '') !== normalizeWorkspaceRoot(workspaceRoot)) {
      openArtifactsPage({ from: 'work', workRoot: workspaceRoot })
    }
  }, [activeLibrary, artifactRoot, workspaceRoot])
  // A file opened from anywhere else (home cards, the library, an Agent) must come on
  // stage; only the session's own chips peek or split instead.
  const focusedPath = (layout.groups.find((group) => group.id === layout.focusedGroupId) ?? layout.groups[0])?.activePath ?? ''
  const seenPath = useRef(focusedPath)
  useEffect(() => {
    if (seenPath.current === focusedPath) return
    seenPath.current = focusedPath
    if (focusedPath && sessionMain && !split && !peek) showDocument()
  }, [focusedPath, sessionMain, split, peek, showDocument])
  // Keep the tab on stage in view when the row overflows.
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  })
  if (!workspaceRoot && !activeLibrary && libraryTabs.length === 0) return null

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
  const sessionOnStage = !activeLibrary && (sessionMain || !hasDocuments)
  const sessionIds = current && !openSessions.includes(current) ? [...openSessions, current] : openSessions
  const draftOpen = Boolean(workspaceRoot) && !current
  const visibleLibraries = activeLibrary && !libraryTabs.includes(activeLibrary) ? [...libraryTabs, activeLibrary] : libraryTabs
  const entries: WorkStripEntry[] = [
    ...sessionIds.map((id): WorkStripEntry => ({ kind: 'session', key: `session:${id}`, id })),
    ...(draftOpen ? [{ kind: 'draft', key: DRAFT_KEY } as const] : []),
    ...documents.map((tab): WorkStripEntry => ({ kind: 'document', ...tab })),
    ...visibleLibraries.map((tab): WorkStripEntry => ({ kind: 'library', key: `library:${tab}`, tab }))
  ]

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
    useChatStore.getState().setRoute('write')
    showSession()
    if (id === current && id === useChatStore.getState().activeThreadId) return
    void openWorkSession({ id, title: titles[id] ?? '', updatedAt: null, anchor: { kind: 'space' } }, undefined, { restoreWorkbench: false })
  }
  const openLibrary = (tab: WorkLibraryTab): void => {
    if (tab === 'artifacts' && (artifactSource !== 'work' || normalizeWorkspaceRoot(artifactRoot ?? '') !== normalizeWorkspaceRoot(workspaceRoot))) {
      openArtifactsPage({ from: 'work', workRoot: workspaceRoot })
    } else {
      useChatStore.getState().setRoute(tab)
    }
  }
  // Confirm paper notes before closing any tabs, then honor document save cancellation.
  const closeEntries = async (targets: WorkStripEntry[]): Promise<void> => {
    const closedLibraries = new Set(targets.flatMap((entry) => entry.kind === 'library' ? [entry.tab] : []))
    if (closedLibraries.has('papers') && !(await preparePaperNotesForNavigation())) return
    for (const entry of targets) {
      if (entry.kind === 'document' && !(await closeTab(entry.groupId, entry.key))) return
    }
    for (const tab of closedLibraries) closeLibraryTab(tab)
    const closed = new Set(targets.flatMap((entry) => entry.kind === 'session' ? [entry.id] : []))
    for (const id of closed) closeSessionTab(workspaceRoot, id)
    let nextSession: string | undefined
    if (closed.has(current)) {
      nextSession = sessionIds.find((other) => !closed.has(other))
      if (nextSession) {
        if (activeLibrary) useWorkSessionStore.getState().select(workspaceRoot, nextSession)
        else openSession(nextSession)
      } else {
        useWorkSessionStore.getState().startDraft(workspaceRoot)
        const documentsLeft = documents.some((tab) => !targets.some((entry) => entry.key === tab.key))
        if (documentsLeft && sessionOnStage) showDocument()
      }
    }
    if (activeLibrary && closedLibraries.has(activeLibrary) && useChatStore.getState().route === activeLibrary) {
      const nextLibrary = visibleLibraries.filter((tab) => !closedLibraries.has(tab)).at(-1)
      if (nextLibrary) openLibrary(nextLibrary)
      else {
        const session = nextSession ?? (closed.has(current) ? undefined : current)
        if (session && (sessionMain || !hasDocuments) && session !== useChatStore.getState().activeThreadId) openSession(session)
        else useChatStore.getState().setRoute('write')
      }
    }
  }
  const closeSession = (id: string): void => {
    void closeEntries([{ kind: 'session', key: `session:${id}`, id }])
  }
  const entryTitle = (entry: WorkStripEntry): string => {
    if (entry.kind === 'document') return documentLabel(entry.item)
    if (entry.kind === 'library') return t(entry.tab === 'papers' ? 'workSidebarPapersNav' : 'artifactsNav')
    return entry.kind === 'session' ? titles[entry.id] || t('workSessionNew') : t('workSessionNew')
  }
  const openMenu = (event: MouseEvent<HTMLElement>, key: string): void => {
    event.preventDefault()
    setMenu({ key, point: contextMenuPoint(event) })
  }
  const menuEntry = menu ? entries.find((entry) => entry.key === menu.key) : undefined
  const menuState = (entry: WorkStripEntry): WorkTabMenuState => {
    const count = (scope: WorkTabCloseScope): number => workTabCloseTargets(entries, entry.key, scope).length
    return {
      kind: entry.kind === 'document' ? 'document' : 'session',
      canClose: entry.kind !== 'draft',
      othersCount: count('others'),
      rightCount: count('right'),
      allCount: count('all'),
      canMoveLeft: Boolean(workTabMoveNeighbor(entries, entry.key, -1)),
      canMoveRight: Boolean(workTabMoveNeighbor(entries, entry.key, 1)),
      canOpenBeside: entry.kind === 'document',
      path: entry.kind === 'document' && isWriteFileTab(entry.item) ? entry.item.path : null
    }
  }
  const moveEntry = (entry: WorkStripEntry, direction: -1 | 1): void => {
    const neighbor = workTabMoveNeighbor(entries, entry.key, direction)
    if (!neighbor) return
    if (entry.kind === 'session' && neighbor.kind === 'session') {
      const ids = [...sessionIds]
      const from = ids.indexOf(entry.id)
      ids.splice(from, 1)
      ids.splice(from + direction, 0, entry.id)
      reorderSessionTabs(workspaceRoot, ids)
      return
    }
    if (entry.kind !== 'document') return
    const group = layout.groups.find((candidate) => candidate.id === entry.groupId)
    const index = group?.tabs.findIndex((tab) => writeEditorItemKey(tab) === entry.key) ?? -1
    if (index >= 0) moveTab(entry.key, entry.groupId, entry.groupId, index + direction)
  }
  const copyText = (value: string): void => {
    if (value) void navigator.clipboard?.writeText?.(value)?.catch(() => undefined)
  }
  const runMenuAction = (entry: WorkStripEntry, action: WorkTabMenuAction): void => {
    const scope = CLOSE_SCOPES[action]
    if (scope) {
      void closeEntries(workTabCloseTargets(entries, entry.key, scope))
      return
    }
    if (action === 'moveLeft' || action === 'moveRight') {
      moveEntry(entry, action === 'moveLeft' ? -1 : 1)
      return
    }
    if (action === 'copyTitle') {
      copyText(entryTitle(entry))
      return
    }
    if (entry.kind !== 'document') return
    if (action === 'openBeside') {
      useChatStore.getState().setRoute('write')
      activateTab(entry.groupId, entry.key)
      showSession()
      if (!useWorkViewStore.getState().split) toggleSplit()
    } else if (isWriteFileTab(entry.item)) {
      if (action === 'copyPath') copyText(absolutePath(workspaceRoot, entry.item.path))
      if (action === 'reveal') void window.kunGui.revealWorkspaceFileInFolder({ path: entry.item.path, workspaceRoot })
    }
  }
  const openDocument = (tab: DocumentTab): void => {
    useChatStore.getState().setRoute('write')
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
      <div ref={listRef} role="tablist" aria-label={t('workTabsLabel')} className="work-tab-list">
        {sessionIds.map((id) => {
          const selected = sessionOnStage && id === current
          return (
            <div key={`session:${id}`} className="work-tab" data-kind="session" data-selected={selected ? 'true' : undefined}
              data-menu-target={menu?.key === `session:${id}` ? 'true' : undefined} onContextMenu={(event) => openMenu(event, `session:${id}`)}>
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
          <div className="work-tab" data-kind="session" data-selected={sessionOnStage ? 'true' : undefined}
            data-menu-target={menu?.key === DRAFT_KEY ? 'true' : undefined} onContextMenu={(event) => openMenu(event, DRAFT_KEY)}>
            <button type="button" role="tab" aria-selected={sessionOnStage} className="work-tab-main" onClick={() => {
              useChatStore.getState().setRoute('write')
              showSession()
            }}>
              <span className="work-tab-session-mark" aria-hidden="true">K</span>
              <span className="work-tab-label">{t('workSessionNew')}</span>
            </button>
          </div>
        ) : null}
        {documents.map((tab) => {
          const selected = !activeLibrary && !sessionOnStage && tab.key === shownDocument
          const beside = sessionOnStage && (split || peek) && tab.key === shownDocument
          return (
            <div key={tab.key} className="work-tab" data-kind="document" data-selected={selected ? 'true' : undefined}
              data-beside={beside ? 'true' : undefined} data-menu-target={menu?.key === tab.key ? 'true' : undefined}
              onContextMenu={(event) => openMenu(event, tab.key)}>
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
        {visibleLibraries.map((tab) => {
          const key = `library:${tab}`
          const selected = activeLibrary === tab
          const label = t(tab === 'papers' ? 'workSidebarPapersNav' : 'artifactsNav')
          const Icon = tab === 'papers' ? LibraryBig : Shapes
          return (
            <div key={key} className="work-tab" data-kind="library" data-library={tab} data-selected={selected ? 'true' : undefined}
              data-menu-target={menu?.key === key ? 'true' : undefined} onContextMenu={(event) => openMenu(event, key)}>
              <button type="button" role="tab" aria-selected={selected} className="work-tab-main" title={label} onClick={() => openLibrary(tab)}>
                <span className="work-tab-icon"><Icon className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" /></span>
                <span className="work-tab-label">{label}</span>
              </button>
              <button type="button" className="work-tab-close" aria-label={t('workTabClose')} title={t('workTabClose')}
                onClick={() => void closeEntries([{ kind: 'library', key, tab }])}>
                <X className="h-3 w-3" strokeWidth={2.4} />
              </button>
            </div>
          )
        })}
        {workspaceRoot ? <button type="button" className="work-tab-add" aria-label={t('workSidebarNewSession')} title={t('workSidebarNewSession')}
          onClick={() => {
            useChatStore.getState().setRoute('write')
            showSession()
            void startWorkSession()
          }}>
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button> : null}
      </div>
      {hasDocuments && !activeLibrary ? (
        <button type="button" className="work-tab-split" aria-pressed={split} aria-label={t('workTabSplit')} title={t('workTabSplit')}
          onClick={toggleSplit}>
          <Columns2 className="h-4 w-4" strokeWidth={1.8} />
        </button>
      ) : null}
      {/* The folded tool rail comes back from here, as in Code's top bar. */}
      {activeLibrary ? null : <span className="work-tab-rail-reopen"><RailReopenButton /></span>}
      {menu && menuEntry ? (
        <WorkTabContextMenu point={menu.point} state={menuState(menuEntry)}
          onAction={(action) => runMenuAction(menuEntry, action)} onDismiss={dismissMenu} />
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
