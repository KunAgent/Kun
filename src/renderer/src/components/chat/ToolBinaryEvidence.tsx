import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Volume2 } from 'lucide-react'
import type { ToolPresentationContent } from '@shared/tool-presentation'
import { retainedToolBase64, toolEvidenceAudio, toolEvidenceFileName } from './tool-evidence-content'

export function ToolBinaryEvidence({ item, truncated = false }: { item: ToolPresentationContent; truncated?: boolean }): ReactElement | null {
  const { t } = useTranslation('common')
  const [previewedAudio, setPreviewedAudio] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const raw = item.data ?? item.resource?.blob
  if (!raw) return null
  const bytes = retainedToolBase64(raw)
  if (item.omitted || truncated || !bytes) return <p className="text-ds-muted">{t('toolDetails.binaryUnavailable')}</p>
  const audio = toolEvidenceAudio(bytes, item.mimeType ?? item.resource?.mimeType)
  const preview = audio !== undefined && previewedAudio === audio
  const download = (): void => {
    try {
      const decoded = atob(bytes)
      const buffer = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = toolEvidenceFileName(item.name)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } catch { setFailed(true) }
  }
  return <div className="min-w-0 space-y-2" data-tool-binary-content>
    <div className="flex flex-wrap gap-3">
      {audio ? <button type="button" className="inline-flex items-center gap-1.5 text-accent hover:underline" onClick={() => setPreviewedAudio(preview ? null : audio)}>
        <Volume2 size={14} />{t(preview ? 'toolDetails.hideAudio' : 'toolDetails.previewAudio')}
      </button> : null}
      <button type="button" className="inline-flex items-center gap-1.5 text-accent hover:underline" onClick={download}>
        <Download size={14} />{t('toolDetails.download')}
      </button>
    </div>
    {preview && audio ? <audio controls preload="none" src={audio} className="max-w-full" /> : null}
    {failed ? <p className="text-ds-muted">{t('toolDetails.binaryUnavailable')}</p> : null}
  </div>
}
