import type { AppSettingsV1 } from '../shared/app-settings'

/** Validation for renderer-supplied allowance reminders; keeps text short and printable. */
export type QuotaReminderPayload = { title: string; body: string; dedupeKey: string }

export function parseQuotaReminderPayload(input: unknown): QuotaReminderPayload {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const text = (raw: unknown, max: number): string => typeof raw === 'string'
    ? [...raw.trim()].filter((char) => char.charCodeAt(0) >= 32 || char === '\n').join('').slice(0, max) : ''
  const title = text(value.title, 80)
  const body = text(value.body, 240)
  const dedupeKey = typeof value.dedupeKey === 'string' && /^[\w:.@/+-]{1,200}$/.test(value.dedupeKey) ? value.dedupeKey : ''
  if (!title || !body || !dedupeKey) throw new Error('Invalid quota reminder')
  return { title, body, dedupeKey: `quota:${dedupeKey}` }
}

export function quotaRemindersDisabled(settings: Pick<AppSettingsV1, 'notifications'>): boolean {
  return settings.notifications.quotaReminders === false
}
