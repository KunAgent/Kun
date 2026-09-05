import type { ReactElement } from 'react'
import { Filter, Search, SlidersHorizontal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  PROJECT_BOARD_CATEGORIES,
  type ProjectBoardCategory,
  type ProjectBoardFilters
} from '../../project-board/project-board-types'

type Props = {
  query: string
  filters: ProjectBoardFilters
  resultCount: number
  onQuery: (query: string) => void
  onFilters: (filters: ProjectBoardFilters) => void
}

export function ProjectBoardToolbar(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const filtered = props.filters.priorities.length + props.filters.sources.length +
    props.filters.categories.length + (props.filters.showCompleted ? 0 : 1)
  return (
    <div className="ds-no-drag flex w-14 shrink-0 flex-col items-center gap-2 rounded-2xl border border-ds-border-muted bg-ds-card p-2 shadow-sm">
      <label className="group relative">
        <Search className="h-4 w-4 text-ds-muted" />
        <input
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          aria-label={t('projectBoardSearchTasks')}
          className="absolute left-8 top-[-9px] z-20 h-9 w-52 rounded-xl border border-ds-border-muted bg-ds-card px-3 text-xs text-ds-ink opacity-0 shadow-lg outline-none pointer-events-none focus:opacity-100 focus:pointer-events-auto"
        />
      </label>
      <details className="relative">
        <summary className="relative list-none cursor-pointer rounded-lg p-1.5 text-ds-muted hover:bg-ds-main hover:text-ds-ink" aria-label={t('projectBoardFilters')}>
          <Filter className="h-4 w-4" />
          {filtered ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" /> : null}
        </summary>
        <div className="absolute left-8 top-[-8px] z-20 w-60 space-y-3 rounded-xl border border-ds-border-muted bg-ds-card p-3 text-xs text-ds-ink shadow-xl">
          <label className="flex items-center justify-between gap-3">
            {t('projectBoardShowCompleted')}
            <input
              type="checkbox"
              checked={props.filters.showCompleted}
              onChange={(event) => props.onFilters({ ...props.filters, showCompleted: event.target.checked })}
            />
          </label>
          <div>
            <p className="mb-1.5 font-medium">{t('projectBoardCategory')}</p>
            <select
              value={props.filters.categories[0] ?? ''}
              onChange={(event) => props.onFilters({
                ...props.filters,
                categories: event.target.value ? [event.target.value as ProjectBoardCategory] : []
              })}
              className="h-8 w-full rounded-lg border border-ds-border-muted bg-ds-main px-2 text-xs text-ds-ink"
            >
              <option value="">{t('projectBoardNone')}</option>
              {PROJECT_BOARD_CATEGORIES.map((category) => (
                <option key={category} value={category}>{t(`projectBoardCategory_${category}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1.5 font-medium">{t('projectBoardPriority')}</p>
            <div className="flex flex-wrap gap-1">
              {(['P0', 'P1', 'P2', 'none'] as const).map((priority) => (
                <button
                  key={priority}
                  type="button"
                  onClick={() => props.onFilters({
                    ...props.filters,
                    priorities: toggle(props.filters.priorities, priority)
                  })}
                  className={`rounded-md border px-2 py-1 ${props.filters.priorities.includes(priority) ? 'border-accent bg-accent/10 text-accent' : 'border-ds-border-muted'}`}
                >
                  {priority === 'none' ? t('projectBoardNone') : priority}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 font-medium">{t('projectBoardSource')}</p>
            <div className="flex gap-1">
              {(['manual', 'plan'] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => props.onFilters({
                    ...props.filters,
                    sources: toggle(props.filters.sources, source)
                  })}
                  className={`rounded-md border px-2 py-1 ${props.filters.sources.includes(source) ? 'border-accent bg-accent/10 text-accent' : 'border-ds-border-muted'}`}
                >
                  {t(source === 'manual' ? 'projectBoardManual' : 'projectBoardPlan')}
                </button>
              ))}
            </div>
          </div>
          {filtered ? (
            <button
              type="button"
              onClick={() => props.onFilters({ categories: [], priorities: [], sources: [], showCompleted: true })}
              className="flex items-center gap-1 text-ds-muted hover:text-ds-ink"
            >
              <X className="h-3 w-3" /> {t('projectBoardClearFilters')}
            </button>
          ) : null}
        </div>
      </details>
      <div className="h-px w-6 bg-ds-border-muted" />
      <SlidersHorizontal className="h-4 w-4 text-ds-faint" />
      <span className="text-[10px] tabular-nums text-ds-faint">{props.resultCount}</span>
    </div>
  )
}

function toggle<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items.filter((candidate) => candidate !== item) : [...items, item]
}
