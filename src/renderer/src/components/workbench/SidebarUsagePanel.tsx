import { Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { harnessDisplayNames } from '../../lib/harness-display-name'
import { usageTotalsFromBuckets } from '../chat/initial-session-usage-support'
import {
  formatCompactNumber,
  formatCost,
  formatPercent,
  primaryCacheHitRate,
  summarizeThreadMoney,
  useThreadUsageState,
  type MoneySummaryItem
} from '../../hooks/use-thread-usage'
import { type DailyUsageBucket, useDailyUsageState } from '../../hooks/use-daily-usage'
import { useModelUsageState, type ModelUsageScope } from '../../hooks/use-model-usage'
import { useUsageAutoRefresh } from '../../hooks/use-usage-auto-refresh'
import { useActiveThreadMayHaveUsage } from '../../store/chat-store'
import { formatUsageDay, UsageTrendChart, type UsageTrendMetric } from '../usage/UsageTrendChart'

export type UsagePeriod = 'today' | '7d' | '30d' | '90d'

const PERIODS: UsagePeriod[] = ['today', '7d', '30d', '90d']
const PERIOD_DAYS: Record<UsagePeriod, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 }
const MODEL_SCOPES: ModelUsageScope[] = ['primary', 'side', 'all']
const HISTORY_DAYS = 90
const MODELS_COLLAPSED = 5
const EMPTY_BUCKETS: DailyUsageBucket[] = []
const PERIOD_KEY = 'kun.usage.period'
const METRIC_KEY = 'kun.usage.trendMetric'

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

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return allowed.includes(value as T) ? value as T : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // The choice lasts for this session only.
  }
}

