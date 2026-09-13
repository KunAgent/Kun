import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip } from 'lucide-react'
import type { ChatBlock } from '../agent/types'
import { historyRequest } from './history-reference-api'
import { useCodexReferenceEnabled } from './use-codex-reference-enabled'

type Preview = { name: string; mimeType: string; url: string; text?: string }

export function SourceHistoryAttachments({ blocks, referenceId }: { blocks: ChatBlock[]; referenceId?: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const enabled = useCodexReferenceEnabled(blocks.some((block) => block.turnId?.startsWith('claude-code:')) ? 'claude-code' : 'codex')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const attachments = blocks.flatMap((block) => (block.sourceAttachments ?? []).map((entry) => ({
    ...entry, itemId: block.sourceItemId ?? block.id
  })))
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])
  useEffect(() => {
    setPreview(null); setLoading(false)
    return () => { request.current?.abort(); request.current = null }
  }, [referenceId, enabled])
  async function view(itemId: string, index: number): Promise<void> {
    if (!enabled || !referenceId || loading) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError('')
    try {
      const result = await historyRequest<{ name: string; mimeType: string; dataBase64: string }>(
        `/v1/history-sources/${encodeURIComponent(referenceId)}/attachments/${encodeURIComponent(itemId)}/${index}`, undefined, controller.signal
      )
      const bytes = Uint8Array.from(atob(result.dataBase64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
      const text = /^(text\/(?:plain|csv)|application\/json)(?:;|$)/.test(result.mimeType)
        ? new TextDecoder().decode(bytes).slice(0, 100_000) : undefined
      setPreview({ name: result.name, mimeType: result.mimeType, url, text })
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err)) }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  if (!attachments.length) return null
  return <div className="mt-3 space-y-2" aria-label={t('codexHistoryAttachments')}>
    <div className="flex flex-wrap gap-2">{attachments.map((entry) => <button type="button"
      key={`${entry.itemId}:${entry.index}`} disabled={!enabled || !referenceId || loading}
      title={!referenceId ? t('codexHistoryAttachmentAfterBranch') : entry.name}
      onClick={() => void view(entry.itemId, entry.index)}
      className="flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2 py-1 text-xs text-ds-muted hover:text-ds-ink disabled:opacity-50">
      <Paperclip size={13} />{entry.name}
    </button>)}</div>
    {!referenceId ? <p className="text-xs text-ds-muted">{t('codexHistoryAttachmentAfterBranch')}</p> : null}
    {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
    {preview && enabled ? <div className="rounded-lg border border-ds-border-muted p-3">
      <div className="mb-2 flex justify-between gap-3 text-xs"><span className="truncate">{preview.name}</span>
        <button type="button" onClick={() => setPreview(null)}>{t('close')}</button></div>
      {/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(preview.mimeType)
        ? <img src={preview.url} alt={preview.name} className="max-h-96 max-w-full object-contain" />
        : preview.mimeType.startsWith('audio/') ? <audio src={preview.url} controls className="max-w-full" />
        : preview.mimeType.startsWith('video/') ? <video src={preview.url} controls className="max-h-96 max-w-full" />
        : preview.text !== undefined ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{preview.text}</pre>
        : <p className="text-xs text-ds-muted">{t('codexHistoryAttachmentSaveHint')}</p>}
      <a className="mt-2 inline-block text-xs underline" href={preview.url} download={preview.name}>{t('codexHistoryAttachmentSave')}</a>
    </div> : null}
  </div>
}
