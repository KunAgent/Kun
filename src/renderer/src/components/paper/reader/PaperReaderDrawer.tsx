import { useEffect, useState, type ReactElement } from 'react'
import { BookMarked, Loader2, Plus, Trash2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { PDFDocumentProxy, PDFOutlineItem } from 'pdfjs-dist/build/pdf.mjs'
import type { PaperReferenceItem } from '@shared/paper/paper-library-types'
import { usePaperMarksStore } from '../../../paper/paper-marks-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { openLibraryEntry } from '../../../paper/paper-library-actions'
import { newPaperRequestId, usePaperStore } from '../../../write/paper/paper-store'
import { PaperFiguresPane } from './PaperFiguresPane'

type DrawerTab = 'outline' | 'figures' | 'annotations' | 'references' | 'citations'

/**
 * Reader side drawer (plan §6.4): table of contents, annotation list, and
 * the references panel (local bbl/bib → S2 → Crossref via the main service).
 */
export function PaperReaderDrawer({
  workspaceRoot,
  unitDir,
  pdfDocument,
  onJumpToPage,
  onDeleteMark,
  t
}: {
  workspaceRoot: string
  unitDir: string
  pdfDocument: PDFDocumentProxy | null
  onJumpToPage: (page: number) => void
  onDeleteMark: (id: string) => void
  t: TFunction
}): ReactElement {
  const [tab, setTab] = useState<DrawerTab>('annotations')
  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-ds-border-muted bg-ds-card/60">
      <div className="flex shrink-0 gap-1 border-b border-ds-border-muted p-1.5">
        {(['outline', 'figures', 'annotations', 'references', 'citations'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`flex-1 rounded-md px-2 py-1 text-[11.5px] ${
              tab === key ? 'bg-accent/15 font-medium text-accent' : 'text-ds-muted hover:bg-ds-hover'
            }`}
            onClick={() => setTab(key)}
          >
            {t(`writePaperReaderTab_${key}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tab === 'outline' ? (
          <OutlinePane pdfDocument={pdfDocument} onJumpToPage={onJumpToPage} t={t} />
        ) : tab === 'figures' ? (
          <PaperFiguresPane
            workspaceRoot={workspaceRoot}
            unitDir={unitDir}
            onJumpToPage={onJumpToPage}
            t={t}
          />
        ) : tab === 'annotations' ? (
          <AnnotationsPane onJumpToPage={onJumpToPage} onDelete={onDeleteMark} t={t} />
        ) : (
          <ReferencesPane
            workspaceRoot={workspaceRoot}
            unitDir={unitDir}
            kind={tab === 'citations' ? 'citations' : 'references'}
            t={t}
          />
        )}
      </div>
    </aside>
  )
}

function OutlinePane({
  pdfDocument,
  onJumpToPage,
  t
}: {
  pdfDocument: PDFDocumentProxy | null
  onJumpToPage: (page: number) => void
  t: TFunction
}): ReactElement {
  const [items, setItems] = useState<PDFOutlineItem[] | null>(null)
  useEffect(() => {
    let cancelled = false
    setItems(null)
    if (!pdfDocument) return
    void pdfDocument.getOutline().then((outline) => {
      if (!cancelled) setItems(outline ?? [])
    }).catch(() => {
      if (!cancelled) setItems([])
    })
    return () => {
      cancelled = true
    }
  }, [pdfDocument])
  if (items === null) {
    return <div className="flex items-center gap-2 p-2 text-[12px] text-ds-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>
  }
  if (items.length === 0) {
    return <p className="p-2 text-[12px] text-ds-faint">{t('writePaperReaderNoOutline')}</p>
  }
  return (
    <ul className="space-y-0.5">
      {items.map((item, index) => (
        <OutlineRow key={index} item={item} depth={0} pdfDocument={pdfDocument} onJumpToPage={onJumpToPage} />
      ))}
    </ul>
  )
}

function OutlineRow({
  item,
  depth,
  pdfDocument,
  onJumpToPage
}: {
  item: PDFOutlineItem
  depth: number
  pdfDocument: PDFDocumentProxy | null
  onJumpToPage: (page: number) => void
}): ReactElement {
  const jump = async (): Promise<void> => {
    if (!pdfDocument || !item.dest) return
    try {
      const dest: unknown[] | null =
        typeof item.dest === 'string' ? await pdfDocument.getDestination(item.dest) : item.dest
      const ref = dest?.[0]
      if (ref) {
        const pageIndex = await pdfDocument.getPageIndex(ref)
        onJumpToPage(pageIndex + 1)
      }
    } catch {
      // Unresolvable outline dest — ignore.
    }
  }
  return (
    <li>
      <button
        type="button"
        className="w-full truncate rounded px-1.5 py-1 text-left text-[12px] text-ds-ink hover:bg-ds-hover"
        style={{ paddingLeft: `${6 + depth * 12}px` }}
        onClick={() => void jump()}
      >
        {item.title}
      </button>
      {item.items?.length ? (
        <ul>
          {item.items.map((child, index) => (
            <OutlineRow key={index} item={child} depth={depth + 1} pdfDocument={pdfDocument} onJumpToPage={onJumpToPage} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function AnnotationsPane({
  onJumpToPage,
  onDelete,
  t
}: {
  onJumpToPage: (page: number) => void
  onDelete: (id: string) => void
  t: TFunction
}): ReactElement {
  const items = usePaperMarksStore((s) => s.items)
  const cards = usePaperMarksStore((s) => s.cards)
  const cardList = Object.values(cards) as { id: string; page: number; quote: string; translation?: string }[]
  if (items.length === 0 && cardList.length === 0) {
    return <p className="p-2 text-[12px] text-ds-faint">{t('writePaperReaderNoAnnotations')}</p>
  }
  return (
    <ul className="space-y-1.5">
      {items.map((mark) => (
        <li key={mark.id} className="group rounded-lg border border-ds-border-muted p-2">
          <button
            type="button"
            className="block w-full text-left"
            onClick={() => onJumpToPage(mark.page)}
          >
            <span className="text-[10.5px] text-ds-faint">{t('writePdfPageLabel', { page: mark.page })}</span>
            <p className="line-clamp-2 text-[12px] leading-4 text-ds-ink">{mark.quote}</p>
            {mark.comment ? (
              <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-4 text-ds-muted">{mark.comment}</p>
            ) : null}
          </button>
          <button
            type="button"
            className="mt-1 hidden text-[11px] text-red-500 group-hover:block"
            onClick={() => onDelete(mark.id)}
          >
            <Trash2 className="mr-1 inline h-3 w-3" />
            {t('writePaperReaderDelete')}
          </button>
        </li>
      ))}
      {cardList.map((card) => (
        <li key={card.id} className="rounded-lg border border-accent/30 bg-accent/5 p-2">
          <button
            type="button"
            className="block w-full text-left"
            onClick={() => onJumpToPage(card.page)}
          >
            <span className="text-[10.5px] text-ds-faint">{t('writePdfPageLabel', { page: card.page })}</span>
            <p className="line-clamp-2 text-[12px] leading-4 text-ds-ink">{card.quote}</p>
            {card.translation ? (
              <p className="mt-0.5 line-clamp-3 text-[11.5px] leading-4 text-ds-muted">{card.translation}</p>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}

function ReferencesPane({
  workspaceRoot,
  unitDir,
  kind,
  t
}: {
  workspaceRoot: string
  unitDir: string
  kind: 'references' | 'citations'
  t: TFunction
}): ReactElement {
  const entries = usePaperModeStore((s) => s.entries)
  const [importing, setImporting] = useState<number | null>(null)
  const [state, setState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'done'; items: PaperReferenceItem[]; fromCache: boolean }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' })

  const load = (force: boolean): void => {
    if (typeof window.kunGui?.paperFetchReferences !== 'function') return
    setState({ phase: 'loading' })
    void window.kunGui.paperFetchReferences({ workspaceRoot, unitDir, force, kind }).then((result) => {
      if (result.ok) setState({ phase: 'done', items: result.items, fromCache: result.fromCache })
      else setState({ phase: 'error', message: result.message })
    }).catch((error: unknown) => {
      setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }

  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot, unitDir, kind])

  // "已在库中" is computed at render time against the library entries.
  const findInLibrary = (ref: PaperReferenceItem) =>
    entries.find((entry) =>
      (ref.arxivId && entry.meta.arxivId === ref.arxivId)
      || (ref.doi && entry.meta.doi?.toLowerCase() === ref.doi.toLowerCase())
    )

  const importRef = async (ref: PaperReferenceItem): Promise<void> => {
    const input = ref.arxivId ?? ref.doi
    if (!input || typeof window.kunGui?.paperImport !== 'function') return
    setImporting(ref.n)
    try {
      const result = await window.kunGui.paperImport({
        workspaceRoot,
        input,
        requestId: newPaperRequestId()
      })
      if (result.ok) usePaperModeStore.getState().refreshEntries()
      else {
        usePaperStore.getState().setNotice({ tone: 'error', message: result.message })
      }
    } finally {
      setImporting(null)
    }
  }

  if (state.phase === 'loading' || state.phase === 'idle') {
    return <div className="flex items-center gap-2 p-2 text-[12px] text-ds-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>
  }
  if (state.phase === 'error') {
    return (
      <div className="p-2">
        <p className="text-[12px] text-red-500">{state.message}</p>
        <button type="button" className="mt-1 text-[12px] text-accent" onClick={() => load(true)}>
          {t('writePaperReaderRetry')}
        </button>
      </div>
    )
  }
  if (state.items.length === 0) {
    return <p className="p-2 text-[12px] text-ds-faint">{t('writePaperReaderNoReferences')}</p>
  }
  return (
    <ul className="space-y-1.5">
      {state.items.map((ref) => {
        const inLibrary = findInLibrary(ref)
        return (
          <li key={ref.n} className="rounded-lg border border-ds-border-muted p-2 text-[12px] leading-4">
            <p className="text-ds-ink">{ref.title ?? ref.raw ?? '—'}</p>
            <p className="mt-0.5 text-[11px] text-ds-faint">
              {[ref.authors?.slice(0, 3).join(', '), ref.year, ref.venue].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              {ref.doi || ref.arxivId ? (
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-accent">
                  {ref.doi ?? `arXiv:${ref.arxivId}`}
                </span>
              ) : (
                <span className="flex-1" />
              )}
              {inLibrary ? (
                <button
                  type="button"
                  onClick={() => void openLibraryEntry(inLibrary)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
                >
                  <BookMarked className="h-2.5 w-2.5" strokeWidth={2} />
                  {t('writePaperRefInLibrary')}
                </button>
              ) : ref.arxivId || ref.doi ? (
                <button
                  type="button"
                  disabled={importing !== null}
                  onClick={() => void importRef(ref)}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-ds-border px-1.5 py-px text-[10px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-60"
                >
                  {importing === ref.n ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <Plus className="h-2.5 w-2.5" strokeWidth={2} />
                  )}
                  {t('writePaperImport')}
                </button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
