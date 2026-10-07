import type {
  ProviderQuotaEntry,
  ProviderQuotaMetric
} from '@shared/provider-quota'

/** Whether meters show what is used of each window, or what is left of it. */
export type QuotaDisplayMode = 'used' | 'left'

export type QuotaSeverity = 'ok' | 'warn' | 'danger'

/**
 * The quota list split the way the panel reads it: windowed allowances as
 * cards, plain balances as tiles, providers that need the user as one list,
 * and providers without a quota API only named.
 */
export type QuotaSections = {
  allowances: ProviderQuotaEntry[]
  balances: ProviderQuotaEntry[]
  problems: ProviderQuotaEntry[]
  unsupported: ProviderQuotaEntry[]
}

const HOUR = 3_600
const DAY = 24 * HOUR

/** A metric drawn as a meter: it knows how much of a limit is used. */
export function isMeterMetric(metric: ProviderQuotaMetric): boolean {
  return quotaUsedPercent(metric) !== undefined
}

/** A metric that is only an amount left, like an account balance. */
export function isBalanceMetric(metric: ProviderQuotaMetric): boolean {
  return !isMeterMetric(metric) && metric.remaining !== undefined
}

export function classifyQuotaEntries(entries: readonly ProviderQuotaEntry[]): QuotaSections {
  const sections: QuotaSections = { allowances: [], balances: [], problems: [], unsupported: [] }
  for (const entry of entries) {
    if (entry.status === 'unsupported' && !entry.localCost) {
      sections.unsupported.push(entry)
    } else if (entry.status !== 'available') {
      sections.problems.push(entry)
    } else if (entry.metrics.some(isMeterMetric)) {
      sections.allowances.push(entry)
    } else if (entry.metrics.some(isBalanceMetric)) {
      sections.balances.push(entry)
    } else {
      sections.problems.push(entry)
    }
  }
  sections.allowances.sort((left, right) => tightestUsedPercent(right) - tightestUsedPercent(left))
  return sections
}

/** The share of a window that is used, from whichever figures the provider gave. */
export function quotaUsedPercent(metric: ProviderQuotaMetric): number | undefined {
  if (metric.usedPercent !== undefined && Number.isFinite(metric.usedPercent)) {
    return clampPercent(metric.usedPercent)
  }
  const limit = metric.limit
  if (limit === undefined || !(limit > 0)) return undefined
  if (metric.used !== undefined) return clampPercent((metric.used / limit) * 100)
  if (metric.remaining !== undefined) return clampPercent(((limit - metric.remaining) / limit) * 100)
  return undefined
}

export function tightestUsedPercent(entry: ProviderQuotaEntry): number {
  return entry.metrics.reduce((most, metric) => Math.max(most, quotaUsedPercent(metric) ?? 0), 0)
}

export function quotaSeverity(usedPercent: number): QuotaSeverity {
  if (usedPercent >= 90) return 'danger'
  if (usedPercent >= 75) return 'warn'
  return 'ok'
}

/** How full a meter is drawn: the used share, or what is left of it. */
export function quotaFillPercent(usedPercent: number, mode: QuotaDisplayMode): number {
  const used = clampPercent(usedPercent)
  return mode === 'left' ? 100 - used : used
}

