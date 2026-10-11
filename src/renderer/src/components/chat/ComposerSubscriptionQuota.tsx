import { useEffect, useState, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProviderQuotaEntry } from '@shared/provider-quota'
import { formatPercent, quotaSeverity } from '../usage/quota-view-model'
import { quotaResetText } from '../usage/QuotaMeter'
import { composerQuotaWindowLabel, composerQuotaWindows } from './composer-subscription-quota-model'
import './composer-subscription-quota.css'

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
    {entry.summary ? <p className="ds-composer-subscription-plan">{entry.summary}</p> : null}
    <div className="ds-composer-subscription-windows">
      {windows.map(({ metric, remainingPercent }) => {
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
