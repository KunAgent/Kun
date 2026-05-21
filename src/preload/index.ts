import { contextBridge, ipcRenderer } from 'electron'
import type { DsGuiApi } from '../shared/ds-gui-api'

const api = {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) =>
    ipcRenderer.invoke('settings:set', partial),
  runtimeRequest: (path, method, body) =>
    ipcRenderer.invoke('runtime:request', { path, method, body }),
  fetchUpstreamModels: () => ipcRenderer.invoke('upstream:models'),
  getClawStatus: () => ipcRenderer.invoke('claw:status'),
  runClawTask: (taskId) =>
    ipcRenderer.invoke('claw:task:run', taskId),
  startClawImInstallQr: (provider, options) =>
    ipcRenderer.invoke('claw:im-install:qrcode', { provider, isLark: options?.isLark }),
  pollClawImInstall: (provider, deviceCode) =>
    ipcRenderer.invoke('claw:im-install:poll', { provider, deviceCode }),
  deepseekSpawnIfNeeded: () =>
    ipcRenderer.invoke('deepseek:spawn-if-needed'),
  prepareDeepseekBinary: () => ipcRenderer.invoke('deepseek:prepare-binary'),
  checkDeepseekUpdate: () =>
    ipcRenderer.invoke('deepseek:update-check'),
  installDeepseekUpdate: () =>
    ipcRenderer.invoke('deepseek:update-install'),
  pickWorkspaceDirectory: (defaultPath) =>
    ipcRenderer.invoke('workspace:pick-directory', defaultPath),
  saveSkillFile: (rootPath, skillName, content) =>
    ipcRenderer.invoke('skill:save-file', { rootPath, skillName, content }),
  openSkillRoot: (rootPath) =>
    ipcRenderer.invoke('skill:open-root', rootPath),
  getDeepseekConfigFile: () =>
    ipcRenderer.invoke('deepseek:config:read'),
  setDeepseekConfigFile: (content) =>
    ipcRenderer.invoke('deepseek:config:write', content),
  openDeepseekConfigDir: () =>
    ipcRenderer.invoke('deepseek:config:open-dir'),
  diagnoseDeepseekRuntime: () =>
    ipcRenderer.invoke('deepseek:diagnostics'),
  getGitBranches: (workspaceRoot) =>
    ipcRenderer.invoke('git:branches', workspaceRoot),
  switchGitBranch: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:switch-branch', { workspaceRoot, branch }),
  createAndSwitchGitBranch: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:create-and-switch-branch', { workspaceRoot, branch }),
  listEditors: () => ipcRenderer.invoke('editor:list'),
  openEditorPath: (options) =>
    ipcRenderer.invoke('editor:open-path', options),
  createTerminalSession: (options) =>
    ipcRenderer.invoke('terminal:create', options),
  writeTerminalSession: (payload) =>
    ipcRenderer.invoke('terminal:write', payload),
  resizeTerminalSession: (payload) =>
    ipcRenderer.invoke('terminal:resize', payload),
  closeTerminalSession: (payload) =>
    ipcRenderer.invoke('terminal:close', payload),
  onTerminalData: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('terminal:data', wrapped)
    return () => ipcRenderer.removeListener('terminal:data', wrapped)
  },
  onTerminalExit: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('terminal:exit', wrapped)
    return () => ipcRenderer.removeListener('terminal:exit', wrapped)
  },
  resolveWorkspaceFile: (options) =>
    ipcRenderer.invoke('file:resolve-workspace', options),
  readWorkspaceFile: (options) =>
    ipcRenderer.invoke('file:read-workspace', options),
  startSse: (threadId, sinceSeq, streamId) =>
    ipcRenderer.invoke('runtime:sse:start', { threadId, sinceSeq, streamId }),
  stopSse: (streamId) => ipcRenderer.invoke('runtime:sse:stop', streamId),
  onSseEvent: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('runtime:sse-event', wrapped)
    return () => ipcRenderer.removeListener('runtime:sse-event', wrapped)
  },
  onSseEnd: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('runtime:sse-end', wrapped)
    return () => ipcRenderer.removeListener('runtime:sse-end', wrapped)
  },
  onSseError: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('runtime:sse-error', wrapped)
    return () => ipcRenderer.removeListener('runtime:sse-error', wrapped)
  },
  onClawChannelActivity: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('claw:channel-activity', wrapped)
    return () => ipcRenderer.removeListener('claw:channel-activity', wrapped)
  },
  mirrorClawChannelMessageToFeishu: (threadId, text, direction) =>
    ipcRenderer.invoke('claw:channel:mirror-to-feishu', { threadId, text, direction }),
  createClawTaskFromText: (text, options) =>
    ipcRenderer.invoke('claw:task:create-from-text', {
      text,
      channelId: options?.channelId,
      modelHint: options?.modelHint,
      mode: options?.mode
    }),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  showTurnCompleteNotification: (payload) => ipcRenderer.invoke('notification:turn-complete', payload),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getGuiUpdateState: () => ipcRenderer.invoke('gui:update-state'),
  checkGuiUpdate: (channel) =>
    ipcRenderer.invoke('gui:update-check', channel),
  downloadGuiUpdate: (channel) =>
    ipcRenderer.invoke('gui:update-download', channel),
  installGuiUpdate: () => ipcRenderer.invoke('gui:update-install'),
  onGuiUpdateState: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('gui:update-state', wrapped)
    return () => ipcRenderer.removeListener('gui:update-state', wrapped)
  },
  logError: (category, message, detail) =>
    ipcRenderer.invoke('log:error', { category, message, detail }),
  getLogPath: () => ipcRenderer.invoke('log:get-path'),
  openLogDir: () => ipcRenderer.invoke('log:open-dir')
} satisfies DsGuiApi

contextBridge.exposeInMainWorld('dsGui', api)