export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) || rounded >= 10 ? Math.round(rounded) : rounded.toFixed(1)}%`
}

/**
 * A metric's own count, when it counts in amounts rather than shares:
 * "340 / 1,500 requests" used, or what is left of them.
 */
export function quotaCountText(
  metric: ProviderQuotaMetric,
  mode: QuotaDisplayMode,
  locale?: string
): string | undefined {
  if (metric.unit === 'percent' || metric.limit === undefined || !(metric.limit > 0)) return undefined
  const used = metric.used ?? (metric.remaining !== undefined ? metric.limit - metric.remaining : undefined)
  if (used === undefined) return undefined
  const shown = mode === 'left' ? Math.max(0, metric.limit - used) : Math.max(0, used)
  if (isCurrency(metric.unit)) {
    return `${formatQuotaAmount(shown, metric.unit, locale)} / ${formatQuotaAmount(metric.limit, metric.unit, locale)}`
  }
  // The unit once, after the limit: "340 / 1,500 requests".
  return `${formatQuotaAmount(shown, '', locale)} / ${formatQuotaAmount(metric.limit, metric.unit, locale)}`
}

function isCurrency(unit: string): boolean {
  return CURRENCIES.has(unit.trim().toUpperCase())
}

const CURRENCIES = new Set(['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD', 'KRW', 'INR', 'RUB', 'THB'])

/** An amount in its unit: a currency as money, anything else as a count. */
export function formatQuotaAmount(value: number, unit: string, locale?: string): string {
  const code = unit.trim().toUpperCase()
  const safe = Number.isFinite(value) ? value : 0
  if (isCurrency(code)) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: Math.abs(safe) >= 1_000 ? 0 : 2
    }).format(safe)
  }
  const compact = Math.abs(safe) >= 100_000
  const number = new Intl.NumberFormat(locale, {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2
  }).format(safe)
  const label = unit === 'percent' ? '%' : unit
  return label === '%' ? `${number}%` : `${number} ${label}`.trim()
}

/** The balance an entry shows on its tile: its first amount left. */
export function primaryBalance(entry: ProviderQuotaEntry): ProviderQuotaMetric | undefined {
  return entry.metrics.find(isBalanceMetric)
}

export type QuotaWindowName = {
  /** The model or pool a window counts, when it counts only some. */
  scope?: string
  /** How long the window runs, in hours or days. */
  span?: { unit: 'hours' | 'days'; count: number }
  /** The provider's own wording, when neither of the above could be read. */
  raw?: string
}

const KNOWN_SCOPES: Record<string, string> = {
  'seven-day-sonnet': 'Sonnet',
  'seven-day-opus': 'Opus',
  'seven-day-oauth-apps': 'OAuth apps'
}

/**
 * A short name for a window: its span ("5-hour", "7-day") and, before it,
 * the model it counts. Providers label windows in English ("7-day Opus
 * usage", "Spark - 5h usage"); the span is read from windowSeconds where the
 * provider states it, and the words left over are the scope.
 */
export function quotaWindowName(metric: ProviderQuotaMetric): QuotaWindowName {
  const span = windowSpan(metric)
  if (!span) return { raw: tidyLabel(metric.label) }
  const scope = KNOWN_SCOPES[metric.id] ?? scopeFromLabel(metric.label)
  return scope ? { scope, span } : { span }
}

function windowSpan(metric: ProviderQuotaMetric): QuotaWindowName['span'] | undefined {
  const seconds = metric.windowSeconds ?? spanFromLabel(`${metric.id} ${metric.label}`)
  if (!seconds || !(seconds > 0)) return undefined
  if (seconds < DAY) return { unit: 'hours', count: Math.max(1, Math.round(seconds / HOUR)) }
  return { unit: 'days', count: Math.max(1, Math.round(seconds / DAY)) }
}

function spanFromLabel(text: string): number | undefined {
  const lower = text.toLowerCase()
  const match = /(\d+)\s*-?\s*(h|hr|hrs|hour|hours|d|day|days)\b/.exec(lower)
  if (match) return Number(match[1]) * (match[2].startsWith('h') ? HOUR : DAY)
  if (/\bfive[-\s]?hour\b/.test(lower)) return 5 * HOUR
  if (/\bseven[-\s]?day\b|\bweekly\b|\bweek\b/.test(lower)) return 7 * DAY
  if (/\bdaily\b/.test(lower)) return DAY
  if (/\bmonthly\b/.test(lower)) return 30 * DAY
  return undefined
}

const SPAN_WORDS = /\b(?:\d+\s*-?\s*(?:h|hr|hrs|hour|hours|d|day|days)|five[-\s]?hour|seven[-\s]?day|weekly|week|daily|monthly|interval)\b/gi
const FILLER_WORDS = /\b(?:usage|quota|window|limit|primary|secondary|rate)\b/gi

function scopeFromLabel(label: string): string | undefined {
  const scope = label
    .replace(SPAN_WORDS, ' ')
    .replace(FILLER_WORDS, ' ')
    .replace(/\s+[-–—:·]\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:·\s]+|[-–—:·\s]+$/g, '')
  return scope.length > 0 ? scope : undefined
}

function tidyLabel(label: string): string {
  const tidy = label.replace(/\s+usage$/i, '').trim()
  return tidy || label
}

export type QuotaPace = {
  /** Where an even burn from the window's start to its reset would be now. */
  expectedUsedPercent: number
  /** Used more than an even burn by a margin worth saying. */
  ahead: boolean
}

/**
 * The even-burn line of a window: full at its start, empty at its reset.
 * Only for windows whose length and reset are both known and still running.
 */
export function quotaPace(metric: ProviderQuotaMetric, now: number): QuotaPace | undefined {
  const used = quotaUsedPercent(metric)
  const seconds = metric.windowSeconds
  if (used === undefined || !seconds || !metric.resetsAt) return undefined
  const resetsAt = Date.parse(metric.resetsAt)
  if (!Number.isFinite(resetsAt) || resetsAt <= now) return undefined
  const start = resetsAt - seconds * 1_000
  if (start >= now) return undefined
  const expectedUsedPercent = clampPercent(((now - start) / (seconds * 1_000)) * 100)
  return {
    expectedUsedPercent,
    ahead: used >= 20 && used - expectedUsedPercent >= 15
  }
}

export type QuotaResetParts = { clock: string; relative?: string }

/**
 * When a window starts again, as the clock reads it (today's time, a weekday
 * this week, a date further out) and how long until then.
 */
export function quotaResetParts(resetsAt: string, now: number, locale?: string): QuotaResetParts | undefined {
  const at = Date.parse(resetsAt)
  if (!Number.isFinite(at)) return undefined
  const date = new Date(at)
  const today = new Date(now)
  const sameDay = date.toDateString() === today.toDateString()
  const withinWeek = Math.abs(at - now) < 6 * DAY * 1_000
  const clock = sameDay
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
    : withinWeek
      ? new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
      : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
  if (at <= now) return { clock }
  return { clock, relative: relativeTime(at - now, locale) }
}

/** "in 2 hours", "3 天后": the largest unit that reads naturally. */
export function relativeTime(deltaMs: number, locale?: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  const minutes = Math.round(deltaMs / 60_000)
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute')
  const hours = Math.round(deltaMs / 3_600_000)
  if (Math.abs(hours) < 36) return format.format(hours, 'hour')
  return format.format(Math.round(deltaMs / 86_400_000), 'day')
}

/** A provider's plan as its card shows it: "max" reads "Max". */
export function quotaPlanLabel(summary: string | undefined): string | undefined {
  const text = summary?.trim()
  if (!text || text.length > 32 || text.includes('@')) return undefined
  if (/^[a-z][a-z0-9_ -]*$/.test(text)) {
    return text.split(/[_\s-]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
  }
  return text
}

/** The account a summary names, when it is an address rather than a plan. */
export function quotaAccountLabel(summary: string | undefined): string | undefined {
  const text = summary?.trim()
  return text && text.includes('@') && text.length <= 120 ? text : undefined
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}
