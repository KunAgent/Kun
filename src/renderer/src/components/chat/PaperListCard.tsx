import { useMemo, useState, type ReactElement } from 'react'
import {
  BadgeCheck,
  BookMarked,
  CheckSquare,
  FileText,
  Loader2,
  Quote,
  Send,
  Square,
  TriangleAlert
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  RendererPaperList,
  RendererPaperListEntry
} from '../../agent/paper-list-adapter'
import { paperCardImportInput, paperCardImportMeta, paperCardUrl } from '../../agent/paper-list-adapter'
import type { PaperUnitMetaV2 } from '@shared/paper/paper-meta-v2'
import { generatePaperBibtex } from '@shared/paper/paper-bibtex'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { newPaperRequestId, usePaperStore } from '../../write/paper/paper-store'
import { ImportButton } from '../paper/discover/PaperDiscoverParts'

const PRIORITY_ORDER = { must: 0, should: 1, optional: 2 } as const

function entryImportInput(entry: RendererPaperListEntry): string | undefined {
  return (entry.paper ? paperCardImportInput(entry.paper) : undefined) ?? entry.id
}

function entryUrl(entry: RendererPaperListEntry): string | undefined {
  return entry.paper ? paperCardUrl(entry.paper) : undefined
}

function entryMetaLine(entry: RendererPaperListEntry): string {
  const paper = entry.paper
  return [
    paper?.authors?.slice(0, 4).join(', ') ?? '',
    paper?.year ? String(paper.year) : '',
    paper?.venue ?? ''
  ].filter(Boolean).join(' · ')
}

