import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { DailyUsageBucket } from '../../hooks/use-daily-usage'
import { formatCompactNumber, formatCost } from '../../hooks/use-thread-usage'
import { usageHeatmapIntensityLevel, usageHasBucketActivity } from '../chat/initial-session-usage-support'

export type UsageHistoryMetric = {
  label: string
  value: string
  detail?: string
  detailTitle?: string
  accent?: boolean
}

type HeatmapMode = 'tokens' | 'cost'
type ContributionWeek = { key: string; cells: Array<DailyUsageBucket | null> }

const MIN_HEATMAP_WEEKS = 12
const MAX_HEATMAP_WEEKS = 52
const CELL_SIZE = 13
const CELL_GAP = 4
const WEEKDAY_COLUMN_WIDTH = 30
const WEEKDAY_LABEL_ROWS = new Set([0, 2, 4, 6])
// 2026-08-31 is a Monday; weekday labels come from Intl so they localize.
const REFERENCE_MONDAY = '2026-08-31T00:00:00.000Z'
const HEATMAP_CLASSES = [
  'bg-[#eef2f7] dark:bg-[#202020]',
  'bg-[#cce9ff] dark:bg-[#173653]',
  'bg-[#80c9ff] dark:bg-[#185987]',
  'bg-[#2da9f7] dark:bg-[#147eb9]',
  'bg-[#0066cc] dark:bg-[#339cff]'
]

export function SidebarUsageHistoryCard({
  buckets,
  error,
  hasUsage,
  loading,
  metrics,
  onVisibleWeeksChange
}: {
  buckets: DailyUsageBucket[]
  error: string | null
  hasUsage: boolean
  loading: boolean
  metrics: UsageHistoryMetric[]
  onVisibleWeeksChange?: (weeks: number) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [mode, setMode] = useState<HeatmapMode>('tokens')
  const cardRef = useRef<HTMLElement>(null)
  const [visibleWeeks, setVisibleWeeks] = useState(MIN_HEATMAP_WEEKS)

  useEffect(() => {
    const card = cardRef.current
    if (!card || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setVisibleWeeks(heatmapWeeksForWidth(entry.contentRect.width))
    })
    observer.observe(card)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    onVisibleWeeksChange?.(visibleWeeks)
  }, [onVisibleWeeksChange, visibleWeeks])

  const rangeLabel = t('usageQuotaRangeWeeks', {
    count: visibleWeeks,
    defaultValue: `Last ${visibleWeeks} weeks`
  })

  return (
    <section
      ref={cardRef}
      aria-label={t('usageQuotaHistory')}
      className="overflow-hidden rounded-[16px] border border-ds-border-muted bg-ds-card shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-4 pt-4">
        <div>
          <h3 className="text-[15px] font-semibold leading-5 text-ds-ink">
            {t('usageQuotaHistory')}
          </h3>
          <p className="mt-1 text-[10.5px] text-ds-faint">
            {t('usageQuotaHistoryRange', { range: rangeLabel })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex rounded-lg border border-ds-border-muted bg-ds-surface-subtle/60 p-0.5 text-[10.5px] font-medium text-ds-muted">
            {(['tokens', 'cost'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                className={`min-h-7 rounded-md px-2.5 transition-colors ${
                  mode === value
                    ? 'bg-accent/10 text-accent shadow-sm dark:bg-accent/20'
                    : 'hover:text-ds-ink'
                }`}
                onClick={() => setMode(value)}
              >
                {t(value === 'tokens' ? 'usageQuotaMetricTokens' : 'usageQuotaMetricCost')}
              </button>
            ))}
          </div>
          <span className="inline-flex min-h-7 items-center rounded-lg border border-ds-border-muted px-2.5 text-[10.5px] font-medium text-ds-muted">
            {rangeLabel}
          </span>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          title={error}
          className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] leading-4 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-200"
        >
          <span aria-hidden>!</span>
          <span>{t(hasUsage ? 'usageQuotaCachedRefreshFailed' : 'usageQuotaInitialLoadFailed')}</span>
        </div>
      ) : null}

      {loading && !hasUsage ? (
        <div className="mx-4 mb-4 flex min-h-44 items-center justify-center gap-2 text-[11px] text-ds-faint">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ds-border border-t-accent" aria-hidden />
          {t('usageHeatmapLoading')}
        </div>
      ) : hasUsage ? (
        <>
          <HistoryMetricStrip metrics={metrics} />
          <ContributionHeatmap buckets={buckets} mode={mode} visibleWeeks={visibleWeeks} />
        </>
      ) : (
        <p className="mx-4 mb-4 rounded-xl bg-ds-surface-subtle px-3 py-8 text-center text-[11px] leading-5 text-ds-faint">
          {t('usageQuotaNoUsage')}
        </p>
      )}
    </section>
  )
}