export function SidebarUsagePanel({
  activeThreadId,
  enabled = true,
  refreshKey,
  onStatusChange
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const locale = i18n.language
  const [period, setPeriodState] = useState<UsagePeriod>(() => readStored(PERIOD_KEY, PERIODS, '7d'))
  const [metric, setMetricState] = useState<UsageTrendMetric>(() => readStored(METRIC_KEY, ['tokens', 'cost'] as const, 'tokens'))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [modelScope, setModelScope] = useState<ModelUsageScope>('primary')
  const [modelsExpanded, setModelsExpanded] = useState(false)
  const [autoRefreshKey, setAutoRefreshKey] = useState(0)
  const effectiveRefreshKey = `${String(refreshKey)}:${autoRefreshKey}`
  const activeThreadMayHaveUsage = useActiveThreadMayHaveUsage()
  const threadState = useThreadUsageState(activeThreadId,
    enabled && Boolean(activeThreadId) && activeThreadMayHaveUsage, effectiveRefreshKey)
  const dailyState = useDailyUsageState(enabled, effectiveRefreshKey, HISTORY_DAYS)
  const modelState = useModelUsageState(enabled, effectiveRefreshKey, PERIOD_DAYS[period], modelScope)
  const loading = dailyState.loading || modelState.loading || (Boolean(activeThreadId) && threadState.loading)
  const refreshedAt = earliest(dailyState.updatedAt, modelState.updatedAt)
  const autoRefresh = useCallback(() => setAutoRefreshKey((current) => current + 1), [])
  useUsageAutoRefresh(enabled, refreshKey, autoRefreshKey, refreshedAt, autoRefresh)

  useEffect(() => {
    onStatusChange?.({ loading, ...(refreshedAt ? { refreshedAt } : {}) })
  }, [loading, onStatusChange, refreshedAt])

  const buckets = dailyState.usage?.buckets ?? EMPTY_BUCKETS
  // "Today" draws the week for context, with today picked out.
  const chartBuckets = useMemo(() => buckets.slice(-Math.max(7, PERIOD_DAYS[period])), [buckets, period])
  const today = buckets.at(-1)?.date ?? null
  const activeDay = selectedDay ?? (period === 'today' ? today : null)
  const periodBuckets = useMemo(() => {
    if (activeDay) return buckets.filter((bucket) => bucket.date === activeDay)
    return buckets.slice(-PERIOD_DAYS[period])
  }, [activeDay, buckets, period])
  const totals = useMemo(() => usageTotalsFromBuckets(periodBuckets), [periodBuckets])
  const recordedCost = chartBuckets.some((bucket) => bucket.costUsd > 0 || (bucket.costCny ?? 0) > 0)

  const setPeriod = (next: UsagePeriod): void => {
    setPeriodState(next)
    setSelectedDay(null)
    setModelsExpanded(false)
    store(PERIOD_KEY, next)
  }
  const setMetric = (next: UsageTrendMetric): void => {
    setMetricState(next)
    store(METRIC_KEY, next)
  }
  const selectDay = (day: string | null): void => {
    setSelectedDay(period === 'today' && day === today ? null : day)
  }

  const money = moneyFigures(totals, locale, t)
  const scopeLabel = activeDay && activeDay !== today
    ? formatUsageDay(activeDay, locale)
    : t(`usagePanelPeriodLabel.${activeDay ? 'today' : period}`)

  return (
    <div
      data-sidebar-usage-panel
      className="usage-panel-scroller"
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="usage-stats">
        <CurrentSessionStrip
          activeThreadId={activeThreadId}
          loading={threadState.loading}
          usage={threadState.usage}
          locale={locale}
        />

        <div className="usage-stats-bar">
          <div className="kq-seg" role="radiogroup" aria-label={t('usagePanelPeriodGroup')}>
            {PERIODS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={period === key}
                data-active={period === key ? 'true' : 'false'}
                data-usage-period={key}
                onClick={() => setPeriod(key)}
              >
                {t(`usagePanelPeriod.${key}`)}
              </button>
            ))}
          </div>
        </div>

        <section className="usage-kpis" aria-label={scopeLabel} data-usage-kpis>
          <div className="usage-kpis-head">
            <span>{scopeLabel}</span>
            {selectedDay ? (
              <button type="button" className="usage-day-chip" onClick={() => setSelectedDay(null)}
                aria-label={t('usagePanelClearDay')} title={t('usagePanelClearDay')}>
                <X aria-hidden="true" strokeWidth={2} />
              </button>
            ) : null}
          </div>
          {dailyState.loading && !dailyState.usage ? (
            <div className="usage-panel-state is-compact">
              <Loader2 className="animate-spin" aria-hidden="true" strokeWidth={1.8} />
              <p>{t('usageHeatmapLoading')}</p>
            </div>
          ) : (
            <dl className="usage-kpi-grid">
              <Kpi label={t('usagePanelKpiTokens')} value={formatCompactNumber(totals.totalTokens)}
                detail={totals.totalTokens > 0 ? t('usagePanelKpiTokensDetail', {
                  input: formatCompactNumber(totals.inputTokens),
                  output: formatCompactNumber(totals.outputTokens)
                }) : undefined} />
              <Kpi label={t('usagePanelKpiCost')} value={money.value} detail={money.detail} detailTitle={money.detailTitle} />
              <Kpi label={t('usagePanelKpiCache')} value={formatPercent(totals.cacheHitRate)}
                detail={totals.cachedTokens > 0 ? t('usagePanelKpiCacheDetail', { cached: formatCompactNumber(totals.cachedTokens) }) : undefined} />
              <Kpi label={t('usagePanelKpiSessions')} value={new Intl.NumberFormat(locale).format(totals.threadCount)}
                detail={t('usagePanelKpiTurnsDetail', { turns: new Intl.NumberFormat(locale).format(totals.turns) })} />
            </dl>
          )}
          {dailyState.error ? (
            <p role="alert" className="usage-panel-note is-warning" title={dailyState.error}>
              {t(dailyState.usage ? 'usageQuotaCachedRefreshFailed' : 'usageQuotaInitialLoadFailed')}
            </p>
          ) : null}
        </section>

        <section className="usage-card" aria-label={t('usagePanelTrend')} data-usage-trend>
          <div className="usage-card-head">
            <h3>{t('usagePanelTrend')}</h3>
            <span className="kq-grow" />
            <div className="kq-seg is-small" role="radiogroup" aria-label={t('usagePanelTrend')}>
              {(['tokens', 'cost'] as const).map((key) => (
                <button key={key} type="button" role="radio" aria-checked={metric === key}
                  data-active={metric === key ? 'true' : 'false'} data-usage-metric={key}
                  onClick={() => setMetric(key)}>
                  {t(key === 'tokens' ? 'usagePanelKpiTokens' : 'usagePanelKpiCost')}
                </button>
              ))}
            </div>
          </div>
          <UsageTrendChart
            buckets={chartBuckets}
            metric={metric}
            costSource={recordedCost ? 'recorded' : 'estimate'}
            selectedDay={activeDay}
            onSelectDay={selectDay}
            locale={locale}
          />
          {metric === 'cost' && !recordedCost ? (
            <p className="usage-panel-note">{t('usagePanelChartEstimateNote')}</p>
          ) : null}
        </section>

        <ModelRanking
          period={period}
          scope={modelScope}
          onScopeChange={(scope) => { setModelScope(scope); setModelsExpanded(false) }}
          expanded={modelsExpanded}
          onToggleExpanded={() => setModelsExpanded((value) => !value)}
          state={modelState}
        />

        <p className="usage-panel-note">{t('usageQuotaLocalNote')}</p>
      </div>
    </div>
  )
}

