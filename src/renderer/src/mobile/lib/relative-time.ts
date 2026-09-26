const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** Compact "3h"/"昨天" style timestamp for mobile list rows. */
export function mobileRelativeTime(iso: string, locale: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const diff = Date.now() - ms
  const abs = Math.abs(diff)
  if (abs >= WEEK) return new Date(ms).toLocaleDateString(locale)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < MINUTE) return rtf.format(0, 'minute')
  if (abs < HOUR) return rtf.format(-Math.trunc(diff / MINUTE), 'minute')
  if (abs < DAY) return rtf.format(-Math.trunc(diff / HOUR), 'hour')
  return rtf.format(-Math.trunc(diff / DAY), 'day')
}
