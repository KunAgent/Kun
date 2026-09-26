import { useEffect, useState, type ReactElement } from 'react'
import { summarizeThreadMoney, type MoneySummaryItem } from '../../hooks/use-thread-usage'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'

type AnimatedCacheValueState = {
  current: string
  previous: string | null
  revision: number
}

function AnimatedCacheValue({ value }: { value: string }): ReactElement {
  const [state, setState] = useState<AnimatedCacheValueState>({
    current: value,
    previous: null,
    revision: 0
  })

  useEffect(() => {
    setState((current) => current.current === value
      ? current
      : { current: value, previous: current.current, revision: current.revision + 1 })
  }, [value])

  useEffect(() => {
    if (state.previous == null) return
    const revision = state.revision
    const timer = window.setTimeout(() => {
      setState((current) => current.revision === revision
        ? { ...current, previous: null }
        : current)
    }, 220)
    return () => window.clearTimeout(timer)
  }, [state.previous, state.revision])

  return (
    <span className="ds-composer-usage-cache-value" aria-live="polite" aria-atomic="true">
      {state.previous != null ? (
        <span className="ds-composer-usage-cache-value-out" aria-hidden="true">
          {state.previous}
        </span>
      ) : null}
      <span key={state.revision} className="ds-composer-usage-cache-value-in">
        {state.current}
      </span>
    </span>
  )
}

