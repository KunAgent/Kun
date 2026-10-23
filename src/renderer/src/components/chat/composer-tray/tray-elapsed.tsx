import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

/** Minimal `t` shape so pure helpers stay testable without i18next. */
export type TrayTranslate = (key: string, options?: Record<string, unknown>) => string

/**
 * - `seconds`: exact running time, "3 分 12 秒" / "3m 12s" (shells, workers)
 * - `minutes`: coarse elapsed time, "26 分钟" / "26 min" (goal, todo step)
 */
export type TrayDurationPrecision = 'seconds' | 'minutes'

function wholeSeconds(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

/** Localized duration label from a number of seconds. */
export function formatTrayDuration(
  totalSeconds: number,
  t: TrayTranslate,
  precision: TrayDurationPrecision = 'seconds'
): string {
  const value = wholeSeconds(totalSeconds)
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const seconds = value % 60
  if (precision === 'minutes') {
    if (value < 60) return t('composerTray.duration.underMinute')
    if (hours === 0) return t('composerTray.duration.minutesRounded', { minutes })
    return minutes === 0
      ? t('composerTray.duration.hoursRounded', { hours })
      : t('composerTray.duration.hoursMinutesRounded', { hours, minutes })
  }
  if (value < 60) return t('composerTray.duration.seconds', { seconds })
  if (hours === 0) {
    return seconds === 0
      ? t('composerTray.duration.minutes', { minutes })
      : t('composerTray.duration.minutesSeconds', { minutes, seconds })
  }
  return minutes === 0
    ? t('composerTray.duration.hours', { hours })
    : t('composerTray.duration.hoursMinutes', { hours, minutes })
}

/** "2 分钟前" / "2 min ago"; under a minute reads "刚刚" / "just now". */
export function formatTrayAgo(secondsAgo: number, t: TrayTranslate): string {
  const value = wholeSeconds(secondsAgo)
  if (value < 60) return t('composerTray.duration.justNow')
  return t('composerTray.duration.ago', { duration: formatTrayDuration(value, t, 'minutes') })
}

/** Seconds between an epoch-ms (or ISO) start and `nowMs`; null when unknown. */
export function elapsedSecondsSince(
  start: number | string | null | undefined,
  nowMs: number
): number | null {
  const startMs = toEpochMs(start)
  if (startMs == null) return null
  return Math.max(0, Math.floor((nowMs - startMs) / 1000))
}

/**
 * Wall clock that re-renders once per second while `active` and mounted.
 * Inactive callers get a stable value (no timer), so idle trays cost nothing.
 */
export function useTrayNow(active: boolean, intervalMs = 1000): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!active || typeof window === 'undefined') return
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  return nowMs
}

function toEpochMs(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Elapsed-time label. With `since` and no `until` it ticks once per second
 * (override with `live`); with `until` it shows the fixed span. `baseSeconds`
 * adds already-accumulated time (e.g. a goal's persisted `timeUsedSeconds`).
 * Renders nothing when there is no time to show.
 */
export function TrayElapsedLabel({
  since,
  until,
  baseSeconds = 0,
  live,
  precision = 'seconds',
  className
}: {
  since?: number | string | null
  until?: number | string | null
  baseSeconds?: number
  live?: boolean
  precision?: TrayDurationPrecision
  className?: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  const endMs = toEpochMs(until)
  const ticking = live ?? (since != null && endMs == null)
  const nowMs = useTrayNow(ticking)
  const running = elapsedSecondsSince(since, endMs ?? nowMs)
  if (running == null && baseSeconds <= 0) return null
  const total = wholeSeconds(baseSeconds) + (running ?? 0)
  return (
    <span className={`tabular-nums ${className ?? ''}`.trim()}>
      {formatTrayDuration(total, t, precision)}
    </span>
  )
}
