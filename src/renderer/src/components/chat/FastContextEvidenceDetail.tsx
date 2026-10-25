import type { ReactElement } from 'react'
import type { TFunction } from 'i18next'
import type {
  CardStatus,
  FastContextEvidence,
  FastContextEvidencePack
} from './subagent-call-card-support'

export function FastContextEvidencePill({
  pack,
  status,
  t
}: {
  pack: FastContextEvidencePack | undefined
  status: CardStatus
  t: TFunction<'common'>
}): ReactElement | null {
  if (!pack) return null
  const state = status === 'queued' || status === 'running'
    ? t('fastContextRetrievalActive', { defaultValue: 'Retrieving' })
    : t('fastContextEvidenceLabel', { defaultValue: 'Evidence' })
  const count = t('fastContextEvidenceCount', {
    count: pack.evidenceCount,
    defaultValue: `${pack.evidenceCount} evidence`
  })
  return (
    <span
      className="whitespace-nowrap rounded-full bg-emerald-500/12 px-2 py-[2px] text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300"
      data-testid="fast-context-evidence-summary"
      title={evidenceTitle(pack)}
    >
      {state} · {count}
    </span>
  )
}

export function FastContextEvidenceDetail({
  pack,
  t
}: {
  pack: FastContextEvidencePack | undefined
  t: TFunction<'common'>
}): ReactElement | null {
  if (!pack) return null
  return (
    <div className="mt-3 space-y-3" data-testid="fast-context-evidence-detail">
      <p className="text-[12px] font-semibold text-ds-ink">
        {t('fastContextEvidenceLabel', { defaultValue: 'Evidence' })} · {t('fastContextEvidenceCount', {
          count: pack.evidenceCount,
          defaultValue: `${pack.evidenceCount} evidence`
        })}
      </p>
      {pack.tasks.map((task) => (
        <section key={task.index} className="rounded-[10px] border border-ds-border-muted bg-ds-card-muted/30 px-3 py-2.5">
          <p className="text-[12px] font-semibold text-ds-ink" title={task.query}>{task.title}</p>
          {task.conclusion ? <p className="mt-1 text-[12px] leading-5 text-ds-muted">{task.conclusion}</p> : null}
          {task.evidence.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-[11.5px] leading-5 text-ds-muted">
              {task.evidence.map((item, index) => <EvidenceRow key={`${item.path}:${index}`} item={item} />)}
            </ul>
          ) : null}
          {task.uncertainties.length > 0 ? <Uncertainties values={task.uncertainties} t={t} /> : null}
        </section>
      ))}
      {pack.uncertainties.length > 0 ? <Uncertainties values={pack.uncertainties} t={t} /> : null}
    </div>
  )
}

function EvidenceRow({ item }: { item: FastContextEvidence }): ReactElement {
  const ranges = item.ranges.map(([start, end]) => start === end ? `${start}` : `${start}-${end}`).join(', ')
  return (
    <li className="rounded-md bg-ds-card/60 px-2 py-1.5">
      <code className="break-all font-mono text-[10.5px] text-accent">{item.path}:{ranges}</code>
      {item.reason ? <span className="ml-1.5">{item.reason}</span> : null}
      {item.excerpt ? <p className="mt-0.5 whitespace-pre-wrap break-words text-ds-faint">{item.excerpt}</p> : null}
    </li>
  )
}

function Uncertainties({ values, t }: { values: string[]; t: TFunction<'common'> }): ReactElement {
  return (
    <p className="mt-2 text-[11.5px] leading-5 text-amber-700 dark:text-amber-300">
      {t('fastContextUncertaintiesLabel', { defaultValue: 'Open questions' })}: {values.join(' · ')}
    </p>
  )
}

function evidenceTitle(pack: FastContextEvidencePack): string {
  return pack.tasks.map((task) => `${task.title}: ${task.evidence.length}`).join('\n')
}
