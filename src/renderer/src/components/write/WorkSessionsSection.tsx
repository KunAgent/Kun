import { useMemo, useState, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  GraduationCap,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Plus,
  Shapes,
  Trash2
} from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../write/write-workspace-store'
import { usePaperWorkspaceBootstrapStore } from '../../paper/paper-workspace-bootstrap'
import { writeWorkspaceKey } from '../../write/write-thread-registry'
import { writeActivityForThreadIds, type WriteResourceActivityContext } from '../../write/write-resource-activity'
import { usePaperStore } from '../../write/paper/paper-store'
import { useWorkSidebarStore } from '../../write/work-sidebar-store'
import type { WorkSessionEntry, WorkSessionGroup } from '../../write/work-sessions-model'
import { openWorkSession, startWorkSession } from '../../write/work-session-actions'
import { SidebarActivityIndicator } from '../sidebar/SidebarActivityIndicator'
import { SidebarActionDialog, type SidebarActionDialogState } from '../chat/SidebarProjectOverlays'
import { RoomPopover } from '../rooms/RoomPopover'
import { useWorkSessionGroups } from './use-work-sessions'
import '../rooms/conversation-manage.css'

const COLLAPSE_KEY = 'kun.work.sessionGroups.v1'
const VISIBLE_SESSIONS = 5
/** Below this age a session reads "just now" instead of ticking seconds. */
const JUST_NOW_MS = 60_000

function readGroupState(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(COLLAPSE_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {}
  } catch {
    return {}
  }
}

/** Untitled sessions borrow the name of what they are attached to. */
function anchorName(anchor: WorkSessionEntry['anchor'], boardTitle: (id: string) => string | undefined): string {
  if (anchor.kind === 'file' || anchor.kind === 'paper') return writeBasenameFromPath(anchor.path)
  if (anchor.kind === 'whiteboard') return boardTitle(anchor.boardId) ?? ''
  return ''
}

function AnchorIcon({ anchor }: { anchor: WorkSessionEntry['anchor'] }): ReactElement {
  const props = { className: 'h-3.5 w-3.5', strokeWidth: 1.8, 'aria-hidden': true as const }
  if (anchor.kind === 'file') return <FileText {...props} />
  if (anchor.kind === 'whiteboard') return <Shapes {...props} />
  if (anchor.kind === 'paper') return <GraduationCap {...props} />
  return <MessageSquare {...props} />
}

