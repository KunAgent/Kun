import { useEffect, useState, type ReactElement } from 'react'
import { ExternalLink, FileText, Loader2, Quote, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperSearchHit } from '@shared/paper/paper-search'

type DetailPaper = {
  title: string
  authors: string[]
  abstract?: string
  year?: number
  venue?: string
  doi?: string
  arxivId?: string
  url?: string
  pdfUrl?: string
  citations?: number
  tldr?: string
  fieldsOfStudy?: string[]
}

/**
 * Search-hit detail side panel (plan P5): everything the merged hit already
 * carries, upgraded on open with the S2/OpenAlex detail lookup (tldr, fields
 * of study, OA link, per-year citation trend).
 */
export function PaperSearchDetailPane({
  hit,
  onClose
}: {
  hit: PaperSearchHit
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [detail, setDetail] = useState<DetailPaper | null>(null)
  const [trend, setTrend] = useState<Array<{ year: number; citations: number }>>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const lookupId = hit.doi ?? hit.arxivId ?? hit.coolId ?? hit.url ?? hit.title

  useEffect(() => {
    setDetail(null)
    setTrend([])
    setFailed(false)
    if (typeof window.kunGui?.paperDetail !== 'function') return
    setLoading(true)
    void window.kunGui
      .paperDetail({ id: lookupId })
      .then((result) => {
        if (result.ok) {
          setDetail(result.paper)
          setTrend(result.countsByYear ?? [])
        } else {
          setFailed(true)
        }
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [lookupId])

  const paper: DetailPaper = {
    title: detail?.title ?? hit.title,
    authors: detail?.authors?.length ? detail.authors : hit.authors,
    abstract: detail?.abstract ?? hit.abstract,
    year: detail?.year ?? hit.year,
    venue: detail?.venue ?? hit.venue,
    doi: detail?.doi ?? hit.doi,
    arxivId: detail?.arxivId ?? hit.arxivId,
    url: detail?.url ?? hit.url,
    pdfUrl: detail?.pdfUrl ?? hit.pdfUrl,
    citations: detail?.citations ?? hit.citations,
    tldr: detail?.tldr,
    fieldsOfStudy: detail?.fieldsOfStudy
  }

  const maxCount = Math.max(0, ...trend.map((row) => row.citations))

  return (
    <aside
      aria-label={t('writePaperDetailTitle')}
      className="flex w-[300px] shrink-0 flex-col rounded-xl border border-ds-border-muted bg-ds-card"
    >
      <div className="flex items-center gap-2 border-b border-ds-border-muted px-3 py-2">
        <span className="flex-1 text-[12px] font-medium text-ds-ink">{t('writePaperDetailTitle')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('writePaperDetailClose')}
          className="rounded p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <p className="text-[13px] font-semibold leading-5 text-ds-ink">{paper.title}</p>
        {paper.authors.length ? (
          <p className="text-[11.5px] leading-5 text-ds-muted">{paper.authors.join(', ')}</p>
        ) : null}
        <p className="text-[11px] text-ds-faint">
          {[paper.year, paper.venue].filter(Boolean).join(' · ')}
        </p>
        {paper.tldr ? (
          <p className="rounded-md bg-accent-tint/[0.08] px-2 py-1.5 text-[11.5px] italic leading-[1.45] text-ds-ink">
            {paper.tldr}
          </p>
        ) : null}
        {paper.abstract ? (
          <p className="text-[11.5px] leading-[1.5] text-ds-muted">{paper.abstract}</p>
        ) : null}
        {paper.fieldsOfStudy?.length ? (
          <div className="flex flex-wrap gap-1">
            {paper.fieldsOfStudy.map((field) => (
              <span key={field} className="rounded bg-ds-subtle px-1.5 py-px text-[10px] text-ds-muted">
                {field}
              </span>
            ))}
          </div>
        ) : null}
        {trend.length ? (
          <div>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-ds-ink">
              <Quote className="h-3 w-3" strokeWidth={1.8} />
              {t('writePaperDetailCitationsByYear')}
            </p>
            <div className="flex h-14 items-end gap-1">
              {trend.map((row) => (
                <div key={row.year} className="flex flex-1 flex-col items-center gap-0.5">
                  <div
                    className="w-full rounded-sm bg-accent-tint/40"
                    style={{ height: `${Math.max(4, (row.citations / (maxCount || 1)) * 44)}px` }}
                    title={`${row.year}: ${row.citations}`}
                  />
                  <span className="text-[8.5px] tabular-nums text-ds-faint">
                    {String(row.year).slice(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {loading ? (
          <p className="flex items-center gap-1.5 text-[11px] text-ds-faint">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('writePaperDetailLoading')}
          </p>
        ) : failed ? (
          <p className="text-[11px] text-ds-faint">{t('writePaperDetailFailed')}</p>
        ) : null}
        <div className="flex flex-wrap gap-1.5 border-t border-ds-border-muted pt-2.5">
          {paper.arxivId ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                void window.kunGui?.openExternal?.(`https://arxiv.org/abs/${paper.arxivId}`)
              }}
              className="inline-flex items-center gap-1 rounded-md border border-ds-border px-2 py-1 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <ExternalLink className="h-3 w-3" />
              arXiv {paper.arxivId}
            </a>
          ) : null}
          {paper.doi ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                void window.kunGui?.openExternal?.(`https://doi.org/${paper.doi}`)
              }}
              className="inline-flex items-center gap-1 rounded-md border border-ds-border px-2 py-1 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <ExternalLink className="h-3 w-3" />
              DOI
            </a>
          ) : null}
          {paper.pdfUrl ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                void window.kunGui?.openExternal?.(paper.pdfUrl!)
              }}
              className="inline-flex items-center gap-1 rounded-md border border-ds-border px-2 py-1 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <FileText className="h-3 w-3" />
              PDF
            </a>
          ) : null}
          {paper.url && !paper.arxivId && !paper.doi ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                void window.kunGui?.openExternal?.(paper.url!)
              }}
              className="inline-flex items-center gap-1 rounded-md border border-ds-border px-2 py-1 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <ExternalLink className="h-3 w-3" />
              {t('writePaperVenuePaperPage')}
            </a>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
