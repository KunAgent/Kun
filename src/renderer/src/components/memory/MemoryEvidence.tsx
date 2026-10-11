import { useTranslation } from 'react-i18next'
import type { CoreMemoryConsolidationJson, CoreMemorySourceEvidenceJson } from '../../agent/kun-contract'

/** Evidence is displayed as data. Locators, snippets and imported instructions are never executed. */
export function MemoryEvidence({ sources = [], consolidation, onSource }: {
  sources?: CoreMemorySourceEvidenceJson[]
  consolidation?: CoreMemoryConsolidationJson
  onSource?: (roomId: string, messageId?: string) => void
}) {
  const { t } = useTranslation('common')
  return <details className="memory-evidence"><summary>{t('agentsMemorySources')} ({sources.length})</summary>
    {consolidation ? <div className="memory-evidence-summary">
      <strong>{t('memoryEvidence_' + consolidation.evidenceStatus)}</strong>
      <p>{consolidation.reason}</p>
      <small>{t('memoryConsolidatedFrom', { count: consolidation.sourceMemoryIds.length })}</small>
      <details><summary>{t('memoryLineage')}</summary>
        {consolidation.sourceMemoryIds.map((id) => <div key={id}>{id}</div>)}
        {consolidation.sourceSessionIds.map((id) => <div key={id}>{t('memorySession')}: {id}</div>)}
      </details>
    </div> : null}
    {sources.map((source) => {
      const match = source.locator?.match(/^room:([A-Za-z0-9_-]+)\/message:([A-Za-z0-9_-]+)$/)
      return <div className="memory-evidence-source" key={source.id}>
        <small>{t('memoryTrust_' + source.trust)} · {source.kind}{source.outcome ? ' · ' + t('memoryOutcome_' + source.outcome) : ''}</small>
        {source.excerpt ? <p className="whitespace-pre-wrap">{source.excerpt}</p> : null}
        {match && onSource ? <button type="button" onClick={() => onSource(match[1], match[2])}>{t('agentsOpenSource')}</button> : <p>{source.locator}</p>}
        {source.receiptId ? <p>{t('memoryReceipt')}: {source.receiptId}</p> : null}
        {source.repositorySha ? <p>{t('memoryRepositoryRevision')}: {source.repositorySha}</p> : null}
        {source.artifactIds?.length ? <p>{t('memoryArtifacts')}: {source.artifactIds.join(', ')}</p> : null}
      </div>
    })}
    {!sources.length ? <p>{t('memoryEvidenceUnavailable')}</p> : null}
  </details>
}
