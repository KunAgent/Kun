import { lazy, Suspense, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../store/chat-store'
import { useRoomAttentionCount } from '../components/rooms/useRoomEvents'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { MobileModeNav } from './MobileModeNav'
import { MobileCodeHome } from './screens/MobileCodeHome'
import { MobileRoomsRoot } from './rooms/MobileRoomsRoot'
import { MobileDocumentsHome } from './work/MobileDocumentsHome'
import { useMobileNavigation, type MobileNavigationGuard } from './navigation/use-mobile-navigation'
import { modeForWorkbenchRoute, workLeaveDecision, workbenchRouteForMode } from './mobile-mode-policy'
import type { MobileMode, MobilePage } from './navigation/mobile-page'
import type { RoomContentOpenTarget } from '@shared/rooms-api'
import { openRoomContentTarget } from '../components/rooms/room-content-navigation'
import { workFileResourceKey } from './work/work-resource-key'
import { useWorkBeforeUnloadGuard } from './use-work-before-unload-guard'
import { useMobileViewport } from './use-mobile-viewport'
import { MobileLoadingState } from './lib/MobileLoading'
import './mobile-app-shell.css'

const MobileRoomNew = lazy(() => import('./rooms/MobileRoomNew').then((module) => ({
  default: module.MobileRoomNew
})))
const MobileRoomConversation = lazy(() => import('./rooms/MobileRoomConversation').then((module) => ({
  default: module.MobileRoomConversation
})))
const MobileCodeConversation = lazy(() => import('./chat/MobileCodeConversation').then((module) => ({
  default: module.MobileCodeConversation
})))
const MobileRoomDetail = lazy(() => import('./rooms/MobileRoomDetail').then((module) => ({
  default: module.MobileRoomDetail
})))
const MobileRoomSettings = lazy(() => import('./rooms/MobileRoomSettings').then((module) => ({
  default: module.MobileRoomSettings
})))
const MobileWorkResourceScreen = lazy(() => import('./work/MobileWorkResourceScreen').then((module) => ({
  default: module.MobileWorkResourceScreen
})))
const MobilePaperHome = lazy(() => import('./paper/MobilePaperHome').then((module) => ({
  default: module.MobilePaperHome
})))
const MobilePaperReader = lazy(() => import('./paper/MobilePaperReader').then((module) => ({
  default: module.MobilePaperReader
})))
const MobilePaperDiscover = lazy(() => import('./paper/MobilePaperDiscover').then((module) => ({
  default: module.MobilePaperDiscover
})))
const MobileSettingsScreen = lazy(() => import('./settings/MobileSettingsScreen').then((module) => ({
  default: module.MobileSettingsScreen
})))

function MobileUnavailable({ title, onBack }: { title: string; onBack: () => void }): ReactElement {
  return <section className="kun-mobile-unavailable"><h1>{title}</h1><p>This mobile workspace is still loading.</p>
    <button type="button" onClick={onBack}>Back</button></section>
}

export function MobileAppShell(): ReactElement {
  useMobileViewport()
  const { t } = useTranslation('common')
  const leaveGuardRef = useRef<MobileNavigationGuard | null>(null)
  const { page, navigate } = useMobileNavigation(
    leaveGuardRef,
    modeForWorkbenchRoute(useChatStore.getState().route)
  )
  const roomAttention = useRoomAttentionCount()
  const [notice, setNotice] = useState('')
  const [paperUnsaved, setPaperUnsaved] = useState(false)
  const [paperBusy, setPaperBusy] = useState(false)
  const workSettingsLoaded = useRef(false)
  const navigationRequestRef = useRef(0)
  const chat = useChatStore(useShallow((state) => ({
    route: state.route, threads: state.threads, search: state.threadSearch,
    cursors: state.threadListCursorByWorkspace,
    loading: state.threadListStatus === 'loading' || state.threadListStatus === 'refreshing',
    error: state.threadListStatus === 'error' ? state.threadListError ?? state.error ?? t('appErrorTitle') : null,
    workspaceRoot: state.workspaceRoot, setSearch: state.setThreadSearch,
    refresh: state.refreshThreads, loadMore: state.loadMoreThreads,
    selectThread: state.selectThread, createConversation: state.createConversation,
    chooseWorkspace: state.chooseWorkspace,
    setRoute: state.setRoute
  })))
  const work = useWriteWorkspaceStore(useShallow((state) => ({
    workspaceRoot: state.workspaceRoot, documentsByPath: state.documentsByPath,
    saveStatus: state.saveStatus, reviewActive: state.reviewActive,
    spreadsheetConflict: Object.values(state.documentsByPath)
      .some((document) => document.spreadsheetConflictPreview !== null),
    saveAll: state.saveAllDocuments, loadSettings: state.loadWriteSettings
  })))

  const { route: currentRoute, setRoute } = chat
  const loadWorkSettings = work.loadSettings

  // The desktop settings route is never rendered on the phone (AppShell
  // routes it here). Any path that requests it — the Work settings button, a
  // runtime that needs configuration, a timeline error card — opens the
  // full-screen mobile settings page instead, and the route returns to the
  // current mode. The page that opened settings is remembered so its back
  // button restores the exact origin instead of the mode home.
  const settingsReturnRef = useRef<MobilePage | null>(null)
  const openSettingsPage = (from: MobilePage): void => {
    if ((from.kind === 'paper' && paperUnsaved) || paperBusy) {
      setNotice('先保存论文笔记/标注或等待导入完成，再打开设置。')
      return
    }
    settingsReturnRef.current = from
    navigate({ mode: from.mode, kind: 'settings' })
  }
  useEffect(() => {
    const target = workbenchRouteForMode(page.mode)
    if (currentRoute === 'settings') {
      if (page.kind !== 'settings') settingsReturnRef.current = page
      navigate({ mode: page.mode, kind: 'settings' })
    }
    if (currentRoute !== target) setRoute(target)
  }, [currentRoute, navigate, page, setRoute])
  useEffect(() => {
    if (page.mode !== 'work' || workSettingsLoaded.current) return
    workSettingsLoaded.current = true
    void loadWorkSettings({ mobile: true })
  }, [loadWorkSettings, page.mode])

  const leaveState = { saveStatus: work.saveStatus, conflict: work.spreadsheetConflict, reviewActive: work.reviewActive } as const
  useWorkBeforeUnloadGuard(page.mode === 'work', leaveState)
  useEffect(() => {
    if ((!paperUnsaved || page.kind !== 'paper') && !paperBusy) return
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [paperUnsaved, paperBusy, page.kind])

  const canLeaveWork = async (): Promise<boolean> => {
    if (paperBusy) { setNotice('导入进行中，请先取消或等待结束。'); return false }
    if (paperUnsaved) { setNotice('先保存论文笔记或标注，再离开此页。'); return false }
    const decision = workLeaveDecision(leaveState)
    if (decision === 'resolve-conflict' || decision === 'confirm-discard') {
      setNotice(decision === 'resolve-conflict' ? 'Resolve the document conflict before leaving Work.' : 'Finish or discard the current Work review before leaving.')
      return false
    }
    if (decision === 'wait') { setNotice('Saving Work documents…'); return false }
    if (decision === 'save' && work.workspaceRoot && !await work.saveAll(work.workspaceRoot)) {
      setNotice('Work documents could not be saved.'); return false
    }
    return true
  }
  leaveGuardRef.current = async (current, next) => {
    if (current.mode !== 'work') return true
    if (current.kind === 'resource' && next.mode === 'work' && next.kind === 'resource'
      && current.resourceKey === next.resourceKey) return true
    if (current.kind === 'paper' && next.kind === 'paper' && next.paperKey === current.paperKey
      && next.view === current.view) return true
    return canLeaveWork()
  }

  const leaveWorkResource = async (): Promise<void> => {
    const request = ++navigationRequestRef.current
    if (!await canLeaveWork() || request !== navigationRequestRef.current) return
    setNotice('')
    navigate({ mode: 'work', kind: 'home' })
  }

  const selectMode = async (mode: MobileMode): Promise<void> => {
    const request = ++navigationRequestRef.current
    if (page.mode === 'work' && mode !== 'work' && !await canLeaveWork()) return
    if (request !== navigationRequestRef.current) return
    setNotice('')
    navigate({ mode, kind: 'home' })
  }

  const openRoomTarget = async (target: RoomContentOpenTarget): Promise<void> => {
    if (target.kind === 'thread') {
      await chat.selectThread(target.threadId)
      navigate({ mode: 'code', kind: 'conversation', threadId: target.threadId })
      return
    }
    if (target.kind === 'work_file') {
      await openRoomContentTarget(target, (threadId) => chat.selectThread(threadId))
      const write = useWriteWorkspaceStore.getState()
      if (!write.activeFilePath) throw new Error('Referenced Work file is unavailable')
      navigate({ mode: 'work', kind: 'resource',
        resourceKey: workFileResourceKey(write.workspaceRoot, write.activeFilePath), view: 'read' })
      return
    }
    throw new Error('Open this content from the desktop workspace.')
  }

  let content: ReactElement
  if (page.mode === 'rooms' && page.kind === 'new') {
    content = <MobileRoomNew group={page.group === true} onClose={() => navigate({ mode: 'rooms', kind: 'home' })}
      onOpen={(roomId) => navigate({ mode: 'rooms', kind: 'room', roomId })} />
  } else if (page.mode === 'code' && page.kind === 'conversation') {
    content = <MobileCodeConversation threadId={page.threadId}
      onBack={() => navigate({ mode: 'code', kind: 'home' })}
      onOpenSettings={() => openSettingsPage(page)} />
  } else if (page.mode === 'rooms' && page.kind === 'room-settings') {
    content = <MobileRoomSettings roomId={page.roomId}
      onBack={() => navigate({ mode: 'rooms', kind: 'room', roomId: page.roomId })} />
  } else if (page.mode === 'rooms' && page.kind === 'room') {
    content = <MobileRoomConversation roomId={page.roomId}
      onBack={() => navigate({ mode: 'rooms', kind: 'home' })}
      onDetails={() => navigate({ mode: 'rooms', kind: 'room-settings', roomId: page.roomId })}
      onReply={(message) => navigate({ mode: 'rooms', kind: 'reply', roomId: page.roomId, messageId: message.id })}
      onTask={(taskId) => navigate({ mode: 'rooms', kind: 'task', roomId: page.roomId, taskId })}
      onRun={(runId) => navigate({ mode: 'rooms', kind: 'run', roomId: page.roomId, runId })}
      onOpenTarget={openRoomTarget} />
  } else if (page.mode === 'rooms' && ['reply', 'run', 'task', 'member'].includes(page.kind)) {
    const detailPage = page as Extract<typeof page, { kind: 'reply' | 'run' | 'task' | 'member' }>
    content = <MobileRoomDetail page={detailPage}
      onBack={() => navigate({ mode: 'rooms', kind: 'room', roomId: detailPage.roomId })}
      onNavigate={(next) => navigate(next)}
      onOpenTarget={openRoomTarget}
      onOpenCode={async (threadId) => {
        await chat.selectThread(threadId)
        navigate({ mode: 'code', kind: 'conversation', threadId })
      }} />
  } else if (page.mode === 'work' && page.kind === 'resource') {
    content = <MobileWorkResourceScreen resourceKey={page.resourceKey} view={page.view}
      onBack={() => void leaveWorkResource()}
      onView={(view) => navigate({ mode: 'work', kind: 'resource', resourceKey: page.resourceKey, view }, true)}
      onSettings={() => openSettingsPage(page)} />
  } else if (page.mode === 'work' && page.kind === 'paper') {
    content = <MobilePaperReader paperKey={page.paperKey} view={page.view}
      onBack={() => { void canLeaveWork().then((ok) => { if (ok) navigate({ mode: 'work', kind: 'home', surface: 'papers' }) }) }}
      onView={(view) => navigate({ mode: 'work', kind: 'paper', paperKey: page.paperKey, view }, true)}
      onSettings={() => openSettingsPage(page)} onUnsavedChange={setPaperUnsaved} />
  } else if (page.mode === 'work' && page.kind === 'folder') {
    content = <MobileDocumentsHome page={page} navigate={navigate} canLeave={canLeaveWork}
      onPapers={() => navigate({ mode: 'work', kind: 'home', surface: 'papers' })} />
  } else if (page.mode === 'work' && page.kind === 'discover') {
    content = <MobilePaperDiscover onBack={() => { void canLeaveWork().then((ok) => { if (ok) navigate({ mode: 'work', kind: 'home', surface: 'papers' }) }) }}
      onSettings={() => openSettingsPage(page)} onBusyChange={setPaperBusy} />
  } else if (page.kind === 'settings') {
    content = <MobileSettingsScreen onBack={() => {
      const origin = settingsReturnRef.current ?? { mode: page.mode, kind: 'home' } as MobilePage
      settingsReturnRef.current = null
      navigate(origin, true)
    }} />
  } else if (page.kind !== 'home') {
    content = <MobileUnavailable title={page.kind} onBack={() => navigate({ mode: page.mode, kind: 'home' })} />
  } else if (page.mode === 'rooms') {
    content = <MobileRoomsRoot navigate={navigate} />
  } else if (page.mode === 'work' && page.kind === 'home' && page.surface !== 'papers') {
    content = <MobileDocumentsHome page={page} navigate={navigate} canLeave={canLeaveWork}
      onPapers={() => navigate({ mode: 'work', kind: 'home', surface: 'papers' })} />
  } else if (page.mode === 'work' && page.kind === 'home' && page.surface === 'papers') {
    content = <MobilePaperHome navigate={navigate} onDocuments={() => { void canLeaveWork().then((ok) => { if (ok) navigate({ mode: 'work', kind: 'home' }) }) }}
      onBusyChange={setPaperBusy} />
  } else {
    content = <MobileCodeHome onOpen={(threadId) => navigate({ mode: 'code', kind: 'conversation', threadId })}
      onOpenSettings={() => openSettingsPage(page)} />
  }

  return <div className="kun-mobile-app" data-mobile-mode={page.mode}>
    {notice ? <div className="kun-mobile-notice" role="alert">{notice}</div> : null}
    <div className="kun-mobile-app-content"><Suspense fallback={<MobileLoadingState className="kun-mobile-page-loading" label={t('loading')} />}>{content}</Suspense></div>
    {page.kind === 'home' ? <MobileModeNav active={page.mode} attentionCount={roomAttention}
      labels={{ code: 'Code', rooms: t('roomsLabel'), work: t('workspaceModeWorkLabel') }}
      onSelect={(mode) => void selectMode(mode)} /> : null}
  </div>
}
