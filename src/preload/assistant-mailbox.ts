import { ipcRenderer } from 'electron'
import {
  ASSISTANT_MAILBOX_CHANNELS as channels,
  type AssistantMailboxApi,
  type AssistantMailboxStatus
} from '../shared/assistant-mailbox'

export const assistantMailboxApi: AssistantMailboxApi = {
  listTasks: query => ipcRenderer.invoke(channels.listTasks, query),
  taskDetails: id => ipcRenderer.invoke(channels.taskDetails, id),
  archiveTask: (id, archived) => ipcRenderer.invoke(channels.archiveTask, id, archived),
  retryDelivery: id => ipcRenderer.invoke(channels.retryDelivery, id),
  setContinuation: (id, enabled) => ipcRenderer.invoke(channels.setContinuation, id, enabled),
  rerunTask: id => ipcRenderer.invoke(channels.rerunTask, id),
  history: (id, before) => ipcRenderer.invoke(channels.history, id, before),
  recoverHistory: id => ipcRenderer.invoke(channels.recoverHistory, id),
  status: () => ipcRenderer.invoke(channels.status),
  refresh: () => ipcRenderer.invoke(channels.refresh),
  updatePrompt: (id, locale) => ipcRenderer.invoke(channels.updatePrompt, id, locale),
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
