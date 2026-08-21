import { useEffect, useState, type ReactElement } from 'react'
import { summarizeThreadMoney } from '../../hooks/use-thread-usage'
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
                {moneyItems.length > 0 ? moneyItems.map((item) => (
                  <span
                    key={item.kind}
                    className="ds-composer-usage-metric ds-composer-usage-money shrink-0 tabular-nums"
                    title={item.kind === 'estimate'
                      ? t('sessionUsageEstimateTitle', { defaultValue: 'Reference API-price estimate, not an actual subscription charge.' })
                      : t('sessionUsageActualCostTitle', { defaultValue: 'Recorded API cost.' })}
                  >
                    {item.kind === 'estimate'
                      ? t('sessionUsageFooterEstimate', { value: item.value, defaultValue: 'Estimate ≈{{value}}' })
                      : t('sessionUsageFooterActualCost', { value: item.value, defaultValue: 'Cost {{value}}' })}
                    {item.kind === 'estimate' && item.coverage === 'partial' ? (
                      <span className="ml-1" data-session-usage-estimate-partial>
                        · {t('turnUsageEstimatePartial', { defaultValue: 'Partial estimate' })}
                      </span>
                    ) : null}
                  </span>
                )) : threadUsage.totalTokens > 0 ? (
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
