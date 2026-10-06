import type { ReactElement } from 'react'
import { MessageCircle, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { openAgentConversationRoom, useAgentChatNavigationStore } from '../rooms/agent-chat-navigation'
import { openAgentChatDialog } from '../rooms/agent-chat-picker'

const pillClass = 'ds-no-drag inline-flex h-8 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3.5 text-[13px] text-ds-muted transition hover:border-ds-border-strong hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55'

/** Home shortcuts into Code conversations: continue with an Agent or gather a group. */
export function CodeHomeQuickStart({ disabled }: { disabled: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const lastRoomId = useAgentChatNavigationStore((state) => state.roomId)
  return <nav aria-label={t('homeQuickStartLabel')} data-home-quick-start className="mt-5 flex flex-wrap items-center justify-center gap-2">
    <button type="button" className={pillClass} disabled={disabled}
      onClick={() => { if (lastRoomId) openAgentConversationRoom(lastRoomId); else openAgentChatDialog('picker') }}>
      <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
      {t('homeQuickChat')}
    </button>
    <button type="button" className={pillClass} disabled={disabled} onClick={() => openAgentChatDialog('picker', { group: true })}>
      <Users className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
      {t('homeQuickGroup')}
    </button>
  </nav>
}
