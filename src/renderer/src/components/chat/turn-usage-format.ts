import type { TurnUsageActualCost } from '../../hooks/use-turn-usage'

export function formatTurnActualCost(
  cost: TurnUsageActualCost,
  locale?: string
): string {
  const value = Math.max(0, Number.isFinite(cost.amount) ? cost.amount : 0)
  if (value > 0 && value < 0.0001) {
    const symbol = cost.currency === 'USD' ? '$' : cost.currency === 'CNY' ? '￥' : `${cost.currency} `
    return `${symbol}<0.0001`
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: cost.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 4
  }).format(value)
}

export function formatExactTurnUsageCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(
    Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0))
  )
}

export function formatTurnUsagePercent(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)))
}
