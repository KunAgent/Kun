import { useEffect } from 'react'
import type { ProviderQuotaListResult } from '@shared/provider-quota'
import { quotaResetReminders } from '@shared/provider-quota-reminders'
import i18n from '../i18n'
import { useChatStore } from '../store/chat-store'

const FIRST_CHECK_MS = 2 * 60_000
const INTERVAL_MS = 60 * 60_000

type ShowReminder = (payload: { title: string; body: string; dedupeKey: string }) => Promise<unknown>

/**
 * Turns quota windows about to renew with much of them unused into reminder
 * notifications. Each window is keyed by provider, metric and reset time, so
 * Main shows it once; Main also applies the user's preference.
 */
export async function sendQuotaReminders(result: ProviderQuotaListResult, now: number, show: ShowReminder): Promise<number> {
  let sent = 0
  for (const entry of result.entries) {
    if (entry.status !== 'available') continue
    for (const reminder of quotaResetReminders(entry.metrics, now)) {
      const metric = entry.metrics.find((item) => item.id === reminder.metricId)
      const dedupeKey = `${entry.providerId}:${reminder.metricId}:${metric?.resetsAt ?? ''}`.replace(/[^\w:.@/+-]/g, '_').slice(0, 200)
      await show({
        title: i18n.t('common:providerQuotaReminderTitle', { provider: entry.providerName }),
        body: i18n.t('common:providerQuotaResetReminder', { label: reminder.label, percent: reminder.unusedPercent, hours: reminder.hoursLeft }),
        dedupeKey
      })
      sent += 1
    }
  }
  return sent
}

export function useQuotaReminderNotifications(enabled: boolean): void {
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.kunGui
    if (!enabled || typeof api?.listProviderQuotas !== 'function' || typeof api.showQuotaReminderNotification !== 'function') return
    let stopped = false
    const check = async (): Promise<void> => {
      try {
        const result = await api.listProviderQuotas()
        if (!stopped) await sendQuotaReminders(result, Date.now(), (payload) => api.showQuotaReminderNotification(payload))
      } catch { /* reminders are best effort */ }
    }
    const first = setTimeout(() => void check(), FIRST_CHECK_MS)
    const timer = setInterval(() => void check(), INTERVAL_MS)
    const off = api.onQuotaReminderClicked?.(() => useChatStore.getState().openSettings('providers'))
    return () => { stopped = true; clearTimeout(first); clearInterval(timer); off?.() }
  }, [enabled])
}
