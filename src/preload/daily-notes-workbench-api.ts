import { ipcRenderer } from 'electron'
import type {
  DailyNoteChangedEvent,
  DailyNotesWorkbenchBridge,
  DailyNotesWorkbenchCommand
} from '../shared/daily-notes'
import { DAILY_NOTES_WORKBENCH_IPC as channels } from './daily-notes-workbench-channels'

export const dailyNotesWorkbenchApi: DailyNotesWorkbenchBridge = {
  getDirectory: () => ipcRenderer.invoke(channels.workbenchDirectory),
  toggleWindow: () => ipcRenderer.invoke(channels.workbenchToggleWindow),
  closeWindow: () => ipcRenderer.invoke(channels.workbenchCloseWindow),
  listDays: () => ipcRenderer.invoke(channels.workbenchListDays),
  read: day => ipcRenderer.invoke(channels.workbenchRead, day),
  save: (day, markdown, expectedRevision) => ipcRenderer.invoke(channels.workbenchSave, day, markdown, expectedRevision),
  rollover: (fromDay, toDay) => ipcRenderer.invoke(channels.workbenchRollover, fromDay, toDay),
  appendTask: input => ipcRenderer.invoke(channels.workbenchAppendTask, input),
  setTaskDone: input => ipcRenderer.invoke(channels.workbenchSetDone, input),
  getTaskStatus: input => ipcRenderer.invoke(channels.workbenchGetTaskStatus, input),
  bindDispatchLink: input => ipcRenderer.invoke(channels.workbenchBindDispatch, input),
  publishLinkSummaries: summaries => {
    ipcRenderer.send(channels.workbenchPublishSummaries, summaries)
  },
  onExternalChange: listener => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: DailyNoteChangedEvent): void => listener(payload)
    ipcRenderer.on(channels.workbenchExternalChange, wrapped)
    return () => { ipcRenderer.removeListener(channels.workbenchExternalChange, wrapped) }
  },
  onCommand: handler => {
    const wrapped = (_event: Electron.IpcRendererEvent, command: DailyNotesWorkbenchCommand): void => {
      handler(command, response => {
        ipcRenderer.send(channels.workbenchReply, { requestId: command.requestId, response })
      })
    }
    ipcRenderer.on(channels.workbenchCommand, wrapped)
    return () => { ipcRenderer.removeListener(channels.workbenchCommand, wrapped) }
  }
}
