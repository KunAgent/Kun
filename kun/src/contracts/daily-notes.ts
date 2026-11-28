export type DailyNoteSnapshot = { markdown: string; revision: string }

export type DailyNoteSaveResult =
  | { status: 'saved'; revision: string }
  | { status: 'conflict'; current: DailyNoteSnapshot }

export function localNoteDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function isNoteDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isDailyNoteRevision(value: unknown): value is string {
  return typeof value === 'string' && /^daily-v1:[a-f0-9]{64}$/.test(value)
}