function ComposerUsageMoneyMetric({
  items,
  t
}: {
  items: MoneySummaryItem[]
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement | null {
  const actual = items.find((item) => item.kind === 'actual')
  const estimate = items.find((item) => item.kind === 'estimate')
  if (!actual && !estimate) return null

  const primary = actual ?? estimate
  const secondary = actual && estimate ? estimate : null
  const titleParts = [
    actual
      ? t('sessionUsageActualCostTitle', {
          defaultValue: 'Estimated from published token prices, or the cost field in the provider response. Not a live billing sync from the DeepSeek console.'
        })
      : null,
    estimate
      ? t('sessionUsageEstimateTitle', {
          defaultValue: 'Public API-price equivalent of subscription usage; not the plan charge, and not the metered API bill.'
        })
      : null,
    estimate?.coverage === 'partial'
      ? t('turnUsageEstimatePartial', { defaultValue: 'Partial estimate' })
      : null
  ].filter((part): part is string => Boolean(part))

  return (
    <span
      className="ds-composer-usage-metric ds-composer-usage-money shrink-0 tabular-nums"
      data-session-usage-estimate-partial={estimate?.coverage === 'partial' ? 'true' : undefined}
      title={titleParts.join(' · ')}
    >
      {primary?.kind === 'estimate'
        ? t('sessionUsageFooterEstimate', { value: primary.value, defaultValue: 'Plan value ≈{{value}}' })
        : t('sessionUsageFooterActualCost', { value: primary!.value, defaultValue: 'API {{value}}' })}
      {secondary ? (
        <span className="ds-composer-usage-money-estimate">
          {t('sessionUsageFooterEstimate', { value: secondary.value, defaultValue: 'Plan value ≈{{value}}' })}
        </span>
      ) : null}
    </span>
  )
}

export function FloatingComposerFooterView({
  context
}: {
  context: FloatingComposerRenderContext
}): ReactElement | null {
  const {
    BarChart3, FloatingComposerUsageHistory, activeThreadId, compact,
    primaryCacheHitRate, footerHint, formatCompactNumber, formatPercent, formatTps,
    formatTtftSeconds, i18n, showUsageHistoryFooter, t, threadUsage, threadUsageState,
    timingThreadUsage
  } = context
  if (compact) return null
  const latestCacheHitRate = threadUsage ? primaryCacheHitRate(threadUsage) : null
  const usageLocale = i18n.resolvedLanguage ?? i18n.language
  const moneyItems = threadUsage ? summarizeThreadMoney({
    costUsd: threadUsage.costUsd,
    costCny: threadUsage.costCny,
    valueEstimateUsd: threadUsage.valueEstimateUsd,
    valueEstimateCny: threadUsage.valueEstimateCny,
    valueEstimateCoverage: threadUsage.valueEstimateCoverage,
    locale: usageLocale
  }) : []

  return (
    <div className="ds-composer-footer ds-no-drag">
      <div className="ds-composer-footer-left">
        {showUsageHistoryFooter ? (
          <FloatingComposerUsageHistory
            title={
              threadUsage
                ? t(
                    threadUsage.lastTurnCacheHitRate != null
                      ? 'sessionUsageDetailsTitleWithLatestCache'
                      : 'sessionUsageDetailsTitle',
                    {
                      tokens: formatCompactNumber(threadUsage.totalTokens),
                      cost: moneyItems[0]?.value ?? '-',
                      cache: formatPercent(threadUsage.cacheHitRate),
                      latestCache: formatPercent(threadUsage.lastTurnCacheHitRate),
                      cached: formatCompactNumber(threadUsage.cachedTokens),
                      miss: formatCompactNumber(threadUsage.cacheMissTokens),
                      turns: threadUsage.turns
                    }
                  )
                : activeThreadId
                  ? t('sessionUsageUnavailable')
                  : t('usageHistoryOpen')
            }
          >
            <BarChart3 className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
            {threadUsage ? (
              <>
                <span className="ds-composer-usage-metric ds-composer-usage-tokens shrink-0 tabular-nums">
                  {t('sessionUsageFooterTokens', {
                    tokens: formatCompactNumber(threadUsage.totalTokens)
                  })}
                </span>
                {latestCacheHitRate != null ? (
                  <span className="ds-composer-usage-metric ds-composer-usage-cache shrink-0 tabular-nums">
                    <span className="ds-composer-usage-cache-indicator" aria-hidden="true" />
                    <AnimatedCacheValue
                      value={t('sessionUsageFooterCache', {
                        cache: formatPercent(latestCacheHitRate)
                      })}
                    />
                  </span>
                ) : null}
                <span className="ds-composer-usage-metric ds-composer-usage-turns shrink-0 tabular-nums">
                  {t('sessionUsageFooterTurns', { turns: threadUsage.turns })}
                </span>
                {timingThreadUsage?.avgTtftMs != null ? (
                  <span
                    className="ds-composer-usage-metric ds-composer-usage-ttft shrink-0 tabular-nums"
                    title={t('sessionUsageAvgMetricsTitle')}
                  >
                    {t('sessionUsageFooterTtft', {
                      ttft: formatTtftSeconds(timingThreadUsage.avgTtftMs) ?? '-'
                    })}
                  </span>
                ) : null}
                {timingThreadUsage?.avgTokensPerSecond != null ? (
                  <span
                    className="ds-composer-usage-metric ds-composer-usage-tps shrink-0 tabular-nums"
                    title={t('sessionUsageAvgMetricsTitle')}
                  >
                    {t('sessionUsageFooterTps', {
                      tps: formatTps(timingThreadUsage.avgTokensPerSecond) ?? '-'
                    })}
                  </span>
                ) : null}
                {moneyItems.length > 0 ? (
                  <ComposerUsageMoneyMetric items={moneyItems} t={t} />
                ) : threadUsage.totalTokens > 0 ? (
                  <span
                    className="ds-composer-usage-metric ds-composer-usage-money shrink-0"
                    title={t('sessionUsagePriceUnavailableTitle', {
                      defaultValue: 'The provider did not report a cost and this model has no trusted local price.'
                    })}
                  >
                    {t('sessionUsagePriceUnavailable', { defaultValue: 'Price unavailable' })}
                  </span>
                ) : null}
              </>
            ) : activeThreadId ? (
              <span className="shrink-0 text-ds-faint">
                {threadUsageState.loading
                  ? t('sessionUsageLoading')
                  : t('sessionUsageUnavailable')}
              </span>
            ) : (
              <span className="shrink-0 text-ds-muted">
                {t('usageHistoryTitle')}
              </span>
            )}
          </FloatingComposerUsageHistory>
        ) : null}
      </div>
      {footerHint ? (
        <div className="ds-composer-footer-hint">
          <span>{footerHint}</span>
        </div>
      ) : null}
    </div>
  )
}
