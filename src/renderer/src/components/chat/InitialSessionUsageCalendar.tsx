import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DailyUsageBucket } from '../../hooks/use-daily-usage'
import { formatCompactNumber, formatCost, formatPercent } from '../../hooks/use-thread-usage'
import {
  USAGE_HEATMAP_GRID_DAYS,
  USAGE_HEATMAP_INTENSITY_CLASSES,
  USAGE_HEATMAP_PREVIEW_CELLS,
  buildUsageCalendarWeeks,
  dailySummary,
  usageHeatmapIntensityLevel,
  type UsageViewMode
} from './initial-session-usage-support'

export function HeatmapGrid({
  buckets,
  loading,
  selected,
  onSelect
}: {
  buckets: DailyUsageBucket[]
  loading: boolean
  selected: DailyUsageBucket | null
  onSelect: (bucket: DailyUsageBucket) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(760)
  const [tooltip, setTooltip] = useState<{
    bucket: DailyUsageBucket
    left: number
    top: number
  } | null>(null)
  const weeks = useMemo(() => buildUsageCalendarWeeks(buckets), [buckets])
  const useTurns = !buckets.some((bucket) => bucket.totalTokens > 0)
  const positiveMetrics = useMemo(
    () => buckets
      .map((bucket) => useTurns ? bucket.turns : bucket.totalTokens)
      .filter((value) => value > 0),
    [buckets, useTurns]
  )
  const skeletonWeeks = Array.from({ length: Math.ceil(USAGE_HEATMAP_GRID_DAYS / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => week * 7 + day)
  )
  const weekCount = loading ? skeletonWeeks.length : Math.max(weeks.length, 1)
  const cellSize = Math.max(10, Math.min(14, Math.floor((containerWidth - 32 - (weekCount - 1) * 3) / weekCount)))
  const gridWidth = weekCount * cellSize + (weekCount - 1) * 3
  const monthLabels = weeks.map((week, index) => {
    const bucket = week.cells.find((cell) => cell?.date.endsWith('-01'))
      ?? (index === 0 ? week.cells.find((cell) => cell) : undefined)
    if (!bucket) return ''
    const parsed = new Date(`${bucket.date}T00:00:00.000Z`)
    return Number.isNaN(parsed.getTime())
      ? ''
      : new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' }).format(parsed)
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width > 0) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const showTooltip = (bucket: DailyUsageBucket, element: HTMLElement): void => {
    onSelect(bucket)
    const rect = element.getBoundingClientRect()
    const width = 240
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8))
    const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 174))
    setTooltip({ bucket, left, top })
  }

  return (
    <div ref={containerRef} className="w-full min-w-0">
      <div className="max-w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div className="min-w-max">
          <div className="mb-1 grid pl-[28px] text-[10px] text-ds-faint" style={{
            gridTemplateColumns: `repeat(${weekCount}, ${cellSize}px)`,
            gap: '3px'
          }}>
            {(loading ? Array.from({ length: weekCount }, () => '') : monthLabels).map((label, index) => (
              <span key={`month-${index}`} className="h-4 whitespace-nowrap">{label}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <div
              className="grid shrink-0 grid-rows-7 text-[9px] leading-none text-ds-faint"
              style={{ rowGap: '3px' }}
              aria-hidden
            >
              {['', t('usageHeatmapWeekdayMon', { defaultValue: 'M' }), '', t('usageHeatmapWeekdayWed', { defaultValue: 'W' }), '', t('usageHeatmapWeekdayFri', { defaultValue: 'F' }), ''].map((label, index) => (
                <span key={`${label}-${index}`} className="flex w-5 items-center">{label}</span>
              ))}
            </div>
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${weekCount}, ${cellSize}px)`, gap: '3px', width: gridWidth }}
              role="grid"
              aria-label={t('usageHeatmapGridLabel')}
            >
          {loading
            ? skeletonWeeks.map((week) => (
                <span key={week[0]} className="grid grid-rows-7" style={{ rowGap: '3px' }}>
                  {week.map((cell) => (
                    <span
                      key={cell}
                      className="animate-pulse rounded-[3px] border border-ds-border-muted bg-ds-subtle"
                      style={{ width: cellSize, height: cellSize }}
                    />
                  ))}
                </span>
              ))
            : weeks.map((week) => (
                <span key={week.key} className="grid grid-rows-7" style={{ rowGap: '3px' }} role="row">
                  {week.cells.map((bucket, index) =>
                    bucket ? (
                      <button
                        key={bucket.date}
                        type="button"
                        role="gridcell"
                        title={dailySummary(bucket, t, i18n.language)}
                        aria-label={dailySummary(bucket, t, i18n.language)}
                        onMouseEnter={(event) => showTooltip(bucket, event.currentTarget)}
                        onMouseLeave={() => setTooltip(null)}
                        onFocus={(event) => showTooltip(bucket, event.currentTarget)}
                        onBlur={() => setTooltip(null)}
                        onClick={(event) => showTooltip(bucket, event.currentTarget)}
                        className={`rounded-[3px] border transition focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-ds-main ${USAGE_HEATMAP_INTENSITY_CLASSES[usageHeatmapIntensityLevel(bucket, positiveMetrics, useTurns)]} ${
                          selected?.date === bucket.date ? 'ring-2 ring-accent ring-offset-2 ring-offset-ds-main' : ''
                        }`}
                        style={{ width: cellSize, height: cellSize }}
                      />
                    ) : (
                      <span
                        key={`blank-${week.key}-${index}`}
                        className="rounded-[3px]"
                        style={{ width: cellSize, height: cellSize }}
                        aria-hidden
                      />
                    )
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-ds-faint">
        <span>{t('usageHeatmapLess', { defaultValue: 'Less' })}</span>
        <span className="flex items-center gap-1">
          {USAGE_HEATMAP_INTENSITY_CLASSES.map((className, index) => (
            <span key={index} className={`h-2.5 w-2.5 rounded-[3px] border ${className}`} />
          ))}
        </span>
        <span>{t('usageHeatmapMore', { defaultValue: 'More' })}</span>
      </div>
      {tooltip && typeof document !== 'undefined' ? createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[12000] w-[240px] rounded-lg border border-ds-border bg-ds-card p-3 text-[11px] leading-5 text-ds-muted shadow-xl"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <div className="mb-1 font-semibold text-ds-ink">{tooltip.bucket.date}</div>
          <div>{t('usageHeatmapTooltipTokens', {
            defaultValue: 'Tokens: {{total}} ({{input}} in / {{output}} out)',
            total: formatCompactNumber(tooltip.bucket.totalTokens),
            input: formatCompactNumber(tooltip.bucket.inputTokens),
            output: formatCompactNumber(tooltip.bucket.outputTokens)
          })}</div>
          <div>{t('usageHeatmapTooltipActivity', {
            defaultValue: '{{turns}} turns · {{threads}} sessions · {{cache}} cache',
            turns: tooltip.bucket.turns,
            threads: tooltip.bucket.threadCount,
            cache: formatPercent(tooltip.bucket.cacheHitRate)
          })}</div>
          <div>{t('usageHeatmapTooltipCost', {
            defaultValue: 'Cost {{cost}} · {{saved}} cached tokens',
            cost: formatCost(tooltip.bucket.costUsd, i18n.language, tooltip.bucket.costCny),
            saved: formatCompactNumber(tooltip.bucket.cachedTokens)
          })}</div>
        </div>,
        document.body
      ) : null}
    </div>
  )
}

export function PreviewCalendar({ mode }: { mode: Exclude<UsageViewMode, 'populated'> }): ReactElement {
  const weeks = Array.from({ length: Math.ceil(USAGE_HEATMAP_PREVIEW_CELLS / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => week * 7 + day)
  )
  const activePattern = new Set([6, 12, 20, 24, 29, 33, 42, 57, 63, 78, 91])
  const strongPattern = new Set([24, 63, 91])
  return (
    <div className="mx-auto min-w-0 max-w-full" aria-hidden>
      <div className="max-w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div className="flex w-max gap-1">
          {weeks.map((week) => (
            <span key={week[0]} className="grid grid-rows-7 gap-1">
              {week.map((cell) => {
                const patterned = activePattern.has(cell)
                const strong = strongPattern.has(cell)
                const className =
                  mode === 'loading'
                    ? 'animate-pulse border-ds-border-muted bg-ds-subtle'
                    : patterned
                      ? strong
                        ? 'border-accent/35 bg-accent/35 dark:border-accent/45 dark:bg-accent/30'
                        : 'border-accent/18 bg-accent/16 dark:border-accent/25 dark:bg-accent/16'
                      : 'border-ds-border-muted bg-ds-subtle/70'
                return <span key={cell} className={`h-[13px] w-[13px] rounded-[3px] border ${className}`} />
              })}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 text-[10.5px] font-medium tracking-[0] text-ds-faint">
        <span className={mode === 'loading' ? 'animate-pulse' : ''}>--</span>
        <div className="flex items-center gap-1">
          {USAGE_HEATMAP_INTENSITY_CLASSES.map((className, index) => (
            <span
              key={className}
              className={`h-2.5 w-2.5 rounded-[3px] border ${index === 0 ? className : 'border-ds-border-muted bg-ds-subtle'} ${
                mode === 'loading' ? 'animate-pulse' : ''
              }`}
            />
          ))}
        </div>
        <span className={mode === 'loading' ? 'animate-pulse' : ''}>--</span>
      </div>
    </div>
  )
}

export function WarmupStatePanel({
  mode,
  onRefresh
}: {
  mode: Exclude<UsageViewMode, 'populated'>
  onRefresh?: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const icon =
    mode === 'loading' ? (
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
    ) : mode === 'error' ? (
      <AlertCircle className="h-4 w-4" strokeWidth={1.9} />
    ) : (
      <Sparkles className="h-4 w-4" strokeWidth={1.9} />
    )
  return (
    <div className="flex flex-col gap-5 border-t border-ds-border-muted pt-5 md:flex-row md:flex-wrap md:items-start md:justify-center md:gap-x-10 md:gap-y-5">
      <PreviewCalendar mode={mode} />
      <div className="w-full min-w-0 border-t border-ds-border-muted pt-5 sm:max-w-[310px] md:w-[310px] md:shrink-0 md:border-l md:border-t-0 md:pl-5 md:pt-0">
        <div
          className={`mb-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${
            mode === 'error'
              ? 'border-amber-300/35 bg-amber-50/70 text-amber-900 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100'
              : 'border-accent/15 bg-accent/8 text-accent'
          }`}
        >
          {icon}
          <span>{t(`usageHeatmapWarmupBadge.${mode}`)}</span>
        </div>
        <h2 className="text-[18px] font-semibold leading-7 tracking-[0] text-ds-ink">
          {t(`usageHeatmapWarmupTitle.${mode}`)}
        </h2>
        <p className="mt-2 text-[13.5px] leading-6 text-ds-muted">
          {t(`usageHeatmapWarmupSub.${mode}`)}
        </p>
        {mode === 'error' ? (
          <button
            type="button"
            className="mt-4 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle px-3 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:text-ds-ink"
            onClick={onRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span>{t('usageHeatmapRefresh')}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <span className="grid min-h-[52px] min-w-0 grid-rows-[auto_1fr] rounded-md bg-ds-subtle px-2.5 py-2">
      <span className="min-w-0 truncate whitespace-nowrap text-[12px] leading-4 text-ds-faint" title={label}>
        {label}
      </span>
      <span className="mt-0.5 min-w-0 truncate text-[15px] font-semibold leading-5 tabular-nums text-ds-ink" title={value}>
        {value}
      </span>
    </span>
  )
}
