import { contextBridge, ipcRenderer } from 'electron'
import {
  DAILY_NOTES_CHANNELS as channels,
  type DailyNoteChangedEvent,
  type DailyNoteLinkSummary,
  type DailyNotesApi
} from '../shared/daily-notes'

const api: DailyNotesApi = {
  context: () => ipcRenderer.invoke(channels.context),
  listDays: () => ipcRenderer.invoke(channels.listDays),
  read: day => ipcRenderer.invoke(channels.read, day),
  save: (day, markdown) => ipcRenderer.invoke(channels.save, day, markdown),
  setPinned: enabled => ipcRenderer.invoke(channels.pin, enabled),
  rollover: (fromDay, toDay) => ipcRenderer.invoke(channels.rollover, fromDay, toDay),
  sendToKun: request => ipcRenderer.invoke(channels.sendToKun, request),
  startThread: request => ipcRenderer.invoke(channels.startThread, request),
  listTargets: () => ipcRenderer.invoke(channels.listTargets),
  dockToWorkbench: payload => ipcRenderer.invoke(channels.dockToWorkbench, payload),
  openLink: url => ipcRenderer.invoke(channels.openLink, url),
  watchLinks: urls => ipcRenderer.invoke(channels.watchLinks, urls),
  onCloseRequest: finishEditing => {
    const listener = (): void => {
      void finishEditing().catch(() => false).then(saved => ipcRenderer.invoke(channels.finishClose, saved))
    }
    ipcRenderer.on(channels.requestClose, listener)
    return () => { ipcRenderer.removeListener(channels.requestClose, listener) }
  },
  onExternalChange: listener => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: DailyNoteChangedEvent): void => listener(payload)
    ipcRenderer.on(channels.externalChange, wrapped)
    return () => { ipcRenderer.removeListener(channels.externalChange, wrapped) }
  },
  onLinkSummaries: listener => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Record<string, DailyNoteLinkSummary>): void => listener(payload)
    ipcRenderer.on(channels.linkSummaries, wrapped)
    return () => { ipcRenderer.removeListener(channels.linkSummaries, wrapped) }
  }
}
contextBridge.exposeInMainWorld('kunDailyNotes', api)
