import { localNoteDay } from '@shared/daily-notes'

/** `YYYY-MM` key of the month containing a note day. */
export function monthOf(day: string): string {
  return day.slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number)
  return localNoteDay(new Date(year, index - 1 + delta, 1, 12)).slice(0, 7)
}

export function shiftDay(day: string, delta: number): string {
  const date = noteDate(day)
  date.setDate(date.getDate() + delta)
  return localNoteDay(date)
}

export function noteDate(day: string): Date {
  return new Date(day + 'T12:00:00')
}

export type MonthCell = { day: string; inMonth: boolean }

/** Six Sunday-first weeks covering the month, so the grid height never jumps. */
export function monthCells(month: string): MonthCell[] {
  const [year, index] = month.split('-').map(Number)
  const first = new Date(year, index - 1, 1, 12)
  const cursor = new Date(first)
  cursor.setDate(1 - first.getDay())
  return Array.from({ length: 42 }, () => {
    const cell = { day: localNoteDay(cursor), inMonth: cursor.getMonth() === first.getMonth() }
    cursor.setDate(cursor.getDate() + 1)
    return cell
  })
}

export function weekdayLabels(locale: string): string[] {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, index) =>
    new Date(2023, 0, 1 + index, 12).toLocaleDateString(locale, { weekday: 'narrow' }))
}

export function monthLabel(locale: string, month: string): string {
  return noteDate(month + '-01').toLocaleDateString(locale, { year: 'numeric', month: 'long' })
}

const LUNAR_DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']

let lunarFormat: Intl.DateTimeFormat | null | undefined

export type LunarInfo = { text: string; isMonthStart: boolean }

/** Chinese lunar day label (month name on the first day), only for Chinese locales. */
export function lunarInfo(locale: string, day: string): LunarInfo | null {
  if (!locale.startsWith('zh')) return null
  if (lunarFormat === undefined) {
    try {
      lunarFormat = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' })
    } catch {
      lunarFormat = null
    }
  }
  if (!lunarFormat) return null
  const parts = lunarFormat.formatToParts(noteDate(day))
  const value = Number(parts.find(part => part.type === 'day')?.value)
  if (value === 1) {
    const month = parts.find(part => part.type === 'month')?.value ?? ''
    return month ? { text: month, isMonthStart: true } : null
  }
  const text = LUNAR_DAYS[value - 1]
  return text ? { text, isMonthStart: false } : null
}

export function lunarLabel(locale: string, day: string): string {
  return lunarInfo(locale, day)?.text ?? ''
}
