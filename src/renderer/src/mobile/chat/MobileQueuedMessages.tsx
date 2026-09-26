import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import './mobile-queued-messages.css'

export function mobileQueuedMessageStatus(message: QueuedUserMessage): string {
  if (message.deliveryState === 'starting') return 'queuedMessageConfirming'
  if (message.deliveryState === 'paused') return 'queuedMessagePaused'
  if (message.deliveryState === 'failed') return 'queuedMessageFailed'
  return 'queuedMessageInFlight'
}

/** Follow-ups sent while a turn runs wait here instead of vanishing from the composer. */
export function MobileQueuedMessages({ messages, onRemove }: {
  messages: readonly QueuedUserMessage[]
  onRemove: (id: string) => Promise<void> | void
}) {
  const { t } = useTranslation('common')
  if (messages.length === 0) return null
  return <section className="kun-mobile-queued" aria-label={t('queuedMessagesTitle', { count: messages.length })}>
    <ul>
      {messages.map((message) => {
        const failed = message.deliveryState === 'failed'
        return <li key={message.id} data-state={message.deliveryState ?? 'pending'}>
          <span className="kun-mobile-queued-text">{message.displayText || message.text}</span>
          <span className="kun-mobile-queued-status">
            {failed && (message.errorMessage || message.errorCode)
              ? message.errorMessage || message.errorCode
              : t(mobileQueuedMessageStatus(message))}
          </span>
          <button type="button" aria-label={t('queuedMessageRemove')}
            disabled={message.deliveryState === 'starting' || Boolean(message.steeringRequest)}
            onClick={() => void onRemove(message.id)}>
            <X size={16} aria-hidden />
          </button>
        </li>
      })}
    </ul>
  </section>
}
