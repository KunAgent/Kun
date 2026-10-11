import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

/** Only the immutable, workspace-confined image snapshot is rendered. */
export function PaperEvidenceImage({ workspaceRoot, path }: { workspaceRoot: string; path: string }): ReactElement {
  const { t } = useTranslation('common')
  const [source, setSource] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setSource(null)
    setError('')
    void window.kunGui.readWorkspaceImage({ workspaceRoot, path }).then((result) => {
      if (!active) return
      if (!result.ok) { setError(result.message); return }
      // Never let a corrupted store/API value create an external image request.
      if (!/^data:image\/png;base64,/.test(result.dataUrl)) { setError('Evidence image is not a local PNG.'); return }
      setSource(result.dataUrl)
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [workspaceRoot, path])
  return <div>{source ? <img src={source} alt={t('paperEvidenceImage')} className="max-h-64 max-w-full rounded border border-ds-border-muted object-contain" /> : <p className="text-xs text-ds-muted">{error || t('loading')}</p>}</div>
}
