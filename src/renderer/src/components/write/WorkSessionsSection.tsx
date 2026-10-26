import { useRef, useState, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ChevronDown,
  MoreHorizontal,
  PanelRight,
  PencilLine,
  Search,
  Trash2
} from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../write/write-workspace-store'
import { writeWorkspaceKey } from '../../write/write-thread-registry'
import { writeActivityForThreadIds, type WriteResourceActivityContext } from '../../write/write-resource-activity'
import { usePaperStore } from '../../write/paper/paper-store'
import { useWorkSessionStore } from '../../write/work-session-store'
import { forgetWorkSessionTabs } from '../../write/work-session-tabs'
import type { WorkSessionEntry } from '../../write/work-sessions-model'
import { openWorkSession } from '../../write/work-session-actions'
import { SidebarActivityIndicator } from '../sidebar/SidebarActivityIndicator'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'
import { SidebarActionDialog, type SidebarActionDialogState } from '../chat/SidebarProjectOverlays'
import { RoomPopover } from '../rooms/RoomPopover'
import { WorkSidebarSection } from './WorkSidebarSection'
import { useWorkViewStore } from '../../write/work-view-store'
import { useWorkSessions } from './use-work-sessions'
import '../rooms/conversation-manage.css'
import { readSessionsExpanded, writeSessionsExpanded } from './work-sidebar-layout'

/** Folded, the list shows the latest few; the open session always stays in view. */
export const VISIBLE_SESSIONS = 5
/** Below this age a session reads "just now" instead of ticking seconds. */
const JUST_NOW_MS = 60_000

/** Untitled sessions borrow the name of what they are attached to. */
function anchorName(anchor: WorkSessionEntry['anchor'], boardTitle: (id: string) => string | undefined): string {
  if (anchor.kind === 'file' || anchor.kind === 'paper') return writeBasenameFromPath(anchor.path)
  if (anchor.kind === 'whiteboard') return boardTitle(anchor.boardId) ?? ''
  return ''
}

/**
 * 会话: the current space's sessions. Picking one makes it the current
 * session and brings back its workbench; New session starts a draft that
 * shows here until its first send.
 */
