import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { missionFiltered, type MissionFilters } from './mission-filters'

export type MissionToolbarProps = {
  filters: MissionFilters
  projects: string[]
  harnesses: string[]
  /** Present verdict statuses across loaded card data. */
  verdicts: string[]
  resultCount: number
  onChange: (next: MissionFilters) => void
}

const VERDICT_OPTIONS = ['passed', 'needs_changes', 'rejected', 'waived', 'pending']

/**
 * Mission Control toolbar (docs/ade/12 §5.2): free-text search over
 * title/project/agent plus project, harness, and verdict filters, and the
 * board setting that reveals the idle column. Counts only show once any
 * filter is active.
 */
export function MissionToolbar({
  filters,
  projects,
  harnesses,
  verdicts,
  resultCount,
  onChange
}: MissionToolbarProps): ReactElement {
  const { t } = useTranslation('common')
  const patch = (partial: Partial<MissionFilters>): void =>
    onChange({ ...filters, ...partial })
  const active = missionFiltered(filters)

  const select = (
    value: string,
    options: string[],
    label: string,
    key: 'project' | 'harness' | 'verdict',
    labelOf?: (value: string) => string
  ): ReactElement => (
    <select
      value={value}
      aria-label={label}
      data-mission-filter={key}
      onChange={(e) => patch({ [key]: e.target.value })}
      className="h-7 max-w-40 rounded-md border border-ds-border-muted bg-ds-card px-1.5 text-[11.5px] text-ds-muted outline-none"
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {labelOf?.(option) ?? option}
        </option>
      ))}
    </select>
  )

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2" data-mission-toolbar>
      <div className="flex h-7 min-w-48 flex-1 items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-card px-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} aria-hidden />
        <input
          value={filters.search}
          onChange={(e) => patch({ search: e.target.value })}
          placeholder={t('missionSearch')}
          aria-label={t('missionSearch')}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none placeholder:text-ds-faint"
        />
      </div>
      {select(filters.project, projects, t('missionFilterProject'), 'project')}
      {select(filters.harness, harnesses, t('missionFilterAgent'), 'harness')}
      {select(
        filters.verdict,
        VERDICT_OPTIONS.filter((v) => verdicts.includes(v)),
        t('missionFilterVerdict'),
        'verdict',
        (v) => t(`missionVerdict_${v}`)
      )}
      <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-ds-border-muted px-2 text-[11.5px] text-ds-muted">
        <input
          type="checkbox"
          checked={filters.showIdle}
          onChange={(e) => patch({ showIdle: e.target.checked })}
          className="h-3 w-3 accent-[var(--ds-accent)]"
        />
        {t('missionShowIdle')}
      </label>
      {active ? (
        <>
          <span className="text-[11px] text-ds-faint">
            {t('missionResultCount', { count: resultCount })}
          </span>
          <button
            type="button"
            onClick={() => onChange({ ...filters, ...EMPTY_PATCH })}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-ds-muted hover:bg-ds-subtle"
          >
            <X className="h-3 w-3" strokeWidth={2} aria-hidden />
            {t('missionClearFilters')}
          </button>
        </>
      ) : null}
    </div>
  )
}

const EMPTY_PATCH = { search: '', project: '', harness: '', verdict: '' } as const
