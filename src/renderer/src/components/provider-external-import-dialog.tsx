import type { ExternalProviderDraft } from '@shared/kun-gui-api'
import { CheckCircle2, Loader2, X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'

const SOURCE_LABEL_KEYS: Record<ExternalProviderDraft['source'], string> = {
  'cc-switch': 'modelProviderImportSourceCcSwitch',
  'claude-code': 'modelProviderImportSourceClaudeCode',
  'codex': 'modelProviderImportSourceCodex',
  'opencode': 'modelProviderImportSourceOpencode'
}

function statusLabel(
  draft: ExternalProviderDraft,
  t: (key: string, options?: Record<string, unknown>) => string
): { tone: 'ok' | 'warn' | 'skip'; text: string } {
  if (draft.skipped) return { tone: 'skip', text: t('modelProviderImportStatusSkipped') }
  switch (draft.status) {
    case 'exists':
      return { tone: 'skip', text: t('modelProviderImportStatusExists') }
    case 'conflict-renamed':
      return { tone: 'warn', text: t('modelProviderImportStatusRenamed', { id: draft.suggestedId }) }
    case 'mergeable':
      return {
        tone: 'warn',
        text: t('modelProviderImportStatusMergeable', { target: draft.mergeTargetId ?? '' })
      }
    default:
      return { tone: 'ok', text: t('modelProviderImportStatusNew') }
  }
}

/**
 * External tool import dialog (plan §6.12). Scanning is read-only and never
 * returns credentials — each row shows a masked key hint only. Committing one
 * entry asks the main process to re-read the source file itself.
 */
export function ProviderExternalImportDialog({
  t,
  onClose,
  onImported
}: {
  t: (key: string, options?: Record<string, unknown>) => string
  onClose: () => void
  onImported: (providerIds: string[]) => void
}): ReactElement {
  const [scanState, setScanState] = useState<
    { status: 'busy' } | { status: 'ready'; drafts: ExternalProviderDraft[] } | { status: 'error'; message: string }
  >({ status: 'busy' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.kunGui.scanExternalProviders()
      .then((drafts) => {
        if (cancelled) return
        setScanState({ status: 'ready', drafts })
        setSelected(new Set(
          drafts
            .filter((draft) => draft.status === 'new' || draft.status === 'conflict-renamed')
            .map((draft) => `${draft.source}:${draft.ref}`)
        ))
      })
      .catch((error) => {
        if (!cancelled) {
          setScanState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const keyOf = (draft: ExternalProviderDraft): string => `${draft.source}:${draft.ref}`
  const drafts = scanState.status === 'ready' ? scanState.drafts : []

  const commit = async (): Promise<void> => {
    setImporting(true)
    setImportError('')
    const importedIds: string[] = []
    try {
      for (const draft of drafts) {
        if (!selected.has(keyOf(draft))) continue
        const result = await window.kunGui.importExternalProvider({
          source: draft.source,
          ref: draft.ref,
          name: draft.name
        })
        if (!result.ok) {
          setImportError(`${draft.name}: ${result.message}`)
          continue
        }
        importedIds.push(result.providerId)
      }
    } finally {
      setImporting(false)
    }
    if (importedIds.length > 0) onImported(importedIds)
    if (importedIds.length === selected.size || importedIds.length > 0) onClose()
  }

  return (
    <div
      className="ds-no-drag fixed inset-0 z-50 grid place-items-center overscroll-none bg-slate-950/40 p-4 backdrop-blur-md dark:bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-import-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="flex max-h-[min(640px,calc(100dvh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-panel"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ds-border px-5 py-4">
          <div>
            <h2 id="provider-import-dialog-title" className="text-[15px] font-semibold text-ds-ink">
              {t('modelProviderImportTitle')}
            </h2>
            <p className="mt-1 text-[12.5px] text-ds-faint">{t('modelProviderImportDesc')}</p>
          </div>
          <button
            type="button"
            aria-label={t('modelProviderImportCancel')}
            onClick={onClose}
            className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-5 py-4">
          {scanState.status === 'busy' ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-ds-faint">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
              {t('modelProviderImportScanning')}
            </div>
          ) : scanState.status === 'error' ? (
            <p role="alert" className="rounded-xl border border-dashed border-ds-border-muted px-4 py-6 text-center text-[12.5px] text-ds-faint">
              {scanState.message}
            </p>
          ) : drafts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ds-border-muted px-4 py-6 text-center text-[12.5px] text-ds-faint">
              {t('modelProviderImportEmpty')}
            </p>
          ) : (
            <div className="grid gap-1.5">
              {drafts.map((draft) => {
                const key = keyOf(draft)
                const status = statusLabel(draft, t)
                const checkable = !draft.skipped && draft.status !== 'exists'
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition ${
                      checkable
                        ? 'cursor-pointer border-ds-border bg-ds-card hover:bg-ds-hover'
                        : 'border-ds-border-muted bg-ds-main/30 opacity-70'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--ds-accent,#4f7cff)]"
                      disabled={!checkable}
                      checked={selected.has(key)}
                      onChange={(event) => {
                        const next = new Set(selected)
                        if (event.target.checked) next.add(key)
                        else next.delete(key)
                        setSelected(next)
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-ds-ink">
                          {draft.name}
                        </span>
                        <span className="shrink-0 text-[10.5px] font-medium text-ds-faint">
                          {t(SOURCE_LABEL_KEYS[draft.source])}
                        </span>
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-2 truncate font-mono text-[11px] text-ds-faint">
                        <span className="truncate">{draft.baseUrl || '—'}</span>
                        {draft.hasKey ? <span className="shrink-0">{draft.keyHint}</span> : null}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-medium ${
                        status.tone === 'ok'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : status.tone === 'warn'
                            ? 'text-amber-600 dark:text-amber-300'
                            : 'text-ds-faint'
                      }`}
                    >
                      {status.text}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ds-border px-5 py-3.5">
          {importError ? (
            <span role="alert" className="min-w-0 truncate text-[12px] text-red-600 dark:text-red-300">
              {importError}
            </span>
          ) : (
            <span className="text-[12px] text-ds-faint">
              {t('modelProviderImportKeyNote')}
            </span>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('modelProviderImportCancel')}
            </button>
            <button
              type="button"
              disabled={importing || selected.size === 0}
              onClick={() => void commit()}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {importing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                : <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />}
              {t('modelProviderImportCommit', { count: selected.size })}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