function HistoryMetricStrip({ metrics }: { metrics: UsageHistoryMetric[] }): ReactElement {
  return (
    <dl className="grid grid-cols-2 border-b border-ds-border-muted sm:grid-cols-4">
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={[
            'min-w-0 px-4 py-3',
            index % 2 === 1 ? 'border-l border-ds-border-muted' : '',
            index >= 2 ? 'border-t border-ds-border-muted sm:border-t-0' : '',
            index > 0 ? 'sm:border-l sm:border-ds-border-muted' : ''
          ].join(' ')}
        >
          <dt className="truncate text-[10.5px] leading-4 text-ds-faint" title={metric.label}>
            {metric.label}
          </dt>
          <dd
            className="mt-1 truncate text-[18px] font-semibold leading-6 tabular-nums text-ds-ink"
            title={metric.value}
          >
            {metric.value}
          </dd>
          {metric.detail ? (
            <p className="mt-1 line-clamp-2 text-[9px] leading-3.5 text-ds-muted" title={metric.detailTitle}>
              {metric.detail}
            </p>
          ) : null}
        </div>
      ))}
    </dl>
  )
}

function ContributionHeatmap({
  buckets,
  mode,
  visibleWeeks
}: {
  buckets: DailyUsageBucket[]
  mode: HeatmapMode
  visibleWeeks: number
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [selected, setSelected] = useState<DailyUsageBucket | null>(null)
  const weeks = useMemo(() => buildContributionWeeks(buckets, visibleWeeks), [buckets, visibleWeeks])
  const visibleBuckets = useMemo(
    () => weeks.flatMap((week) => week.cells).filter((cell): cell is DailyUsageBucket => Boolean(cell)),
    [weeks]
  )
  const values = useMemo(
    () => visibleBuckets.map((bucket) => heatmapValue(bucket, mode)).filter((value) => value > 0),
    [mode, visibleBuckets]
  )
  const monthMarkers = useMemo(() => buildMonthMarkers(weeks, i18n.language), [i18n.language, weeks])
  const summary = useMemo(
    () => usageSummary(visibleBuckets, mode, i18n.language),
    [i18n.language, mode, visibleBuckets]
  )

  const selectBucket = (bucket: DailyUsageBucket): void => {
    setSelected((current) => (current?.date === bucket.date ? null : bucket))
  }

  return (
    <div className="px-4 pb-4 pt-4" data-usage-contribution-heatmap>
      <div className="mx-auto w-max">
        <div
          className="relative mb-1.5 h-3.5 text-[10px] leading-3.5 text-ds-faint"
          style={{ marginLeft: WEEKDAY_COLUMN_WIDTH + 8 }}
          aria-hidden
        >
          {monthMarkers.map((marker) => (
            <span
              key={`${marker.index}-${marker.label}`}
              className="absolute whitespace-nowrap"
              style={{ left: marker.index * (CELL_SIZE + CELL_GAP) }}
            >
              {marker.label}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <div
            className="grid shrink-0 grid-rows-7 text-[10px] leading-none text-ds-faint"
            style={{ rowGap: CELL_GAP, width: WEEKDAY_COLUMN_WIDTH }}
            aria-hidden
          >
            {[0, 1, 2, 3, 4, 5, 6].map((row) => (
              <span key={row} className="flex items-center" style={{ height: CELL_SIZE }}>
                {WEEKDAY_LABEL_ROWS.has(row) ? weekdayLabel(i18n.language, row) : ''}
              </span>
            ))}
          </div>
          <div
            role="grid"
            aria-label={t('usageHeatmapGridLabel')}
            className="grid shrink-0"
            style={{ gridTemplateColumns: `repeat(${visibleWeeks}, ${CELL_SIZE}px)`, columnGap: CELL_GAP }}
          >
            {weeks.map((week) => (
              <span key={week.key} role="row" className="grid grid-rows-7" style={{ rowGap: CELL_GAP }}>
                {week.cells.map((bucket, index) => bucket ? (
                  <button
                    key={bucket.date}
                    type="button"
                    role="gridcell"
                    title={tooltipText(bucket, mode, i18n.language)}
                    aria-label={tooltipText(bucket, mode, i18n.language)}
                    aria-pressed={selected?.date === bucket.date}
                    onClick={() => selectBucket(bucket)}
                    className={`rounded-[3px] transition-[box-shadow] hover:ring-2 hover:ring-ds-ink/30 focus:outline-none focus:ring-2 focus:ring-accent dark:hover:ring-white/40 ${HEATMAP_CLASSES[usageHeatmapIntensityLevel(
                      { totalTokens: heatmapValue(bucket, mode), turns: bucket.turns },
                      values
                    )]} ${
                      selected?.date === bucket.date
                        ? 'ring-2 ring-ds-ink ring-offset-1 ring-offset-ds-card dark:ring-white dark:ring-offset-ds-bg'
                        : ''
                    }`}
                    style={{ width: CELL_SIZE, height: CELL_SIZE }}
                  />
                ) : (
                  <span key={`${week.key}-${index}`} style={{ width: CELL_SIZE, height: CELL_SIZE }} aria-hidden />
                ))}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] text-ds-faint">
            {t(mode === 'tokens' ? 'usageQuotaDailyTokens' : 'usageQuotaDailyCost')}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ds-faint">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span>{t('usageQuotaCurrentStreak', { count: summary.currentStreak })}</span>
            <span aria-hidden>·</span>
            <span>{t('usageQuotaMostActiveWeekday', { weekday: summary.mostActiveWeekday })}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-ds-faint">
          <span>{t('usageHeatmapLess')}</span>
          <span className="flex items-center gap-1" aria-hidden>
            {HEATMAP_CLASSES.map((className, index) => (
              <span key={index} className={`h-3 w-3 rounded-[3px] ${className}`} />
            ))}
          </span>
          <span>{t('usageHeatmapMore')}</span>
        </div>
      </div>

    </div>
  )
}

export function heatmapWeeksForWidth(width: number): number {
  const horizontalPadding = 32
  const labelAndGap = WEEKDAY_COLUMN_WIDTH + 8
  const usableWidth = Math.max(0, width - horizontalPadding - labelAndGap)
  const count = Math.floor((usableWidth + CELL_GAP) / (CELL_SIZE + CELL_GAP))
  return Math.max(MIN_HEATMAP_WEEKS, Math.min(MAX_HEATMAP_WEEKS, count))
}

export function buildContributionWeeks(
  buckets: DailyUsageBucket[],
  weekCount = MIN_HEATMAP_WEEKS
): ContributionWeek[] {
  const safeWeekCount = Math.max(MIN_HEATMAP_WEEKS, Math.min(MAX_HEATMAP_WEEKS, Math.round(weekCount)))
  const heatmapCells = safeWeekCount * 7
  const sorted = [...buckets].sort((left, right) => left.date.localeCompare(right.date)).slice(-heatmapCells)
  if (sorted.length === 0) return emptyWeeks(safeWeekCount)
  const first = new Date(`${sorted[0].date}T00:00:00.000Z`)
  const mondayOffset = Number.isNaN(first.getTime()) ? 0 : (first.getUTCDay() + 6) % 7
  const cells: Array<DailyUsageBucket | null> = [
    ...Array.from({ length: mondayOffset }, () => null),
    ...sorted
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: ContributionWeek[] = []
  for (let index = 0; index < cells.length; index += 7) {
    const weekCells = cells.slice(index, index + 7)
    weeks.push({ key: weekCells.find(Boolean)?.date ?? `blank-${index}`, cells: weekCells })
  }
  const visible = weeks.slice(-safeWeekCount)
  while (visible.length < safeWeekCount) {
    visible.unshift({ key: `empty-${visible.length}`, cells: Array.from({ length: 7 }, () => null) })
  }
  return visible
}

function emptyWeeks(weekCount: number): ContributionWeek[] {
  return Array.from({ length: weekCount }, (_, index) => ({
    key: `empty-${index}`,
    cells: Array.from({ length: 7 }, () => null)
  }))
}

function heatmapValue(bucket: DailyUsageBucket, mode: HeatmapMode): number {
  if (mode === 'tokens') return bucket.totalTokens
  return bucket.costCny ?? bucket.costUsd
}

function buildMonthMarkers(
  weeks: ContributionWeek[],
  locale: string
): Array<{ index: number; label: string }> {
  const markers: Array<{ index: number; label: string }> = []
  let previousMonth = -1
  weeks.forEach((week, index) => {
    const monthStart = week.cells.find((cell) => cell?.date.endsWith('-01'))
    const firstCell = week.cells.find((cell): cell is DailyUsageBucket => Boolean(cell))
    const labelCell = monthStart ?? (index === 0 ? firstCell : undefined)
    if (!labelCell) return
    const date = new Date(`${labelCell.date}T00:00:00.000Z`)
    if (Number.isNaN(date.getTime())) return
    const month = date.getUTCMonth()
    if (month === previousMonth) return
    previousMonth = month
    markers.push({
      index,
      label: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date)
    })
  })
  return markers
}

function weekdayLabel(locale: string, mondayIndex: number): string {
  const date = new Date(REFERENCE_MONDAY)
  date.setUTCDate(date.getUTCDate() + mondayIndex)
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date)
}

function tooltipText(bucket: DailyUsageBucket, mode: HeatmapMode, locale: string): string {
  const date = new Date(`${bucket.date}T00:00:00.000Z`)
  const dateLabel = Number.isNaN(date.getTime())
    ? bucket.date
    : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
  const value = mode === 'tokens'
    ? `${formatCompactNumber(bucket.totalTokens)} Tokens`
    : formatCost(bucket.costUsd, locale, bucket.costCny)
  return `${dateLabel} · ${value}`
}

function usageSummary(
  buckets: DailyUsageBucket[],
  mode: HeatmapMode,
  locale: string
): { currentStreak: number; mostActiveWeekday: string } {
  const sorted = [...buckets].sort((left, right) => left.date.localeCompare(right.date))
  let currentStreak = 0
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (!usageHasBucketActivity(sorted[index])) break
    currentStreak += 1
  }
  const weekdayTotals = Array.from({ length: 7 }, () => 0)
  for (const bucket of sorted) {
    const date = new Date(`${bucket.date}T00:00:00.000Z`)
    if (Number.isNaN(date.getTime())) continue
    weekdayTotals[(date.getUTCDay() + 6) % 7] += heatmapValue(bucket, mode)
  }
  const max = Math.max(...weekdayTotals)
  return {
    currentStreak,
    mostActiveWeekday: weekdayLabel(locale, max > 0 ? weekdayTotals.indexOf(max) : 0)
  }
}
