import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ProviderLocalCostSummary,
  ProviderLocalCostWindow
} from '@shared/provider-quota'

const USD_TO_CNY_REFERENCE_RATE = 7.2

export type ProviderLocalCostSummaryProps = {
  summary: ProviderLocalCostSummary
  locale?: string
  variant: 'workbench' | 'tray' | 'tray-overview'
}

export function ProviderLocalCostSummaryView({
  summary,
  locale,
  variant
}: ProviderLocalCostSummaryProps): ReactElement {
  const { t } = useTranslation('common')
  const Root = variant === 'tray-overview' ? 'div' : 'section'
  const displayCurrency = isChineseLocale(locale)
    ? t('providerQuotaLocalCostCurrencyCny')
    : summary.currency
  return (
    <Root
      className={`provider-local-cost provider-local-cost-${variant}`}
      data-provider-local-cost={variant}
      aria-hidden={variant === 'tray-overview' ? true : undefined}
    >
      <div className="provider-local-cost-heading">
        <strong>{t('providerQuotaLocalCostTitle')}</strong>
        <span>{displayCurrency}</span>
      </div>
      <div className="provider-local-cost-windows">
        <LocalCostWindow
          id="today"
          label={t('providerQuotaLocalCostToday')}
          locale={locale}
          window={summary.today}
        />
        <LocalCostWindow
          id="last-30-days"
          label={t('providerQuotaLocalCostLast30Days')}
          locale={locale}
          window={summary.last30Days}
        />
      </div>
      {variant !== 'tray-overview' ? (
        <p className="provider-local-cost-disclaimer">
          {t('providerQuotaLocalCostDisclaimer')}
        </p>
      ) : null}
    </Root>
  )
}

function LocalCostWindow({
  id,
  label,
  locale,
  window
}: {
  id: string
  label: string
  locale?: string
  window: ProviderLocalCostWindow
}): ReactElement {
  const { t } = useTranslation('common')
  const amount = window.amount
  const unavailable = amount === null || window.coverage === 'unavailable'
  const amountLabel = unavailable || amount === null
    ? t('providerQuotaLocalCostUnavailable')
    : formatProviderLocalCostAmount(amount, locale)
  return (
    <div
      className="provider-local-cost-window"
      data-provider-local-cost-window={id}
      data-coverage={window.coverage}
    >
      <span className="provider-local-cost-window-label">{label}</span>
      <strong
        className="provider-local-cost-amount"
        title={t('providerQuotaLocalCostDisclaimer')}
      >
        {amountLabel}
      </strong>
      {window.coverage === 'partial' ? (
        <span className="provider-local-cost-coverage">
          {t('providerQuotaLocalCostPartial')}
        </span>
      ) : null}
      <small>
        {t('providerQuotaLocalCostCounts', {
          requests: formatProviderLocalCostCount(window.requests, locale),
          tokens: formatProviderLocalCostCount(window.totalTokens, locale)
        })}
      </small>
    </div>
  )
}

export function formatProviderLocalCostAmount(
  amountUsd: number,
  locale?: string
): string {
  const chinese = isChineseLocale(locale)
  const value = Math.max(0, Number.isFinite(amountUsd) ? amountUsd : 0) * (
    chinese ? USD_TO_CNY_REFERENCE_RATE : 1
  )
  const symbol = chinese ? '￥' : '$'
  if (value > 0 && value < 0.0001) return `${symbol}<0.0001`
  return `${symbol}${value.toFixed(value >= 1 ? 2 : 4)}`
}

export function formatProviderLocalCostDetailedAmount(
  amountUsd: number,
  locale?: string
): string {
  const chinese = isChineseLocale(locale)
  const value = Math.max(0, Number.isFinite(amountUsd) ? amountUsd : 0) * (
    chinese ? USD_TO_CNY_REFERENCE_RATE : 1
  )
  const symbol = chinese ? '￥' : '$'
  if (value > 0 && value < 0.0001) return `${symbol}<0.0001`
  const rounded = Math.round((value + Number.EPSILON) * 10_000) / 10_000
  return `${symbol}${rounded.toFixed(4)}`
}

export function formatProviderLocalCostRate(
  amountUsd: number,
  locale?: string
): string {
  const chinese = isChineseLocale(locale)
  const value = Math.max(0, Number.isFinite(amountUsd) ? amountUsd : 0) * (
    chinese ? USD_TO_CNY_REFERENCE_RATE : 1
  )
  const symbol = chinese ? '￥' : '$'
  return `${symbol}${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)}`
}

export function formatProviderLocalCostCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0)))
}

function isChineseLocale(locale?: string): boolean {
  const normalized = (locale ?? '').trim().toLowerCase()
  return normalized === 'zh' || normalized.startsWith('zh-')
}
