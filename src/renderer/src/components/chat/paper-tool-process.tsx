import { createContext, useContext, useState, type ReactElement } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, FileText, Quote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolBlock } from '../../agent/types'
import {
  paperCardUrl,
  parseRendererPaperSearchMeta,
  type RendererPaperCard,
  type RendererPaperDetails,
  type RendererPaperSearchMeta
} from '../../agent/paper-list-adapter'

type Translate = (key: string, opts?: Record<string, unknown>) => string

export type PaperToolName = 'paper_search' | 'paper_citations' | 'paper_details' | 'paper_report'

const PAPER_TOOLS: ReadonlySet<string> = new Set(['paper_search', 'paper_citations', 'paper_details', 'paper_report'])
const COLLAPSED_ROWS = 5

export type PaperToolDetail =
  | { kind: 'paper-search'; meta: RendererPaperSearchMeta }
  | { kind: 'paper-details'; papers: RendererPaperCard[] }

/**
 * Research-pool hints for tool cards (how many papers each call added). The
 * research stage provides it; elsewhere cards render without the hint.
 */
export const PaperToolPoolContext = createContext<Record<string, number> | null>(null)

export function paperToolName(toolName: string): PaperToolName | null {
  const name = toolName.toLowerCase().replace(/^mcp__kun__/, '')
  return PAPER_TOOLS.has(name) ? (name as PaperToolName) : null
}

function argsOf(block: ToolBlock): Record<string, unknown> {
  for (const text of [block.detail, block.summary]) {
    const start = text?.indexOf('{') ?? -1
    if (!text || start < 0) continue
    try {
      const parsed = JSON.parse(text.slice(start)) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // Not JSON arguments; fall through.
    }
  }
  return {}
}

function clip(text: string, max = 64): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

export function paperToolLabel(name: PaperToolName, t: Translate): string {
  switch (name) {
    case 'paper_search': return t('paperToolSearch')
    case 'paper_citations': return t('paperToolCitations')
    case 'paper_details': return t('paperToolDetails')
    case 'paper_report': return t('paperToolReport')
  }
}

/** One-line collapsed summary for a paper tool row. */
export function summarizePaperToolBlock(block: ToolBlock, name: PaperToolName, t: Translate): string {
  const label = paperToolLabel(name, t)
  const meta = parseRendererPaperSearchMeta(block.meta?.paperSearch)
  const args = argsOf(block)
  const parts: string[] = []
  if (name === 'paper_search') {
    const query = typeof args.query === 'string' ? args.query : meta?.query
    parts.push(query ? `${label} “${clip(query)}”` : label)
  } else if (name === 'paper_citations') {
    const seed = typeof args.seed_id === 'string' ? args.seed_id : ''
    const key = args.direction === 'citations' ? 'paperToolCitedBy' : 'paperToolReferencesOf'
    parts.push(seed ? `${label} · ${t(key, { seed: clip(seed, 40) })}` : label)
  } else if (name === 'paper_details') {
    const ids = Array.isArray(args.ids) ? args.ids.length : 0
    parts.push(ids ? `${label} · ${t('paperToolPaperCount', { count: ids })}` : label)
  } else {
    parts.push(label)
  }
  if (meta) {
    parts.push(t('paperToolPaperCount', { count: meta.total }))
    const failed = meta.sources.filter((report) => report.error)
    if (failed.length) {
      parts.push(t('paperToolFailed', { sources: failed.map((r) => t(`writePaperSearchSource_${r.source}`)).join(', ') }))
    }
  }
  return parts.join(' · ')
}

export function paperToolProcessDetail(block: ToolBlock, name: PaperToolName): PaperToolDetail | null {
  if (name === 'paper_search' || name === 'paper_citations') {
    const meta = parseRendererPaperSearchMeta(block.meta?.paperSearch)
    return meta ? { kind: 'paper-search', meta } : null
  }
  if (name === 'paper_details') {
    const details = block.meta?.paperDetails as RendererPaperDetails | undefined
    return details && Array.isArray(details.papers) && details.papers.length
      ? { kind: 'paper-details', papers: details.papers }
      : null
  }
  return null
}

