import type { ReactElement } from 'react'
import { Bot, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadWorkbenchOrigin } from '@shared/rooms-api'
import { writeBrowserStorageItem } from '../../lib/browser-storage'
import { useChatStore } from '../../store/chat-store'
import { sendThreadToBot, watchThreadWithBot } from './workbench-bridge-actions'

/** Opens the bot conversation that started a Code/Work session. */
export function openWorkbenchOriginChat(origin: ThreadWorkbenchOrigin): void {
  writeBrowserStorageItem('kun.rooms.selected', origin.roomId)
  useChatStore.getState().setRoute('rooms')
}

/** "From bot · Name" chip shown on a session a bot Agent started for the user. */
export function WorkbenchOriginChip({ origin }: { origin: ThreadWorkbenchOrigin }): ReactElement {
  const { t } = useTranslation('common')
  const label = t('roomsWorkbenchFrom', { name: origin.agentName || t('roomsLabel') })
  return <button type="button" onClick={() => openWorkbenchOriginChat(origin)} title={`${label} — ${t('roomsWorkbenchOpenChat')}`} aria-label={`${label}. ${t('roomsWorkbenchOpenChat')}`}
    className="ds-no-drag inline-flex h-7 min-w-0 max-w-[180px] shrink items-center gap-1.5 rounded-[var(--ds-radius-control)] border border-ds-border-muted bg-ds-card px-2 text-[11.5px] font-medium text-ds-muted transition hover:border-ds-border-strong hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
    <Bot className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.85} aria-hidden="true" />
    <span className="truncate">{label}</span>
  </button>
}

/** Header actions that hand the open Code session to the bot: cite it, or be told when it finishes. */
export function WorkbenchSessionActions({ thread, running }: { thread: { id: string; title: string; workbenchOrigin?: ThreadWorkbenchOrigin }; running: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const button = 'ds-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--ds-radius-control)] border border-ds-border-muted bg-ds-card text-ds-muted transition hover:border-ds-border-strong hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30'
  return <div className="flex shrink-0 items-center gap-1.5">
    {thread.workbenchOrigin ? <WorkbenchOriginChip origin={thread.workbenchOrigin} /> : null}
    {running ? <button type="button" className={button} onClick={() => void watchThreadWithBot(thread)} title={t('roomsWorkbenchWatchSession')} aria-label={t('roomsWorkbenchWatchSession')}>
      <Eye className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" /></button> : null}
    <button type="button" className={button} onClick={() => void sendThreadToBot(thread)} title={t('roomsWorkbenchSendToBot')} aria-label={t('roomsWorkbenchSendToBot')}>
      <Bot className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden="true" /></button>
  </div>
}
