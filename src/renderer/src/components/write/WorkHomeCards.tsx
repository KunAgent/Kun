import { useMemo, type ReactElement, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { FileText, GraduationCap, History } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { useWriteWorkspaceStore, writeBasenameFromPath, writeRelativeToWorkspace } from '../../write/write-workspace-store'
import { readWriteThreadRegistry } from '../../write/write-thread-registry'
import { workWhiteboardThreadIds } from '../../write/work-whiteboard'
import { buildWorkSessions } from '../../write/work-sessions-model'
import { readWorkRecentDocuments } from '../../write/work-recent-documents'
import { openPaperImport, openPaperView, openWorkSession } from '../../write/work-session-actions'
import { usePaperModeStore } from '../../paper/paper-mode-store'

function HomeCard({ kind, eyebrow, icon, title, meta, onClick }: {
  kind: string
  eyebrow: string
  icon: ReactNode
  title: string
  meta: string
  onClick: () => void
}): ReactElement {
  return (
    <button type="button" className="work-home-card" data-work-home-card={kind} onClick={onClick} title={title}>
      <span className="work-home-card-eyebrow">{icon}<span>{eyebrow}</span></span>
      <span className="work-home-card-title">{title}</span>
      <span className="work-home-card-meta">{meta}</span>
    </button>
  )
}

/**
 * Ways back into the space under the home composer, like Code's home cards:
 * the last session, the last document, and the papers waiting to be read.
 */
export function WorkHomeCards(): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const { workspaceRoot, whiteboards } = useWriteWorkspaceStore(useShallow((s) => ({
    workspaceRoot: s.workspaceRoot,
    whiteboards: s.whiteboards
  })))
  const threads = useChatStore((s) => s.threads)
  const counts = usePaperModeStore((s) => s.counts)
  const language = i18n.resolvedLanguage ?? i18n.language

  const lastSession = useMemo(() => {
    if (!workspaceRoot) return null
    const boards = Object.values(whiteboards).map((board) => ({
      id: board.id, workspaceRoot: board.workspaceRoot, threadIds: workWhiteboardThreadIds(board)
    }))
    return buildWorkSessions({ root: workspaceRoot, threads, registry: readWriteThreadRegistry(), boards })[0] ?? null
  }, [threads, whiteboards, workspaceRoot])
  const lastDocument = useMemo(() => (workspaceRoot ? readWorkRecentDocuments(workspaceRoot)[0] ?? null : null),
    // The list only changes while documents are open, never on the home.
    [workspaceRoot])

  if (!workspaceRoot) return null
  const cards: ReactElement[] = []
  if (lastSession) {
    const anchor = lastSession.anchor
    const anchorLabel = anchor.kind === 'file' || anchor.kind === 'paper'
      ? writeBasenameFromPath(anchor.path)
      : anchor.kind === 'whiteboard' ? whiteboards[anchor.boardId]?.title ?? '' : ''
    const when = lastSession.updatedAt ? formatRelativeTime(lastSession.updatedAt, language) : ''
    cards.push(
      <HomeCard key="session" kind="continue-session" eyebrow={t('workHomeContinue')}
        icon={<History className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden />}
        title={lastSession.title || anchorLabel || t('workSessionNew')}
        meta={[anchorLabel, when].filter(Boolean).join(' · ')}
        onClick={() => void openWorkSession(lastSession)} />
    )
  }
  if (lastDocument) {
    cards.push(
      <HomeCard key="document" kind="recent-document" eyebrow={t('workHomeRecentDocument')}
        icon={<FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden />}
        title={writeBasenameFromPath(lastDocument.path)}
        meta={[writeRelativeToWorkspace(workspaceRoot, lastDocument.path).split('/').slice(0, -1).join('/'),
          formatRelativeTime(new Date(lastDocument.at).toISOString(), language)].filter(Boolean).join(' · ')}
        onClick={() => void useWriteWorkspaceStore.getState().openFile(workspaceRoot, lastDocument.path)} />
    )
  }
  cards.push(counts.total > 0 ? (
    <HomeCard key="papers" kind="papers" eyebrow={t('workSidebarPapersNav')}
      icon={<GraduationCap className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden />}
      title={counts.unread > 0 ? t('workHomePapersUnread', { count: counts.unread }) : t('workHomePapersAllRead')}
      meta={t('workHomePapersOpen', { count: counts.total })}
      onClick={() => void openPaperView('library')} />
  ) : (
    <HomeCard key="papers" kind="papers" eyebrow={t('workSidebarPapersNav')}
      icon={<GraduationCap className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden />}
      title={t('workHomePapersFirst')}
      meta={t('workHomePapersFirstHint')}
      onClick={() => void openPaperImport()} />
  ))
  return (
    <nav className="work-home-cards" aria-label={t('workHomeCardsLabel')} data-work-home-cards>
      {cards}
    </nav>
  )
}
