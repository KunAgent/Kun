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
  approve: (enrollmentId, requestId, verificationCode) => ipcRenderer.invoke(channels.approve, enrollmentId, requestId, verificationCode),
  reject: (enrollmentId, requestId) => ipcRenderer.invoke(channels.reject, enrollmentId, requestId),
  cancelEnrollment: (enrollmentId) => ipcRenderer.invoke(channels.cancelEnrollment, enrollmentId),
  revoke: (assistantId) => ipcRenderer.invoke(channels.revoke, assistantId),
  assign: (request) => ipcRenderer.invoke(channels.assign, request),
  cancel: (taskId) => ipcRenderer.invoke(channels.cancel, taskId),
  reply: (taskId, body) => ipcRenderer.invoke(channels.reply, taskId, body),
  promptFor: (enrollmentId, locale) => ipcRenderer.invoke(channels.promptFor, enrollmentId, locale),
  onStatus: (listener) => {
    const wrapped = (_: Electron.IpcRendererEvent, status: AssistantMailboxStatus) => listener(status)
    ipcRenderer.on(channels.changed, wrapped)
    return () => ipcRenderer.removeListener(channels.changed, wrapped)
  }
}
