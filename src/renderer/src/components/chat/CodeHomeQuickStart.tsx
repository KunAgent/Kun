import { useMemo, type ReactElement, type ReactNode } from 'react'
import { History, MessageCircle, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import type { NormalizedThread } from '../../agent/types'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { useThreadClassificationRegistries } from '../../lib/thread-classification-registries'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { useChatStore } from '../../store/chat-store'
import { isCodeThread } from '../../store/chat-store-runtime-projection-support'
import { openAgentConversationRoom } from '../rooms/agent-chat-navigation'
import { openAgentChatDialog } from '../rooms/agent-chat-picker'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { useLatestPrivateConversation } from '../rooms/room-activity-counts'
import { sidebarThreadActivity, sortSidebarThreads, type SidebarThreadActivityContext } from './sidebar-project-selectors'

const EMPTY_MAP: Record<string, never> = {}
const ACTIVITY_KEYS = {
  'awaiting-input': 'attentionStatusAwaitingInput',
  running: 'attentionStatusRunning',
  failed: 'attentionStatusFailed',
  unread: 'attentionStatusUnread',
  scheduled: 'attentionStatusScheduled'
} as const

/** The task the home card offers to resume: the newest Code task other than the open blank one. */
export function continueTaskCandidate(threads: readonly NormalizedThread[], activeThreadId: string | null,
  isCode: (thread: NormalizedThread) => boolean): NormalizedThread | null {
  return sortSidebarThreads(threads.filter((thread) => thread.id !== activeThreadId && !thread.archived &&
    thread.relation !== 'side' && !thread.parentThreadId && !thread.executionUnit && isCode(thread)))[0] ?? null
}

function HomeCard({ eyebrow, icon, title, meta, metaTone, disabled, onClick, kind }: {
  eyebrow: string
  icon: ReactNode
  title: string
  meta: string
  metaTone?: string
  disabled: boolean
  onClick: () => void
  kind: string
}): ReactElement {
  return (
    <button type="button" disabled={disabled} onClick={onClick} data-home-card={kind}
      className="ds-home-card ds-no-drag group flex min-w-0 flex-col items-start gap-1 rounded-[14px] border border-ds-border bg-ds-card px-3.5 py-3 text-left transition hover:border-ds-border-strong hover:shadow-[0_6px_18px_rgba(20,30,50,0.07)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/30 disabled:cursor-not-allowed disabled:opacity-55">
      <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-ds-faint">
        {icon}
        <span className="truncate">{eyebrow}</span>
      </span>
      <span className="w-full truncate text-[13.5px] font-semibold text-ds-ink">{title}</span>
      <span className={`w-full truncate text-[12px] ${metaTone ?? 'text-ds-faint'}`}>{meta}</span>
    </button>
  )
}

/**
 * Code home cards under the composer: resume the latest task, return to the
 * last Agent private chat, or gather a group.
 */
export function CodeHomeQuickStart({ disabled, onOpenThread }: {
  disabled: boolean
  /** Opens a task the same way the sidebar does; without it the resume card is hidden. */
  onOpenThread?: (threadId: string) => unknown
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const chat = useChatStore(useShallow((s) => ({ threads: s.threads, clawChannels: s.clawChannels, activeThreadId: s.activeThreadId })))
  const activityContext: SidebarThreadActivityContext = useChatStore(useShallow((s) => ({
    activeThreadId: s.activeThreadId,
    busy: s.busy,
    watchTurnCompletion: s.watchTurnCompletion ?? EMPTY_MAP,
    unreadThreadIds: s.unreadThreadIds ?? EMPTY_MAP,
    scheduledThreadActivities: s.scheduledThreadActivities ?? EMPTY_MAP,
    awaitingUserInputThreadIds: s.awaitingUserInputThreadIds ?? EMPTY_MAP
  })))
  const classification = useThreadClassificationRegistries(chat.threads)
  const latestTask = useMemo(() => onOpenThread ? continueTaskCandidate(chat.threads, chat.activeThreadId, (thread) =>
    isCodeThread(thread, chat.clawChannels, classification.writeRegistry, classification.designRegistry, classification.sddRegistry)) : null,
  [chat.activeThreadId, chat.clawChannels, chat.threads, classification, onOpenThread])
  const latestChat = useLatestPrivateConversation((state) => state.entry)
  const activity = latestTask ? sidebarThreadActivity(latestTask, activityContext) : 'read'
  const taskMeta = latestTask ? [
    workspaceLabelFromPath(latestTask.workspace ?? ''),
    activity === 'read' ? formatRelativeTime(latestTask.updatedAt, i18n.resolvedLanguage ?? i18n.language) : t(ACTIVITY_KEYS[activity])
  ].filter(Boolean).join(' · ') : ''
  const cards: ReactElement[] = []
  if (latestTask && onOpenThread) {
    cards.push(<HomeCard key="task" kind="continue-task" disabled={disabled}
      icon={<History className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />}
      eyebrow={t('homeContinueTask')} title={latestTask.title || t('newChat')} meta={taskMeta}
      metaTone={activity === 'awaiting-input' ? 'text-[var(--sidebar-attention-ink,#a2520a)]' : undefined}
      onClick={() => void onOpenThread(latestTask.id)} />)
  }
  cards.push(<HomeCard key="chat" kind="agent-chat" disabled={disabled}
    icon={latestChat
      ? <RoomAvatar avatar={latestChat.avatar} id={latestChat.agentId} label={latestChat.name} size={18} />
      : <MessageCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />}
    eyebrow={t('homeQuickChat')}
    title={latestChat?.name ?? t('homeChatAgentTitle')}
    meta={latestChat ? latestChat.preview || t('homeChatAgentResume') : t('homeChatAgentHint')}
    onClick={() => { if (latestChat) openAgentConversationRoom(latestChat.roomId); else openAgentChatDialog('picker') }} />)
  cards.push(<HomeCard key="group" kind="group-chat" disabled={disabled}
    icon={<Users className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />}
    eyebrow={t('homeQuickGroup')} title={t('homeGroupTitle')} meta={t('homeGroupHint')}
    onClick={() => openAgentChatDialog('picker', { group: true })} />)
  return (
    <nav aria-label={t('homeQuickStartLabel')} data-home-quick-start
      className="ds-home-quick-start ds-chat-column-inset ds-chat-content-max-width mt-1 grid w-full gap-2.5"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
      {cards}
    </nav>
  )
}
