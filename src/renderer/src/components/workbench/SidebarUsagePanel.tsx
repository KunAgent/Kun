import { BarChart3, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  usageTotalsFromBuckets
} from '../chat/InitialSessionUsageHeatmap'
import {
  formatCompactNumber,
  formatCost,
  formatPercent,
  primaryCacheHitRate,
  summarizeThreadMoney,
  useThreadUsageState,
  type MoneySummaryItem
} from '../../hooks/use-thread-usage'
import {
  type DailyUsageBucket,
  useDailyUsageState
} from '../../hooks/use-daily-usage'
import { useModelUsageState } from '../../hooks/use-model-usage'
import { useUsageAutoRefresh } from '../../hooks/use-usage-auto-refresh'
import { SidebarUsageHistoryCard } from './SidebarUsageHistoryCard'

type UsageRangeKey = 'all' | '90d' | '30d' | '7d'

const RANGE_DAYS: Record<UsageRangeKey, number> = {
  all: 365,
  '90d': 90,
  '30d': 30,
  '7d': 7
}

const RANGE_KEYS: UsageRangeKey[] = ['7d', '30d', '90d', 'all']
const EMPTY_DAILY_USAGE_BUCKETS: DailyUsageBucket[] = []
const HISTORY_RANGE_DAYS = 365
const MODEL_USAGE_PAGE_SIZE = 5

export type SidebarUsagePanelStatus = {
  loading: boolean
  refreshedAt?: string
}

type Props = {
  activeThreadId: string | null
  enabled?: boolean
  refreshKey: unknown
  onStatusChange?: (status: SidebarUsagePanelStatus) => void
}

