import { useEffect, useState, type ReactElement } from 'react'
import { BookMarked, ExternalLink, Loader2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { PaperReferenceItem } from '@shared/paper/paper-references-types'
import type { PaperFigureItemV1 } from '@shared/paper/paper-types'
import {
  resolveAuthorYear,
  resolveFigureLabel,
  resolveReferenceNumber,
  type PaperCitationHit
} from '../../../paper/pdf-citation-resolve'
import { usePaperReaderServices } from './paper-reader-context'
import { writeJoinPath } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { openLibraryEntry } from '../../../paper/paper-library-actions'

export type CitationAnchor = { x: number; y: number }

/**
 * R2.5 hover card next to a citation/cross-ref hitbox in the PDF text layer.
 * Bibliography hits resolve against references.json; figure/table hits show
 * the figures index thumbnail + caption. Unresolved hits degrade to a
 * jump-to-references fallback.
 */
export function PaperCitationCard({
  hit,
  anchor,
  onCloseIntent,
  t
}: {
  hit: PaperCitationHit
  /** Page-local CSS pixels (same space as the hitbox). */
  anchor: CitationAnchor
  onCloseIntent: () => void
  t: TFunction
}): ReactElement {
  const services = usePaperReaderServices()
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'references'; items: PaperReferenceItem[] }
    | { phase: 'figure'; item: PaperFigureItemV1 | null }
    | { phase: 'unresolved' }
  >({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading' })
    const run = async (): Promise<void> => {
      if (!services) {
        setState({ phase: 'unresolved' })
        return
      }
      if (hit.kind === 'figure' || hit.kind === 'table') {
        const items = await services.getFigures().catch(() => [])
        if (cancelled) return
        setState({
          phase: 'figure',
          item: resolveFigureLabel(items, hit.kind, hit.objectNumber ?? -1) ?? null
        })
        return
      }
      const items = await services.getReferences().catch(() => [])
      if (cancelled) return
      const resolved = hit.kind === 'authorYear'
        ? [resolveAuthorYear(items, hit.surname ?? '', hit.year ?? '')]
        : (hit.numbers ?? []).map((n) => resolveReferenceNumber(items, n))
      const found = resolved.filter((item): item is PaperReferenceItem => Boolean(item))
      setState(found.length ? { phase: 'references', items: found.slice(0, 4) } : { phase: 'unresolved' })
    }
    void run()
    return () => { cancelled = true }
  }, [hit, services])

  const jumpToReferences = (): void => {
    if (services?.referencesPage) services.jumpToPage(services.referencesPage)
    onCloseIntent()
  }

  return (
    <div
      className="ds-no-drag absolute z-40 w-60 rounded-xl border border-ds-border bg-ds-card p-2 text-left shadow-xl"
      style={{ left: anchor.x, top: anchor.y }}
      onPointerDown={(event) => event.stopPropagation()}
      role="tooltip"
    >
      <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-ds-faint">
        {hit.raw}
      </p>
      {state.phase === 'loading' ? (
        <div className="flex items-center gap-1.5 py-1 text-[11.5px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.9} />
          {t('loading')}
        </div>
      ) : state.phase === 'references' ? (
        <ul className="space-y-1.5">
          {state.items.map((item) => (
            <ReferenceRow key={item.n} item={item} t={t} />
          ))}
        </ul>
      ) : state.phase === 'figure' && state.item ? (
        <FigurePreview item={state.item} t={t} />
      ) : (
        <div className="space-y-1">
          <p className="text-[11.5px] leading-4 text-ds-muted">
            {hit.kind === 'reference' || hit.kind === 'authorYear'
              ? t('writePaperCitationUnresolved')
              : hit.raw}
          </p>
          {services?.referencesPage ? (
            <button
              type="button"
              className="text-[11.5px] text-accent hover:underline"
              onClick={jumpToReferences}
            >
              {t('writePaperCitationJumpToReferences')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function ReferenceRow({ item, t }: { item: PaperReferenceItem; t: TFunction }): ReactElement {
  // "已在库中" mirrors ReferencesPane: match by arXiv id or DOI at render time.
  const inLibrary = usePaperModeStore((s) =>
    s.entries.find((entry) =>
      (item.arxivId && entry.meta.arxivId === item.arxivId)
      || (item.doi && entry.meta.doi?.toLowerCase() === item.doi.toLowerCase())
    )
  )
  const href = item.doi
    ? `https://doi.org/${item.doi}`
    : item.arxivId
      ? `https://arxiv.org/abs/${item.arxivId}`
      : null
  const openExternal = (): void => {
    if (href) void window.kunGui?.openExternal?.(href)
  }
  return (
    <li className="rounded-lg border border-ds-border-muted p-1.5">
      <p className="line-clamp-2 text-[11.5px] font-medium leading-4 text-ds-ink">
        [{item.n}] {item.title ?? item.raw ?? '—'}
      </p>
      <p className="mt-0.5 line-clamp-1 text-[10.5px] text-ds-faint">
        {[item.authors?.slice(0, 3).join(', '), item.year, item.venue].filter(Boolean).join(' · ')}
      </p>
      <div className="mt-0.5 flex items-center gap-1.5">
        {href ? (
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-0.5 truncate text-[10.5px] text-accent hover:underline"
            onClick={openExternal}
            title={href}
          >
            <ExternalLink className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
            {item.doi ? `doi:${item.doi}` : `arXiv:${item.arxivId}`}
          </button>
        ) : null}
        {inLibrary ? (
          <button
            type="button"
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
            onClick={() => void openLibraryEntry(inLibrary)}
          >
            <BookMarked className="h-2.5 w-2.5" strokeWidth={2} />
            {t('writePaperRefInLibrary')}
          </button>
        ) : null}
      </div>
    </li>
  )
}

function FigurePreview({ item, t }: { item: PaperFigureItemV1; t: TFunction }): ReactElement {
  const services = usePaperReaderServices()
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setSrc(null)
    if (!services || !item.path || typeof window.kunGui?.readWorkspaceImage !== 'function') return
    const path = writeJoinPath(writeJoinPath(services.workspaceRoot, services.unitDir), item.path)
    void window.kunGui.readWorkspaceImage({ workspaceRoot: services.workspaceRoot, path })
      .then((result) => { if (!cancelled && result.ok) setSrc(result.dataUrl) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [item.path, services])

  return (
    <div>
      {src ? (
        <img src={src} alt={item.label} className="mb-1 max-h-36 w-full rounded bg-white object-contain" />
      ) : null}
      <p className="text-[11.5px] font-medium leading-4 text-ds-ink">{item.label}</p>
      {item.caption ? (
        <p className="mt-0.5 line-clamp-3 text-[11px] leading-4 text-ds-muted">{item.caption}</p>
      ) : null}
      {item.page ? (
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
          onClick={() => services?.jumpToPage(item.page ?? 1)}
        >
          <BookMarked className="h-3 w-3" strokeWidth={1.8} />
          {t('writePdfPageLabel', { page: item.page })}
        </button>
      ) : null}
    </div>
  )
}
