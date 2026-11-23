import { useEffect, useState, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProviderQuotaEntry } from '@shared/provider-quota'
import {
  formatCompoundResetIn,
  formatPercent,
  groupQuotaMetrics,
  quotaSeverity
} from '../usage/quota-view-model'
import { quotaResetText } from '../usage/QuotaMeter'
import { composerQuotaWindowLabel, composerQuotaWindows } from './composer-subscription-quota-model'
import './composer-subscription-quota.css'

const INLINE_RING_RADIUS = 7
const INLINE_RING_LENGTH = 2 * Math.PI * INLINE_RING_RADIUS

function deduplicatePlanSummary(
  providerName: string | undefined,
  summary: string | undefined
): string | undefined {
  const trimmedSummary = summary?.trim()
  if (!trimmedSummary) return undefined
  const trimmedProvider = providerName?.trim()
  if (!trimmedProvider) return trimmedSummary
  const lowerSummary = trimmedSummary.toLowerCase()
  const lowerProvider = trimmedProvider.toLowerCase()
  if (lowerSummary === lowerProvider) return undefined
  const prefix = `${lowerProvider} · `
  if (lowerSummary.startsWith(prefix)) {
    const rest = trimmedSummary.slice(prefix.length).trim()
    return rest || undefined
  }
  return trimmedSummary
}

export function ComposerSubscriptionQuota({ entry, refreshedAt, refreshing, onRefresh }: {
  entry: ProviderQuotaEntry
  refreshedAt?: string
  refreshing: boolean
  onRefresh: () => void
}): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') setNow(Date.now()) }, 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const windows = composerQuotaWindows(entry)
  if (!windows.length) return null
  const remainingById = new Map(windows.map((window) => [window.metric.id, window.remainingPercent]))
  const groups = groupQuotaMetrics(windows.map((window) => window.metric))
  const planSummary = deduplicatePlanSummary(entry.providerName, entry.summary)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const updated = Date.parse(entry.updatedAt ?? refreshedAt ?? '')
  const updatedText = Number.isFinite(updated)
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(updated) : undefined
  return <section className="ds-composer-subscription" data-composer-subscription-quota aria-label={t('subscriptionQuota.title')}>
    <header className="ds-composer-subscription-header">
      <div className="min-w-0">
        <h3>{t('subscriptionQuota.title')}</h3>
        {entry.providerName ? <p className="ds-composer-subscription-account" title={entry.providerName}>{entry.providerName}</p> : null}
      </div>
      <button type="button" className="ds-composer-subscription-refresh" onClick={onRefresh} disabled={refreshing}
        aria-label={t('subscriptionQuota.refresh')} title={t('subscriptionQuota.refresh')}>
        <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
      </button>
    </header>
    {planSummary ? <p className="ds-composer-subscription-plan">{planSummary}</p> : null}
    <div className="ds-composer-subscription-windows">
      {groups ? groups.map((group) => (
        <div key={group.title} className="ds-composer-subscription-group" data-quota-group={group.title}>
          <h4 className="ds-composer-subscription-group-title">{group.title}</h4>
          <div className="ds-composer-subscription-group-rows">
            {group.items.map(({ metric, windowTitle }) => {
              const remainingPercent = remainingById.get(metric.id) ?? 0
              const remaining = `${formatPercent(remainingPercent)} left`
              const reset = metric.resetsAt ? formatCompoundResetIn(metric.resetsAt, now) : undefined
              return (
                <div
                  className="ds-composer-subscription-window is-grouped"
                  key={metric.id}
                  data-quota-window={metric.id}
                  data-severity={quotaSeverity(100 - remainingPercent)}
                >
                  <div className="ds-composer-subscription-grouped-row">
                    <div className="ds-composer-subscription-grouped-copy">
                      <span>{windowTitle}</span>
                      {reset ? <p className="ds-composer-subscription-reset">{reset}</p> : null}
                    </div>
                    <div className="ds-composer-subscription-grouped-value">
                      <strong>{remaining}</strong>
                      <span
                        className="ds-composer-subscription-ring"
                        role="progressbar"
                        aria-label={metric.label}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(remainingPercent)}
                        aria-valuetext={remaining}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <circle className="ds-composer-subscription-ring-track" cx="10" cy="10" r={INLINE_RING_RADIUS} />
                          <circle
                            className="ds-composer-subscription-ring-fill"
                            cx="10"
                            cy="10"
                            r={INLINE_RING_RADIUS}
                            strokeDasharray={`${(remainingPercent / 100) * INLINE_RING_LENGTH} ${INLINE_RING_LENGTH}`}
                          />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )) : windows.map(({ metric, remainingPercent }) => {
        const label = composerQuotaWindowLabel(metric, t)
        const remaining = formatPercent(remainingPercent)
        const reset = quotaResetText(metric, now, t, locale)
        return <div className="ds-composer-subscription-window" key={metric.id} data-quota-window={metric.id} data-severity={quotaSeverity(100 - remainingPercent)}>
          <div className="ds-composer-subscription-window-heading">
            <span>{label}</span><strong>{t('subscriptionQuota.remaining', { percent: remaining })}</strong>
          </div>
          <div className="ds-composer-subscription-track" role="progressbar" aria-label={t('subscriptionQuota.windowRemaining', { window: label })}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remainingPercent)} aria-valuetext={t('subscriptionQuota.remaining', { percent: remaining })}>
            <span style={{ width: `${remainingPercent}%` }} />
          </div>
          {reset ? <p className="ds-composer-subscription-reset">{reset}</p> : null}
        </div>
      })}
    </div>
    {updatedText ? <p className="ds-composer-subscription-updated">{t('subscriptionQuota.updated', { time: updatedText })}</p> : null}
  </section>
}