export function SidebarUsagePanel({
  activeThreadId,
  enabled = true,
  refreshKey,
  onStatusChange
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [rangeKey, setRangeKey] = useState<UsageRangeKey>('7d')
  const [historyVisibleWeeks, setHistoryVisibleWeeks] = useState(12)
  const [modelPage, setModelPage] = useState(0)
  const [autoRefreshKey, setAutoRefreshKey] = useState(0)
  const effectiveRefreshKey = `${String(refreshKey)}:${autoRefreshKey}`
  const threadState = useThreadUsageState(
    activeThreadId,
    enabled && Boolean(activeThreadId),
    effectiveRefreshKey
  )
  const dailyState = useDailyUsageState(enabled, effectiveRefreshKey, HISTORY_RANGE_DAYS)
  const modelState = useModelUsageState(
    enabled,
    effectiveRefreshKey,
    RANGE_DAYS[rangeKey]
  )
  const loading =
    dailyState.loading ||
    modelState.loading ||
    (Boolean(activeThreadId) && threadState.loading)
  const refreshedAt = earliestRefreshTime(dailyState.updatedAt, modelState.updatedAt)
  const autoRefresh = useCallback(() => setAutoRefreshKey((current) => current + 1), [])
  useUsageAutoRefresh(enabled, refreshKey, autoRefreshKey, refreshedAt, autoRefresh)

  useEffect(() => {
    onStatusChange?.({
      loading,
      ...(refreshedAt ? { refreshedAt } : {})
    })
  }, [loading, onStatusChange, refreshedAt])

  const buckets = dailyState.usage?.buckets ?? EMPTY_DAILY_USAGE_BUCKETS
  const historyBuckets = useMemo(
    () => buckets.slice(-(historyVisibleWeeks * 7)),
    [buckets, historyVisibleWeeks]
  )
  const totals = useMemo(() => usageTotalsFromBuckets(historyBuckets), [historyBuckets])
  const hasAccumulatedUsage =
    totals.totalTokens > 0 ||
    totals.turns > 0 ||
    totals.costUsd > 0 ||
    (totals.costCny ?? 0) > 0 ||
    totals.valueEstimateUsd > 0 ||
    (totals.valueEstimateCny ?? 0) > 0
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
  const locale = i18n.language
  const sessionMoneyItems = currentUsage
    ? summarizeThreadMoney({
        costUsd: currentUsage.costUsd,
        costCny: currentUsage.costCny,
        valueEstimateUsd: currentUsage.valueEstimateUsd,
        valueEstimateCny: currentUsage.valueEstimateCny,
        valueEstimateCoverage: currentUsage.valueEstimateCoverage,
        locale
      })
    : []
  const historyMoneyItems = summarizeThreadMoney({
    costUsd: totals.costUsd,
    costCny: totals.costCny,
    valueEstimateUsd: totals.valueEstimateUsd,
    valueEstimateCny: totals.valueEstimateCny,
    valueEstimateCoverage: totals.valueEstimateCoverage,
    locale
  })
  const estimateTitle = t('sessionUsageEstimateTitle')
  const partialEstimateLabel = t('turnUsageEstimatePartial')
  const referenceEstimate = (item: MoneySummaryItem): string => `${t('sessionUsageFooterEstimate', { value: item.value })}${
    item.coverage === 'partial' ? ` · ${partialEstimateLabel}` : ''
  }`
  const sessionMoney = moneyMetric(
    sessionMoneyItems,
    formatRecordedCost(currentUsage?.costUsd, currentUsage?.costCny, locale),
    referenceEstimate,
    estimateTitle
  )
  const historyMoney = moneyMetric(
    historyMoneyItems,
    formatRecordedCost(totals.costUsd, totals.costCny, locale),
    referenceEstimate,
    estimateTitle
  )
  const hasReferenceEstimate = [...sessionMoneyItems, ...historyMoneyItems]
    .some((item) => item.kind === 'estimate')

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
                  ...sessionMoney
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

        <SidebarUsageHistoryCard
          buckets={buckets}
          error={dailyState.error}
          hasUsage={hasAccumulatedUsage}
          loading={dailyState.loading}
          onVisibleWeeksChange={setHistoryVisibleWeeks}
          metrics={[
            {
              label: t('usageQuotaMetricTokens'),
              value: formatCompactNumber(totals.totalTokens),
              accent: true
            },
            {
              label: t('usageQuotaMetricCost'),
              ...historyMoney
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
          {modelState.error ? (
            <p
              role="alert"
              title={modelState.error}
              className="mt-2 text-[10.5px] leading-4 text-amber-700 dark:text-amber-300"
            >
              {t(modelState.usage ? 'usageQuotaCachedRefreshFailed' : 'usageQuotaInitialLoadFailed')}
            </p>
          ) : null}
          {modelState.loading && !modelState.usage ? (
            <div className="flex min-h-20 items-center justify-center gap-2 text-[11px] text-ds-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              {t('usageHeatmapLoading')}
            </div>
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

        {hasReferenceEstimate ? (
          <p className="px-1 text-[9.5px] leading-4 text-ds-faint">
            {estimateTitle}
          </p>
        ) : null}
        <p className="px-1 pb-1 text-[9.5px] leading-4 text-ds-faint">
          {t('usageQuotaLocalNote')}
        </p>
      </div>
    </div>
  )
}

function earliestRefreshTime(left?: string, right?: string): string | undefined {
  if (!left) return right
  if (!right) return left
  return Date.parse(left) <= Date.parse(right) ? left : right
}

type UsageMetric = {
  label: string
  value: string
  detail?: string
  detailTitle?: string
  accent?: boolean
}

function moneyMetric(
  items: MoneySummaryItem[],
  fallback: string,
  referenceEstimate: (item: MoneySummaryItem) => string,
  estimateTitle: string
): Pick<UsageMetric, 'value' | 'detail' | 'detailTitle'> {
  const actual = items.find((item) => item.kind === 'actual')
  const estimate = items.find((item) => item.kind === 'estimate')
  return {
    value: actual?.value ?? (estimate ? referenceEstimate(estimate) : fallback),
    ...(actual && estimate ? { detail: referenceEstimate(estimate), detailTitle: estimateTitle } : {})
  }
}

function MetricGrid({
  metrics
}: {
  metrics: UsageMetric[]
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
          <dd className="mt-0.5 break-words text-[14px] font-semibold leading-5 tabular-nums text-ds-ink" title={metric.value}>
            {metric.value}
          </dd>
          {metric.detail ? (
            <p className="mt-1 break-words text-[9px] leading-3.5 text-ds-muted" title={metric.detailTitle}>
              {metric.detail}
            </p>
          ) : null}
        </div>
      ))}
    </dl>
  )
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
