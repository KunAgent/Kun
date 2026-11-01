import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { BookOpen, MessageSquare, Sparkles, X } from 'lucide-react'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { PaperTitleText } from '../PaperTitleText'
import { PAPER_STATUS_PILL, paperByline, statusLabelKey } from './PaperLibraryTable'

type Translate = (key: string, opts?: Record<string, unknown>) => string

/** The detail panel only docks when the library has room for list + panel. */
export const PAPER_DETAIL_MIN_WIDTH = 980

export function useLibraryHasRoom(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWide((entry?.contentRect.width ?? 0) >= PAPER_DETAIL_MIN_WIDTH))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, wide]
}

function InfoRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="text-ds-faint">{label}</span>
      <span className="min-w-0 truncate text-ds-ink" title={value}>{value}</span>
    </div>
  )
}

/**
 * Right-hand paper detail: status, title and byline, the two main actions
 * (open / ask Kun to interpret), the abstract, and the paper's sessions.
 * Everything shown comes from the library entry itself.
 */
export function PaperLibraryDetailPanel({
  entry,
  sessions,
  onOpen,
  onInterpret,
  onOpenSessions,
  onClose,
  t
}: {
  entry: PaperLibraryEntry
  sessions: number
  onOpen: () => void
  onInterpret: () => void
  onOpenSessions: () => void
  onClose: () => void
  t: Translate
}): ReactElement {
  const meta = entry.meta
  const status = meta.status ?? 'unread'
  const byline = paperByline(meta)
  const abstract = meta.abstract?.trim()
  const tags = meta.tags ?? []
  return (
    <aside
      aria-label={t('paperDetailLabel')}
      data-testid="paper-detail-panel"
      className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-ds-border-muted bg-ds-subtle/60 px-5 py-5"
    >
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold ${PAPER_STATUS_PILL[status] ?? PAPER_STATUS_PILL.unread}`}>
          {t(statusLabelKey(status))}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label={t('paperDetailClose')}
          title={t('paperDetailClose')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <PaperTitleText title={meta.title} className="text-[16px] font-bold leading-snug text-ds-ink" />
        {byline ? <span className="text-[12.5px] leading-relaxed text-ds-muted">{byline}</span> : null}
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--ds-control)] text-[13px] font-medium text-[var(--ds-control-foreground)] transition hover:opacity-90"
        >
          <BookOpen className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('paperDetailOpen')}
        </button>
        <button
          type="button"
          onClick={onInterpret}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent/10 text-[13px] font-semibold text-accent transition hover:bg-accent/15"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('paperDetailInterpret')}
        </button>
      </div>
      <section className="flex flex-col gap-1.5 rounded-[14px] bg-ds-main px-3.5 py-3 shadow-[0_0_0_1px_var(--ds-border-muted)]">
        <span className="text-[12px] font-semibold text-ds-faint">{t('writePaperMetaAbstract')}</span>
        <p className="line-clamp-[9] text-[13px] leading-[1.7] text-ds-ink">
          {abstract || <span className="text-ds-faint">{t('mobileWorkPaperNoAbstract')}</span>}
        </p>
      </section>
      <section className="flex flex-col gap-1">
        <span className="px-0.5 pb-0.5 text-[12px] font-semibold text-ds-faint">{t('paperDetailSessions')}</span>
        {sessions > 0 ? (
          <button
            type="button"
            onClick={onOpenSessions}
            className="flex h-9 items-center gap-2 rounded-[10px] px-2 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover"
          >
            <span className="grid h-[18px] w-[18px] place-items-center rounded-[6px] bg-accent/15 text-[10px] font-extrabold text-accent">K</span>
            <span className="min-w-0 flex-1 truncate">{t('paperRowSessions', { count: sessions })}</span>
            <MessageSquare className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
          </button>
        ) : (
          <span className="px-2 text-[12.5px] text-ds-faint">{t('paperDetailNoSessions')}</span>
        )}
      </section>
      <section className="flex flex-col gap-2 border-t border-ds-border-muted pt-3">
        <InfoRow label={t('paperDetailInterpretations')} value={String(entry.interpretationCount)} />
        <InfoRow label={t('paperDetailNotes')} value={entry.hasNotes ? t('paperDetailNotesYes') : t('paperDetailNotesNo')} />
        {entry.group ? <InfoRow label={t('paperDetailFolder')} value={entry.group} /> : null}
        {tags.length ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {tags.map((tag) => (
              <span key={tag} className="h-[22px] rounded-full bg-ds-hover px-2 text-[11.5px] leading-[22px] text-ds-muted">{tag}</span>
            ))}
          </div>
        ) : null}
      </section>
    </aside>
  )
}