export function WorkSessionsSection({ query }: { query: string }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const { workspaceRoot, defaultWorkspaceRoot, workSurface, spaces, libraries, whiteboards } = useWriteWorkspaceStore(
    useShallow((state) => ({
      workspaceRoot: state.workspaceRoot,
      defaultWorkspaceRoot: state.defaultWorkspaceRoot,
      workSurface: state.workSurface,
      spaces: state.workspaceRoots,
      libraries: state.paperMode.libraries,
      whiteboards: state.whiteboards
    }))
  )
  const sessionLabel = (session: WorkSessionEntry): string =>
    session.title || anchorName(session.anchor, (id) => whiteboards[id]?.title) || t('workSessionNew')
  const sessionTime = (updatedAt: string): string => {
    const age = Date.now() - Date.parse(updatedAt)
    return age < JUST_NOW_MS ? t('workSessionJustNow') : formatRelativeTime(updatedAt, i18n.language)
  }
  const defaultLibraryRoot = usePaperWorkspaceBootstrapStore((state) => state.defaultWorkspaceRoot)
  const pin = useWorkSidebarStore((state) => state.pin)
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
  const [groupState, setGroupState] = useState(readGroupState)
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set())
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [actionDialog, setActionDialog] = useState<SidebarActionDialogState | null>(null)
  const mountedKey = writeWorkspaceKey(workspaceRoot)
  const searching = query.trim().length > 0

  type GroupRef = Pick<WorkSessionGroup, 'kind' | 'root'>
  const groupKey = (group: GroupRef): string => `${group.kind}:${writeWorkspaceKey(group.root)}`
  const isMounted = (group: GroupRef): boolean =>
    writeWorkspaceKey(group.root) === mountedKey && (group.kind === 'library') === (workSurface === 'papers')
  const isExpanded = (group: GroupRef): boolean =>
    searching || (groupState[groupKey(group)] ?? isMounted(group))

  const expandedRoots = useMemo(() => {
    const refs: GroupRef[] = [
      ...spaces.map((root) => ({ kind: 'space' as const, root })),
      ...libraries.map((root) => ({ kind: 'library' as const, root }))
    ]
    return new Set(refs.filter((group) => isExpanded(group)).map((group) => group.root))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces, libraries, groupState, mountedKey, workSurface, searching])
  const { groups: liveGroups, loadingRoots, patchThread, forgetThread, reloadRoot } =
    useWorkSessionGroups({ query, expandedRoots })

  const toggleGroup = (group: WorkSessionGroup): void => {
    setGroupState((current) => {
      const next = { ...current, [groupKey(group)]: !isExpanded(group) }
      writeBrowserStorageItem(COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
  }

  const label = (group: WorkSessionGroup): string => {
    const key = writeWorkspaceKey(group.root)
    if (group.kind === 'space' && key === writeWorkspaceKey(defaultWorkspaceRoot)) return t('writeDefaultSpace')
    if (group.kind === 'library' && key === writeWorkspaceKey(defaultLibraryRoot)) return t('paperWorkspaceDefaultName')
    return writeBasenameFromPath(group.root) || group.root
  }

  const commitRename = (session: WorkSessionEntry): void => {
    const value = renaming?.value.trim() ?? ''
    setRenaming(null)
    if (!value || value === session.title) return
    patchThread(session.id, { title: value, titleAuto: false })
    void renameThread(session.id, value)
  }

  // A pinned session that goes away leaves the conversation to the open document.
  const releaseSession = (threadId: string): void => {
    if (useWorkSidebarStore.getState().pin?.threadId === threadId) useWorkSidebarStore.getState().clearPin()
    forgetThread(threadId)
  }
  // Store actions report failures through `error`; a failed removal lists the space again.
  const removeSession = async (group: WorkSessionGroup, threadId: string, remove: () => Promise<void>): Promise<boolean> => {
    const errorBefore = useChatStore.getState().error
    releaseSession(threadId)
    await remove()
    const { error } = useChatStore.getState()
    if (!error || error === errorBefore) return true
    reloadRoot(group.root)
    return false
  }
  // Undo puts the session back where it was, reopening it if it was the open one.
  const archiveSession = (group: WorkSessionGroup, session: WorkSessionEntry): void => {
    const wasOpen = useChatStore.getState().activeThreadId === session.id
    void removeSession(group, session.id, () => archiveThread(session.id, true)).then((archived) => {
      if (!archived) return
      usePaperStore.getState().setNotice({
        tone: 'info',
        message: t('workSessionArchived', { title: sessionLabel(session) }),
        action: {
          label: t('workSessionUndo'),
          run: () => void useChatStore.getState().archiveThread(session.id, false).then(() => {
            reloadRoot(group.root)
            if (wasOpen) void openWorkSession(group, session)
          })
        }
      })
    })
  }
  const requestDelete = (group: WorkSessionGroup, session: WorkSessionEntry): void => {
    setActionDialog({
      title: t('sidebarThreadDeleteDialogTitle', { title: sessionLabel(session) }),
      description: t('sidebarThreadDeleteDialogDescription'),
      detail: t('sidebarThreadDeleteDialogDetail'),
      confirmLabel: t('sidebarThreadDeleteConfirmButton'),
      danger: true,
      submitting: false,
      onConfirm: async () => {
        await removeSession(group, session.id, () => deleteThread(session.id))
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

  const visibleGroups = searching ? liveGroups.filter((group) => group.sessions.length > 0) : liveGroups
  if (searching && visibleGroups.length === 0) {
    return <p className="work-session-loading">{t('workSessionNoMatches')}</p>
  }

  return (
    <div className="work-sessions" data-work-sessions>
      {visibleGroups.map((group) => {
        const key = groupKey(group)
        const expanded = isExpanded(group)
        const mounted = isMounted(group)
        // A draft, or a session created moments ago that the list has not
        // picked up yet, still shows as the current row of its space.
        const pinnedHere = Boolean(pin && mounted && writeWorkspaceKey(pin.workspaceRoot) === writeWorkspaceKey(group.root))
        const draft = pinnedHere && pin !== null && (!pin.threadId ||
          (activity.activeThreadId === pin.threadId && !group.sessions.some((session) => session.id === pin.threadId)))
        const sessions = showAll.has(key) ? group.sessions : group.sessions.slice(0, VISIBLE_SESSIONS)
        const hidden = group.sessions.length - sessions.length
        const name = label(group)
        const GroupIcon = group.kind === 'library' ? GraduationCap : expanded ? FolderOpen : Folder
        return (
          <section key={key} className="work-session-group" data-work-session-group={group.kind} data-root={group.root}>
            <div className="work-session-group-row" data-active={mounted ? 'true' : 'false'} title={group.root}>
              <button type="button" className="work-session-group-toggle" aria-expanded={expanded}
                onClick={() => toggleGroup(group)}>
                {expanded
                  ? <ChevronDown className="work-session-chevron h-3 w-3" strokeWidth={2} aria-hidden />
                  : <ChevronRight className="work-session-chevron h-3 w-3" strokeWidth={2} aria-hidden />}
                <GroupIcon className={`h-3.5 w-3.5 shrink-0 ${mounted ? 'text-accent' : ''}`} strokeWidth={1.8} aria-hidden />
                <span className="work-session-group-name">{name}</span>
                {group.sessions.length ? <span className="work-session-group-count">{group.sessions.length}</span> : null}
              </button>
              <button type="button" className="work-session-group-add" aria-label={t('workSessionNewIn', { name })}
                title={t('workSessionNewIn', { name })} onClick={() => void startWorkSession(group)}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            </div>
            {expanded ? (
              <>
                {draft ? (
                  <div className="work-session-item">
                    <button type="button" className="work-session-row" aria-current="true">
                      <span className="work-session-anchor"><MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden /></span>
                      <span className="work-session-title" data-placeholder="true">{t('workSessionNew')}</span>
                    </button>
                  </div>
                ) : null}
                {sessions.map((session) => {
                  const current = activity.route === 'write' && activity.activeThreadId === session.id && mounted
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
                      <button type="button" className="work-session-row" aria-current={current ? 'true' : undefined}
                        title={sessionLabel(session)}
                        onClick={() => void openWorkSession(group, session)}>
                        <span className="work-session-anchor"><AnchorIcon anchor={session.anchor} /></span>
                        <span className="work-session-title" data-placeholder={session.title ? undefined : 'true'}>
                          {sessionLabel(session)}
                        </span>
                        {state !== 'idle' ? (
                          <SidebarActivityIndicator activity={state} runningLabel={t('sidebarThreadRunning')}
                            failedLabel={t('sidebarThreadFailed')} unreadLabel={t('sidebarThreadUnread')}
                            awaitingInputLabel={t('sidebarThreadAwaitingInput')} />
                        ) : session.updatedAt ? (
                          <span className="work-session-time">{sessionTime(session.updatedAt)}</span>
                        ) : null}
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
                              archiveSession(group, session)
                            }}>
                              <Archive size={15} aria-hidden="true" /><span>{t('sidebarThreadArchive')}</span>
                            </button>
                            <hr />
                            <button type="button" className="is-danger" data-work-session-action="delete" onClick={() => {
                              close()
                              requestDelete(group, session)
                            }}>
                              <Trash2 size={15} aria-hidden="true" /><span>{t('sidebarThreadDelete')}</span>
                            </button>
                          </div>
                        )}
                      </RoomPopover>
                    </div>
                  )
                })}
                {hidden > 0 || showAll.has(key) ? (
                  <button type="button" className="work-session-more" onClick={() => setShowAll((current) => {
                    const next = new Set(current)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })}>
                    {hidden > 0 ? t('workSessionShowMore', { count: hidden }) : t('workSessionShowLess')}
                  </button>
                ) : null}
                {!group.sessions.length && !draft ? (
                  loadingRoots.has(writeWorkspaceKey(group.root)) ? (
                    <p className="work-session-loading">{t('workSessionLoading')}</p>
                  ) : (
                    <div className="work-session-empty">
                      <span>{t('workSessionEmpty')}</span>
                      <button type="button" onClick={() => void startWorkSession(group)}>{t('workSidebarNewSession')}</button>
                    </div>
                  )
                ) : null}
              </>
            ) : null}
          </section>
        )
      })}
      {actionDialog ? (
        <SidebarActionDialog
          state={actionDialog}
          onClose={() => { if (!actionDialog.submitting) setActionDialog(null) }}
          onConfirm={() => void confirmActionDialog()}
          t={t}
        />
      ) : null}
    </div>
  )
}
