import { RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RoomAvatar } from './RoomAvatar'
import type { RoomPendingSend } from './useRoomPendingSends'

/**
 * Optimistic copy of the user's own message, shown at the bottom of the
 * timeline until the server echoes it (matched by clientRequestId). Failed
 * sends stay visible with retry/dismiss so nothing is silently lost.
 */
export function RoomPendingSendRow({
  item,
  onRetry,
  onDismiss
}: {
  item: RoomPendingSend
  onRetry: (clientRequestId: string) => void
  onDismiss: (clientRequestId: string) => void
}) {
  const { t } = useTranslation('common')
  return (
    <article
      className={`rooms-message-row rooms-message-user rooms-pending-row rooms-pending-${item.state}`}
      data-pending-id={item.clientRequestId}
    >
      <RoomAvatar id="user" user label={t('roomsMyAvatar')} />
      <div className="rooms-message-content">
        <div className="rooms-message-meta">
          <strong>{t('roomsMyAvatar')}</strong>
          <span className="rooms-pending-status">
            {item.state === 'sending' ? t('roomsSend_pending') : null}
            {item.state === 'sent' ? t('roomsReceipt_fallback') : null}
          </span>
        </div>
        <div className="rooms-message-bubble">
          <p className="rooms-pending-body">{item.body}</p>
        </div>
        {item.state === 'failed' ? (
          <p className="rooms-pending-failed" role="alert">
            <span className="min-w-0 flex-1 break-words">
              {t('roomsSend_failed')}
              {item.error ? ` · ${item.error}` : ''}
            </span>
            <button
              type="button"
              onClick={() => onRetry(item.clientRequestId)}
              aria-label={t('roomsSend_retry')}
            >
              <RotateCcw size={12} aria-hidden="true" />
              {t('roomsSend_retry')}
            </button>
            <button
              type="button"
              onClick={() => onDismiss(item.clientRequestId)}
              aria-label={t('roomsSend_dismiss')}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </p>
        ) : null}
      </div>
    </article>
  )
}
