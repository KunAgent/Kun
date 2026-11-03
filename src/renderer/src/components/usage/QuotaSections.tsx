import { AlertCircle, ExternalLink, KeyRound, RefreshCw } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ProviderLocalCostSummary,
  ProviderQuotaEntry,
  ProviderQuotaMetric
} from '@shared/provider-quota'
import { quotaResetReminders } from '@shared/provider-quota-reminders'
import { ProviderIcon } from '../provider-icon'
import { formatProviderLocalCostAmount } from '../provider-local-cost-summary'
import { QuotaBarMeter, QuotaRingMeter, quotaResetText, quotaWindowLabel } from './QuotaMeter'
import {
  formatQuotaAmount,
  isMeterMetric,
  primaryBalance,
  quotaAccountLabel,
  quotaPlanLabel,
  type QuotaDisplayMode
} from './quota-view-model'

export type QuotaCardVariant = 'bars' | 'rings'

const COLLAPSED_METERS: Record<QuotaCardVariant, number> = { bars: 4, rings: 3 }

type CardContext = {
  mode: QuotaDisplayMode
  onToggleMode: () => void
  now: number
  locale?: string
}

export function QuotaModeToggle({
  mode,
  onChange
}: {
  mode: QuotaDisplayMode
  onChange: (mode: QuotaDisplayMode) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="kq-seg" role="radiogroup" aria-label={t('usagePanelModeLabel')}>
      {(['used', 'left'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={mode === option}
          data-active={mode === option ? 'true' : 'false'}
          data-quota-mode={option}
          onClick={() => onChange(option)}
          title={t(option === 'left' ? 'usagePanelShowLeftHint' : 'usagePanelShowUsedHint')}
        >
          {t(option === 'left' ? 'usagePanelModeLeft' : 'usagePanelModeUsed')}
        </button>
      ))}
    </div>
  )
}

