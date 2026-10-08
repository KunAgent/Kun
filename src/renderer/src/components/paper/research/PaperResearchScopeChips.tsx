import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PAPER_SEARCH_SOURCES, type PaperSearchSource } from '@shared/paper/paper-search'
import type { PaperResearchDepth } from '../../../paper/paper-research-actions'
import { toggleSearchSource } from '../../../paper/paper-search-prefs'

export type PaperResearchScope = {
  depth: PaperResearchDepth
  sources: PaperSearchSource[]
  yearFrom: string
  yearTo: string
}

const DEPTHS: PaperResearchDepth[] = ['quick', 'standard', 'deep']
const COMMON_SOURCES: PaperSearchSource[] = ['arxiv', 'openalex', 'venues', 'semantic_scholar']
const RECENT_YEARS = [1, 3] as const

type Translate = (key: string, options?: Record<string, unknown>) => string

function yearsLabel(scope: PaperResearchScope, t: Translate): string {
  if (!scope.yearFrom && !scope.yearTo) return t('paperResearchYearsAny')
  if (scope.yearFrom && !scope.yearTo) return t('paperScopeYearsSince', { year: scope.yearFrom })
  return `${scope.yearFrom || '…'}–${scope.yearTo || '…'}`
}

/** One-line summary shown on the pill: depth · sources · years. */
export function paperScopeSummary(scope: PaperResearchScope, showDepth: boolean, t: Translate): string {
  const sources = t('paperResearchSourcesCount', { count: scope.sources.length })
  return [showDepth ? t(`paperResearchDepth_${scope.depth}`) : '', sources, yearsLabel(scope, t)].filter(Boolean).join(' · ')
}

function Section({ label, children }: { label: string; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="w-10 shrink-0 pt-[5px] text-[12px] text-ds-faint">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * The single scope control of a search composer: one pill that summarizes
 * depth, sources and years, and opens a small settings panel. Replaces the
 * row of separate chips.
 */
export function PaperScopePill({
  scope,
  onChange,
  showDepth = true,
  placement = 'below'
}: {
  scope: PaperResearchScope
  onChange: (next: PaperResearchScope) => void
  showDepth?: boolean
  /** Which side of the pill the panel opens on. */
  placement?: 'below' | 'above'
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [moreSources, setMoreSources] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const sources = moreSources ? PAPER_SEARCH_SOURCES : COMMON_SOURCES.filter((source) => PAPER_SEARCH_SOURCES.includes(source))
  const setRecent = (years: number): void => {
    onChange({ ...scope, yearFrom: String(new Date().getFullYear() - years + 1), yearTo: '' })
  }
  const chip = (on: boolean): string =>
    `h-[26px] rounded-full border px-2.5 text-[12px] transition ${
      on
        ? 'border-[var(--ds-accent)]/35 bg-[var(--ds-accent-soft)] font-medium text-[var(--ds-accent)]'
        : 'border-ds-border-muted bg-ds-main text-ds-muted hover:text-ds-ink'
    }`

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-paper-scope-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-[30px] max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          open ? 'border-[var(--ds-accent)]/40 bg-[var(--ds-accent-soft)] text-ds-ink' : 'border-ds-border-muted bg-ds-subtle/60 text-ds-muted hover:text-ds-ink'
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
        <span className="min-w-0 truncate">{paperScopeSummary(scope, showDepth, t)}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
      </button>
      {open ? (
        <div
          data-paper-scope-menu
          role="dialog"
          aria-label={t('paperScopeTitle')}
          className={`absolute left-0 z-40 w-[380px] max-w-[calc(100vw-48px)] rounded-2xl border border-ds-border bg-ds-elevated px-4 py-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] ${
            placement === 'above' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'
          }`}
        >
          {showDepth ? (
            <Section label={t('paperScopeDepth')}>
              <div role="radiogroup" aria-label={t('paperScopeDepth')} className="inline-flex rounded-lg bg-ds-subtle p-0.5">
                {DEPTHS.map((depth) => (
                  <button
                    key={depth}
                    type="button"
                    role="radio"
                    aria-checked={scope.depth === depth}
                    onClick={() => onChange({ ...scope, depth })}
                    className={`h-6 rounded-md px-3 text-[12px] transition ${
                      scope.depth === depth ? 'bg-ds-main font-semibold text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
                    }`}
                  >
                    {t(`paperResearchDepth_${depth}`)}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px] text-ds-faint">{t(`paperResearchDepthHint_${scope.depth}`)}</p>
            </Section>
          ) : null}
          <div className={showDepth ? 'border-t border-ds-border-muted/70' : ''}>
            <Section label={t('paperScopeSources')}>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((source) => {
                  const on = scope.sources.includes(source)
                  return (
                    <button
                      key={source}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChange({ ...scope, sources: toggleSearchSource(scope.sources, source) })}
                      className={chip(on)}
                    >
                      {t(`writePaperSearchSource_${source}`)}
                    </button>
                  )
                })}
                {PAPER_SEARCH_SOURCES.length > COMMON_SOURCES.length ? (
                  <button
                    type="button"
                    onClick={() => setMoreSources((value) => !value)}
                    className="h-[26px] rounded-full px-2 text-[12px] text-ds-muted transition hover:text-ds-ink"
                  >
                    {moreSources ? t('paperScopeFewer') : t('paperScopeMore', { count: PAPER_SEARCH_SOURCES.length - COMMON_SOURCES.length })}
                  </button>
                ) : null}
              </div>
              <p className="mt-1.5 text-[11.5px] text-ds-faint">{t('paperScopeSourcesHint')}</p>
            </Section>
          </div>
          <div className="border-t border-ds-border-muted/70">
            <Section label={t('paperScopeYears')}>
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ds-faint">
                {(['yearFrom', 'yearTo'] as const).map((key, position) => (
                  <span key={key} className="flex items-center gap-1.5">
                    {position ? <span>–</span> : null}
                    <input
                      value={scope[key]}
                      onChange={(event) => onChange({ ...scope, [key]: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                      placeholder={t(key === 'yearFrom' ? 'writePaperSearchYearFrom' : 'writePaperSearchYearTo')}
                      aria-label={t(key === 'yearFrom' ? 'writePaperSearchYearFrom' : 'writePaperSearchYearTo')}
                      inputMode="numeric"
                      className="h-[26px] w-[50px] rounded-md border border-ds-border-muted bg-ds-main px-1 text-center tabular-nums text-ds-ink outline-none focus-visible:outline-none focus:border-[var(--ds-accent)]"
                    />
                  </span>
                ))}
                <span className="flex-1" />
                {RECENT_YEARS.map((years) => (
                  <button key={years} type="button" onClick={() => setRecent(years)} className="h-6 rounded-md px-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
                    {t('paperScopeRecentYears', { count: years })}
                  </button>
                ))}
                <button type="button" onClick={() => onChange({ ...scope, yearFrom: '', yearTo: '' })} className="h-6 rounded-md px-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
                  {t('paperScopeAnyYear')}
                </button>
              </div>
            </Section>
          </div>
        </div>
      ) : null}
    </div>
  )
}
