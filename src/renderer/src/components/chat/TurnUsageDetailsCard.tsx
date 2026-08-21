import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  TurnUsageReferencePriceGroup,
  TurnUsageReferencePriceItem,
  TurnUsageSummary
} from '../../hooks/use-turn-usage'
import {
  formatProviderLocalCostDetailedAmount,
  formatProviderLocalCostRate
} from '../provider-local-cost-summary'
import {
  formatExactTurnUsageCount,
  formatTurnActualCost,
  formatTurnUsagePercent
} from './turn-usage-format'

export function TurnUsageDetailsCard({
  usage,
  stale = false
}: {
  usage: TurnUsageSummary
  stale?: boolean
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const locale = i18n.resolvedLanguage ?? i18n.language
  const cachedInput = Math.min(usage.inputTokens, usage.cachedTokens)
  const cacheWrite = Math.min(usage.cacheWriteTokens, usage.inputTokens - cachedInput)
  const uncachedInput = Math.max(0, usage.inputTokens - cachedInput - cacheWrite)
  const cacheRate = usage.inputTokens > 0 ? cachedInput / usage.inputTokens : 0
  const breakdown = usage.referencePriceBreakdown
  const models = usage.models.join(', ') || t('turnUsageDetailsUnknownModel')

  return (
    <div className="text-[12px] leading-5 text-ds-muted" data-turn-usage-details-content>
      <div className="flex items-start justify-between gap-4 border-b border-ds-border-muted px-4 py-3">
        <div className="min-w-0">
          <div className="font-semibold text-ds-ink">{t('turnUsageDetailsTitle')}</div>
          <div className="mt-0.5 break-words text-[11px] text-ds-faint">
            {t('turnUsageDetailsMeta', {
              models,
              requests: formatExactTurnUsageCount(usage.requests, locale)
            })}
          </div>
        </div>
        <div className="shrink-0 text-right font-semibold tabular-nums text-ds-ink">
          {breakdown
            ? `≈${formatProviderLocalCostDetailedAmount(breakdown.amount, locale)}`
            : usage.actualCost
              ? formatTurnActualCost(usage.actualCost, locale)
              : usage.referenceEstimateUsd !== null
                ? `≈${formatProviderLocalCostDetailedAmount(usage.referenceEstimateUsd, locale)}`
                : '—'}
        </div>
      </div>

      <section className="px-4 py-3" aria-label={t('turnUsageDetailsTokens')}>
        <div className="mb-1.5 font-medium text-ds-ink">{t('turnUsageDetailsTokens')}</div>
        <UsageRow label={t('turnUsageDetailsInput')} value={usage.inputTokens} locale={locale} strong />
        <UsageRow label={t('turnUsageDetailsUncachedInput')} value={uncachedInput} locale={locale} inset />
        <UsageRow
          label={t('turnUsageDetailsCacheRead', { rate: formatTurnUsagePercent(cacheRate, locale) })}
          value={cachedInput}
          locale={locale}
          inset
        />
        {cacheWrite > 0 ? (
          <UsageRow label={t('turnUsageDetailsCacheWrite')} value={cacheWrite} locale={locale} inset />
        ) : null}
        <UsageRow label={t('turnUsageDetailsOutput')} value={usage.outputTokens} locale={locale} strong />
        {usage.reasoningTokens > 0 ? (
          <UsageRow
            label={t('turnUsageDetailsReasoningIncluded')}
            value={usage.reasoningTokens}
            locale={locale}
            inset
          />
        ) : null}
        <div className="mt-1 border-t border-ds-border-muted pt-1">
          <UsageRow label={t('turnUsageDetailsTotal')} value={usage.totalTokens} locale={locale} strong />
        </div>
      </section>

      {usage.actualCost ? (
        <section className="border-t border-ds-border-muted px-4 py-3" data-turn-usage-actual-details>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-ds-ink">{t('turnUsageDetailsActualCost')}</span>
            <span className="font-semibold tabular-nums text-ds-ink">
              {formatTurnActualCost(usage.actualCost, locale)}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-ds-faint">{t('turnUsageDetailsActualOnly')}</p>
        </section>
      ) : null}

      {breakdown ? (
        <section className="border-t border-ds-border-muted px-4 py-3" data-turn-usage-price-details>
          <div className="mb-2 font-medium text-ds-ink">{t('turnUsageDetailsPricing')}</div>
          <div className="grid gap-3">
            {breakdown.groups.map((group, index) => (
              <PriceGroup key={priceGroupKey(group, index)} group={group} locale={locale} />
            ))}
          </div>
          {breakdown.unpricedRequests > 0 ? (
            <p className="mt-2 rounded-md bg-amber-500/8 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
              {t('turnUsageDetailsUnpricedRequests', {
                count: breakdown.unpricedRequests
              })}
            </p>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-ds-border-muted pt-2 font-semibold text-ds-ink">
            <span>{t('turnUsageDetailsReferenceTotal')}</span>
            <span className="tabular-nums">≈{formatProviderLocalCostDetailedAmount(breakdown.amount, locale)}</span>
          </div>
        </section>
      ) : usage.referenceEstimateUsd !== null && usage.estimateCoverage !== 'unavailable' ? (
        <p className="border-t border-ds-border-muted px-4 py-2.5 text-[11px] text-ds-faint" data-turn-usage-legacy-details>
          {t('turnUsageDetailsLegacyBreakdown')}
        </p>
      ) : null}

      <div className="border-t border-ds-border-muted px-4 py-2.5 text-[10.5px] leading-4 text-ds-faint">
        {usage.referenceEstimateUsd !== null ? <p>{t('sessionUsageEstimateTitle')}</p> : null}
        {usage.estimateCoverage === 'partial' ? <p>{t('turnUsageEstimatePartial')}</p> : null}
        {stale ? <p>{t('turnUsageStaleTitle')}</p> : null}
      </div>
    </div>
  )
}

function UsageRow({
  label,
  value,
  locale,
  inset = false,
  strong = false
}: {
  label: string
  value: number
  locale?: string
  inset?: boolean
  strong?: boolean
}): ReactElement {
  return (
    <div className={`flex items-center justify-between gap-3 ${inset ? 'pl-3 text-ds-faint' : ''}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-medium text-ds-ink' : ''}`}>
        {formatExactTurnUsageCount(value, locale)}
      </span>
    </div>
  )
}

function PriceGroup({
  group,
  locale
}: {
  group: TurnUsageReferencePriceGroup
  locale?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const mode = group.pricingMode === 'fast' && group.fastMultiplier
    ? t('turnUsagePricingFast', { multiplier: group.fastMultiplier })
    : group.pricingMode === 'long_context'
      ? t('turnUsagePricingLongContext')
      : t('turnUsagePricingStandard')
  const items = group.items.filter((item) => item.tokens > 0)
  return (
    <div className="rounded-lg border border-ds-border-muted bg-ds-surface-subtle/60 p-2.5" data-price-mode={group.pricingMode}>
      <div className="mb-1.5 flex items-start justify-between gap-3 text-[11px]">
        <span className="min-w-0 break-words font-medium text-ds-ink">
          {t('turnUsageDetailsPriceGroup', {
            model: group.model,
            mode,
            requests: formatExactTurnUsageCount(group.requestCount, locale)
          })}
        </span>
      </div>
      <div className="grid gap-1">
        {items.map((item) => <PriceItem key={item.kind} item={item} locale={locale} />)}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-ds-border-muted pt-1.5 font-medium text-ds-ink">
        <span>{t('turnUsageDetailsGroupSubtotal')}</span>
        <span className="tabular-nums">{formatProviderLocalCostDetailedAmount(group.amount, locale)}</span>
      </div>
    </div>
  )
}

function PriceItem({
  item,
  locale
}: {
  item: TurnUsageReferencePriceItem
  locale?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const labelKey = {
    uncached_input: 'turnUsageDetailsUncachedInput',
    cache_read: 'turnUsageDetailsCacheReadShort',
    cache_write: 'turnUsageDetailsCacheWrite',
    output: 'turnUsageDetailsOutput'
  }[item.kind]
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 text-[11px]">
      <span className="min-w-0 text-ds-muted">
        {t(labelKey)} · {formatExactTurnUsageCount(item.tokens, locale)} ×{' '}
        {t('turnUsageDetailsPerMillion', {
          rate: formatProviderLocalCostRate(item.ratePerMillion, locale)
        })}
      </span>
      <span className="whitespace-nowrap tabular-nums text-ds-ink">
        {formatProviderLocalCostDetailedAmount(item.amount, locale)}
      </span>
    </div>
  )
}

function priceGroupKey(group: TurnUsageReferencePriceGroup, index: number): string {
  return `${group.model}:${group.pricingMode}:${group.fastMultiplier ?? 1}:${index}`
}
