import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, GitBranch } from 'lucide-react'
import { useChatStore } from '../store/chat-store'
import { createReferenceBranch, historyRequest, type HistoryReference, type HistoryPage } from './history-reference-api'
import { useCodexReferenceEnabled } from './use-codex-reference-enabled'

export function SourceHistoryCard({ referenceId }: { referenceId: string }): ReactElement {
  const { t } = useTranslation('common')
  const enabled = useCodexReferenceEnabled()
  const [source, setSource] = useState<{ reference: HistoryReference; status: HistoryPage['status'] } | null>(null)
  const [error, setError] = useState('')
  const [relinking, setRelinking] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setSource(null); setError('')
    if (!enabled) return
    const controller = new AbortController()
    void historyRequest<{ reference: HistoryReference; status: HistoryPage['status'] }>(`/v1/history-sources/${encodeURIComponent(referenceId)}`, undefined, controller.signal)
      .then(setSource).catch((err) => { if (!controller.signal.aborted) setError(String(err.message ?? err)) })
    return () => controller.abort()
  }, [referenceId, enabled])
  async function relink(): Promise<void> {
    setRelinking(true); setError('')
    try {
      const picked = await window.kunGui.pickLocalFiles()
      if (picked.canceled || !picked.paths[0]) return
      const result = await historyRequest<{ reference: HistoryReference }>(`/v1/history-sources/${encodeURIComponent(referenceId)}/relink`, { path: picked.paths[0] })
      setSource({ reference: result.reference, status: 'available' })
      const state = useChatStore.getState()
      if (state.activeThreadId) await state.selectThread(state.activeThreadId)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setRelinking(false) }
  }
  return <aside className="rounded-xl border border-ds-border-muted bg-ds-card p-4 text-sm" aria-label={t('codexHistorySource')}>
    <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="flex w-full items-center gap-2 text-left">
      <FileText size={16} /><span className="flex-1 truncate font-medium">{source?.reference.title || t('codexHistorySource')}</span>
      <span className="text-xs text-ds-muted">Codex · {t('codexHistoryReadOnly')}</span>
    </button>
    <p className="mt-2 text-ds-muted">{t(enabled ? 'codexHistoryReferenceHint' : 'codexHistoryDisabled')}</p>
    {enabled && source?.status && source.status !== 'available' ? <p className="mt-2 text-amber-600">{t(`codexHistoryStatus_${source.status}`)}</p> : null}
    {expanded ? <div className="mt-3 space-y-2 break-all text-xs text-ds-muted">
      <p>{t('codexHistoryVirtualFile')}: <code>{referenceId}</code></p>
      {source?.reference.files.map((file) => <p key={file.path}>{file.path}</p>)}
      {source?.reference.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      {enabled ? <button type="button" disabled={relinking} className="rounded border border-ds-border-muted px-3 py-1 text-ds-ink"
        onClick={() => void relink()}>{t('codexHistoryRelink')}</button> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-2 text-red-500">{error}</p> : null}
  </aside>
}

export function SourceHistoryTurnLabel({ referenceId, turnId }: { referenceId?: string; turnId?: string }): ReactElement {
  const { t } = useTranslation('common')
  const enabled = useCodexReferenceEnabled()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function branch(): Promise<void> {
    if (!enabled || !referenceId || !turnId || busy) return
    setBusy(true); setError('')
    try {
      const state = useChatStore.getState()
      const workspace = state.threads.find((thread) => thread.id === state.activeThreadId && thread.historyRefId === referenceId)?.workspace
      const result = await createReferenceBranch({
        referenceId, cutoffTurnId: turnId, idempotencyKey: crypto.randomUUID(),
        ...(workspace ? { workspace } : {}),
        ...(state.composerModel ? { model: state.composerModel } : {}),
        ...(state.composerProviderId ? { providerId: state.composerProviderId } : {})
      })
      await state.refreshThreads()
      if (useChatStore.getState().activeThreadId === state.activeThreadId) await state.selectThread(result.thread.id)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-ds-muted">
    <span>Codex · {t('codexHistoryReadOnly')}</span>
    {enabled && referenceId ? <button type="button" disabled={busy} onClick={() => void branch()} className="flex items-center gap-1 hover:text-ds-ink">
      <GitBranch size={12} />{t('codexHistoryBranchHere')}
    </button> : null}
    {error ? <span role="alert" className="text-red-500">{error}</span> : null}
  </div>
}

export function SourceHistoryBoundary(): ReactElement {
  const { t } = useTranslation('common')
  return <div className="mb-6 flex items-center gap-3 text-xs text-ds-muted">
    <span className="h-px flex-1 bg-ds-border-muted" />{t('codexHistoryBoundary')}<span className="h-px flex-1 bg-ds-border-muted" />
  </div>
}
