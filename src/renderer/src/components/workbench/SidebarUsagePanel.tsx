import { AlertCircle, BarChart3, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  buildUsageCalendarWeeks,
  usageHeatmapIntensityLevel,
  usageTotalsFromBuckets
} from '../chat/InitialSessionUsageHeatmap'
import {
  formatCompactNumber,
  formatCost,
  formatPercent,
  primaryCacheHitRate,
  useThreadUsageState
} from '../../hooks/use-thread-usage'
import {
  type DailyUsageBucket,
  useDailyUsageState
} from '../../hooks/use-daily-usage'
import { useModelUsageState } from '../../hooks/use-model-usage'

type UsageRangeKey = 'all' | '90d' | '30d' | '7d'

const RANGE_DAYS: Record<UsageRangeKey, number> = {
  all: 365,
  '90d': 90,
  '30d': 30,
  '7d': 7
}

const RANGE_KEYS: UsageRangeKey[] = ['7d', '30d', '90d', 'all']
const EMPTY_DAILY_USAGE_BUCKETS: DailyUsageBucket[] = []
const MODEL_USAGE_PAGE_SIZE = 5

export type SidebarUsagePanelStatus = {
  loading: boolean
  refreshedAt?: string
}

type Props = {
  activeThreadId: string | null
  refreshKey: unknown
  onStatusChange?: (status: SidebarUsagePanelStatus) => void
}

