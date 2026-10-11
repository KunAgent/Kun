import { File, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PendingRoomAttachment } from './useRoomAttachmentUploads'

export function RoomAttachmentUploads({ pending, onCancel, onRetry }: {
  pending: PendingRoomAttachment[]; onCancel: (id: string) => void; onRetry: (id: string) => void
}) {
  const { t } = useTranslation('common')
  if (!pending.length) return null
  return <div className="rooms-attachment-uploads" aria-live="polite">
    {pending.map((item) => <div key={item.id} className={`rooms-attachment-upload is-${item.state}`}>
      <File size={16} aria-hidden="true" /><span>{item.name}</span>
      {item.state === 'uploading' ? <span role="status"><LoaderCircle size={14} className="animate-spin" />{t('roomsUploading')}</span>
        : <><span role="alert">{item.error}</span><button type="button" onClick={() => onRetry(item.id)}
          aria-label={t('roomsRetryAttachment', { name: item.name, defaultValue: 'Retry {{name}}' })}><RotateCcw size={14} /></button></>}
      <button type="button" onClick={() => onCancel(item.id)}
        aria-label={t('roomsCancelAttachment', { name: item.name, defaultValue: 'Cancel {{name}}' })}><X size={14} /></button>
    </div>)}
  </div>
}
