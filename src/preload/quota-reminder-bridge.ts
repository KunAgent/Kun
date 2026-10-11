import { ipcRenderer } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api'

/** Allowance reminders are shown by Main; the renderer only learns when one was clicked. */
export const quotaReminderPreloadApi: Pick<KunGuiApi, 'onQuotaReminderClicked'> = {
  onQuotaReminderClicked: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('notification:quota-reminder:clicked', listener)
    return () => ipcRenderer.removeListener('notification:quota-reminder:clicked', listener)
  }
}
