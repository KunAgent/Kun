import type { Notification } from 'electron'
import type { SystemNotificationResult } from '../shared/kun-gui-notification-contracts'

/** Calling show() merely asks the OS. Record success only after Electron
 * confirms display; explicit failure/timeout remains retryable. */
export function displayNotification(
  notification: Pick<Notification, 'once' | 'removeListener' | 'show'>,
  timeoutMs = 5_000
): Promise<SystemNotificationResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: SystemNotificationResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      notification.removeListener('show', shown)
      notification.removeListener('failed', failed)
      resolve(result)
    }
    const shown = () => finish({ ok: true, shown: true })
    const failed = (_event: unknown, error: string) => finish({ ok: false, message: error || 'Native notification failed' })
    const timer = setTimeout(() => finish({ ok: false, message: 'Native notification display was not confirmed' }), timeoutMs)
    notification.once('show', shown)
    notification.once('failed', failed)
    try { notification.show() }
    catch (error) { finish({ ok: false, message: error instanceof Error ? error.message : String(error) }) }
  })
}
