import { useEffect, useRef, useState } from 'react'
import { MEMORY_RELATION_MAX_RECORD_CHARS, type MemoryRelationResult } from '@shared/memory-relations'
import type { CoreMemoryRecordJson } from '../../agent/kun-contract'
import { analyzeRuntimeMemoryRelations, requestMemoryRelations } from '../../agent/kun-runtime-memory-relations'
import { settingsButtonClass } from '../settings-button'
import { MemoryEvidence } from './MemoryEvidence'

type Relation = MemoryRelationResult['relations'][number]

export function MemoryRelationsPanel({ memory, t }: {
  memory: CoreMemoryRecordJson
  t: (key: string) => string
}) {
  const [opened, setOpened] = useState(false)
  const [relations, setRelations] = useState<Relation[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const access = { workspace: memory.workspace, project: memory.project }
  const expired = [memory.expiresAt, memory.validTo].some((value) => value && Date.parse(value) <= Date.now())
  const privateMemory = 'agentContext' in memory && Boolean(memory.agentContext)
  const eligible = memory.authority !== 'directive' && !privateMemory && !memory.disabledAt &&
    !memory.deletedAt && !memory.supersededAt && !expired &&
    !(memory.validFrom && Date.parse(memory.validFrom) > Date.now()) && memory.content.length <= MEMORY_RELATION_MAX_RECORD_CHARS

  useEffect(() => () => controller.current?.abort(), [])

  const run = async (operation: 'list' | 'analyze' | 'accepted' | 'rejected', relation?: Relation) => {
    if (controller.current) return
    const pending = new AbortController()
    controller.current = pending
    setBusy(true)
    setError(false)
    try {
      if (operation === 'analyze') {
        await analyzeRuntimeMemoryRelations({ memoryId: memory.id, expectedRevision: memory.revision ?? 1, access }, pending.signal)
      } else if (relation) {
        await requestMemoryRelations({ action: 'review', id: relation.suggestion.id, decision: operation as 'accepted' | 'rejected', access }, pending.signal)
      }
      const result = await requestMemoryRelations({ action: 'list', memoryId: memory.id, access }, pending.signal)
      if (!pending.signal.aborted) {
        setRelations(result.relations)
        setLoaded(true)
      }
    } catch {
      if (!pending.signal.aborted) {
        setError(true)
        // Hide cached evidence after a failed revalidation (for example, erasure).
        setRelations([])
      }
    } finally {
      if (controller.current === pending) controller.current = null
      if (!pending.signal.aborted) setBusy(false)
    }
  }

  return <section className="border-t border-ds-border-muted pt-3">
    <button type="button" aria-expanded={opened} className={settingsButtonClass()}
      onClick={() => {
        setOpened(!opened)
        if (!opened && !loaded) void run('list')
      }}>
      {t('memoryRelationsTitle')}
    </button>
    {opened ? <div className="mt-3 space-y-3" aria-busy={busy}>
      <p className="max-w-[72ch] text-[12px] leading-5 text-ds-muted">{t('memoryRelationsDescription')}</p>
      <p className="max-w-[72ch] text-[12px] leading-5 text-ds-muted">{t('memoryRelationsPrivacy')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !eligible} className={settingsButtonClass({ variant: 'primary' })}
          onClick={() => void run('analyze')}>{t('memoryRelationsAnalyze')}</button>
        <button type="button" disabled={busy} className={settingsButtonClass()}
          onClick={() => void run('list')}>{t('memoryRelationsRefresh')}</button>
      </div>
      {!eligible ? <p className="text-[12px] text-ds-muted">{t('memoryRelationsIneligible')}</p> : null}
      {busy ? <p role="status" className="text-[12px] text-ds-muted">{t('memoryRelationsBusy')}</p> : null}
      {error ? <p role="alert" className="text-[12px] text-ds-danger">{t('memoryRelationsError')}</p> : null}
      {!busy && loaded && !error && relations.length === 0
        ? <p role="status" className="text-[12px] text-ds-muted">{t('memoryRelationsEmpty')}</p> : null}
      <ul className="divide-y divide-ds-border-muted">
        {relations.map((relation) => <li key={relation.suggestion.id} className="space-y-3 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-[14px] font-semibold text-ds-ink">{t(`memoryRelations_${relation.suggestion.proposal.kind}`)}</h4>
            <span className="text-[12px] text-ds-muted">{t(`memoryRelations_${relation.stale ? 'stale' : relation.suggestion.status}`)}</span>
          </div>
          {relation.stale ? <p className="text-[12px] text-ds-muted">{t('memoryRelationsStaleHint')}</p> : (
            <div className="grid gap-4 sm:grid-cols-2">
              <RelationEndpoint record={relation.source} label={t('memoryRelationsSource')}
                scopeLabel={t(`memoryScope_${relation.source.scope}`)}
                span={relation.suggestion.proposal.sourceEvidence} />
              <RelationEndpoint record={relation.target} label={t('memoryRelationsTarget')}
                scopeLabel={t(`memoryScope_${relation.target.scope}`)}
                span={relation.suggestion.proposal.targetEvidence} />
            </div>
          )}
          {!relation.stale && relation.suggestion.status === 'pending' ? <div className="flex gap-2">
            <button type="button" disabled={busy} className={settingsButtonClass()}
              onClick={() => void run('accepted', relation)}>{t('memoryRelationsAccept')}</button>
            <button type="button" disabled={busy} className={settingsButtonClass()}
              onClick={() => void run('rejected', relation)}>{t('memoryRelationsReject')}</button>
          </div> : null}
        </li>)}
      </ul>
    </div> : null}
  </section>
}

function RelationEndpoint({ record, label, scopeLabel, span }: {
  record: Relation['source']
  label: string
  scopeLabel: string
  span: { start: number; end: number }
}) {
  return <div className="min-w-0 space-y-2 break-words">
    <p className="text-[12px] font-medium text-ds-muted">{label} · {scopeLabel} · r{record.revision}</p>
    <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-ds-ink">
      {record.content.slice(0, span.start)}<mark className="bg-accent-tint/15 text-ds-ink">{record.content.slice(span.start, span.end)}</mark>{record.content.slice(span.end)}
    </p>
    <MemoryEvidence sources={record.sources} consolidation={record.consolidation} />
  </div>
}
