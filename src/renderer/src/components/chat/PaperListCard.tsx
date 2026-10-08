import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { BookMarked, ChevronDown, ChevronRight, ClipboardCopy, ExternalLink, FileText, Maximize2, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RendererPaperList, RendererPaperListEntry } from '../../agent/paper-list-adapter'
import { paperCardUrl } from '../../agent/paper-list-adapter'
import type { PaperUnitMetaV2 } from '@shared/paper/paper-meta-v2'
import { generatePaperBibtex } from '@shared/paper/paper-bibtex'
import { useChatStore } from '../../store/chat-store'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { candidateFromListEntry, useLibraryIndex } from '../../paper/paper-import-candidates'
import { findImportItem, importJobCounts, undoPaperImport, usePaperImportJobs, revealPaperFolder } from '../../paper/paper-import-job'
import type { ImportCandidate } from '../../paper/paper-import-plan'
import { selectionHas, usePaperImportSelection, usePaperSelectionRecords } from '../../paper/paper-import-selection'
import { listResearchSessions } from '../../paper/paper-research-sessions'
import { openPaperResearchSession } from '../../paper/paper-research-actions'
import { paperResearchStageActive } from '../../paper/paper-view'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { PaperImportAction } from '../paper/import/PaperImportAction'
import { PaperImportStatus } from '../paper/import/PaperImportStatus'
import { PaperMoreMenu } from '../paper/import/PaperMoreMenu'
import { PaperCheck, PaperPickRow, PRIORITY_TONE } from '../paper/import/PaperPickRow'
import { PaperListNextSteps } from './PaperListNextSteps'

const PRIORITY_ORDER = { must: 0, should: 1, optional: 2 } as const
/** Groups past this many rows start folded so a long report stays scannable. */
const OPEN_ROW_BUDGET = 8

type Item = { entry: RendererPaperListEntry; candidate: ImportCandidate }
type Group = { label: string; items: Item[] }

function metaLine(entry: RendererPaperListEntry): string {
  const paper = entry.paper
  const authors = paper?.authors ?? []
  const names = authors.length > 2 ? `${authors.slice(0, 2).join(', ')} +${authors.length - 2}` : authors.join(', ')
  return [names, paper?.year ? String(paper.year) : '', paper?.venue ?? ''].filter(Boolean).join(' · ')
}

