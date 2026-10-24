import { useTranslation } from 'react-i18next'
import type { MemoryRelationAnnotation } from '@shared/memory-working-context'

/** IDs/revisions are the historical annotation, not a fresh claim about current facts. */
export function MemoryRelationAnnotations({ annotations, historical = false }: {
  annotations: readonly MemoryRelationAnnotation[]
  historical?: boolean
}) {
  const { t } = useTranslation('settings')
  if (!annotations.length) return null
  return <section className="space-y-2" aria-label={t('memoryContextRelations')}>
    <h4 className="text-[13px] font-semibold text-ds-ink">{t('memoryContextRelations')}</h4>
    <p className="text-[12px] leading-5 text-ds-muted">{t(historical ? 'memoryContextHistorical' : 'memoryContextBoundary')}</p>
    <ul className="divide-y divide-ds-border-muted">
      {annotations.map((entry) => <li key={entry.id} className="space-y-1 py-2 text-[12px]">
        <p className="font-medium text-ds-ink">{t(`memoryRelations_${entry.kind}`)}</p>
        <p className="break-all text-ds-muted">
          {entry.source.id} (r{entry.source.revision}) → {entry.target.id} (r{entry.target.revision})
        </p>
        <p className="break-all text-ds-muted">{t('memoryContextReviewed')}: {entry.reviewedAt}</p>
        <details><summary className="cursor-pointer text-ds-muted">{t('memoryContextRelationId')}</summary>
          <code className="break-all">{entry.id}</code>
        </details>
        {entry.kind === 'contradicts'
          ? <p className="text-ds-muted">{t('memoryContextConflict')}</p> : null}
      </li>)}
    </ul>
  </section>
}