function Kpi({ label, value, detail, detailTitle }: {
  label: string
  value: string
  detail?: string
  detailTitle?: string
}): ReactElement {
  return (
    <div className="usage-kpi">
      <dd title={value}>{value}</dd>
      <dt>{label}</dt>
      {detail ? <p title={detailTitle ?? detail}>{detail}</p> : null}
    </div>
  )
}

function CurrentSessionStrip({ activeThreadId, loading, usage, locale }: {
  activeThreadId: string | null
  loading: boolean
  usage: ReturnType<typeof useThreadUsageState>['usage']
  locale: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (!activeThreadId) return null
  const cache = usage ? primaryCacheHitRate(usage) : null
  const parts = usage ? [
    `${formatCompactNumber(usage.totalTokens)} tokens`,
    moneyFigures(usage, locale, t).value,
    ...(cache != null ? [t('usagePanelSessionCache', { rate: formatPercent(cache) })] : []),
    t('usagePanelKpiTurnsDetail', { turns: new Intl.NumberFormat(locale).format(usage.turns) })
  ] : []
  return (
    <section className="usage-session" aria-label={t('usageQuotaCurrentSession')} data-usage-session>
      <span className="usage-session-label">{t('usageQuotaCurrentSession')}</span>
      {loading && !usage ? (
        <Loader2 className="animate-spin" aria-hidden="true" strokeWidth={1.8} />
      ) : (
        <span className="usage-session-figures" title={parts.join(' · ')}>
          {usage ? parts.join(' · ') : t('sessionUsageUnavailable')}
        </span>
      )}
    </section>
  )
}

function ModelRanking({ period, scope, onScopeChange, expanded, onToggleExpanded, state }: {
  period: UsagePeriod
  scope: ModelUsageScope
  onScopeChange: (scope: ModelUsageScope) => void
  expanded: boolean
  onToggleExpanded: () => void
  state: ReturnType<typeof useModelUsageState>
}): ReactElement {
  const { t } = useTranslation('common')
  // Zero-token buckets stay in the response; only models used in the range rank.
  const models = (state.usage?.buckets ?? [])
    .filter((bucket) => bucket.totalTokens > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens)
  const total = Math.max(1, models.reduce((sum, bucket) => sum + bucket.totalTokens, 0))
  const shown = expanded ? models : models.slice(0, MODELS_COLLAPSED)
  return (
    <section className="usage-card" aria-label={t('usageQuotaModels')} data-usage-models>
      <div className="usage-card-head">
        <h3>{t('usageQuotaModels')}</h3>
        <span className="usage-card-sub">{t(`usagePanelPeriodLabel.${period}`)}</span>
        <span className="kq-grow" />
        <label className="usage-select">
          <span className="sr-only">{t('usageModelScopeLabel')}</span>
          <select value={scope} onChange={(event) => onScopeChange(event.target.value as ModelUsageScope)}
            data-usage-scope-select title={t('usageModelScopeNote')}>
            {MODEL_SCOPES.map((key) => <option key={key} value={key}>{t(`usageModelScope.${key}`)}</option>)}
          </select>
        </label>
      </div>
      {state.error ? (
        <p role="alert" title={state.error} className="usage-panel-note is-warning">
          {t(state.usage ? 'usageQuotaCachedRefreshFailed' : 'usageQuotaInitialLoadFailed')}
        </p>
      ) : null}
      {state.loading && !state.usage ? (
        <div className="usage-panel-state is-compact">
          <Loader2 className="animate-spin" aria-hidden="true" strokeWidth={1.8} />
          <p>{t('usageHeatmapLoading')}</p>
        </div>
      ) : models.length > 0 ? (
        <ol className="usage-models">
          {shown.map((bucket) => {
            const share = (bucket.totalTokens / total) * 100
            return (
              <li key={bucket.model} className="usage-model" data-usage-model={bucket.model}>
                <div className="usage-model-row">
                  <span className="usage-model-name" title={bucket.model}>
                    {bucket.model}
                    {bucket.harnessIds?.length ? (
                      <small data-model-usage-agent>{harnessDisplayNames(bucket.harnessIds)}</small>
                    ) : null}
                  </span>
                  <span className="usage-model-figure">{formatCompactNumber(bucket.totalTokens)}</span>
                  <span className="usage-model-share">{share.toFixed(share >= 10 ? 0 : 1)}%</span>
                </div>
                <div className="usage-model-track"><span style={{ width: `${Math.min(100, share)}%` }} /></div>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="usage-chart-empty">{t('usagePanelModelsEmpty')}</p>
      )}
      {models.length > MODELS_COLLAPSED ? (
        <button type="button" className="kq-text-button usage-models-more" aria-expanded={expanded} onClick={onToggleExpanded}>
          {expanded ? t('usagePanelShowFewerModels') : t('usagePanelShowAllModels', { count: models.length })}
        </button>
      ) : null}
    </section>
  )
}

type MoneyInput = {
  costUsd: number | null
  costCny: number | null
  valueEstimateUsd: number | null
  valueEstimateCny: number | null
  valueEstimateCoverage?: 'complete' | 'partial' | 'unavailable'
}

/** Recorded cost first; the reference estimate beside it, or alone when nothing was billed. */
function moneyFigures(
  input: MoneyInput,
  locale: string,
  t: ReturnType<typeof useTranslation>['t']
): { value: string; detail?: string; detailTitle?: string } {
  const items = summarizeThreadMoney({ ...input, locale })
  const actual = items.find((item) => item.kind === 'actual')
  const estimate = items.find((item) => item.kind === 'estimate')
  const estimateText = (item: MoneySummaryItem): string => `${t('sessionUsageFooterEstimate', { value: item.value })}${
    item.coverage === 'partial' ? ` · ${t('turnUsageEstimatePartial')}` : ''
  }`
  if (actual && estimate) return { value: actual.value, detail: estimateText(estimate), detailTitle: t('sessionUsageEstimateTitle') }
  if (actual) return { value: actual.value }
  if (estimate) return { value: estimateText(estimate), detailTitle: t('sessionUsageEstimateTitle') }
  return { value: recordedCost(input.costUsd, input.costCny, locale) }
}

function recordedCost(costUsd: number | null, costCny: number | null, locale: string): string {
  const chineseLocale = /^zh(?:-|$)/i.test(locale.trim())
  const hasRecordedCny = typeof costCny === 'number' && Number.isFinite(costCny) && costCny > 0
  return formatCost(costUsd, chineseLocale && !hasRecordedCny ? 'en' : locale, costCny)
}

function earliest(left?: string, right?: string): string | undefined {
  if (!left) return right
  if (!right) return left
  return Date.parse(left) <= Date.parse(right) ? left : right
}
