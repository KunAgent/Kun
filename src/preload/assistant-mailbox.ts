import { ipcRenderer } from 'electron'
import {
  ASSISTANT_MAILBOX_CHANNELS as channels,
  type AssistantMailboxApi,
  type AssistantMailboxStatus
} from '../shared/assistant-mailbox'

export const assistantMailboxApi: AssistantMailboxApi = {
  status: () => ipcRenderer.invoke(channels.status),
  refresh: () => ipcRenderer.invoke(channels.refresh),
  createEnrollment: (request) => ipcRenderer.invoke(channels.enroll, request),
  revoke: (assistantId) => ipcRenderer.invoke(channels.revoke, assistantId),
  assign: (request) => ipcRenderer.invoke(channels.assign, request),
  cancel: (taskId) => ipcRenderer.invoke(channels.cancel, taskId),
  onStatus: (listener) => {
    const wrapped = (_: Electron.IpcRendererEvent, status: AssistantMailboxStatus) => listener(status)
    ipcRenderer.on(channels.changed, wrapped)
    return () => ipcRenderer.removeListener(channels.changed, wrapped)
  }
}