/** Loose BibTeX projection: cards carry only the fields BibTeX needs. */
function entryToBibtexMeta(entry: RendererPaperListEntry): PaperUnitMetaV2 {
  const paper = entry.paper
  return {
    version: 2,
    slug: entry.id,
    title: paper?.title ?? entry.title,
    authors: paper?.authors ?? [],
    abstract: paper?.abstract,
    year: paper?.year !== undefined ? String(paper.year) : undefined,
    venue: paper?.venue,
    doi: paper?.doi ?? (/^10\.\d{4,9}\//i.test(entry.id) ? entry.id : undefined),
    arxivId: paper?.arxivId,
    pdfUrl: paper?.pdfUrl,
    sourceUrl: paper?.url,
    importedAt: ''
  }
}

function sendableText(entry: RendererPaperListEntry): string {
  const ids = [
    entry.paper?.arxivId ? `arXiv:${entry.paper.arxivId}` : '',
    entry.paper?.doi ? `doi:${entry.paper.doi}` : '',
    !entry.paper?.arxivId && !entry.paper?.doi ? `id:${entry.id}` : ''
  ].filter(Boolean).join(' ')
  return `- ${entry.title}${ids ? ` (${ids})` : ''} — ${entry.reason}`
}

/**
 * `paper_report` result card (plan P1.3): the curated list renders outside
 * the folded process timeline with checkboxes, batch import, BibTeX copy and
 * a send-to-assistant hand-off. Unverified ids stay visible but flagged.
 */
export function PaperListCard({
  list,
  workspaceRoot
}: {
  list: RendererPaperList
  workspaceRoot: string
}): ReactElement {
  const { t } = useTranslation('common')
  const composer = usePaperModeStore((s) => s.composerBridge)
  const refreshEntries = usePaperModeStore((s) => s.refreshEntries)
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(list.papers.map((entry) => entry.id))
  )
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)

  const groups = useMemo(() => {
    const out: Array<{ label: string; entries: RendererPaperListEntry[] }> = []
    const byLabel = new Map<string, RendererPaperListEntry[]>()
    for (const entry of [...list.papers].sort(
      (a, b) => (PRIORITY_ORDER[a.priority ?? 'optional'] ?? 2) - (PRIORITY_ORDER[b.priority ?? 'optional'] ?? 2)
    )) {
      const label = entry.group?.trim() ?? ''
      const bucket = byLabel.get(label)
      if (bucket) bucket.push(entry)
      else {
        byLabel.set(label, [entry])
        out.push({ label, entries: byLabel.get(label)! })
      }
    }
    return out
  }, [list.papers])

  const verifiedCount = list.papers.filter((entry) => entry.verified).length
  const selectedEntries = list.papers.filter((entry) => selected.has(entry.id))

  const toggle = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (): void => {
    setSelected((current) =>
      current.size === list.papers.length ? new Set() : new Set(list.papers.map((entry) => entry.id))
    )
  }

  const importSelected = async (): Promise<void> => {
    if (importing || !selectedEntries.length) return
    const paperReading = useWriteWorkspaceStore.getState().paperReading
    setImporting(true)
    try {
      const items = selectedEntries.map((entry) => ({
        input: entryImportInput(entry)!,
        meta: entry.paper ? paperCardImportMeta(entry.paper) : undefined
      }))
      if (typeof window.kunGui?.paperImportBatch === 'function') {
        const result = await window.kunGui.paperImportBatch({
          workspaceRoot,
          items,
          parentDir: paperReading.papersDir || 'papers',
          requestId: newPaperRequestId()
        })
        if (result.ok) {
          const imported = result.results.filter((r) => r.ok && !r.reused).length
          const reused = result.results.filter((r) => r.ok && r.reused).length
          const failed = result.results.filter((r) => !r.ok).length
          usePaperStore.getState().setNotice({
            tone: failed ? 'error' : 'info',
            message: t('writePaperReportImportDone', { imported, reused, failed })
          })
          refreshEntries()
        } else {
          usePaperStore.getState().setNotice({ tone: 'error', message: result.message })
        }
      }
    } finally {
      setImporting(false)
    }
  }

  const copyBibtex = async (): Promise<void> => {
    const text = generatePaperBibtex(selectedEntries.map(entryToBibtexMeta))
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const sendToAssistant = (): void => {
    if (!composer?.setInput || !selectedEntries.length) return
    composer.setInput(
      [list.title?.trim() || t('writePaperReportTitle'), '', ...selectedEntries.map(sendableText)].join('\n')
    )
  }

  return (
    <section className="overflow-hidden rounded-xl border border-ds-border-muted bg-ds-card">
      <header className="flex items-center gap-2 border-b border-ds-border-muted px-3.5 py-2.5">
        <BookMarked className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ds-ink">
            {list.title?.trim() || t('writePaperReportTitle')}
          </p>
          <p className="text-[11px] text-ds-faint">
            {t('writePaperReportCount', { count: list.papers.length })}
            {' · '}
            {t('writePaperReportVerified', { count: verifiedCount })}
          </p>
        </div>
      </header>

      {list.summary ? (
        <p className="border-b border-ds-border-muted px-3.5 py-2 text-[12px] leading-5 text-ds-muted">
          {list.summary}
        </p>
      ) : null}

      <div className="max-h-[420px] overflow-y-auto">
        {groups.map((group) => (
          <div key={group.label || '__none__'}>
            {group.label ? (
              <p className="sticky top-0 bg-ds-card/95 px-3.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-ds-faint backdrop-blur">
                {group.label}
              </p>
            ) : null}
            <ul>
              {group.entries.map((entry) => (
                <PaperListRow
                  key={entry.id}
                  entry={entry}
                  checked={selected.has(entry.id)}
                  onToggle={() => toggle(entry.id)}
                  workspaceRoot={workspaceRoot}
                  t={t}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <footer className="flex flex-wrap items-center gap-1.5 border-t border-ds-border-muted px-3 py-2">
        <button
          type="button"
          onClick={toggleAll}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          {selected.size === list.papers.length ? (
            <CheckSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
          ) : (
            <Square className="h-3.5 w-3.5" strokeWidth={1.8} />
          )}
          {t('writePaperReportSelectAll')}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void importSelected()}
          disabled={importing || !selectedEntries.length}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--ds-control)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--ds-control-foreground)] transition hover:opacity-90 disabled:opacity-50"
        >
          {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('writePaperReportImportSelected', { count: selectedEntries.length })}
        </button>
        <button
          type="button"
          onClick={() => void copyBibtex()}
          disabled={!selectedEntries.length}
          className="inline-flex items-center gap-1 rounded-md border border-ds-border px-2 py-1 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
        >
          <Quote className="h-3 w-3" strokeWidth={1.8} />
          {copied ? t('writePaperReportCopied') : t('writePaperReportCopyBibtex')}
        </button>
        {composer?.setInput ? (
          <button
            type="button"
            onClick={sendToAssistant}
            disabled={!selectedEntries.length}
            title={t('writePaperReportSendHint')}
            className="inline-flex items-center gap-1 rounded-md border border-ds-border px-2 py-1 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
          >
            <Send className="h-3 w-3" strokeWidth={1.8} />
            {t('writePaperReportSend')}
          </button>
        ) : null}
      </footer>
    </section>
  )
}

export function PaperListSkeleton({ title }: { title?: string }): ReactElement {
  return (
    <section
      aria-busy="true"
      aria-label={title?.trim() || 'Curating papers'}
      className="rounded-xl border border-ds-border-muted bg-ds-card p-3.5"
    >
      <div className="h-4 w-48 max-w-full rounded bg-ds-subtle" />
      <div className="mt-2 h-3 w-72 max-w-full rounded bg-ds-subtle/80" />
      <div className="mt-3 space-y-2">
        <div className="h-8 rounded bg-ds-subtle/70" />
        <div className="h-8 rounded bg-ds-subtle/70" />
        <div className="h-8 rounded bg-ds-subtle/70" />
      </div>
    </section>
  )
}

function PaperListRow({
  entry,
  checked,
  onToggle,
  workspaceRoot,
  t
}: {
  entry: RendererPaperListEntry
  checked: boolean
  onToggle: () => void
  workspaceRoot: string
  t: (key: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  const url = entryUrl(entry)
  const input = entryImportInput(entry)
  const metaLine = entryMetaLine(entry)
  const paper = entry.paper
  return (
    <li className="flex items-start gap-2 px-3.5 py-2 transition hover:bg-ds-hover/50">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={entry.title}
        onClick={onToggle}
        className="mt-0.5 shrink-0 text-ds-faint transition hover:text-ds-ink"
      >
        {checked ? (
          <CheckSquare className="h-3.5 w-3.5 text-accent" strokeWidth={1.8} />
        ) : (
          <Square className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          {url ? (
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault()
                void window.kunGui?.openExternal?.(url)
              }}
              className="min-w-0 flex-1 text-[12.5px] font-medium leading-5 text-ds-ink transition hover:text-accent"
            >
              {entry.title}
            </a>
          ) : (
            <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-5 text-ds-ink">{entry.title}</p>
          )}
          {entry.priority ? (
            <span
              className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${
                entry.priority === 'must'
                  ? 'bg-accent-tint/15 text-accent'
                  : 'bg-ds-subtle text-ds-muted'
              }`}
            >
              {t(`writePaperReportPriority_${entry.priority}`)}
            </span>
          ) : null}
          <span
            title={entry.verified ? t('writePaperReportVerifiedTip') : t('writePaperReportUnverifiedTip')}
            className={`shrink-0 ${entry.verified ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}
          >
            {entry.verified ? (
              <BadgeCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
            ) : (
              <TriangleAlert className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
          </span>
        </div>
        {metaLine ? <p className="mt-0.5 truncate text-[11px] text-ds-faint" title={metaLine}>{metaLine}</p> : null}
        <p className="mt-0.5 text-[11.5px] italic leading-[1.4] text-ds-muted">{entry.reason}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {paper?.sources?.map((source) => (
            <span key={source} className="rounded bg-ds-subtle px-1.5 py-px text-[10px] text-ds-muted">
              {t(`writePaperSearchSource_${source}`)}
            </span>
          ))}
          {typeof paper?.citations === 'number' ? (
            <span className="inline-flex items-center gap-0.5 text-[10.5px] tabular-nums text-ds-faint">
              <Quote className="h-2.5 w-2.5" strokeWidth={1.8} />
              {paper.citations}
            </span>
          ) : null}
          {paper?.pdfUrl ? (
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault()
                void window.kunGui?.openExternal?.(paper.pdfUrl!)
              }}
              className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[10.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <FileText className="h-2.5 w-2.5" strokeWidth={1.8} />
              PDF
            </a>
          ) : null}
          <span className="flex-1" />
          {input ? (
            <ImportButton
              input={input}
              meta={paper ? paperCardImportMeta(paper) : undefined}
              workspaceRoot={workspaceRoot}
              t={t}
            />
          ) : null}
        </div>
      </div>
    </li>
  )
}
