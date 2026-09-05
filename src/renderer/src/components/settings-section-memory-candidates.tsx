import { Check, Sparkles, X } from 'lucide-react'
import type { ReactElement } from 'react'
import { useState } from 'react'
import type { CorePendingMemoryCandidateJson } from '../agent/kun-contract'

export function MemoryCandidatesPanel(props: {
  candidates: CorePendingMemoryCandidateJson[]
  decide: (candidateId: string, decision: 'allow' | 'deny') => Promise<boolean>
  t: (key: string) => string
}): ReactElement {
  const [busyId, setBusyId] = useState<string | null>(null)

  const decide = async (
    candidate: CorePendingMemoryCandidateJson,
    decision: 'allow' | 'deny'
  ): Promise<void> => {
    setBusyId(candidate.id)
    try {
      await props.decide(candidate.id, decision)
    } finally {
      setBusyId(null)
    }
  }

  if (props.candidates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ds-border-muted bg-ds-main/40 px-3 py-8 text-center">
        <Sparkles className="h-6 w-6 text-ds-faint" strokeWidth={1.5} />
        <div className="text-[13px] text-ds-faint">{props.t('memoryCandidatesEmpty')}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {props.candidates.map((entry) => {
        const action = entry.proposedAction.action
        const targetId = action === 'create' ? null : entry.proposedAction.memoryId
        return (
          <article
            key={entry.id}
            className="rounded-xl border border-ds-border-muted bg-ds-main/50 p-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ds-faint">
              <span>{entry.candidate.type}</span>
              <span>·</span>
              <span>{props.t('memoryCandidateImportance')} {entry.candidate.importance.toFixed(2)}</span>
              <span>·</span>
              <span>{props.t(`memoryCandidateAction_${action}`)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-ds-ink">
              {entry.candidate.content}
            </p>
            <dl className="mt-3 grid gap-2 text-[11px] text-ds-muted sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-ds-faint">{props.t('memoryCandidateTarget')}</dt>
                <dd className="break-all">{entry.target.workspace}</dd>
              </div>
              {targetId ? (
                <div>
                  <dt className="font-semibold text-ds-faint">{props.t('memoryCandidateExisting')}</dt>
                  <dd className="break-all font-mono">{targetId}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-3 space-y-1">
              <div className="text-[11px] font-semibold text-ds-faint">
                {props.t('memoryCandidateSources')}
              </div>
              {entry.candidate.sources.map((source) => (
                <div
                  key={source.id}
                  className="rounded-lg bg-ds-hover/70 px-2.5 py-2 text-[11px] text-ds-muted"
                >
                  <span className="font-semibold">{source.kind} / {source.trust}</span>
                  {source.excerpt ? <span className="ml-2">{source.excerpt}</span> : null}
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void decide(entry, 'deny')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-3 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                {props.t('memoryCandidateDeny')}
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void decide(entry, 'allow')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ds-ink px-3 py-1.5 text-[12px] font-semibold text-ds-main transition hover:opacity-85 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {props.t('memoryCandidateAllow')}
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
