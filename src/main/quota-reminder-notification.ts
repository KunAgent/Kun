import { app, Notification } from 'electron'
import { join } from 'node:path'
import type { SystemNotificationResult } from '../shared/kun-gui-notification-contracts'
import type { ProviderQuotaListResult } from '../shared/provider-quota'
import { notificationIconOptions } from './app-icon'
import { appEnvironment, appIcon, mainState } from './main-app-context'
import { revealMainWindow } from './main-tray'
import { displayNotification } from './notification-display'
import { NotificationReceipts } from './notification-receipts'
import { parseQuotaReminderPayload, quotaRemindersDisabled, type QuotaReminderPayload } from './quota-reminder-payload'
import { startProviderQuotaReminders } from './services/provider-quota-reminder-service'

/**
 * Provider allowance reminders. Main computes them from quota lists (see
 * provider-quota-reminder-service), checks the user's preference, shows each
 * window's reminder once (receipts survive restarts) and, on click, brings
 * the window forward with the provider settings.
 */
export const QUOTA_REMINDER_CLICKED_CHANNEL = 'notification:quota-reminder:clicked'

export type QuotaReminderResult = SystemNotificationResult | { ok: true; shown: false; reason: string }

let receipts: NotificationReceipts | undefined

export async function showQuotaReminderNotification(payload: QuotaReminderPayload): Promise<QuotaReminderResult> {
  if (quotaRemindersDisabled(await mainState.store.load())) return { ok: true, shown: false, reason: 'disabled' }
  if (!Notification.isSupported()) return { ok: true, shown: false, reason: 'unsupported' }
  receipts ??= new NotificationReceipts(join(app.getPath('userData'), 'notification-receipts.json'))
  return receipts.deliver(payload.dedupeKey, async () => {
    const notification = new Notification({
      title: appEnvironment.flavor === 'development' ? `[DV] ${payload.title}` : payload.title,
      body: payload.body,
      ...notificationIconOptions(appIcon)
    })
    notification.on('click', () => {
      revealMainWindow()
      const window = mainState.mainWindow
      if (window && !window.isDestroyed()) window.webContents.send(QUOTA_REMINDER_CLICKED_CHANNEL)
    })
    return displayNotification(notification)
  })
}

/** Starts reminders over the runtime's quota list; call once the IPC layer is ready. */
export function startQuotaReminderNotifications(list: () => Promise<ProviderQuotaListResult>): void {
  startProviderQuotaReminders({
    list,
    show: (payload) => showQuotaReminderNotification(parseQuotaReminderPayload(payload)),
    settings: () => mainState.store.load()
  })
}
