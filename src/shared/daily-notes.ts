import type { AppLocale } from './app-locales'

export type DailyNotesAppearance = { locale: AppLocale; theme: 'light' | 'dark' | 'system' }

export type DailyNotesContext = DailyNotesAppearance & { pinned: boolean; canPin: boolean }

export interface DailyNotesApi {
  context(): Promise<DailyNotesContext>
  listDays(): Promise<string[]>
  read(day: string): Promise<string>
  save(day: string, markdown: string): Promise<void>
  setPinned(enabled: boolean): Promise<boolean>
  onCloseRequest(finishEditing: () => Promise<boolean>): () => void
}

export const DAILY_NOTES_CHANNELS = {
  open: 'daily-notes:open',
  context: 'daily-notes:context',
  listDays: 'daily-notes:list-days',
  read: 'daily-notes:read',
  save: 'daily-notes:save',
  pin: 'daily-notes:pin',
  requestClose: 'daily-notes:request-close',
  finishClose: 'daily-notes:finish-close'
} as const

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
