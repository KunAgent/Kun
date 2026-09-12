import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { AssistantMarkdown } from '../chat/AssistantMarkdown'
import { getProvider } from '../../agent/registry'
import { roomsRequest } from './rooms-client'

function RoomAttachment({ id }: { id: string }) {
  const { t } = useTranslation('common')
  const [name, setName] = useState(id)
  const [preview, setPreview] = useState<{
    url: string
    mime: string
    text?: string
  } | null>(null)
  const [error, setError] = useState('')
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
    <div className="text-xs">
      <button className="text-accent underline" onClick={() => void open()}>
        {name}
      </button>
      {error ? <span role="alert">{error}</span> : null}
      {preview ? (
        <div
          role="dialog"
          aria-modal="true"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setPreview(null)
            }
          }}
          aria-label={name}
          className="fixed inset-8 z-[80] overflow-auto rounded-xl border border-ds-border bg-ds-main p-4 shadow-xl"
        >
          <div className="flex justify-between">
            <a href={preview.url} download={name}>
              {t('roomsDownload')} {name}
            </a>
            <button onClick={() => setPreview(null)}>{t('roomsClose')}</button>
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
export function RoomMessageBody({
  body,
  attachmentIds
}: {
  body: string
  attachmentIds: string[]
}) {
  return (
    <div className="space-y-2">
      <AssistantMarkdown
        text={body}
        streaming={false}
        className="text-sm leading-7 text-ds-ink"
      />
      {attachmentIds.map((id) => (
        <RoomAttachment key={id} id={id} />
      ))}
    </div>
  )
}
