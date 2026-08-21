export type ZonedDateTimeResult =
  | { ok: true; iso: string }
  | { ok: false; code: 'invalid-date' | 'invalid-time-zone' | 'nonexistent-time' | 'ambiguous-time' | 'past-time'; message: string }

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return Boolean(timeZone.trim())
  } catch {
    return false
  }
}

export function supportedTimeZones(): string[] {
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[]
  }).supportedValuesOf
  if (supportedValuesOf) return supportedValuesOf('timeZone')
  return Array.from(new Set([systemTimeZone(), 'UTC', 'Asia/Shanghai', 'America/New_York', 'Europe/London']))
}

function wallClockParts(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`
}

export function zonedDateTimeToIso(
  date: string,
  time: string,
  timeZone: string,
  nowMs = Date.now()
): ZonedDateTimeResult {
  const wallClock = `${date.trim()}T${time.trim()}`
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(wallClock)) {
    return { ok: false, code: 'invalid-date', message: 'Enter a valid date and time.' }
  }
  if (!isValidTimeZone(timeZone)) {
    return { ok: false, code: 'invalid-time-zone', message: 'Select a valid IANA time zone.' }
  }
  const [year, month, day, hour, minute] = wallClock.split(/[-T:]/).map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const matches: number[] = []
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 1) {
    const candidate = guess + offsetMinutes * 60_000
    if (wallClockParts(candidate, timeZone) === wallClock) matches.push(candidate)
  }
  if (matches.length === 0) {
    return { ok: false, code: 'nonexistent-time', message: 'This local time does not exist in the selected time zone.' }
  }
  const unique = [...new Set(matches)]
  if (unique.length > 1) {
    return { ok: false, code: 'ambiguous-time', message: 'This local time occurs twice in the selected time zone. Choose another time.' }
  }
  if (unique[0] <= nowMs) {
    return { ok: false, code: 'past-time', message: 'Execution time must be in the future.' }
  }
  return { ok: true, iso: new Date(unique[0]).toISOString() }
}

export function formatInTimeZone(iso: string, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(iso))
}

export function relativeScheduleLabel(iso: string, nowMs = Date.now(), locale?: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - nowMs) / 60_000))
  const formatter = new Intl.RelativeTimeFormat(locale ?? 'en', { numeric: 'always' })
  if (minutes < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  return formatter.format(hours, 'hour')
}
