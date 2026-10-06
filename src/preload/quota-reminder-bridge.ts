import { ipcRenderer } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api'

/** Allowance reminder notifications: localized by the renderer, shown once by Main. */
export const quotaReminderPreloadApi: Pick<KunGuiApi, 'showQuotaReminderNotification' | 'onQuotaReminderClicked'> = {
  showQuotaReminderNotification: (payload) => ipcRenderer.invoke('notification:quota-reminder', payload),
  onQuotaReminderClicked: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('notification:quota-reminder:clicked', listener)
    return () => ipcRenderer.removeListener('notification:quota-reminder:clicked', listener)
  }
}