function PaperRow({ paper, t }: { paper: RendererPaperCard; t: Translate }): ReactElement {
  const url = paperCardUrl(paper)
  const meta = [paper.year ? String(paper.year) : '', paper.venue ?? ''].filter(Boolean).join(' · ')
  return (
    <li className="flex items-start gap-2 border-t border-ds-border-muted py-1.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        {url ? (
          <a
            href="#"
            onClick={(event) => {
              event.preventDefault()
              void window.kunGui?.openExternal?.(url)
            }}
            className="block truncate text-[12.5px] font-medium text-ds-ink hover:underline"
            title={paper.title}
          >
            {paper.title}
          </a>
        ) : (
          <span className="block truncate text-[12.5px] font-medium text-ds-ink" title={paper.title}>{paper.title}</span>
        )}
        <span className="flex items-center gap-1.5 text-[11px] text-ds-faint">
          {meta ? <span className="truncate">{meta}</span> : null}
          {typeof paper.citations === 'number' ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums"><Quote className="h-2.5 w-2.5" />{paper.citations}</span>
          ) : null}
          {paper.pdfUrl ? <FileText className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-label="PDF" /> : null}
          {paper.sources.length > 1 ? <span className="shrink-0">{t('paperToolSourceCount', { count: paper.sources.length })}</span> : null}
        </span>
      </div>
    </li>
  )
}

function PaperRows({ papers, t }: { papers: RendererPaperCard[]; t: Translate }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? papers : papers.slice(0, COLLAPSED_ROWS)
  return (
    <>
      <ul>{shown.map((paper) => <PaperRow key={paper.id} paper={paper} t={t} />)}</ul>
      {papers.length > COLLAPSED_ROWS ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-ds-muted hover:text-ds-ink"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? t('paperToolShowLess') : t('paperToolShowAll', { count: papers.length })}
        </button>
      ) : null}
    </>
  )
}

/** Expanded body of a paper tool row: source status, new-paper hint, hit list. */
export function PaperToolDetailView({ block, detail }: { block: ToolBlock; detail: PaperToolDetail }): ReactElement {
  const { t } = useTranslation('common')
  const newCounts = useContext(PaperToolPoolContext)
  if (detail.kind === 'paper-details') return <PaperRows papers={detail.papers} t={t} />
  const fresh = newCounts?.[block.id]
  // In a research session the papers live in the pool (and the report card);
  // the process only reports numbers.
  const inResearch = newCounts !== null
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {detail.meta.sources.map((report) => (
          <span
            key={report.source}
            title={report.error ?? `${(report.ms / 1000).toFixed(1)}s`}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] tabular-nums ${
              report.error ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-ds-subtle text-ds-muted'
            }`}
          >
            {report.error ? <AlertCircle className="h-3 w-3" strokeWidth={2} /> : null}
            {t(`writePaperSearchSource_${report.source}`)}
            <span className="text-ds-faint">{report.error ? t('writePaperSearchSourceFailed') : report.count}</span>
          </span>
        ))}
        {typeof fresh === 'number' ? (
          <span className="ml-auto text-[11px] text-ds-faint">{t('paperToolNewInPool', { count: fresh })}</span>
        ) : null}
      </div>
      {inResearch && detail.meta.papers.length ? (
        <p className="text-[12px] text-ds-muted">
          {t('paperToolInPool', { count: detail.meta.papers.length, fresh: fresh ?? 0 })}
        </p>
      ) : detail.meta.papers.length ? (
        <PaperRows papers={detail.meta.papers} t={t} />
      ) : (
        <p className="text-[12px] text-ds-faint">{t('writePaperSearchNoResults')}</p>
      )}
    </div>
  )
}