export function SidebarUsagePanel({
  activeThreadId,
  refreshKey,
  onStatusChange
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [rangeKey, setRangeKey] = useState<UsageRangeKey>('90d')
  const [modelPage, setModelPage] = useState(0)
  const [refreshedAt, setRefreshedAt] = useState<string>()
  const threadState = useThreadUsageState(
    activeThreadId,
    Boolean(activeThreadId),
    refreshKey
  )
  const dailyState = useDailyUsageState(true, refreshKey, RANGE_DAYS.all)
  const modelState = useModelUsageState(
    true,
    `${String(refreshKey)}:${rangeKey}`,
    RANGE_DAYS[rangeKey]
  )
  const loading =
    dailyState.loading ||
    modelState.loading ||
    (Boolean(activeThreadId) && threadState.loading)
  const loaded =
    dailyState.loaded &&
    modelState.loaded &&
    (!activeThreadId || threadState.loaded)

  useEffect(() => {
    if (loaded && !loading) setRefreshedAt(new Date().toISOString())
  }, [loaded, loading])

  useEffect(() => {
    onStatusChange?.({
      loading,
      ...(refreshedAt ? { refreshedAt } : {})
    })
  }, [loading, onStatusChange, refreshedAt])

  const buckets = dailyState.usage?.buckets ?? EMPTY_DAILY_USAGE_BUCKETS
  const rangeBuckets = useMemo(
    () => buckets.slice(-RANGE_DAYS[rangeKey]),
    [buckets, rangeKey]
  )
  const totals = useMemo(() => usageTotalsFromBuckets(rangeBuckets), [rangeBuckets])
  const calendarBuckets = useMemo(() => buckets.slice(-RANGE_DAYS.all), [buckets])
  const weeks = useMemo(() => buildUsageCalendarWeeks(calendarBuckets), [calendarBuckets])
  const positiveTokens = useMemo(
    () => calendarBuckets.map((bucket) => bucket.totalTokens).filter((value) => value > 0),
    [calendarBuckets]
  )
  const hasAccumulatedUsage =
    totals.totalTokens > 0 ||
    totals.turns > 0 ||
    totals.costUsd > 0 ||
    (totals.costCny ?? 0) > 0
  const modelBuckets = modelState.usage?.buckets ?? []
  // The usage API keeps zero-token model buckets in the response. Only models
  // with real usage in the selected range are worth listing, so derive both the
  // visible rows and the percentage denominator from the positive buckets.
  const visibleModelBuckets = modelBuckets.filter((bucket) => bucket.totalTokens > 0)
  const modelPageCount = Math.max(1, Math.ceil(visibleModelBuckets.length / MODEL_USAGE_PAGE_SIZE))
  const safeModelPage = Math.min(modelPage, modelPageCount - 1)
  const modelPageStart = safeModelPage * MODEL_USAGE_PAGE_SIZE
  const pagedModelBuckets = visibleModelBuckets.slice(
    modelPageStart,
    modelPageStart + MODEL_USAGE_PAGE_SIZE
  )
  const modelPageEnd = modelPageStart + pagedModelBuckets.length
  const modelTotal = Math.max(
    1,
    visibleModelBuckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0)
  )
  useEffect(() => {
    if (modelPage !== safeModelPage) setModelPage(safeModelPage)
  }, [modelPage, safeModelPage])

  const currentUsage = threadState.usage
  const currentCacheHitRate = currentUsage ? primaryCacheHitRate(currentUsage) : null

  return (
    <div
      data-sidebar-usage-panel
      className="h-0 min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden px-3 py-3 [scrollbar-gutter:stable]"
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="space-y-3">
        <section
          aria-label={t('usageQuotaCurrentSession')}
          className="rounded-[16px] border border-ds-border-muted bg-ds-card p-3 shadow-sm"
        >
          <div className="mb-2.5 flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-accent" strokeWidth={1.9} />
            <h3 className="text-[12.5px] font-semibold text-ds-ink">
              {t('usageQuotaCurrentSession')}
            </h3>
          </div>
          {activeThreadId && threadState.loading && !currentUsage ? (
            <div className="flex min-h-20 items-center justify-center gap-2 text-[11px] text-ds-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              {t('sessionUsageLoading')}
            </div>
          ) : currentUsage ? (
            <MetricGrid
              metrics={[
                {
                  label: t('usageQuotaMetricTokens'),
                  value: formatCompactNumber(currentUsage.totalTokens)
                },
                {
                  label: t('usageQuotaMetricCost'),
                  value: formatRecordedCost(
                    currentUsage.costUsd,
                    currentUsage.costCny,
                    i18n.language
                  )
                },
                ...(currentCacheHitRate != null
                  ? [{
                      label: t('usageQuotaMetricCache'),
                      value: formatPercent(currentCacheHitRate)
                    }]
                  : []),
                {
                  label: t('usageQuotaMetricTurns'),
                  value: new Intl.NumberFormat(i18n.language).format(currentUsage.turns)
                }
              ]}
            />
          ) : (
            <p className="rounded-xl bg-ds-surface-subtle px-3 py-5 text-center text-[11px] leading-5 text-ds-faint">
              {activeThreadId ? t('sessionUsageUnavailable') : t('usageQuotaNoCurrentSession')}
            </p>
          )}
        </section>

        <section
          aria-label={t('usageQuotaHistory')}
          className="overflow-hidden rounded-[16px] border border-ds-border-muted bg-ds-card shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-4">
            <div>
              <h3 className="text-[13px] font-semibold text-ds-ink">
                {t('usageQuotaHistory')}
              </h3>
              <p className="mt-0.5 text-[9.5px] text-ds-faint">
                {t('usageQuotaHistoryRange', {
                  range: t(`usageHeatmapRange.${rangeKey}`)
                })}
              </p>
            </div>
          </div>

          {dailyState.error ? (
            <div
              role="alert"
              className="mx-4 mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] leading-4 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-200"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <span>{t('usageHeatmapErrorTitle')}</span>
            </div>
          ) : null}

          {dailyState.loading && !dailyState.usage ? (
            <div className="mx-4 mb-4 flex min-h-44 items-center justify-center gap-2 text-[11px] text-ds-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              {t('usageHeatmapLoading')}
            </div>
          ) : hasAccumulatedUsage ? (
            <>
              <MetricStrip
                metrics={[
                  {
                    label: t('usageQuotaMetricTokens'),
                    value: formatCompactNumber(totals.totalTokens),
                    accent: true
                  },
                  {
                    label: t('usageQuotaMetricCost'),
                    value: formatRecordedCost(totals.costUsd, totals.costCny, i18n.language)
                  },
                  {
                    label: t('usageQuotaMetricCacheHit'),
                    value: formatPercent(totals.cacheHitRate)
                  },
                  {
                    label: t('usageQuotaMetricSessions'),
                    value: new Intl.NumberFormat(i18n.language).format(totals.threadCount)
                  }
                ]}
              />
              <CompactHeatmap
                buckets={calendarBuckets}
                weeks={weeks}
                positiveTokens={positiveTokens}
              />
            </>
          ) : (
            <p className="mx-4 mb-4 rounded-xl bg-ds-surface-subtle px-3 py-8 text-center text-[11px] leading-5 text-ds-faint">
              {t('usageQuotaNoUsage')}
            </p>
          )}
        </section>

        <section
          aria-label={t('usageQuotaModels')}
          className="rounded-[16px] border border-ds-border-muted bg-ds-card p-3 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12.5px] font-semibold text-ds-ink">
              {t('usageQuotaModels')}
            </h3>
            <div
              className="inline-flex rounded-[9px] border border-ds-border-muted bg-ds-surface-subtle/70 p-0.5 text-[10px] font-medium text-ds-muted"
              aria-label={t('usageQuotaModels')}
            >
              {RANGE_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  data-usage-range={key}
                  aria-pressed={rangeKey === key}
                  onClick={() => {
                    setRangeKey(key)
                    setModelPage(0)
                  }}
                  className={`min-h-6 rounded-[7px] px-2 transition ${
                    rangeKey === key
                      ? 'bg-accent/10 text-accent shadow-sm dark:bg-accent/20'
                      : 'hover:text-ds-ink'
                  }`}
                >
                  {t(`usageHeatmapRange.${key}`)}
                </button>
              ))}
            </div>
          </div>
          {modelState.loading && !modelState.usage ? (
            <div className="flex min-h-20 items-center justify-center gap-2 text-[11px] text-ds-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              {t('usageHeatmapLoading')}
            </div>
          ) : modelState.error ? (
            <p role="alert" className="mt-2 text-[10.5px] leading-4 text-amber-700 dark:text-amber-300">
              {t('usageHeatmapErrorTitle')}
            </p>
          ) : visibleModelBuckets.length > 0 ? (
            <>
              <div className={`mt-2.5 space-y-2.5 ${
                visibleModelBuckets.length > MODEL_USAGE_PAGE_SIZE ? 'min-h-[188px]' : ''
              }`}>
                {pagedModelBuckets.map((bucket) => {
                const percent = Math.max(0, Math.min(100, bucket.totalTokens / modelTotal * 100))
                return (
                  <div key={bucket.model} className="min-w-0">
                    <div className="flex items-center justify-between gap-3 text-[10.5px]">
                      <span className="min-w-0 flex-1 truncate font-medium text-ds-ink" title={bucket.model}>
                        {bucket.model}
                      </span>
                      <span className="shrink-0 tabular-nums text-ds-muted">
                        {percent.toFixed(percent >= 10 ? 0 : 1)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ds-border-muted">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-right text-[9px] tabular-nums text-ds-faint">
                      {formatCompactNumber(bucket.totalTokens)} tokens
                    </p>
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
            </>
          ) : (
            <p className="mt-2 rounded-xl bg-ds-surface-subtle px-3 py-5 text-center text-[11px] text-ds-faint">
              {t('usageHeatmapModelsEmpty', { model: '-' })}
            </p>
          )}
        </section>

        <p className="px-1 pb-1 text-[9.5px] leading-4 text-ds-faint">
          {t('usageQuotaLocalNote')}
        </p>
      </div>
    </div>
  )
}

function MetricStrip({
  metrics
}: {
  metrics: Array<{ label: string; value: string; accent?: boolean }>
}): ReactElement {
  return (
    <dl className="mx-4 grid grid-cols-2 rounded-xl border border-ds-border-muted bg-ds-surface-subtle/45 sm:grid-cols-4">
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={`relative min-w-0 px-3 py-2.5 ${
            index > 0 ? 'sm:border-l sm:border-ds-border-muted' : ''
          } ${index > 1 ? 'border-t border-ds-border-muted sm:border-t-0' : ''} ${
            index % 2 === 1 ? 'border-l border-ds-border-muted sm:border-l' : ''
          }`}
        >
          {metric.accent ? (
            <span className="absolute inset-x-3 top-0 h-px rounded-full bg-accent/70" aria-hidden />
          ) : null}
          <dt className="truncate text-[9.5px] leading-4 text-ds-faint" title={metric.label}>
            {metric.label}
          </dt>
          <dd
            className="mt-0.5 truncate text-[15px] font-semibold leading-5 tabular-nums text-ds-ink"
            title={metric.value}
          >
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function MetricGrid({
  metrics
}: {
  metrics: Array<{ label: string; value: string }>
}): ReactElement {
  return (
    <dl className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(6.5rem,1fr))]">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-surface-subtle/60 px-2.5 py-2"
        >
          <dt className="truncate text-[9.5px] leading-4 text-ds-faint" title={metric.label}>
            {metric.label}
          </dt>
          <dd className="mt-0.5 truncate text-[14px] font-semibold leading-5 tabular-nums text-ds-ink" title={metric.value}>
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function CompactHeatmap({
  buckets,
  weeks,
  positiveTokens
}: {
  buckets: DailyUsageBucket[]
  weeks: ReturnType<typeof buildUsageCalendarWeeks>
  positiveTokens: number[]
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [tooltip, setTooltip] = useState<{
    bucket: DailyUsageBucket
    left: number
    top: number
  } | null>(null)
  const monthLabels = useMemo(() => weeks.map((week, index) => {
    const bucket = week.cells.find((cell) => cell?.date.endsWith('-01'))
      ?? (index === 0 ? week.cells.find((cell) => cell) : undefined)
    if (!bucket) return ''
    const parsed = new Date(`${bucket.date}T00:00:00.000Z`)
    return Number.isNaN(parsed.getTime())
      ? ''
      : new Intl.DateTimeFormat(i18n.language, {
          month: 'short',
          timeZone: 'UTC'
        }).format(parsed)
  }), [i18n.language, weeks])

  const showTooltip = (bucket: DailyUsageBucket, element: HTMLElement): void => {
    const rect = element.getBoundingClientRect()
    const width = 224
    setTooltip({
      bucket,
      left: Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 132))
    })
  }

  return (
    <div className="mt-3 border-t border-ds-border-muted px-4 pb-3 pt-3">
      <div className="max-w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div className="min-w-[420px]">
          <div
            className="mb-1.5 grid pl-7 text-[9px] text-ds-faint"
            style={{
              gridTemplateColumns: `repeat(${Math.max(weeks.length, 1)}, minmax(6px, 1fr))`,
              columnGap: '2px'
            }}
            aria-hidden
          >
            {monthLabels.map((label, index) => (
              <span key={`${label}-${index}`} className="h-3 whitespace-nowrap">
                {label}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <div
              className="grid w-5 shrink-0 grid-rows-7 text-[8.5px] leading-none text-ds-faint"
              style={{ rowGap: '2px' }}
              aria-hidden
            >
              {['', t('usageHeatmapWeekdayMon'), '', t('usageHeatmapWeekdayWed'), '', t('usageHeatmapWeekdayFri'), ''].map((label, index) => (
                <span key={`${label}-${index}`} className="flex items-center">
                  {label}
                </span>
              ))}
            </div>
            <div
              role="grid"
              aria-label={t('usageHeatmapGridLabel')}
              className="grid min-w-0 flex-1"
              style={{
                gridTemplateColumns: `repeat(${Math.max(weeks.length, 1)}, minmax(6px, 1fr))`,
                columnGap: '2px'
              }}
            >
              {weeks.map((week) => (
                <span
                  key={week.key}
                  role="row"
                  className="grid min-w-0 grid-rows-7"
                  style={{ rowGap: '2px' }}
                >
                  {week.cells.map((bucket, index) => bucket ? (
                    <button
                      key={bucket.date}
                      type="button"
                      role="gridcell"
                      title={`${bucket.date} · ${formatCompactNumber(bucket.totalTokens)} tokens · ${bucket.turns} turns`}
                      aria-label={`${bucket.date} · ${bucket.totalTokens} tokens · ${bucket.turns} turns`}
                      onMouseEnter={(event) => showTooltip(bucket, event.currentTarget)}
                      onMouseLeave={() => setTooltip(null)}
                      onFocus={(event) => showTooltip(bucket, event.currentTarget)}
                      onBlur={() => setTooltip(null)}
                      className={`aspect-square w-full min-w-[6px] max-w-3 rounded-[2px] transition hover:ring-1 hover:ring-accent focus:outline-none focus:ring-2 focus:ring-accent ${
                        heatmapCellClass(usageHeatmapIntensityLevel(bucket, positiveTokens))
                      }`}
                    />
                  ) : (
                    <span
                      key={`${week.key}-${index}`}
                      aria-hidden
                      className="aspect-square w-full min-w-[6px] max-w-3"
                    />
                  ))}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 text-[9px] text-ds-faint">
        <span>{t('usageQuotaDailyTokens')}</span>
        <span className="flex items-center gap-1">
          <span>{t('usageHeatmapLess')}</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              aria-hidden
              className={`h-2 w-2 rounded-[2px] ${heatmapCellClass(level)}`}
            />
          ))}
          <span>{t('usageHeatmapMore')}</span>
        </span>
        <span className="sr-only">{buckets.length}</span>
      </div>
      {tooltip && typeof document !== 'undefined' ? createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[12000] w-56 rounded-lg border border-ds-border bg-ds-card px-3 py-2.5 text-[10.5px] leading-4 text-ds-muted shadow-xl"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <div className="mb-1 font-semibold text-ds-ink">{tooltip.bucket.date}</div>
          <div>{t('usageHeatmapTooltipTokens', {
            total: formatCompactNumber(tooltip.bucket.totalTokens),
            input: formatCompactNumber(tooltip.bucket.inputTokens),
            output: formatCompactNumber(tooltip.bucket.outputTokens)
          })}</div>
          <div>{t('usageHeatmapTooltipActivity', {
            turns: tooltip.bucket.turns,
            threads: tooltip.bucket.threadCount,
            cache: formatPercent(tooltip.bucket.cacheHitRate)
          })}</div>
        </div>,
        document.body
      ) : null}
    </div>
  )
}

function heatmapCellClass(level: number): string {
  switch (level) {
    case 1: return 'bg-emerald-400 dark:bg-emerald-700'
    case 2: return 'bg-teal-500 dark:bg-teal-600'
    case 3: return 'bg-cyan-600 dark:bg-cyan-500'
    case 4: return 'bg-blue-700 dark:bg-blue-400'
    default: return 'border border-ds-border-muted bg-ds-surface-subtle'
  }
}

function formatRecordedCost(
  costUsd: number | null | undefined,
  costCny: number | null | undefined,
  locale: string
): string {
  const chineseLocale = /^zh(?:-|$)/i.test(locale.trim())
  const hasRecordedCny = typeof costCny === 'number' && Number.isFinite(costCny) && costCny > 0
  return formatCost(costUsd, chineseLocale && !hasRecordedCny ? 'en' : locale, costCny)
}
