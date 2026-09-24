import type { StagedProviderImportLink } from '@shared/kun-gui-api'
import { Loader2, ShieldAlert, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'

function hostLabel(staged: StagedProviderImportLink): string {
  const url =
    staged.draft.chatBaseUrl ?? staged.draft.anthropicBaseUrl ?? staged.draft.responsesBaseUrl
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Confirmation sheet for `kun://import` links and pasted links (plan §6.12).
 * The warning names the destination host explicitly; the staged key stays in
 * the main process and only resolves through the token on confirm.
 */
export function ProviderImportLinkConfirmDialog({
  staged,
  t,
  onCancel,
  onConfirm
}: {
  staged: StagedProviderImportLink
  t: (key: string, options?: Record<string, unknown>) => string
  onCancel: () => void
  onConfirm: (providerId: string) => void
}): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const host = hostLabel(staged)
  const endpoints = [
    staged.draft.chatBaseUrl,
    staged.draft.anthropicBaseUrl,
    staged.draft.responsesBaseUrl
  ].filter((value): value is string => Boolean(value))

  const commit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.kunGui.commitProviderImportLink({ token: staged.token })
      if (!result.ok) {
        setError(result.message)
        return
      }
      onConfirm(result.providerId)
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[60] grid place-items-center overscroll-none bg-slate-950/40 p-4 backdrop-blur-md dark:bg-black/65"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="provider-import-link-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-panel">
        <header className="flex items-start justify-between gap-3 border-b border-ds-border px-5 py-4">
          <div className="flex items-start gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-amber-300/60 bg-amber-50 text-amber-600 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300">
              <ShieldAlert className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <div>
              <h2 id="provider-import-link-title" className="text-[15px] font-semibold text-ds-ink">
                {t('modelProviderLinkImportTitle')}
              </h2>
              <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                {t('modelProviderLinkImportDesc')}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('modelProviderLinkImportCancel')}
            onClick={onCancel}
            className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </header>
        <div className="grid gap-3 px-5 py-4">
          <div className="grid gap-1.5 rounded-xl border border-ds-border-muted bg-ds-main/30 px-3.5 py-3 text-[12.5px]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ds-faint">{t('modelProviderLinkImportName')}</span>
              <span className="truncate font-medium text-ds-ink">
                {staged.draft.name || staged.draft.presetId || '—'}
              </span>
            </div>
            {endpoints.map((url) => (
              <div key={url} className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 text-ds-faint">{t('modelProviderLinkImportEndpoint')}</span>
                <span className="min-w-0 truncate font-mono text-[11.5px] text-ds-ink">{url}</span>
              </div>
            ))}
            {staged.draft.models.length > 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ds-faint">{t('modelProviderLinkImportModels')}</span>
                <span className="text-ds-ink">
                  {t('modelProviderLinkImportModelCount', { count: staged.draft.models.length })}
                </span>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ds-faint">{t('modelProviderLinkImportKey')}</span>
              <span className="font-mono text-[11.5px] text-ds-ink">
                {staged.draft.hasKey
                  ? staged.draft.keyHint ?? '••••'
                  : t('modelProviderLinkImportNoKey')}
              </span>
            </div>
          </div>
          {host ? (
            <p className="rounded-lg border border-amber-300/60 bg-amber-50/80 px-3 py-2 text-[12px] leading-5 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
              {t('modelProviderLinkImportWarning', { host })}
            </p>
          ) : null}
          {staged.warnings.map((warning) => (
            <p key={warning} className="text-[12px] leading-5 text-ds-faint">{warning}</p>
          ))}
          {error ? (
            <p role="alert" className="text-[12px] leading-5 text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-ds-border px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('modelProviderLinkImportCancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void commit()}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
            {t('modelProviderLinkImportConfirm')}
          </button>
        </footer>
      </section>
    </div>
  )
}
