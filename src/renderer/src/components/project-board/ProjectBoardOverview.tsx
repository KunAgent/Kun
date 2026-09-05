import type { ReactElement } from 'react'
import { AlertCircle, CheckCircle2, ListTodo, Route } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { projectBoardOverview } from '../../project-board/project-board-selectors'
import type { ProjectBoardCard } from '../../project-board/project-board-types'

export function ProjectBoardOverview({ cards }: { cards: ProjectBoardCard[] }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const metrics = projectBoardOverview(cards)
  const values = [
    { label: t('projectBoardTotal'), value: metrics.total, icon: ListTodo },
    { label: t('projectBoardCompletionRate'), value: `${Math.round(metrics.completionRate * 100)}%`, icon: CheckCircle2 },
    { label: t('projectBoardInProgress'), value: metrics.inProgress, icon: Route },
    { label: t('projectBoardOpenP0'), value: metrics.p0Open, icon: AlertCircle }
  ]
  return (
    <div className="h-full overflow-y-auto p-6 sm:p-8">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {values.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-ds-border-muted bg-ds-card p-4 shadow-sm">
            <Icon className="h-4 w-4 text-accent" />
            <p className="mt-4 text-2xl font-semibold text-ds-ink">{value}</p>
            <p className="mt-1 text-xs text-ds-muted">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-ds-border-muted bg-ds-card p-5">
          <h2 className="text-sm font-semibold text-ds-ink">{t('projectBoardDistribution')}</h2>
          <div className="mt-4 space-y-3 text-xs text-ds-muted">
            <MetricRow label={t('projectBoardPending')} value={metrics.pending} total={metrics.total} />
            <MetricRow label={t('projectBoardInProgress')} value={metrics.inProgress} total={metrics.total} />
            <MetricRow label={t('projectBoardCompleted')} value={metrics.completed} total={metrics.total} />
            <MetricRow label={t('projectBoardPlan')} value={metrics.plan} total={metrics.total} />
            <MetricRow label={t('projectBoardManual')} value={metrics.manual} total={metrics.total} />
          </div>
        </section>
        <section className="rounded-2xl border border-ds-border-muted bg-ds-card p-5">
          <h2 className="text-sm font-semibold text-ds-ink">{t('projectBoardRecent')}</h2>
          <div className="mt-3 divide-y divide-ds-border-muted">
            {metrics.recent.map((card) => (
              <div key={card.id} className="flex items-center gap-3 py-2.5 text-xs">
                <span className="min-w-0 flex-1 truncate text-ds-ink">{card.title}</span>
                <time className="shrink-0 text-ds-faint">{new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(new Date(card.updatedAt))}</time>
              </div>
            ))}
            {metrics.recent.length === 0 ? <p className="py-8 text-center text-xs text-ds-faint">{t('projectBoardNoTasks')}</p> : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function MetricRow({ label, value, total }: { label: string; value: number; total: number }): ReactElement {
  const width = total ? `${Math.round(value / total * 100)}%` : '0%'
  return (
    <div>
      <div className="flex justify-between"><span>{label}</span><span>{value}</span></div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ds-main"><div className="h-full rounded-full bg-accent" style={{ width }} /></div>
    </div>
  )
}
