import type { ProviderQuotaMetric } from '../../kun/src/contracts/provider-quota.js'
import type { AppLocale } from './app-locales'

export type QuotaResetReminder = { metricId: string; label: string; unusedPercent: number; hoursLeft: number }

const DAY_SECONDS = 86_400
const DEFAULT_WITHIN_HOURS = 6
// Windows a provider labels as a few hours long, when it does not state their length.
const SHORT_WINDOW = /(?:^|[^a-z0-9])(?:[1-9]|1[0-2]|five)[- ]?(?:h|hr|hour)s?(?:$|[^a-z])|hourly|interval/i

/**
 * Whether a window renews often enough that a reminder would only nag: a
 * 5-hour session window renews several times a day. Plan allowances
 * (daily, weekly, monthly) are the ones worth a reminder.
 */
export function shortQuotaWindow(metric: Pick<ProviderQuotaMetric, 'id' | 'label' | 'windowSeconds'>): boolean {
  return metric.windowSeconds !== undefined ? metric.windowSeconds < DAY_SECONDS : SHORT_WINDOW.test(`${metric.id} ${metric.label}`)
}

/**
 * Windows about to renew with much of them unused: allowance that is lost at
 * the reset unless it is spent first. Only metrics with a known usage share,
 * a future reset and a window of a day or more qualify.
 */
export function quotaResetReminders(metrics: readonly ProviderQuotaMetric[], now: number,
  options: { withinHours?: number; minUnusedPercent?: number } = {}): QuotaResetReminder[] {
  const withinMs = (options.withinHours ?? DEFAULT_WITHIN_HOURS) * 3_600_000
  const minUnused = options.minUnusedPercent ?? 40
  return metrics.flatMap((metric) => {
    if (metric.usedPercent === undefined || !metric.resetsAt || shortQuotaWindow(metric)) return []
    const resetsAt = Date.parse(metric.resetsAt)
    if (!Number.isFinite(resetsAt) || resetsAt <= now || resetsAt - now > withinMs) return []
    const unusedPercent = Math.round(100 - metric.usedPercent)
    if (unusedPercent < minUnused) return []
    return [{ metricId: metric.id, label: metric.label, unusedPercent, hoursLeft: Math.max(1, Math.round((resetsAt - now) / 3_600_000)) }]
  })
}

/**
 * When a window next enters the reminder period: the earliest reset of a
 * long window, less the period. Undefined when no window will.
 */
export function nextQuotaReminderAt(metrics: readonly ProviderQuotaMetric[], now: number, withinHours = DEFAULT_WITHIN_HOURS): number | undefined {
  let next: number | undefined
  for (const metric of metrics) {
    if (metric.usedPercent === undefined || !metric.resetsAt || shortQuotaWindow(metric)) continue
    const at = Date.parse(metric.resetsAt) - withinHours * 3_600_000
    if (Number.isFinite(at) && at > now && (next === undefined || at < next)) next = at
  }
  return next
}

const TEXT: Record<AppLocale, { title: string; body: string }> = {
  en: { title: '{{provider}}: allowance renews soon', body: '{{percent}}% of {{label}} is unused and renews in about {{hours}}h.' },
  zh: { title: '{{provider}}：额度即将重置', body: '{{label}} 还有 {{percent}}% 未用，约 {{hours}} 小时后重置。' },
  ja: { title: '{{provider}}: 利用枠がまもなくリセット', body: '{{label}} の {{percent}}% が未使用で、約 {{hours}} 時間後にリセットされます。' },
  ko: { title: '{{provider}}: 곧 사용량이 초기화됩니다', body: '{{label}}의 {{percent}}%가 남아 있으며 약 {{hours}}시간 후 재설정됩니다.' },
  ru: { title: '{{provider}}: лимит скоро обновится', body: '{{percent}}% лимита «{{label}}» не использовано, сброс примерно через {{hours}} ч.' },
  th: { title: '{{provider}}: โควตาจะรีเซ็ตเร็ว ๆ นี้', body: '{{label}} ยังเหลือ {{percent}}% และจะรีเซ็ตในอีกประมาณ {{hours}} ชม.' },
  hi: { title: '{{provider}}: सीमा जल्द रीसेट होगी', body: '{{label}} का {{percent}}% बचा है और लगभग {{hours}} घंटे में रीसेट होगा।' }
}

/** The system notification text for a reminder, in the app's language (same wording as the quota panel). */
export function quotaReminderText(locale: AppLocale | undefined, provider: string, reminder: QuotaResetReminder): { title: string; body: string } {
  const text = TEXT[locale ?? 'en'] ?? TEXT.en
  const fill = (template: string): string => template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(
    key === 'provider' ? provider : key === 'label' ? reminder.label : key === 'percent' ? reminder.unusedPercent : key === 'hours' ? reminder.hoursLeft : ''))
  return { title: fill(text.title), body: fill(text.body) }
}
