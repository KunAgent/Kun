const DAY = 24 * 60 * 60 * 1000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Chat-list timestamp: 14:05, 昨天, 周三, 9/20, 2025/9/20. */
export function imListTime(iso: string, locale: string, now = new Date()): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const date = new Date(ms)
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY)
  if (days <= 0) return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day')
  if (days < 7) return date.toLocaleDateString(locale, { weekday: 'short' })
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
  }
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric' })
}
