import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { paperCardUrl } from '../../../agent/paper-list-adapter'
import type { ResearchPoolEntry } from '../../../paper/paper-research-pool'

function openExternal(url: string | undefined): void {
  if (url) void window.kunGui?.openExternal?.(url)
}

/** Expanded body of a pool row: why it was recommended, abstract, sources, links. */
export function PaperResearchPoolDetail({
  entry,
  onFocusBlock
}: {
  entry: ResearchPoolEntry
  onFocusBlock: (blockId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [fullAbstract, setFullAbstract] = useState(false)
  const url = paperCardUrl(entry)
  const authors = entry.authors.length > 4 ? `${entry.authors.slice(0, 4).join(', ')} +${entry.authors.length - 4}` : entry.authors.join(', ')
  const link = 'inline-flex h-6 items-center gap-1 rounded-md border border-ds-border-muted bg-ds-main px-2 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink'
  return (
    <div className="space-y-2 text-[12px] leading-[18px]">
      {authors ? <p className="text-ds-faint">{authors}</p> : null}
      {entry.recommended?.reason ? (
        <p className="rounded-lg bg-[var(--ds-accent-soft)] px-2.5 py-1.5 text-ds-ink">
          <span className="font-semibold">{t('paperPoolReason')}</span>
          {' · '}
          {entry.recommended.reason}
        </p>
      ) : null}
      {entry.abstract ? (
        <p className="text-ds-muted">
          <span className={fullAbstract ? '' : 'line-clamp-3'}>{entry.abstract}</span>
          <button
            type="button"
            onClick={() => setFullAbstract((value) => !value)}
            className="mt-0.5 text-[11.5px] font-medium text-[var(--ds-accent)] hover:underline"
          >
            {fullAbstract ? t('writePaperDiscoverShowLess') : t('writePaperDiscoverShowMore')}
          </button>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {entry.sources.map((source) => (
          <span key={source} className="rounded-full bg-ds-subtle px-2 py-px text-[11px] text-ds-muted">
            {t(`writePaperSearchSource_${source}`)}
          </span>
        ))}
        {typeof entry.citations === 'number' ? (
          <span className="text-[11px] tabular-nums text-ds-faint">{t('paperPoolCitations', { count: entry.citations })}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {entry.pdfUrl ? <button type="button" onClick={() => openExternal(entry.pdfUrl)} className={link}>PDF</button> : null}
        {url ? <button type="button" onClick={() => openExternal(url)} className={link}>{t('paperReportOpenPage')}</button> : null}
        {entry.firstBlockId ? (
          <button type="button" onClick={() => onFocusBlock(entry.firstBlockId)} className={link}>{t('paperPoolLocate')}</button>
        ) : null}
      </div>
    </div>
  )
}
