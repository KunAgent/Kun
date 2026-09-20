import { lazy, Suspense, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../store/chat-store'
import { useRoomAttentionCount } from '../components/rooms/useRoomEvents'
import { useRoomSidebar } from '../components/rooms/useRoomSidebar'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { MobileModeNav } from './MobileModeNav'
import { MobileHome } from './screens/MobileHome'
import { MobileRoomsHome } from './rooms/MobileRoomsHome'
import { MobileWorkHome, type MobileWorkResource } from './work/MobileWorkHome'
import { useMobileNavigation } from './navigation/use-mobile-navigation'
import { workLeaveDecision, workbenchRouteForMode } from './mobile-mode-policy'
import type { MobileMode } from './navigation/mobile-page'
import { workFileResourceKey, workWhiteboardResourceKey } from './work/work-resource-key'
import './mobile-app-shell.css'

const MobileRoomConversation = lazy(() => import('./rooms/MobileRoomConversation').then((module) => ({
  default: module.MobileRoomConversation
})))
const MobileWorkResourceScreen = lazy(() => import('./work/MobileWorkResourceScreen').then((module) => ({
  default: module.MobileWorkResourceScreen
})))

function basename(value: string): string {
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? value
}

function MobileUnavailable({ title, onBack }: { title: string; onBack: () => void }): ReactElement {
  return <section className="kun-mobile-unavailable"><h1>{title}</h1><p>This mobile workspace is still loading.</p>
    <button type="button" onClick={onBack}>Back</button></section>
}

function MobileRoomsRoot({ navigate }: { navigate: ReturnType<typeof useMobileNavigation>['navigate'] }) {
  const { t } = useTranslation('common')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'unread' | 'attention'>('all')
  const rooms = useRoomSidebar({ kind: 'all', search,
    unreadOnly: filter === 'unread', attentionOnly: filter === 'attention' })
  return <MobileRoomsHome rooms={rooms.entries} search={search} filter={filter}
    loading={rooms.busy} error={rooms.error} hasMore={Boolean(rooms.nextCursor)}
    labels={{ title: t('roomsLabel'), search: t('roomsUnifiedSearch'), create: t('roomsNewChat'), more: t('more'),
      empty: t('roomsEmpty'), loading: t('roomsLoading'), retry: t('roomsRefresh'), loadMore: t('roomsLoadMore'),
      all: t('roomsFilter_all'), unread: t('roomsFilter_unread'), attention: t('roomsFilter_attention') }}
    onSearch={setSearch} onFilter={setFilter}
    onOpen={(roomId) => navigate({ mode: 'rooms', kind: 'room', roomId })}
    onMenu={(roomId) => navigate({ mode: 'rooms', kind: 'room', roomId })}
    onCreate={() => navigate({ mode: 'rooms', kind: 'settings' })}
    onRetry={rooms.refresh} onLoadMore={rooms.more} />
}

export function MobileAppShell(): ReactElement {
  const { t } = useTranslation('common')
  const { page, navigate } = useMobileNavigation()
  const roomAttention = useRoomAttentionCount()
  const [notice, setNotice] = useState('')
  const chat = useChatStore(useShallow((state) => ({
    route: state.route, threads: state.threads, search: state.threadSearch,
    loading: state.threadListStatus === 'loading' || state.threadListStatus === 'refreshing',
    error: state.threadListStatus === 'error' ? state.error ?? t('unknownError') : null,
    workspaceRoot: state.workspaceRoot, setSearch: state.setThreadSearch,
    refresh: state.refreshThreads, selectThread: state.selectThread, createConversation: state.createConversation,
    openSettings: state.openSettings, setRoute: state.setRoute
  })))
  const work = useWriteWorkspaceStore(useShallow((state) => ({
    workspaceRoot: state.workspaceRoot, entriesByDir: state.entriesByDir,
    documentsByPath: state.documentsByPath, whiteboards: state.whiteboards,
    saveStatus: state.saveStatus, reviewActive: state.reviewActive,
    spreadsheetConflict: Object.values(state.documentsByPath)
      .some((document) => document.spreadsheetConflictPreview !== null),
    settingsLoading: state.settingsLoading, error: state.settingsError ?? state.treeError ?? '',
    openFile: state.openFile, openWhiteboard: state.openWhiteboard, saveAll: state.saveAllDocuments,
    loadSettings: state.loadWriteSettings, initialize: state.initializeWorkspace
  })))

  const { route: currentRoute, setRoute } = chat
  const { initialize: initializeWork, loadSettings: loadWorkSettings, workspaceRoot: workRoot } = work

  useEffect(() => {
    const target = workbenchRouteForMode(page.mode)
    if (currentRoute !== target) setRoute(target)
  }, [currentRoute, page.mode, setRoute])
  useEffect(() => {
    if (page.mode !== 'work') return
    void loadWorkSettings().then(() => workRoot ? initializeWork(workRoot) : undefined)
  }, [initializeWork, loadWorkSettings, page.mode, workRoot])

  const workResources = useMemo<MobileWorkResource[]>(() => {
    const files = Object.values(work.entriesByDir).flat().filter((entry) => entry.type === 'file')
    const documents = files.map((entry) => {
      const document = work.documentsByPath[entry.path]
      return { key: workFileResourceKey(work.workspaceRoot, entry.path), title: entry.name, detail: entry.path, kind: 'document' as const,
        status: document?.pendingAgentReview ? 'review' as const : document?.saveStatus ?? 'saved' as const }
    })
    const boards = Object.values(work.whiteboards).map((board) => ({
      key: workWhiteboardResourceKey(board.id), title: board.title, detail: 'Whiteboard', kind: 'whiteboard' as const,
      status: board.phase === 'review' ? 'review' as const : 'saved' as const
    }))
    return [...documents, ...boards]
  }, [work.documentsByPath, work.entriesByDir, work.whiteboards, work.workspaceRoot])

  const selectMode = async (mode: MobileMode): Promise<void> => {
    if (page.mode === 'work' && mode !== 'work') {
      const decision = workLeaveDecision({ saveStatus: work.saveStatus, conflict: work.spreadsheetConflict, reviewActive: work.reviewActive })
      if (decision === 'resolve-conflict' || decision === 'confirm-discard') {
        setNotice(decision === 'resolve-conflict' ? 'Resolve the document conflict before leaving Work.' : 'Finish or discard the current Work review before leaving.')
        return
      }
      if (decision === 'wait') { setNotice('Saving Work documents…'); return }
      if (work.workspaceRoot && !await work.saveAll(work.workspaceRoot)) {
        setNotice('Work documents could not be saved.'); return
      }
    }
    setNotice('')
    navigate({ mode, kind: 'home' })
  }

  let content: ReactElement
  if (page.mode === 'rooms' && page.kind === 'room') {
    content = <MobileRoomConversation roomId={page.roomId}
      onBack={() => navigate({ mode: 'rooms', kind: 'home' })}
      onDetails={() => navigate({ mode: 'rooms', kind: 'settings' })}
      onReply={(message) => navigate({ mode: 'rooms', kind: 'reply', roomId: page.roomId, messageId: message.id })}
      onTask={(taskId) => navigate({ mode: 'rooms', kind: 'task', roomId: page.roomId, taskId })}
      onRun={(runId) => navigate({ mode: 'rooms', kind: 'run', roomId: page.roomId, runId })} />
  } else if (page.mode === 'work' && page.kind === 'resource') {
    content = <MobileWorkResourceScreen resourceKey={page.resourceKey} view={page.view}
      onBack={() => navigate({ mode: 'work', kind: 'home' })}
      onView={(view) => navigate({ mode: 'work', kind: 'resource', resourceKey: page.resourceKey, view }, true)} />
  } else if (page.kind !== 'home') {
    content = <MobileUnavailable title={page.kind} onBack={() => navigate({ mode: page.mode, kind: 'home' })} />
  } else if (page.mode === 'rooms') {
    content = <MobileRoomsRoot navigate={navigate} />
  } else if (page.mode === 'work') {
    content = <MobileWorkHome workspaceLabel={basename(work.workspaceRoot) || t('writeWorkspace')}
      resources={workResources} search="" loading={work.settingsLoading} error={work.error}
      labels={{ title: t('workspaceModeWorkLabel'), search: t('search'), create: t('new'), more: t('more'),
        empty: t('writeEmptyTitle'), loading: t('loading'), retry: t('retry') }}
      onWorkspace={() => undefined} onSearch={() => undefined}
      onOpen={(resource) => {
        const path = Object.values(work.entriesByDir).flat().find((entry) =>
          entry.type === 'file' && workFileResourceKey(work.workspaceRoot, entry.path) === resource.key
        )?.path
        const board = Object.values(work.whiteboards).find((entry) =>
          workWhiteboardResourceKey(entry.id) === resource.key
        )
        if (board) work.openWhiteboard(board.id)
        else if (path) void work.openFile(work.workspaceRoot, path)
        navigate({ mode: 'work', kind: 'resource', resourceKey: resource.key,
          view: resource.kind === 'whiteboard' ? 'whiteboard' : 'read' }) }}
      onMenu={() => undefined} onCreate={() => undefined}
      onRetry={() => work.workspaceRoot ? void work.initialize(work.workspaceRoot) : undefined} />
  } else {
    content = <MobileHome labels={{ title: 'Code', workspace: basename(chat.workspaceRoot) || 'Code', search: t('search'),
      newConversation: t('newChat'), settings: t('settings'), more: t('more'), loadMore: t('loadMore'),
      retry: t('retry'), empty: t('noSessions'), loading: t('loading'), back: t('back') }}
      threads={chat.threads} search={chat.search} loading={chat.loading} error={chat.error} hasMore={false}
      onSearch={chat.setSearch} onOpenThread={(threadId) => { void chat.selectThread(threadId); navigate({ mode: 'code', kind: 'conversation', threadId }) }}
      onThreadMenu={() => undefined} onWorkspace={() => undefined}
      onNewConversation={() => { void chat.createConversation(); navigate({ mode: 'code', kind: 'new' }) }}
      onSettings={() => chat.openSettings()} onLoadMore={() => undefined} onRetry={() => void chat.refresh()} />
  }

  return <div className="kun-mobile-app" data-mobile-mode={page.mode}>
    {notice ? <div className="kun-mobile-notice" role="alert">{notice}</div> : null}
    <div className="kun-mobile-app-content"><Suspense fallback={<MobileUnavailable title="loading" onBack={() => navigate({ mode: page.mode, kind: 'home' })} />}>{content}</Suspense></div>
    {page.kind === 'home' ? <MobileModeNav active={page.mode} attentionCount={roomAttention}
      labels={{ code: 'Code', rooms: t('roomsLabel'), work: t('workspaceModeWorkLabel') }}
      onSelect={(mode) => void selectMode(mode)} /> : null}
  </div>
}
