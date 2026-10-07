import { useEffect } from 'react'
import { useChatStore } from '../store/chat-store'

/**
 * Main shows allowance reminders (provider-quota-reminder-service), so they
 * also arrive while this window is closed. Clicking one opens the provider
 * settings here.
 */
export function useQuotaReminderNotifications(enabled: boolean): void {
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.kunGui
    if (!enabled || typeof api?.onQuotaReminderClicked !== 'function') return
    return api.onQuotaReminderClicked(() => useChatStore.getState().openSettings('providers'))
  }, [enabled])
}
