import { contextBridge, ipcRenderer } from 'electron'
import { DAILY_NOTES_CHANNELS as channels, type DailyNotesApi } from '../shared/daily-notes'

const api: DailyNotesApi = {
  context: () => ipcRenderer.invoke(channels.context),
  listDays: () => ipcRenderer.invoke(channels.listDays),
  read: day => ipcRenderer.invoke(channels.read, day),
  save: (day, markdown) => ipcRenderer.invoke(channels.save, day, markdown),
  setPinned: enabled => ipcRenderer.invoke(channels.pin, enabled),
  onCloseRequest: finishEditing => {
    const listener = (): void => {
      void finishEditing().catch(() => false).then(saved => ipcRenderer.invoke(channels.finishClose, saved))
    }
    ipcRenderer.on(channels.requestClose, listener)
    return () => { ipcRenderer.removeListener(channels.requestClose, listener) }
  }
}
contextBridge.exposeInMainWorld('kunDailyNotes', api)
