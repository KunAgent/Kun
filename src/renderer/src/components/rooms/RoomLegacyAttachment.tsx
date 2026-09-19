import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { getProvider } from '../../agent/registry'
import { roomsRequest } from './rooms-client'

export function RoomLegacyAttachment({ id }: { id: string }) {
  const { t } = useTranslation('common')
  const [name, setName] = useState(id)
  const [preview, setPreview] = useState<{
    url: string
    mime: string
    text?: string
  } | null>(null)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previewOpen = Boolean(preview)
  useEffect(() => {
    if (!previewOpen) return
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [previewOpen])
  useEffect(() => {
    let alive = true
    void roomsRequest<{ attachment: { name: string } }>(
      '/v1/attachments/' + encodeURIComponent(id)
    )
      .then((result) => {
        if (alive) setName(result.attachment.name)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [id])
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url)
    },
    [preview]
  )
  const open = async () => {
    try {
      const result = await getProvider().getAttachmentContent?.(id)
      if (!result) throw new Error(t('roomsAttachmentUnavailable'))
      const bytes = Uint8Array.from(atob(result.dataBase64), (char) =>
        char.charCodeAt(0)
      )
      const mime = result.attachment.mimeType ?? 'application/octet-stream'
      setError('')
      setPreview({
        url: URL.createObjectURL(new Blob([bytes], { type: mime })),
        mime,
        text: /^(text\/|application\/(json|xml))/.test(mime)
          ? new TextDecoder().decode(bytes).slice(0, 100000)
          : undefined
      })
    } catch (cause) {
      setError(String(cause))
    }
  }
  return (
    <div className="rooms-message-attachment">
      <button
        type="button"
        className="rooms-message-attachment-button"
        onClick={() => void open()}
      >
        <Paperclip size={14} aria-hidden="true" />
        <span>{name}</span>
      </button>
      {error ? <span role="alert">{error}</span> : null}
      {preview ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setPreview(null)
            }
            if (event.key === 'Tab') {
              const controls =
                dialogRef.current?.querySelectorAll<HTMLElement>(
                  'button, a[href]'
                )
              const first = controls?.[0]
              const last = controls?.[controls.length - 1]
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last?.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first?.focus()
              }
            }
          }}
          aria-label={name}
          className="fixed inset-8 z-[80] overflow-auto rounded-xl border border-ds-border bg-ds-main p-4 shadow-xl"
        >
          <div className="flex justify-between">
            <a href={preview.url} download={name}>
              {t('roomsDownload')} {name}
            </a>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setPreview(null)}
            >
              {t('roomsClose')}
            </button>
          </div>
          {preview.mime.startsWith('image/') ? (
            <img
              className="max-h-[80vh] max-w-full"
              src={preview.url}
              alt={name}
            />
          ) : preview.text ? (
            <pre className="whitespace-pre-wrap">{preview.text}</pre>
          ) : (
            <p>{t('roomsAttachmentDownloadHint')}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
