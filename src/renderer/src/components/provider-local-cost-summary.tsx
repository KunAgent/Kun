const USD_TO_CNY_REFERENCE_RATE = 7.2

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
