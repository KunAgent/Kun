import type { ReactElement } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function GitHubSkillImportPanel({
  url,
  busy,
  summary,
  onUrlChange,
  onImport
}: {
  url: string
  busy: boolean
  summary: { count: number; names: string[] } | null
  onUrlChange: (value: string) => void
  onImport: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <section className="mt-6 rounded-2xl border border-ds-border bg-ds-card/95 p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginGithubImportPlaceholder')}
          spellCheck={false}
        />
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-ds-userbubble px-4 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Download className="h-4 w-4" strokeWidth={2} />}
          {t('pluginGithubImportAction')}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-ds-faint">
        {t('pluginGithubImportHint')}
      </p>
      {summary ? (
        <p className="mt-3 text-[12px] text-ds-muted">
          {t('pluginGithubImportResult', {
            count: summary.count,
            names: summary.names.join(', ')
          })}
        </p>
      ) : null}
    </section>
  )
}

export function runtimeOverlayErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return /runtimeRequest|kunGui|Cannot read properties/i.test(message) ? fallback : message
}
