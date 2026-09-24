import type { ReactElement } from 'react'
import { SkipForward } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperTitleSearchCandidate } from '@shared/paper/paper-library-types'

/**
 * Candidate picker for a `picking` queue row (PM4): S2 + arXiv results with
 * title, authors·year·venue, source badge and citation count. The user picks
 * one to import or skips the line.
 */
export function PaperSearchCandidates({
  candidates,
  onPick
}: {
  candidates: PaperTitleSearchCandidate[]
  onPick: (choice: PaperTitleSearchCandidate | null) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="mt-1.5 space-y-1 rounded-lg border border-ds-border-muted bg-ds-subtle/40 p-1.5">
      <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-ds-faint">
        {t('writePaperImportCandidates')}
      </p>
      {candidates.map((candidate, index) => (
        <button
          key={`${candidate.title}-${index}`}
          type="button"
          onClick={() => onPick(candidate)}
          className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-ds-hover"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-ds-ink">
              {candidate.title}
            </span>
            <span className="block truncate text-[11.5px] text-ds-muted">
              {[candidate.authors.slice(0, 3).join(', '), candidate.year, candidate.venue]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-[10.5px] text-ds-faint">
            {typeof candidate.citationCount === 'number' ? (
              <span>{t('writePaperImportCitations', { count: candidate.citationCount })}</span>
            ) : null}
            <span className="rounded border border-ds-border px-1 py-px uppercase">
              {candidate.source}
            </span>
          </span>
        </button>
      ))}
      <div className="flex justify-end gap-1 px-1 pb-0.5">
        <button
          type="button"
          onClick={() => onPick(null)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <SkipForward className="h-3 w-3" strokeWidth={2} />
          {t('writePaperImportSkip')}
        </button>
      </div>
    </div>
  )
}
