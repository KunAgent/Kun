import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  formatCompactNumber,
  formatCost,
  formatPercent
} from '../../hooks/use-thread-usage'
import {
  type DailyUsageBucket,
  type DailyUsageState,
  useDailyUsageState
} from '../../hooks/use-daily-usage'
import {
  type ModelUsageState,
  useModelUsageState
} from '../../hooks/use-model-usage'
import { KunHeroStage } from './KunHeroStage'

export {
  USAGE_HEATMAP_CONTRAST_COLORS,
  USAGE_HEATMAP_INTENSITY_CLASSES,
  buildUsageCalendarWeeks,
  usageHeatmapIntensityLevel,
  usageTotalsFromBuckets,
  type UsageTotalsBucket
} from './initial-session-usage-support'
import { HeatmapGrid, Metric, WarmupStatePanel } from './InitialSessionUsageCalendar'
import { ModelUsagePanel } from './InitialSessionModelUsagePanel'
import {
  EMPTY_DAILY_USAGE_BUCKETS,
  USAGE_HEATMAP_GRID_DAYS,
  USAGE_RANGE_DAYS,
  USAGE_RANGE_KEYS,
  usageRangeBuckets,
  usageStreaks,
  usageTotalsFromBuckets,
  usageViewMode,
  type UsageRangeKey,
  type UsageTabKey
} from './initial-session-usage-support'
function UsageHeroToggle({
  expanded,
  onToggle
}: {
  expanded: boolean
  onToggle: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const Icon = expanded ? ChevronUp : ChevronDown
  const label = expanded ? t('usageHeatmapCollapse') : t('usageHeatmapExpand')

  return (
    <button
      type="button"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-[radial-gradient(circle_at_34%_26%,rgba(91,128,255,0.20),transparent_46%),rgba(255,255,255,0.82)] text-accent shadow-[0_12px_28px_rgba(88,105,150,0.16)] backdrop-blur transition hover:-translate-y-0.5 hover:border-accent/35 hover:bg-white hover:text-ds-ink focus:outline-none focus:ring-2 focus:ring-accent/35 focus:ring-offset-2 focus:ring-offset-ds-bg dark:bg-white/[0.08] dark:shadow-[0_16px_34px_rgba(0,0,0,0.28)]"
      onClick={onToggle}
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
    </button>
  )
}

function UsageHeroSection({
  title,
  sub,
  showText = true
}: {
  title: string
  sub: string
  showText?: boolean
}): ReactElement {
  return (
    <div className="flex w-full min-w-0 flex-col items-center text-center">
      <div>
        <KunHeroStage />
      </div>
      {showText ? (
        <>
          <h1 className="max-w-[620px] text-[28px] font-semibold leading-tight tracking-[0] text-ds-ink sm:text-[32px]">
            {title}
          </h1>
          <p className="mt-3 max-w-[680px] text-[14.5px] leading-7 text-ds-muted">
            {sub}
          </p>
        </>
      ) : null}
    </div>
  )
}

function CollapsedCalendarCard({ onExpand }: { onExpand: () => void }): ReactElement {
  return (
    <div className="-mt-1 flex w-full min-w-0 justify-center">
      <UsageHeroToggle expanded={false} onToggle={onExpand} />
    </div>
  )
}

function UsagePanelCard({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="w-full min-w-0 rounded-[28px] border border-ds-border-muted bg-ds-card/82 p-4 shadow-[0_18px_48px_rgba(86,103,136,0.08)] dark:bg-white/[0.045] sm:p-5">
      {children}
    </div>
  )
}

export function InitialSessionUsageHeatmap({
  hideHero = false,
  embedded = false
}: {
  hideHero?: boolean
  embedded?: boolean
} = {}): ReactElement {
  const [refreshKey, setRefreshKey] = useState(0)
  const [rangeKey, setRangeKey] = useState<UsageRangeKey>('all')
  const [modelUsageEnabled, setModelUsageEnabled] = useState(false)
  const state = useDailyUsageState(true, refreshKey, USAGE_RANGE_DAYS.all)
  const modelState = useModelUsageState(modelUsageEnabled, `${refreshKey}:${rangeKey}`, USAGE_RANGE_DAYS[rangeKey])

  return (
    <InitialSessionUsageHeatmapView
      state={state}
      modelState={modelState}
      rangeKey={rangeKey}
      hideHero={hideHero}
      embedded={embedded}
      initialCollapsed={!hideHero}
      onRangeChange={setRangeKey}
      onActiveTabChange={(tab) => setModelUsageEnabled(tab === 'models')}
      onRefresh={() => setRefreshKey((value) => value + 1)}
    />
  )
}

export function InitialSessionUsageHeatmapView({
  state,
  modelState = { usage: null, loading: false, loaded: false, error: null },
  rangeKey = 'all',
  initialCollapsed = false,
  initialActiveTab = 'overview',
  initialModelHoverIndex = null,
  hideHero = false,
  embedded = false,
  onRangeChange,
  onActiveTabChange,
  onRefresh
}: {
  state: DailyUsageState
  modelState?: ModelUsageState
  rangeKey?: UsageRangeKey
  initialCollapsed?: boolean
  initialActiveTab?: UsageTabKey
  initialModelHoverIndex?: number | null
  hideHero?: boolean
  embedded?: boolean
  onRangeChange?: (rangeKey: UsageRangeKey) => void
  onActiveTabChange?: (tab: UsageTabKey) => void
  onRefresh?: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [activeBucket, setActiveBucket] = useState<DailyUsageBucket | null>(null)
  const [activeTab, setActiveTab] = useState<UsageTabKey>(initialActiveTab)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [modelLabel, setModelLabel] = useState('')
  const usage = state.usage
  const buckets = usage?.buckets ?? EMPTY_DAILY_USAGE_BUCKETS
  const metricBuckets = useMemo(() => usageRangeBuckets(buckets, rangeKey), [buckets, rangeKey])
  const heatmapBuckets = useMemo(() => buckets.slice(-USAGE_HEATMAP_GRID_DAYS), [buckets])
  const totals = useMemo(() => usageTotalsFromBuckets(metricBuckets), [metricBuckets])
  const mode = usageViewMode(state)
  const streaks = useMemo(() => usageStreaks(metricBuckets), [metricBuckets])
  const overviewMetrics = [
    { label: t('usageHeatmapSessions'), value: formatCompactNumber(totals.threadCount) },
    { label: t('usageHeatmapMessages'), value: formatCompactNumber(totals.turns) },
    { label: t('usageHeatmapTotalTokens'), value: formatCompactNumber(totals.totalTokens) },
    { label: t('usageHeatmapActiveDays'), value: String(totals.activeDays) },
    { label: t('usageHeatmapCurrentStreak'), value: t('usageHeatmapStreakDays', { count: streaks.current }) },
    { label: t('usageHeatmapLongestStreak'), value: t('usageHeatmapStreakDays', { count: streaks.longest }) },
    { label: t('usageHeatmapCost'), value: formatCost(totals.costUsd, i18n.language, totals.costCny) },
    {
      label: t('usageHeatmapCacheSavings'),
      value: t('usageHeatmapSavedTokensValue', { tokens: formatCompactNumber(totals.cachedTokens) })
    },
    {
      label: t('usageHeatmapContextSavings'),
      value: t('usageHeatmapSavedTokensValue', {
        tokens: formatCompactNumber(totals.tokenEconomySavingsTokens)
      })
    },
    { label: t('usageHeatmapCache'), value: formatPercent(totals.cacheHitRate) }
  ]
  const heroTitle =
    mode === 'populated'
      ? t('usageHeatmapTitle')
      : t(`usageHeatmapHeroTitle.${mode}`)
  const heroSub =
    mode === 'populated'
      ? t('usageHeatmapSub')
      : t(`usageHeatmapHeroSub.${mode}`)

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined' || typeof window.kunGui?.getSettings !== 'function') return
    void window.kunGui.getSettings()
      .then((settings) => {
        if (!cancelled) setModelLabel(settings.agents.kun.model.trim())
      })
      .catch(() => {
        if (!cancelled) setModelLabel('')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={`ds-initial-usage-heatmap ds-no-drag mx-auto flex w-full items-center justify-center text-left ${
      embedded ? 'min-h-0 p-0' : 'min-h-[min(620px,calc(100dvh-220px))] px-3 py-6 sm:px-5 sm:py-8'
    }`}>
      <div className={`${embedded ? 'max-w-none' : 'ds-chat-content-max-width'} flex w-full min-w-0 flex-col gap-5`}>
        {!hideHero ? (
          <UsageHeroSection
            title={heroTitle}
            sub={heroSub}
            showText={mode !== 'populated'}
          />
        ) : null}
        {collapsed ? (
          <CollapsedCalendarCard onExpand={() => setCollapsed(false)} />
        ) : (
          <UsagePanelCard>
            {mode === 'populated' ? (
              <div className={`mx-auto flex w-full min-w-0 flex-col gap-3 ${embedded ? 'max-w-[860px]' : 'max-w-[560px]'}`}>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="inline-flex w-fit max-w-full rounded-lg bg-ds-subtle p-1 text-[12.5px] font-medium text-ds-muted">
                    <button
                      type="button"
                      className={`min-h-7 rounded-md px-3 transition ${
                        activeTab === 'overview' ? 'bg-ds-card text-ds-ink shadow-sm dark:bg-white/10' : 'hover:text-ds-ink'
                      }`}
                      aria-pressed={activeTab === 'overview'}
                      onClick={() => {
                        setActiveTab('overview')
                        onActiveTabChange?.('overview')
                      }}
                    >
                      {t('usageHeatmapTabOverview')}
                    </button>
                    <button
                      type="button"
                      className={`min-h-7 rounded-md px-3 transition ${
                        activeTab === 'models' ? 'bg-ds-card text-ds-ink shadow-sm dark:bg-white/10' : 'hover:text-ds-ink'
                      }`}
                      title={t('usageHeatmapTabModels')}
                      aria-pressed={activeTab === 'models'}
                      onClick={() => {
                        setActiveTab('models')
                        onActiveTabChange?.('models')
                      }}
                    >
                      {t('usageHeatmapTabModels')}
                    </button>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                    <div className="flex min-w-0 items-center gap-1 self-start rounded-lg bg-ds-subtle p-1 text-[12px] font-medium text-ds-muted sm:self-auto">
                      {USAGE_RANGE_KEYS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className={`min-h-7 rounded-md px-2.5 transition ${
                            rangeKey === key ? 'bg-ds-card text-ds-ink shadow-sm dark:bg-white/10' : 'hover:text-ds-ink'
                          }`}
                          aria-pressed={rangeKey === key}
                          onClick={() => onRangeChange?.(key)}
                        >
                          {t(`usageHeatmapRange.${key}`)}
                        </button>
                      ))}
                    </div>
                    {!embedded ? <UsageHeroToggle expanded onToggle={() => setCollapsed(true)} /> : null}
                  </div>
                </div>
                {activeTab === 'overview' ? (
                  <>
                    <div className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {overviewMetrics.map((metric) => (
                        <Metric key={metric.label} label={metric.label} value={metric.value} />
                      ))}
                    </div>
                    <HeatmapGrid
                      buckets={heatmapBuckets}
                      loading={state.loading && heatmapBuckets.length === 0}
                      selected={activeBucket}
                      onSelect={setActiveBucket}
                    />
                    <p className="text-[11.5px] leading-5 text-ds-faint">
                      {t('usageHeatmapOverviewCaption', {
                        tokens: formatCompactNumber(totals.totalTokens),
                        activeDays: totals.activeDays
                      })}
                    </p>
                  </>
                ) : (
                  <ModelUsagePanel
                    state={modelState}
                    fallbackModel={modelLabel}
                    locale={i18n.language}
                    initialActiveDayIndex={initialModelHoverIndex}
                  />
                )}
              </div>
            ) : (
              <>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
                    <button
                      type="button"
                      className="inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle px-3 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:text-ds-ink disabled:opacity-60 sm:w-auto"
                      onClick={onRefresh}
                      disabled={state.loading}
                      title={t('usageHeatmapRefresh')}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${state.loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
                      <span>{t('usageHeatmapRefresh')}</span>
                    </button>
                    {!embedded ? <UsageHeroToggle expanded onToggle={() => setCollapsed(true)} /> : null}
                  </div>
                </div>
                <WarmupStatePanel mode={mode} onRefresh={onRefresh} />
              </>
            )}
          </UsagePanelCard>
        )}
      </div>
    </div>
  )
}