export function WorkSessionsSection({ onOpenArchives }: { onOpenArchives: () => void }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [actionDialog, setActionDialog] = useState<SidebarActionDialogState | null>(null)
  const searching = searchOpen && query.trim().length > 0
  const { root, sessions, loading, patchThread, forgetThread, reload } = useWorkSessions(searching ? query : '')
  const whiteboards = useWriteWorkspaceStore((state) => state.whiteboards)
  const spaceKey = writeWorkspaceKey(root)
  const current = useWorkSessionStore((state) => state.current[spaceKey])
  const [expandedBySpace, setExpandedBySpace] = useState(() => readSessionsExpanded())
  const showAll = expandedBySpace[spaceKey] === true
  const listRef = useRef<HTMLDivElement | null>(null)
  const toggleShowAll = (): void => {
    const next = !showAll
    setExpandedBySpace(writeSessionsExpanded(spaceKey, next))
    // Folding returns to the latest sessions at the top.
    if (!next) listRef.current?.scrollTo?.({ top: 0 })
  }
  const activity = useChatStore(useShallow((state): WriteResourceActivityContext & { route: string } => ({
    route: state.route,
    threads: state.threads,
    activeThreadId: state.activeThreadId,
    busy: state.busy,
    watchTurnCompletion: state.watchTurnCompletion,
    awaitingUserInputThreadIds: state.awaitingUserInputThreadIds,
    unreadThreadIds: state.unreadThreadIds
  })))
  const renameThread = useChatStore((state) => state.renameThread)
  const archiveThread = useChatStore((state) => state.archiveThread)
  const deleteThread = useChatStore((state) => state.deleteThread)

  const sessionLabel = (session: WorkSessionEntry): string =>
    session.title || anchorName(session.anchor, (id) => whiteboards[id]?.title) || t('workSessionNew')
  const sessionTime = (updatedAt: string): string => {
    const age = Date.now() - Date.parse(updatedAt)
    return age < JUST_NOW_MS ? t('workSessionJustNow') : formatRelativeTime(updatedAt, i18n.language)
  }

  const commitRename = (session: WorkSessionEntry): void => {
    const value = renaming?.value.trim() ?? ''
    setRenaming(null)
    if (!value || value === session.title) return
    patchThread(session.id, { title: value, titleAuto: false })
    void renameThread(session.id, value)
  }

  // A session that goes away leaves its space on a draft.
  const releaseSession = (threadId: string): void => {
    useWorkSessionStore.getState().release(threadId)
    forgetThread(threadId)
  }
  // Store actions report failures through `error`; a failed removal lists the space again.
  const removeSession = async (threadId: string, remove: () => Promise<void>): Promise<boolean> => {
    const errorBefore = useChatStore.getState().error
    releaseSession(threadId)
    await remove()
    const { error } = useChatStore.getState()
    if (!error || error === errorBefore) return true
    reload()
    return false
  }
  // Undo puts the session back, reopening it if it was the open one.
  const archiveSession = (session: WorkSessionEntry): void => {
    const wasOpen = useChatStore.getState().activeThreadId === session.id
    void removeSession(session.id, () => archiveThread(session.id, true)).then((archived) => {
      if (!archived) return
      usePaperStore.getState().setNotice({
        tone: 'info',
        message: t('workSessionArchived', { title: sessionLabel(session) }),
        action: {
          label: t('workSessionUndo'),
          run: () => void useChatStore.getState().archiveThread(session.id, false).then(() => {
            reload()
            if (wasOpen) void openWorkSession(session)
          })
        }
      })
    })
  }
  const requestDelete = (session: WorkSessionEntry): void => {
    setActionDialog({
      title: t('sidebarThreadDeleteDialogTitle', { title: sessionLabel(session) }),
      description: t('sidebarThreadDeleteDialogDescription'),
      detail: t('sidebarThreadDeleteDialogDetail'),
      confirmLabel: t('sidebarThreadDeleteConfirmButton'),
      danger: true,
      submitting: false,
      onConfirm: async () => {
        if (await removeSession(session.id, () => deleteThread(session.id))) forgetWorkSessionTabs(session.id)
      }
    })
  }
  const confirmActionDialog = async (): Promise<void> => {
    const dialog = actionDialog
    if (!dialog || dialog.submitting) return
    setActionDialog({ ...dialog, submitting: true })
    try {
      await dialog.onConfirm()
    } finally {
      setActionDialog(null)
    }
  }

  // An explicit draft, or a session created moments ago that the list has
  // not picked up yet, shows as the current row.
  const inList = sessions.some((session) => session.id === current)
  const draftRow = current !== undefined && !searching && (current === '' || (current === activity.activeThreadId && !inList))
  const openId = activity.route === 'write' ? activity.activeThreadId : null
  const folded = sessions.slice(0, VISIBLE_SESSIONS)
  const openBeyondFold = openId ? sessions.find((session, index) => index >= VISIBLE_SESSIONS && session.id === openId) : undefined
  const visible = showAll || searching ? sessions : openBeyondFold ? [...folded, openBeyondFold] : folded
  const hidden = sessions.length - visible.length
  const canFold = !searching && sessions.length > VISIBLE_SESSIONS

  const actions = (
    <>
      <SidebarIconButton onClick={() => { setSearchOpen((open) => !open); setQuery('') }} active={searchOpen}
        className="h-6 w-6" title={t('workSidebarSearchSessions')} ariaLabel={t('workSidebarSearchSessions')}>
        <Search className="h-3.5 w-3.5" strokeWidth={1.85} />
      </SidebarIconButton>
      <RoomPopover label={t('workSessionsMore')} trigger={<MoreHorizontal size={14} />}
        className="work-section-menu rooms-icon-button" align="end" width={200}>
        {(close) => (
          <div className="rooms-menu-list conversation-menu">
            <button type="button" data-work-sessions-action="archives" onClick={() => { close(); onOpenArchives() }}>
              <Archive size={15} aria-hidden="true" /><span>{t('sidebarShowArchivedThreads')}</span>
            </button>
          </div>
        )}
      </RoomPopover>
    </>
  )

  return (
    <WorkSidebarSection id="sessions" label={t('workSidebarViewSessions')} actions={actions}>
      {searchOpen ? (
        <div className="work-sidebar-search">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              setQuery('')
              setSearchOpen(false)
            }}
            placeholder={t('workSidebarSearchPlaceholder')} aria-label={t('workSidebarSearchSessions')} />
        </div>
      ) : null}
      <div className="work-sessions" data-work-sessions>
        <div ref={listRef} className="work-sessions-scroll" data-expanded={showAll && canFold ? 'true' : undefined}>
        {draftRow ? (
          <div className="work-session-item" data-work-session-draft>
            <button type="button" className="work-session-row" aria-current="true">
              <span className="work-session-anchor" aria-hidden="true">K</span>
              <span className="work-session-title" data-placeholder="true">{t('workSessionNew')}</span>
              <span className="work-session-time">{t('workSessionDraft')}</span>
            </button>
          </div>
        ) : null}
        {visible.map((session) => {
          const isCurrent = activity.route === 'write' && activity.activeThreadId === session.id
          const state = writeActivityForThreadIds([session.id], activity).activity
          if (renaming?.id === session.id) {
            return (
              <div key={session.id} className="work-session-item">
                <input autoFocus className="work-session-rename" value={renaming.value}
                  aria-label={t('sidebarThreadRename')}
                  onChange={(event) => setRenaming({ id: session.id, value: event.target.value })}
                  onBlur={() => commitRename(session)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename(session)
                    if (event.key === 'Escape') setRenaming(null)
                  }} />
              </div>
            )
          }
          return (
            <div key={session.id} className="work-session-item" data-work-session={session.id}>
              <button type="button" className="work-session-row" aria-current={isCurrent ? 'true' : undefined}
                title={sessionLabel(session)} onClick={() => {
                  useWorkViewStore.getState().showSession()
                  void openWorkSession(session, undefined, { restoreWorkbench: false })
                }}>
                <span className="work-session-anchor" aria-hidden="true">K</span>
                <span className="work-session-title" data-placeholder={session.title ? undefined : 'true'}>
                  {sessionLabel(session)}
                </span>
                {state !== 'idle' ? (
                  <SidebarActivityIndicator activity={state} className="work-session-activity" runningLabel={t('sidebarThreadRunning')}
                    failedLabel={t('sidebarThreadFailed')} unreadLabel={t('sidebarThreadUnread')}
                    awaitingInputLabel={t('sidebarThreadAwaitingInput')} />
                ) : session.updatedAt ? (
                  <span className="work-session-time">{sessionTime(session.updatedAt)}</span>
                ) : null}
              </button>
              <button type="button" className="work-session-side rooms-icon-button" data-work-session-side
                title={t('workOpenBeside')} aria-label={t('workOpenBeside')} onClick={() => {
                  // Beside: the file keeps the stage and the session joins it in the split.
                  const view = useWorkViewStore.getState()
                  if (!view.split) view.toggleSplit()
                  view.showDocument()
                  void openWorkSession(session, undefined, { restoreWorkbench: false })
                }}>
                <PanelRight size={14} aria-hidden="true" />
              </button>
              <RoomPopover label={t('workSessionMore')} trigger={<MoreHorizontal size={14} />}
                className="work-session-menu rooms-icon-button" align="end" width={188}>
                {(close) => (
                  <div className="rooms-menu-list conversation-menu">
                    <button type="button" data-work-session-action="rename" onClick={() => {
                      close()
                      setRenaming({ id: session.id, value: session.title })
                    }}>
                      <PencilLine size={15} aria-hidden="true" /><span>{t('sidebarThreadRename')}</span>
                    </button>
                    <button type="button" data-work-session-action="archive" onClick={() => {
                      close()
                      archiveSession(session)
                    }}>
                      <Archive size={15} aria-hidden="true" /><span>{t('sidebarThreadArchive')}</span>
                    </button>
                    <hr />
                    <button type="button" className="is-danger" data-work-session-action="delete" onClick={() => {
                      close()
                      requestDelete(session)
                    }}>
                      <Trash2 size={15} aria-hidden="true" /><span>{t('sidebarThreadDelete')}</span>
                    </button>
                  </div>
                )}
              </RoomPopover>
            </div>
          )
        })}
        </div>
        {canFold && (showAll || hidden > 0) ? (
          <button type="button" className="work-session-more" data-work-sessions-fold aria-expanded={showAll}
            onClick={toggleShowAll}>
            <ChevronDown className="work-session-more-chevron h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
            {showAll ? t('workSessionShowLess') : t('workSessionShowMore', { count: hidden })}
          </button>
        ) : null}
        {sessions.length === 0 && !draftRow ? (
          loading ? (
            <p className="work-session-loading">{t('workSessionLoading')}</p>
          ) : (
            <p className="work-session-loading">{searching ? t('workSessionNoMatches') : t('workSessionEmptyHint')}</p>
          )
        ) : null}
      </div>
      {actionDialog ? (
        <SidebarActionDialog
          state={actionDialog}
          onClose={() => { if (!actionDialog.submitting) setActionDialog(null) }}
          onConfirm={() => void confirmActionDialog()}
          t={t}
        />
      ) : null}
    </WorkSidebarSection>
  )
}
