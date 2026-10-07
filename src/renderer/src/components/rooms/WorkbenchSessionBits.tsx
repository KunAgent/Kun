import type { ReactElement } from 'react'
import { Bot, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { HEADER_ICON_BUTTON_CLASS, HEADER_ICON_CLASS, HEADER_ICON_STROKE, headerTextButtonClass } from '../workbench/header-action-button'
import type { ThreadWorkbenchOrigin } from '@shared/rooms-api'
import { openAgentConversationRoom } from './agent-chat-navigation'
import { sendThreadToBot, watchThreadWithBot } from './workbench-bridge-actions'

/** Opens the Code conversation (private or group) that started a Code/Work session. */
export function openWorkbenchOriginChat(origin: ThreadWorkbenchOrigin): void {
  openAgentConversationRoom(origin.roomId)
}

/** "From bot · Name" chip shown on a session a bot Agent started for the user. */
export function WorkbenchOriginChip({ origin }: { origin: ThreadWorkbenchOrigin }): ReactElement {
  const { t } = useTranslation('common')
  const label = t('roomsWorkbenchFrom', { name: origin.agentName || t('roomsLabel') })
  return <button type="button" onClick={() => openWorkbenchOriginChat(origin)} title={`${label} — ${t('roomsWorkbenchOpenChat')}`} aria-label={`${label}. ${t('roomsWorkbenchOpenChat')}`}
    className={`${headerTextButtonClass()} min-w-0 max-w-[180px] shrink`}>
    <Bot className={`${HEADER_ICON_CLASS} text-accent`} strokeWidth={HEADER_ICON_STROKE} aria-hidden="true" />
    <span className="truncate">{label}</span>
  </button>
}

/** Header actions that hand the open Code session to the bot: cite it, or be told when it finishes. */
export function WorkbenchSessionActions({ thread, running }: { thread: { id: string; title: string; workbenchOrigin?: ThreadWorkbenchOrigin }; running: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const button = `ds-no-drag ${HEADER_ICON_BUTTON_CLASS}`
  return <div className="flex shrink-0 items-center gap-1">
    {thread.workbenchOrigin ? <WorkbenchOriginChip origin={thread.workbenchOrigin} /> : null}
    {running ? <button type="button" className={button} onClick={() => void watchThreadWithBot(thread)} data-tooltip={t('roomsWorkbenchWatchSession')} aria-label={t('roomsWorkbenchWatchSession')}>
      <Eye className={HEADER_ICON_CLASS} strokeWidth={HEADER_ICON_STROKE} aria-hidden="true" /></button> : null}
    <button type="button" className={button} onClick={() => void sendThreadToBot(thread)} data-tooltip={t('roomsWorkbenchSendToBot')} aria-label={t('roomsWorkbenchSendToBot')}>
      <Bot className={HEADER_ICON_CLASS} strokeWidth={HEADER_ICON_STROKE} aria-hidden="true" /></button>
  </div>
}
