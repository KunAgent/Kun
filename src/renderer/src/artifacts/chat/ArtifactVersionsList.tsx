import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { OfficeVersionEntry } from '@shared/office-version'
import { formatArtifactTime } from '../artifact-view-model'

/** The current file, then every kept version, newest first, each viewable and restorable. */
export function ArtifactVersionsList({ entries, comparingId, restoring, onView, onRestore }: {
  entries: readonly OfficeVersionEntry[]
  comparingId: string | null
  restoring: boolean
  onView: (id: string) => void
  onRestore: (id: string) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  return (
    <ol className="m-0 flex list-none flex-col gap-0.5 p-0" data-artifact-versions>
      <li className={`flex items-start gap-2.5 rounded-xl p-2.5 ${comparingId ? '' : 'bg-ds-hover'}`}>
        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
        <span className="text-[13px] font-semibold text-ds-ink">{t('artifactChatVersionsCurrent')}</span>
      </li>
      {entries.map((entry) => (
        <li key={entry.id} className={`flex items-start gap-2.5 rounded-xl p-2.5 ${comparingId === entry.id ? 'bg-ds-hover' : ''}`}>
          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[13px] font-semibold text-ds-ink" title={entry.label}>
              {entry.reason === 'restore' ? t('artifactChatVersionRestoreBackup') : t('artifactChatVersionBefore', { label: entry.label })}
            </span>
            <span className="text-[12px] text-ds-muted">{formatArtifactTime(Date.parse(entry.createdAt), i18n.language)}</span>
          </span>
          <span className="flex shrink-0 gap-1">
            <button type="button" onClick={() => onView(entry.id)}
              className="h-7 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] text-ds-ink hover:bg-ds-hover">
              {t('artifactChatVersionView')}
            </button>
            <button type="button" onClick={() => onRestore(entry.id)} disabled={restoring}
              className="h-7 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] text-ds-ink hover:bg-ds-hover disabled:opacity-50">
              {t('artifactChatVersionRestore')}
            </button>
          </span>
        </li>
      ))}
      {entries.length === 0 ? (
        <li className="px-2.5 py-2 text-[12.5px] leading-relaxed text-ds-muted">{t('artifactChatVersionsEmpty')}</li>
      ) : null}
    </ol>
  )
}