function CardHead({
  entry,
  onOpenDashboard,
  trailing
}: {
  entry: ProviderQuotaEntry
  onOpenDashboard?: (url: string) => void
  trailing?: ReactElement | null
}): ReactElement {
  const { t } = useTranslation('common')
  const plan = quotaPlanLabel(entry.summary)
  const account = quotaAccountLabel(entry.summary)
  return (
    <div className="kq-card-head" title={entry.source}>
      <span className="kq-card-icon">
        <ProviderIcon presetId={entry.presetId} providerId={entry.providerId} size={16} />
      </span>
      <span className="kq-card-title">
        <strong title={entry.providerName}>{entry.providerName}</strong>
        {account ? <small title={account}>{account}</small> : null}
      </span>
      {plan ? <span className="kq-plan" title={entry.summary}>{plan}</span> : null}
      {trailing}
      {entry.dashboardUrl && onOpenDashboard ? (
        <button
          type="button"
          className="kq-icon-button"
          onClick={() => onOpenDashboard(entry.dashboardUrl!)}
          aria-label={t('providerQuotaOpenDashboard', { provider: entry.providerName })}
          title={t('providerQuotaOpenDashboard', { provider: entry.providerName })}
        >
          <ExternalLink aria-hidden="true" strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  )
}

/** A metric that is not a meter, on a line of its own: a balance, a count of resets. */
function QuotaDetailRow({ metric, now, locale }: { metric: ProviderQuotaMetric; now: number; locale?: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const amount = metric.remaining ?? metric.used ?? metric.limit
  if (amount === undefined) return null
  const reset = quotaResetText(metric, now, t, locale)
  return (
    <div className="kq-detail-row" data-quota-metric={metric.id}>
      <span>{quotaWindowLabel(metric, t)}</span>
      <strong>{formatQuotaAmount(amount, metric.unit, locale)}</strong>
      {reset ? <small>{reset}</small> : null}
    </div>
  )
}

function LocalCostLine({ summary, locale }: { summary: ProviderLocalCostSummary; locale?: string }): ReactElement {
  const { t } = useTranslation('common')
  const amount = (value: number | null): string => value === null
    ? t('providerQuotaLocalCostUnavailable')
    : formatProviderLocalCostAmount(value, locale)
  return (
    <p className="kq-local-cost" title={t('providerQuotaLocalCostDisclaimer')} data-provider-local-cost>
      {t('usagePanelLocalCost', {
        today: amount(summary.today.amount),
        month: amount(summary.last30Days.amount)
      })}
    </p>
  )
}

export function QuotaAllowanceCard({
  entry,
  variant,
  expanded,
  onToggleExpanded,
  onOpenDashboard,
  ...context
}: CardContext & {
  entry: ProviderQuotaEntry
  variant: QuotaCardVariant
  expanded: boolean
  onToggleExpanded: () => void
  onOpenDashboard?: (url: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const meters = entry.metrics.filter(isMeterMetric)
  const details = entry.metrics.filter((metric) => !isMeterMetric(metric))
  const limit = COLLAPSED_METERS[variant]
  const shown = expanded ? meters : meters.slice(0, limit)
  const hidden = meters.length - shown.length
  const reminders = quotaResetReminders(meters, context.now)
  const Meter = variant === 'rings' ? QuotaRingMeter : QuotaBarMeter
  const moreButton = meters.length > limit ? (
    <button
      type="button"
      className="kq-text-button"
      aria-expanded={expanded}
      onClick={onToggleExpanded}
      data-quota-more={entry.providerId}
    >
      {expanded ? t('usagePanelShowFewerWindows') : t('usagePanelShowAllWindows', { count: meters.length })}
    </button>
  ) : null
  return (
    <article className="kq-card" data-variant={variant} data-quota-provider={entry.providerId}>
      <CardHead entry={entry} onOpenDashboard={onOpenDashboard} />
      {variant === 'rings' ? (
        <div className="kq-rings-row">
          <p className="kq-rings-reset">
            {shown.map((metric) => quotaResetText(metric, context.now, t, context.locale)).filter(Boolean)[0] ??
              t('usagePanelNoReset')}
          </p>
          <div className="kq-rings">
            {shown.map((metric) => <Meter key={metric.id} metric={metric} {...context} />)}
          </div>
        </div>
      ) : (
        <div className="kq-meters">
          {shown.map((metric) => <Meter key={metric.id} metric={metric} {...context} />)}
        </div>
      )}
      {hidden > 0 || expanded ? <div className="kq-card-more">{moreButton}</div> : null}
      {details.map((metric) => (
        <QuotaDetailRow key={metric.id} metric={metric} now={context.now} locale={context.locale} />
      ))}
      {reminders.map((reminder) => (
        <p key={reminder.metricId} className="kq-reminder" data-quota-reset-reminder={reminder.metricId}>
          {t('providerQuotaResetReminder', {
            label: quotaWindowLabel(meters.find((metric) => metric.id === reminder.metricId)!, t),
            percent: reminder.unusedPercent,
            hours: reminder.hoursLeft
          })}
        </p>
      ))}
      {entry.localCost ? <LocalCostLine summary={entry.localCost} locale={context.locale} /> : null}
    </article>
  )
}

export function QuotaBalanceGrid({
  entries,
  locale,
  onOpenDashboard
}: {
  entries: ProviderQuotaEntry[]
  locale?: string
  onOpenDashboard?: (url: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="kq-balances">
      {entries.map((entry) => {
        const balance = primaryBalance(entry)
        const others = entry.metrics.filter((metric) => metric !== balance && metric.remaining !== undefined)
        const clickable = Boolean(entry.dashboardUrl && onOpenDashboard)
        const body = (
          <>
            <span className="kq-balance-name">
              <ProviderIcon presetId={entry.presetId} providerId={entry.providerId} size={14} />
              <span title={entry.providerName}>{entry.providerName}</span>
            </span>
            <strong className="kq-balance-amount">
              {balance?.remaining !== undefined ? formatQuotaAmount(balance.remaining, balance.unit, locale) : '—'}
            </strong>
            {others.map((metric) => (
              <span key={metric.id} className="kq-balance-extra">
                {quotaWindowLabel(metric, t)} {formatQuotaAmount(metric.remaining!, metric.unit, locale)}
              </span>
            ))}
            {entry.localCost ? <LocalCostLine summary={entry.localCost} locale={locale} /> : null}
          </>
        )
        return clickable ? (
          <button
            key={entry.providerId}
            type="button"
            className="kq-balance"
            data-quota-provider={entry.providerId}
            onClick={() => onOpenDashboard!(entry.dashboardUrl!)}
            title={t('providerQuotaOpenDashboard', { provider: entry.providerName })}
          >
            {body}
          </button>
        ) : (
          <div key={entry.providerId} className="kq-balance" data-quota-provider={entry.providerId}>
            {body}
          </div>
        )
      })}
    </div>
  )
}

export function QuotaProblemList({
  entries,
  locale,
  retrying,
  onRetry,
  onFix,
  fixLabel
}: {
  entries: ProviderQuotaEntry[]
  locale?: string
  retrying: boolean
  onRetry: () => void
  onFix?: () => void
  fixLabel?: string
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="kq-problems">
      {entries.map((entry) => {
        const credentials = entry.status === 'missing_credentials'
        const message = entry.message ||
          (credentials ? t('providerQuotaMissingCredentialsHint')
            : entry.status === 'available' ? t('providerQuotaNoMetrics') : t('providerQuotaLoadFailed'))
        return (
          <div key={entry.providerId} className="kq-problem" data-quota-provider={entry.providerId} data-status={entry.status}>
            <span className="kq-card-icon">
              <ProviderIcon presetId={entry.presetId} providerId={entry.providerId} size={15} />
            </span>
            <span className="kq-problem-copy">
              <span className="kq-problem-title">
                <strong title={entry.providerName}>{entry.providerName}</strong>
                <span className="kq-problem-status">
                  {credentials ? <KeyRound aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
                  {t(credentials ? 'providerQuotaMissingCredentials'
                    : entry.status === 'available' ? 'usagePanelNoData' : 'providerQuotaError')}
                </span>
              </span>
              <small title={message}>{message}</small>
              {entry.localCost ? <LocalCostLine summary={entry.localCost} locale={locale} /> : null}
            </span>
            {credentials && onFix ? (
              <button type="button" className="kq-chip-button" onClick={onFix}>{fixLabel}</button>
            ) : !credentials ? (
              <button
                type="button"
                className="kq-chip-button"
                onClick={onRetry}
                disabled={retrying}
                aria-label={t('usagePanelRetryProvider', { provider: entry.providerName })}
              >
                <RefreshCw aria-hidden="true" className={retrying ? 'kq-spin' : undefined} />
                {t('usagePanelRetry')}
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function QuotaUnsupportedNote({ entries, locale }: { entries: ProviderQuotaEntry[]; locale?: string }): ReactElement {
  const { t } = useTranslation('common')
  const names = entries.map((entry) => entry.providerName).join(/^(?:zh|ja)\b/i.test(locale ?? '') ? '、' : ', ')
  return (
    <p className="kq-footnote" data-quota-unsupported title={t('providerQuotaUnsupportedHint')}>
      {t('usagePanelUnsupportedNote', { count: entries.length, names })}
    </p>
  )
}

export function QuotaSectionHead({
  label,
  count,
  children
}: {
  label: string
  count?: number
  children?: ReactElement | null
}): ReactElement {
  return (
    <div className="kq-section-head">
      <h3>{label}</h3>
      {count !== undefined ? <span className="kq-count">{count}</span> : null}
      <span className="kq-grow" />
      {children}
    </div>
  )
}
