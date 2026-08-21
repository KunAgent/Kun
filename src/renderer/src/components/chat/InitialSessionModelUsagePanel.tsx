import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCompactNumber } from '../../hooks/use-thread-usage'
import type { DailyUsageBucket } from '../../hooks/use-daily-usage'
import type { ModelUsageState } from '../../hooks/use-model-usage'
import {
  MODEL_USAGE_BREAKDOWN_COLORS,
  MODEL_USAGE_COLORS
} from './initial-session-usage-support'

const MODEL_USAGE_PAGE_SIZE = 5
const CHART_COLUMN_WIDTH = 24
const CHART_COLUMN_GAP = 4
const MIN_CHART_WIDTH = 320

function isChartDateLabelVisible(index: number, count: number): boolean {
  if (count <= 7) return true
  const interval = Math.ceil(count / 7)
  return index === 0 || index === count - 1 || index % interval === 0
}

function formatChartDate(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed)
}

function formatTokenCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.round(value)))
}

function modelUsageBreakdownSummary(
  label: string,
  bucket: Pick<DailyUsageBucket, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'cacheMissTokens' | 'totalTokens'>,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: string
): string {
  return t('usageHeatmapModelTooltip', {
    label,
    total: formatTokenCount(bucket.totalTokens, locale),
    input: formatTokenCount(bucket.inputTokens, locale),
    output: formatTokenCount(bucket.outputTokens, locale),
    cacheHit: formatTokenCount(bucket.cachedTokens, locale),
    cacheMiss: formatTokenCount(bucket.cacheMissTokens, locale)
  })
}

function modelUsageChartBreakdown(
  bucket: Pick<DailyUsageBucket, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'cacheMissTokens' | 'totalTokens'>
): {
  cachedInput: number
  uncachedInput: number
  output: number
  total: number
} {
  const cachedInput = Math.max(0, bucket.cachedTokens)
  const uncachedInput = Math.max(
    0,
    bucket.cacheMissTokens > 0 ? bucket.cacheMissTokens : bucket.inputTokens - cachedInput
  )
  const output = Math.max(0, bucket.outputTokens)
  const total = Math.max(0, bucket.totalTokens, cachedInput + uncachedInput + output)
  return {
    cachedInput,
    uncachedInput,
    output,
    total
  }
}