function bibtexMeta(item: Item): PaperUnitMetaV2 {
  const paper = item.entry.paper
  return {
    version: 2,
    slug: item.entry.id,
    title: paper?.title ?? item.entry.title,
    authors: paper?.authors ?? [],
    abstract: paper?.abstract,
    year: paper?.year !== undefined ? String(paper.year) : undefined,
    venue: paper?.venue,
    doi: paper?.doi ?? (/^10\.\d{4,9}\//i.test(item.entry.id) ? item.entry.id : undefined),
    arxivId: paper?.arxivId,
    pdfUrl: paper?.pdfUrl,
    sourceUrl: paper?.url,
    importedAt: ''
  }
}

function sendableText(item: Item): string {
  const paper = item.entry.paper
  const ids = [
    paper?.arxivId ? `arXiv:${paper.arxivId}` : '',
    paper?.doi ? `doi:${paper.doi}` : '',
    !paper?.arxivId && !paper?.doi ? `id:${item.entry.id}` : ''
  ].filter(Boolean).join(' ')
  return `- ${item.entry.title}${ids ? ` (${ids})` : ''} — ${item.entry.reason}`
}

function openExternal(url: string | undefined): void {
  if (url) void window.kunGui?.openExternal?.(url)
}

/**
 * `paper_report` result card: the curated list renders outside the folded
 * process timeline as compact rows grouped by direction. Selection is shared
 * with the paper pool; every import goes through the one import sheet, and
 * rows report their own import state afterwards.
 */
export function PaperListCard({ list }: { list: RendererPaperList; workspaceRoot?: string }): ReactElement {
  const { t } = useTranslation('common')
  const scope = useChatStore((s) => s.activeThreadId) ?? ''
  const threads = useChatStore((s) => s.threads)
  const libraryRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const index = useLibraryIndex()
  const records = usePaperSelectionRecords(scope)
  const job = usePaperImportJobs((s) => s.jobs[scope])
  const composer = usePaperModeStore((s) => s.composerBridge)
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [copied, setCopied] = useState(false)
  const stageActive = useWriteWorkspaceStore((s) => paperResearchStageActive(s))

  const items = useMemo<Item[]>(
    () => [...list.papers]
      .sort((a, b) => (PRIORITY_ORDER[a.priority ?? 'optional'] ?? 2) - (PRIORITY_ORDER[b.priority ?? 'optional'] ?? 2))
      .map((entry) => ({ entry, candidate: candidateFromListEntry(entry, index) })),
    [list.papers, index]
  )
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = []
    const byLabel = new Map<string, Group>()
    for (const item of items) {
      const label = item.entry.group?.trim() ?? ''
      let group = byLabel.get(label)
      if (!group) {
        group = { label, items: [] }
        byLabel.set(label, group)
        out.push(group)
      }
      group.items.push(item)
    }
    return out
  }, [items])

  // The Agent's recommendation is the starting selection: everything except
  // "optional" papers and papers the library already has.
  const signature = useMemo(() => list.papers.map((entry) => entry.id).join('|'), [list.papers])
  useEffect(() => {
    if (!scope) return
    const preselected = items.filter((item) => item.entry.priority !== 'optional' && !item.candidate.owned)
    usePaperImportSelection.getState().seed(scope, signature, preselected.map((item) => item.candidate.keys))
    // `items` follows the library index; the seed must happen once per list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, signature])

  const isChecked = (item: Item): boolean => selectionHas(records, item.candidate.keys)
  const selected = items.filter(isChecked)
  const locked = job?.running === true
  const toggle = (item: Item): void => usePaperImportSelection.getState().toggle(scope, item.candidate.keys)
  const setMany = (rows: Item[], on: boolean): void =>
    usePaperImportSelection.getState().setMany(scope, rows.map((item) => item.candidate.keys), on)
  const stateOf = (rows: Item[]): 'on' | 'off' | 'some' => {
    const count = rows.filter(isChecked).length
    return count === 0 ? 'off' : count === rows.length ? 'on' : 'some'
  }

  const verified = list.papers.filter((entry) => entry.verified).length
  const topic = list.title?.trim() || threadTitleOf(scope, threads)
  const ownedSelected = selected.filter((item) => item.candidate.owned).length
  const session = useMemo(
    () => listResearchSessions(libraryRoot, threads).find((candidate) => candidate.threadId === scope),
    [libraryRoot, threads, scope]
  )
  const canExpand = Boolean(session) && !stageActive

  const copyBibtex = async (): Promise<void> => {
    const text = generatePaperBibtex(selected.map(bibtexMeta))
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  const sendToAssistant = (): void => {
    if (!composer?.setInput || !selected.length) return
    composer.setInput([topic || t('writePaperReportTitle'), '', ...selected.map(sendableText)].join('\n'))
  }

  let rowBudget = 0
  const created = job && !job.undone ? importJobCounts(job).created : 0

  return (
    <div>
      <section className="overflow-hidden rounded-xl border border-ds-border-muted bg-ds-card">
        <header className="flex items-center gap-2.5 px-3 py-2.5">
          <PaperCheck
            state={stateOf(items)}
            disabled={locked}
            onToggle={() => setMany(items, stateOf(items) !== 'on')}
            label={t('writePaperReportSelectAll')}
          />
          <BookMarked className="h-4 w-4 shrink-0 text-[var(--ds-accent)]" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-ds-ink">{t('writePaperReportTitle')}</p>
            <p className="truncate text-[11.5px] text-ds-faint">
              {t('writePaperReportCount', { count: list.papers.length })}
              {groups.length > 1 || groups[0]?.label ? ` · ${t('paperReportDirections', { count: groups.length })}` : ''}
              {' · '}
              {t('writePaperReportVerified', { count: verified })}
            </p>
          </div>
          {canExpand && session ? (
            <button
              type="button"
              onClick={() => void openPaperResearchSession({ libraryRoot, sessionId: session.sessionId })}
              title={t('paperReportOpenInDiscover')}
              aria-label={t('paperReportOpenInDiscover')}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          ) : null}
        </header>

        {list.summary ? (
          <p className="border-t border-ds-border-muted/70 px-3 py-2 text-[12px] leading-5 text-ds-muted">{list.summary}</p>
        ) : null}

        {created > 0 && job ? (
          <div className="flex items-center gap-2 border-t border-ds-border-muted/70 bg-emerald-500/[0.07] px-3 py-1.5 text-[12px] text-emerald-800 dark:text-emerald-200">
            <span className="min-w-0 flex-1 truncate">
              {t('paperImportDoneToFolder', { count: created, folder: job.folder || t('paperImportFolderRoot') })}
            </span>
            <button type="button" onClick={() => revealPaperFolder(job.root, job.folder)} className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-emerald-500/10">
              {t('paperImportOpenFolder')}
            </button>
            <button type="button" onClick={() => void undoPaperImport(scope, t)} className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-emerald-500/10">
              {t('paperImportUndo')}
            </button>
          </div>
        ) : null}

        {groups.map((group) => {
          const startFolded = rowBudget >= OPEN_ROW_BUDGET && group.label !== ''
          rowBudget += group.items.length
          const isFolded = folded.has(group.label) !== startFolded
          const count = group.items.filter(isChecked).length
          return (
            <div key={group.label || '__none__'}>
              {group.label ? (
                <div className="flex h-8 items-center gap-2 border-t border-ds-border-muted/70 bg-ds-subtle/50 px-3 text-[12px] font-semibold text-ds-muted">
                  <PaperCheck
                    state={stateOf(group.items)}
                    disabled={locked}
                    onToggle={() => setMany(group.items, stateOf(group.items) !== 'on')}
                    label={group.label}
                  />
                  <button
                    type="button"
                    aria-expanded={!isFolded}
                    onClick={() => setFolded((current) => {
                      const next = new Set(current)
                      if (next.has(group.label)) next.delete(group.label)
                      else next.add(group.label)
                      return next
                    })}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  >
                    {isFolded ? <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} /> : <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />}
                    <span className="truncate">{group.label}</span>
                  </button>
                  <span className="shrink-0 text-[11px] font-normal tabular-nums text-ds-faint">{count} / {group.items.length}</span>
                </div>
              ) : null}
              {isFolded ? null : (
                <ul>
                  {group.items.map((item) => {
                    const { entry, candidate } = item
                    const state = findImportItem(job, candidate.keys)
                    const url = entry.paper ? paperCardUrl(entry.paper) : undefined
                    return (
                      <PaperPickRow
                        key={entry.id}
                        checked={isChecked(item)}
                        onToggle={() => (locked ? undefined : toggle(item))}
                        checkLabel={entry.title}
                        priority={entry.priority ? { label: t(`writePaperReportPriority_${entry.priority}`), tone: PRIORITY_TONE[entry.priority] ?? '' } : undefined}
                        title={entry.title}
                        meta={metaLine(entry)}
                        reason={entry.reason}
                        status={(
                          <>
                            <PaperImportStatus scope={scope} item={state} owned={candidate.owned} />
                            {!entry.verified && !state && !candidate.owned ? (
                              <span className="text-[11.5px] text-amber-700 dark:text-amber-300" title={t('writePaperReportUnverifiedTip')}>
                                {t('paperReportUnverified')}
                              </span>
                            ) : null}
                          </>
                        )}
                        actions={(
                          <>
                            {url ? (
                              <button type="button" onClick={() => openExternal(url)} title={t('paperReportOpenPage')} aria-label={t('paperReportOpenPage')}
                                className="grid h-6 w-6 place-items-center rounded-md border border-ds-border-muted text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                                <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
                              </button>
                            ) : null}
                            {entry.paper?.pdfUrl ? (
                              <button type="button" onClick={() => openExternal(entry.paper?.pdfUrl)} title="PDF" aria-label="PDF"
                                className="grid h-6 w-6 place-items-center rounded-md border border-ds-border-muted text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                                <FileText className="h-3 w-3" strokeWidth={1.8} />
                              </button>
                            ) : null}
                          </>
                        )}
                      />
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}

        <footer className="flex items-center gap-2 border-t border-ds-border-muted bg-ds-subtle/40 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-ds-muted">
            {t('paperResearchPoolSelected', { count: selected.length })}
            {ownedSelected > 0 ? <span className="text-ds-faint">{` · ${t('paperReportOwnedCount', { count: ownedSelected })}`}</span> : null}
          </span>
          <PaperImportAction scope={scope} candidates={selected.map((item) => item.candidate)} topic={topic} />
          <PaperMoreMenu
            label={t('paperReportMore')}
            items={[
              { id: 'bibtex', label: copied ? t('writePaperReportCopied') : t('writePaperReportCopyBibtex'), icon: <ClipboardCopy className="h-3.5 w-3.5" strokeWidth={1.8} />, disabled: !selected.length, onSelect: () => void copyBibtex() },
              { id: 'send', label: t('writePaperReportSend'), icon: <Send className="h-3.5 w-3.5" strokeWidth={1.8} />, disabled: !selected.length || !composer?.setInput, onSelect: sendToAssistant }
            ]}
          />
        </footer>
      </section>
      <PaperListNextSteps scope={scope} />
    </div>
  )
}

function threadTitleOf(threadId: string, threads: ReadonlyArray<{ id: string; title?: string }>): string {
  return threads.find((thread) => thread.id === threadId)?.title?.trim() ?? ''
}

export function PaperListSkeleton({ title }: { title?: string }): ReactElement {
  return (
    <section
      aria-busy="true"
      aria-label={title?.trim() || 'Curating papers'}
      className="rounded-xl border border-ds-border-muted bg-ds-card p-3.5"
    >
      <div className="h-4 w-48 max-w-full rounded bg-ds-subtle" />
      <div className="mt-2 h-3 w-72 max-w-full rounded bg-ds-subtle" />
      <div className="mt-3 space-y-2">
        <div className="h-8 rounded bg-ds-subtle" />
        <div className="h-8 rounded bg-ds-subtle" />
        <div className="h-8 rounded bg-ds-subtle" />
      </div>
    </section>
  )
}
