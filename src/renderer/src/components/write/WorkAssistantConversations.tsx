import { useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useWriteResourceConversationHistory } from './useWriteResourceConversationHistory'
import { SidebarActivityIndicator } from '../sidebar/SidebarActivityIndicator'

/** The existing Work resource registry is the only conversation index. */
export function WorkAssistantConversations() {
  const { t } = useTranslation('common')
  const busy = useChatStore((s) => s.busy)
  const model = useWriteResourceConversationHistory(busy)
  const scopeKey = model?.scopeKey
  const runtimeReady = model?.runtimeReady
  const registeredIds = model?.entries.map((entry) => entry.id).join('\0')
  useEffect(() => {
    if (scopeKey && runtimeReady) void model?.loadMissingThreads()
    // Same scope does not need repeated network reads on streaming updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, runtimeReady, registeredIds])
  if (!model || !model.entries.length) return null
  const locked = model.running || model.workflowLocked || !model.runtimeReady
  return <nav aria-label={t('workAssistantConversations')} className="max-h-60 overflow-y-auto px-2 pb-2 pt-3">
    <p className="mb-1 px-2 text-[11px] text-ds-faint">{t('workAssistantConversations')}</p>
    {model.entries.slice(0, 8).map((entry, index) => <button key={entry.id} type="button"
      disabled={entry.missing || (locked && !entry.current)}
      aria-current={entry.current ? 'page' : undefined}
      onClick={() => void model.selectConversation(entry.id)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] disabled:opacity-50 ${entry.current ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover'}`}>
      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{entry.title || t('writeConversationFallback', { number: index + 1 })}</span>
      <SidebarActivityIndicator activity={entry.activity ?? 'idle'} runningLabel={t('sidebarThreadRunning')}
        failedLabel={t('sidebarThreadFailed')} unreadLabel={t('sidebarThreadUnread')}
        awaitingInputLabel={t('sidebarThreadAwaitingInput')} />
    </button>)}
  </nav>
}
