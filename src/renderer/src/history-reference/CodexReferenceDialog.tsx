import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useChatStore } from '../store/chat-store'
import { SourceHistoryPreview } from './SourceHistoryPreview'
import { createReferenceBranch, historyRequest, type HistoryPreview, type HistorySession } from './history-reference-api'
import { useCodexReferenceEnabled } from './use-codex-reference-enabled'

const control = 'min-w-0 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-2 text-sm text-ds-ink'

export function CodexReferenceDialog({ workspaceRoot, onClose, onCreated }: {
  workspaceRoot: string; onClose: () => void; onCreated: (id: string) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const enabled = useCodexReferenceEnabled()
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [projectOnly, setProjectOnly] = useState(Boolean(workspaceRoot))
  const [archived, setArchived] = useState(false)
  const [after, setAfter] = useState('')
  const [before, setBefore] = useState('')
  const [preview, setPreview] = useState<HistoryPreview | null>(null)
  const [cutoff, setCutoff] = useState('')
  const [workspaceOverride, setWorkspaceOverride] = useState('')
  const [workspaceDirty, setWorkspaceDirty] = useState(false)
  const sourceWorkspace = (cutoff ? preview?.cutoffs.find((entry) => entry.turnId === cutoff)?.workspace : undefined) ?? preview?.session.workspace ?? ''
  const workspace = workspaceDirty ? workspaceOverride : sourceWorkspace || workspaceRoot
  const editWorkspace = (value: string): void => { setWorkspaceOverride(value); setWorkspaceDirty(true) }
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Array<{ path: string; id?: string; error?: string }>>([])
  const previewVersion = useRef(0)
  const requestKeys = useRef(new Map<string, string>())
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => prior?.focus()
  }, [])
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ includeArchived: String(archived), limit: '200' })
      if (projectOnly && workspaceRoot) params.set('cwd', workspaceRoot)
      if (query) params.set('query', query)
      if (after) params.set('after', new Date(`${after}T00:00:00`).toISOString())
      if (before) params.set('before', new Date(`${before}T23:59:59.999`).toISOString())
      setLoading(true); setError('')
      void historyRequest<{ sessions: HistorySession[] }>(`/v1/history-sources/codex/sessions?${params}`, undefined, controller.signal)
        .then((result) => setSessions(result.sessions))
        .catch((err) => { if (!controller.signal.aborted) setError(String(err.message ?? err)) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [enabled, query, projectOnly, archived, after, before, workspaceRoot])

  async function showPreview(path: string, more = false): Promise<void> {
    const version = ++previewVersion.current
    setPreviewLoading(true); setError('')
    try {
      const result = await historyRequest<HistoryPreview>('/v1/history-sources/codex/preview', {
        path, limit: 12, ...(more && preview?.page.nextCursor ? { cursor: preview.page.nextCursor } : {})
      })
      if (version !== previewVersion.current) return
      setPreview((current) => more && current?.session.path === path ? {
        ...result, page: { ...result.page, turns: [...result.page.turns, ...current.page.turns] }
      } : result)
      if (!more && preview?.session.path !== path) { setCutoff(''); setWorkspaceOverride(''); setWorkspaceDirty(false) }
    } catch (err) {
      if (version === previewVersion.current) setError(err instanceof Error ? err.message : String(err))
    } finally { if (version === previewVersion.current) setPreviewLoading(false) }
  }

  async function pickFiles(): Promise<void> {
    const picked = await window.kunGui.pickLocalFiles()
    if (picked.canceled) return
    const paths = picked.paths.filter((path) => /\.jsonl(?:\.zst)?$/i.test(path))
    if (paths.length !== picked.paths.length) setError(t('codexHistoryFileType'))
    if (!paths.length) return
    setSelected(paths)
    if (paths.length === 1) await showPreview(paths[0]!)
    else { ++previewVersion.current; setPreview(null); setCutoff(''); setWorkspaceDirty(false) }
  }

  async function createBranches(): Promise<void> {
    if (!enabled || creating) return
    setCreating(true); setError(''); setResults([])
    const current = useChatStore.getState()
    const completed: Array<{ path: string; id?: string; error?: string }> = []
    for (const path of selected) {
      const input = {
        path,
        ...(selected.length === 1 && preview?.session.path === path && cutoff ? { cutoffTurnId: cutoff } : {}),
        ...(selected.length === 1 && preview?.session.path === path && workspace && (workspaceDirty || !sourceWorkspace) ? { workspace } : {}),
        ...(current.composerModel ? { model: current.composerModel } : {}),
        ...(current.composerProviderId ? { providerId: current.composerProviderId } : {})
      }
      const identity = JSON.stringify(input)
      const key = requestKeys.current.get(identity) ?? crypto.randomUUID()
      requestKeys.current.set(identity, key)
      try {
        const created = await createReferenceBranch({ ...input, idempotencyKey: key })
        completed.push({ path, id: created.thread.id })
      } catch (err) { completed.push({ path, error: err instanceof Error ? err.message : String(err) }) }
      setResults([...completed])
    }
    await current.refreshThreads().catch(() => undefined)
    setCreating(false)
    if (completed.length === 1 && completed[0]?.id) onCreated(completed[0].id)
  }

  const toggle = (path: string): void => {
    setSelected((current) => current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path])
    setCutoff('')
  }
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-5">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="codex-reference-title" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !creating) onClose()
        if (event.key === 'Tab') {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'))
          const first = items[0]; const last = items.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}
      className="flex h-[min(820px,90vh)] w-[min(1100px,95vw)] flex-col rounded-2xl border border-ds-border-muted bg-ds-elevated p-5 text-ds-ink shadow-2xl">
      <header className="mb-3 flex items-start justify-between gap-4">
        <div><h2 id="codex-reference-title" className="text-lg font-semibold">{t('codexHistoryCreate')}</h2>
          <p className="mt-1 text-sm text-ds-muted">{t('codexHistoryReferenceHint')}</p></div>
        <button type="button" onClick={onClose} disabled={creating} aria-label={t('close')} className="rounded p-2"><X size={18} /></button>
      </header>
      {!enabled ? <p>{t('codexHistoryDisabled')}</p> : <>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input className={control} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('codexHistorySearch')} aria-label={t('codexHistorySearch')} />
          <label className="text-sm"><input type="checkbox" checked={projectOnly} disabled={!workspaceRoot} onChange={(event) => setProjectOnly(event.target.checked)} /> {t('codexHistoryCurrentProject')}</label>
          <label className="text-sm"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> {t('codexHistoryArchived')}</label>
          <input className={control} type="date" value={after} onChange={(event) => setAfter(event.target.value)} aria-label={t('codexHistoryAfter')} />
          <input className={control} type="date" value={before} onChange={(event) => setBefore(event.target.value)} aria-label={t('codexHistoryBefore')} />
          <button className={control} type="button" onClick={() => void pickFiles().catch((err) => setError(String(err)))}>{t('codexHistoryChooseFiles')}</button>
        </div>
        {error ? <p role="alert" className="mb-2 text-sm text-red-500">{error}</p> : null}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(210px,0.8fr)_minmax(0,1.2fr)] gap-4">
          <div className="overflow-auto rounded-lg border border-ds-border-muted p-2">
            {loading ? <p className="p-3 text-sm">{t('loading')}</p> : null}
            {!loading && !sessions.length ? <p className="p-3 text-sm text-ds-muted">{t('codexHistoryEmpty')}</p> : null}
            {sessions.map((session) => <div key={session.path} className="flex items-start gap-2 rounded-lg p-2 hover:bg-ds-card">
              <input type="checkbox" className="mt-1" aria-label={session.title} checked={selected.includes(session.path)} onChange={() => toggle(session.path)} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void showPreview(session.path)}>
                <span className="block truncate text-sm font-medium">{session.title || session.sessionId}</span>
                <span className="block truncate text-xs text-ds-muted" title={session.workspace}>{session.workspace}</span>
                <span className="text-xs text-ds-muted">{new Date(session.updatedAt).toLocaleString()}{session.archived ? ` · ${t('codexHistoryArchived')}` : ''}</span>
              </button>
            </div>)}
          </div>
          <div className="flex min-h-0 flex-col gap-2">
            {preview ? <>
              <p className="truncate text-sm font-medium">{preview.session.title}</p>
              <SourceHistoryPreview page={preview.page} workspace={preview.session.workspace} loading={previewLoading} onMore={() => void showPreview(preview.session.path, true)} />
              <p className="text-xs text-amber-600">{preview.warnings.join(' · ')}</p>
              {selected.length === 1 && selected[0] === preview.session.path ? <>
                <label className="flex items-center gap-2 text-sm">{t('codexHistoryBranchPoint')}
                  <select className={`${control} flex-1`} value={cutoff} onChange={(event) => setCutoff(event.target.value)}>
                    <option value="">{t('codexHistoryLatest')}</option>
                    {preview.cutoffs.map((entry) => <option key={entry.turnId} value={entry.turnId}>{entry.label || entry.turnId}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">{t('codexHistoryWorkspace')}
                  <input className={`${control} flex-1`} value={workspace} onChange={(event) => editWorkspace(event.target.value)} />
                  <button type="button" className={control} onClick={() => void window.kunGui.pickWorkspaceDirectory(workspace).then((picked) => { if (!picked.canceled && picked.path) editWorkspace(picked.path) })}>{t('codexHistoryChoose')}</button>
                </label>
              </> : null}
            </> : <p className="p-4 text-sm text-ds-muted">{previewLoading ? t('loading') : t('codexHistoryPreviewHint')}</p>}
          </div>
        </div>
        {results.length ? <div className="max-h-28 overflow-auto py-2 text-sm" role="status">{results.map((result) => <div key={result.path} className="flex gap-2">
          <span className="truncate">{result.path.split(/[\\/]/).at(-1)}</span>
          {result.id ? <button type="button" className="underline" onClick={() => onCreated(result.id!)}>{t('codexHistoryOpen')}</button> : <span className="text-red-500">{result.error}</span>}
        </div>)}</div> : null}
        <footer className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-ds-muted">{t('codexHistorySelected', { count: selected.length })}</span>
          <button type="button" disabled={!selected.length || creating || previewLoading} onClick={() => void createBranches()}
            className="rounded-lg bg-control px-4 py-2 text-sm text-control-foreground disabled:opacity-50">{creating ? t('loading') : t('codexHistoryCreate')}</button>
        </footer>
      </>}
    </div>
  </div>, document.body)
}