export function ModelUsagePanel({
  state,
  fallbackModel,
  locale,
  initialActiveDayIndex = null
}: {
  state: ModelUsageState
  fallbackModel: string
  locale: string
  initialActiveDayIndex?: number | null
}): ReactElement {
  const { t } = useTranslation('common')
  const usage = state.usage
  const modelBuckets = usage?.buckets ?? []
  const visibleModelBuckets = modelBuckets.filter((bucket) => bucket.totalTokens > 0)
  const chartDays = useMemo(() => usage?.days ?? [], [usage])
  const [activeDayIndex, setActiveDayIndex] = useState<number | null>(initialActiveDayIndex)
  const [modelPage, setModelPage] = useState(0)
  const chartScrollerRef = useRef<HTMLDivElement>(null)
  const modelPageKey = `${usage?.from ?? ''}:${usage?.to ?? ''}:${visibleModelBuckets
    .map((bucket) => `${bucket.model}:${bucket.totalTokens}`)
    .join('|')}`
  const modelPageCount = Math.max(1, Math.ceil(visibleModelBuckets.length / MODEL_USAGE_PAGE_SIZE))
  const safeModelPage = Math.min(modelPage, modelPageCount - 1)
  const modelPageStart = safeModelPage * MODEL_USAGE_PAGE_SIZE
  const pagedModelBuckets = visibleModelBuckets.slice(
    modelPageStart,
    modelPageStart + MODEL_USAGE_PAGE_SIZE
  )
  const modelPageEnd = modelPageStart + pagedModelBuckets.length
  const chartWidth = Math.max(
    MIN_CHART_WIDTH,
    chartDays.length * (CHART_COLUMN_WIDTH + CHART_COLUMN_GAP)
  )
  const chartBreakdowns = useMemo(
    () => chartDays.map((bucket) => modelUsageChartBreakdown(bucket)),
    [chartDays]
  )
  const maxTokens = Math.max(1, ...chartBreakdowns.map((bucket) => bucket.total))
  const totalTokens = Math.max(
    1,
    visibleModelBuckets.reduce((total, bucket) => total + bucket.totalTokens, 0)
  )

  useEffect(() => {
    setModelPage(0)
  }, [modelPageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const scroller = chartScrollerRef.current
    if (!scroller) return
    const frame = window.requestAnimationFrame(() => {
      scroller.scrollLeft = scroller.scrollWidth
    })
    return () => window.cancelAnimationFrame(frame)
  }, [usage?.from, usage?.to, chartDays.length])

  const resolvedActiveDayIndex =
    activeDayIndex != null && activeDayIndex >= 0 && activeDayIndex < chartDays.length
      ? activeDayIndex
      : null
  const activeDay = resolvedActiveDayIndex != null ? chartDays[resolvedActiveDayIndex] : null
  const activeBreakdown =
    resolvedActiveDayIndex != null ? chartBreakdowns[resolvedActiveDayIndex] : null
  const tooltipAnchorPercent =
    resolvedActiveDayIndex != null
      ? ((resolvedActiveDayIndex + 0.5) / Math.max(chartDays.length, 1)) * 100
      : 50
  const tooltipTransformClass =
    resolvedActiveDayIndex == null || (resolvedActiveDayIndex > 0 && resolvedActiveDayIndex < chartDays.length - 1)
      ? '-translate-x-1/2'
      : resolvedActiveDayIndex === 0
        ? 'translate-x-0'
        : '-translate-x-full'
  const tooltipRows = activeBreakdown
    ? [
        {
          key: 'cached-input',
          label: t('usageHeatmapModelTooltipCachedInput'),
          value: activeBreakdown.cachedInput,
          color: MODEL_USAGE_BREAKDOWN_COLORS.cachedInput
        },
        {
          key: 'uncached-input',
          label: t('usageHeatmapModelTooltipUncachedInput'),
          value: activeBreakdown.uncachedInput,
          color: MODEL_USAGE_BREAKDOWN_COLORS.uncachedInput
        },
        {
          key: 'output',
          label: t('usageHeatmapModelTooltipOutput'),
          value: activeBreakdown.output,
          color: MODEL_USAGE_BREAKDOWN_COLORS.output
        }
      ]
    : []

  if (state.loading && !usage) {
    return (
      <div className="grid min-h-[180px] place-items-center text-[12px] text-ds-faint">
        {t('usageHeatmapLoading')}
      </div>
    )
  }

  if (visibleModelBuckets.length === 0) {
    return (
      <div className="grid min-h-[180px] place-items-center rounded-md bg-ds-subtle text-[12px] text-ds-faint">
        {t('usageHeatmapModelsEmpty', { model: fallbackModel || '-' })}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline gap-3 px-1">
        <span className="text-[13px] font-medium text-ds-muted">{t('usageHeatmapTokens')}</span>
        <span className="text-[20px] font-semibold tabular-nums text-ds-ink">
          {formatTokenCount(usage?.totals.totalTokens ?? 0, locale)}
        </span>
      </div>
      <div className="grid min-h-[206px] grid-cols-[44px_1fr] gap-2">
        <div className="grid grid-rows-5 pb-5 pt-14 text-right text-[11px] leading-none text-ds-faint">
          {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
            <span key={ratio}>
              {ratio === 0 ? '0' : formatCompactNumber(maxTokens * ratio)}
            </span>
          ))}
        </div>
        <div
          ref={chartScrollerRef}
          className="min-w-0 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-gutter:stable]"
          onMouseLeave={() => setActiveDayIndex(null)}
          data-usage-model-chart
        >
          <div className="relative" style={{ minWidth: `${chartWidth}px` }}>
            {activeDay && activeBreakdown ? (
              <div
                className={`pointer-events-none absolute top-0 z-20 w-[min(18rem,calc(100vw-4rem))] max-w-full rounded-[18px] border border-ds-border bg-ds-card/98 p-3 shadow-[0_18px_46px_rgba(20,47,95,0.12)] backdrop-blur-xl ${tooltipTransformClass}`}
                style={{ left: `${tooltipAnchorPercent}%` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[12.5px] font-semibold text-ds-ink">{activeDay.date}</span>
                  <span className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums text-ds-ink">
                    {t('usageHeatmapModelTooltipTotalTokens', {
                      value: formatTokenCount(activeBreakdown.total, locale)
                    })}
                  </span>
                </div>
                <div className="mt-2 grid gap-1.5">
                  {tooltipRows.map((row) => (
                    <div
                      key={row.key}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[12px] leading-5"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-[3px]"
                        style={{ backgroundColor: row.color }}
                        aria-hidden
                      />
                      <span className="min-w-0 text-ds-muted">{row.label}</span>
                      <span className="whitespace-nowrap tabular-nums text-ds-ink">
                        {t('usageHeatmapModelTooltipTotalTokens', {
                          value: formatTokenCount(row.value, locale)
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div
              className="grid min-h-[150px] items-end gap-1 pt-14"
              style={{
                gridTemplateColumns: `repeat(${Math.max(chartDays.length, 1)}, minmax(${CHART_COLUMN_WIDTH}px, 1fr))`
              }}
            >
              {chartDays.map((bucket, index) => {
                const breakdown = chartBreakdowns[index]
                const segments = [
                  {
                    key: 'output',
                    value: breakdown.output,
                    color: MODEL_USAGE_BREAKDOWN_COLORS.output
                  },
                  {
                    key: 'uncached-input',
                    value: breakdown.uncachedInput,
                    color: MODEL_USAGE_BREAKDOWN_COLORS.uncachedInput
                  },
                  {
                    key: 'cached-input',
                    value: breakdown.cachedInput,
                    color: MODEL_USAGE_BREAKDOWN_COLORS.cachedInput
                  }
                ]
                const dateLabel = formatChartDate(bucket.date, locale)
                const summary = modelUsageBreakdownSummary(dateLabel, bucket, t, locale)
                const active = resolvedActiveDayIndex === index
                const barHeight = breakdown.total > 0 ? Math.max(8, (breakdown.total / maxTokens) * 112) : 8
                return (
                  <div key={`${bucket.date}-${index}`} className="relative grid min-w-0 grid-rows-[1fr_auto] gap-2">
                    {active ? (
                      <span
                        className="pointer-events-none absolute bottom-5 left-1/2 top-0 z-0 w-px -translate-x-1/2 border-l border-dashed border-accent/35"
                        aria-hidden
                      />
                    ) : null}
                    <button
                      type="button"
                      title={summary}
                      aria-label={summary}
                      onMouseEnter={() => setActiveDayIndex(index)}
                      onFocus={() => setActiveDayIndex(index)}
                      onClick={() => setActiveDayIndex(index)}
                      className="relative z-[1] flex min-h-[112px] items-end rounded-[10px] px-1 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 focus:ring-offset-ds-bg"
                    >
                      <span
                        className={`flex w-full flex-col-reverse overflow-hidden rounded-t-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.36)] transition ${
                          active ? 'ring-1 ring-accent/18' : ''
                        } ${breakdown.total === 0 ? 'bg-ds-subtle' : ''}`}
                        style={{ height: `${barHeight}px` }}
                      >
                        {segments.map((segment) => {
                          const ratio = breakdown.total > 0 ? segment.value / breakdown.total : 0
                          if (ratio <= 0) return null
                          return (
                            <span
                              key={segment.key}
                              className="w-full border-t border-white/35 dark:border-white/10"
                              style={{
                                height: `${Math.max(4, ratio * barHeight)}px`,
                                backgroundColor: segment.color
                              }}
                            />
                          )
                        })}
                      </span>
                    </button>
                    <span className="truncate text-center text-[11px] text-ds-faint">
                      {isChartDateLabelVisible(index, chartDays.length) ? dateLabel : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-1.5">
        {pagedModelBuckets.map((bucket, index) => {
          const percent = (bucket.totalTokens / totalTokens) * 100
          const summary = modelUsageBreakdownSummary(bucket.model, bucket, t, locale)
          return (
            <div
              key={bucket.model}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto] items-center gap-3 text-[12px] leading-5"
              title={summary}
              aria-label={summary}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-ds-ink">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: MODEL_USAGE_COLORS[(modelPageStart + index) % MODEL_USAGE_COLORS.length] }}
                />
                <span className="truncate">{bucket.model}</span>
              </span>
              <span className="min-w-0 truncate whitespace-nowrap text-right tabular-nums text-ds-faint">
                {t('usageHeatmapModelTokenBreakdown', {
                  input: formatCompactNumber(bucket.inputTokens),
                  output: formatCompactNumber(bucket.outputTokens),
                  cacheHit: formatCompactNumber(bucket.cachedTokens),
                  cacheMiss: formatCompactNumber(bucket.cacheMissTokens)
                })}
              </span>
              <span className="min-w-[3.2rem] text-right tabular-nums font-semibold text-ds-ink">
                {percent.toFixed(1)}%
              </span>
            </div>
          )
        })}
      </div>
      {visibleModelBuckets.length > MODEL_USAGE_PAGE_SIZE ? (
        <nav
          className="mt-3 flex items-center justify-between gap-2 border-t border-ds-border-muted pt-2.5"
          aria-label={t('usageQuotaModelPagination')}
        >
          <span className="min-w-0 text-[10px] tabular-nums text-ds-faint">
            {t('usageQuotaModelPageRange', {
              first: modelPageStart + 1,
              last: modelPageEnd,
              total: visibleModelBuckets.length
            })}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={safeModelPage === 0}
              aria-label={t('usageQuotaModelPagePrevious')}
              onClick={() => setModelPage(safeModelPage - 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border-muted bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
            <span className="min-w-[2.75rem] text-center text-[10.5px] tabular-nums text-ds-muted" aria-live="polite">
              {t('usageQuotaModelPageIndicator', {
                page: safeModelPage + 1,
                total: modelPageCount
              })}
            </span>
            <button
              type="button"
              disabled={safeModelPage >= modelPageCount - 1}
              aria-label={t('usageQuotaModelPageNext')}
              onClick={() => setModelPage(safeModelPage + 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ds-border-muted bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
