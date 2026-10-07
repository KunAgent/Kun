import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { CalendarRange, Check, ChevronDown, Gauge, Library } from 'lucide-react'
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

function ScopeChip({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        ref={trigger}
        aria-haspopup="dialog"
        data-paper-scope-trigger
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border border-ds-border-muted px-2 text-[12px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          open ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
        }`}
      >
        <span className="text-ds-faint">{icon}</span>
        {label}
        <ChevronDown className="h-3 w-3 text-ds-faint" strokeWidth={2} />
      </button>
      {open ? (
        <div data-paper-scope-menu role="dialog" aria-label={label} className="absolute left-0 top-8 z-30 min-w-[220px] rounded-lg border border-ds-border bg-ds-elevated p-1.5 shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  )
}

function yearsLabel(scope: PaperResearchScope, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!scope.yearFrom && !scope.yearTo) return t('paperResearchYearsAny')
  return `${scope.yearFrom || '…'}–${scope.yearTo || '…'}`
}

/**
 * Scope row above the research composer (mirrors the Code home chips):
 * depth, sources and year range, each in a small popover.
 */
export function PaperResearchScopeChips({
  scope,
  onChange,
  showDepth = true
}: {
  scope: PaperResearchScope
  onChange: (next: PaperResearchScope) => void
  showDepth?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const sourcesLabel = scope.sources.length <= 2
    ? scope.sources.map((source) => t(`writePaperSearchSource_${source}`)).join(', ')
    : t('paperResearchSourcesCount', { count: scope.sources.length })
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showDepth ? <ScopeChip icon={<Gauge className="h-3.5 w-3.5" strokeWidth={1.8} />} label={t(`paperResearchDepth_${scope.depth}`)}>
        {DEPTHS.map((depth) => (
          <button
            key={depth}
            type="button"
            onClick={() => onChange({ ...scope, depth })}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ds-hover"
          >
            <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${scope.depth === depth ? 'text-[var(--ds-accent)]' : 'invisible'}`} />
            <span>
              <span className="block text-[12.5px] text-ds-ink">{t(`paperResearchDepth_${depth}`)}</span>
              <span className="block text-[11px] text-ds-faint">{t(`paperResearchDepthHint_${depth}`)}</span>
            </span>
          </button>
        ))}
      </ScopeChip> : null}
      <ScopeChip icon={<Library className="h-3.5 w-3.5" strokeWidth={1.8} />} label={sourcesLabel}>
        <div className="grid max-h-[300px] grid-cols-2 gap-0.5 overflow-y-auto">
          {PAPER_SEARCH_SOURCES.map((source) => {
            const active = scope.sources.includes(source)
            return (
              <button
                key={source}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ ...scope, sources: toggleSearchSource(scope.sources, source) })}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] hover:bg-ds-hover"
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-[var(--ds-accent)]' : 'invisible'}`} />
                <span className={active ? 'text-ds-ink' : 'text-ds-muted'}>{t(`writePaperSearchSource_${source}`)}</span>
              </button>
            )
          })}
        </div>
      </ScopeChip>
      <ScopeChip icon={<CalendarRange className="h-3.5 w-3.5" strokeWidth={1.8} />} label={yearsLabel(scope, t)}>
        <div className="flex items-center gap-1.5 px-1 py-1 text-[12px] text-ds-faint">
          {(['yearFrom', 'yearTo'] as const).map((key, index) => (
            <span key={key} className="flex items-center gap-1.5">
              {index ? <span>–</span> : null}
              <input
                value={scope[key]}
                onChange={(event) => onChange({ ...scope, [key]: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                placeholder={t(key === 'yearFrom' ? 'writePaperSearchYearFrom' : 'writePaperSearchYearTo')}
                aria-label={t(key === 'yearFrom' ? 'writePaperSearchYearFrom' : 'writePaperSearchYearTo')}
                inputMode="numeric"
                className="h-7 w-20 rounded-md border border-ds-border-muted bg-ds-main px-2 text-center tabular-nums text-ds-ink outline-none focus:border-[var(--ds-accent)]"
              />
            </span>
          ))}
        </div>
      </ScopeChip>
    </div>
  )
}
