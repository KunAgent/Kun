import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api'

// The preload runs sandboxed (webPreferences.sandbox = true), so it cannot
// require node built-ins like node:os. The home dir is passed in from the main
// process via additionalArguments and read off process.argv instead.
const HOME_DIR_ARG = '--kun-home-dir='
const homeDirFromArgs =
  process.argv.find((arg) => arg.startsWith(HOME_DIR_ARG))?.slice(HOME_DIR_ARG.length) ?? ''

const api = {
  platform: process.platform,
  homeDir: homeDirFromArgs,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) =>
    ipcRenderer.invoke('settings:set', partial),
  saveSettingsSilent: (partial) =>
    ipcRenderer.invoke('settings:save-silent', partial),
  runtimeRequest: (path, method, body) =>
    ipcRenderer.invoke('runtime:request', { path, method, body }),
  restartRuntime: () => ipcRenderer.invoke('runtime:restart'),
  fetchUpstreamModels: () => ipcRenderer.invoke('upstream:models'),
  probeModelProvider: (payload) => ipcRenderer.invoke('provider:probe', payload),
  getClawStatus: () => ipcRenderer.invoke('claw:status'),
  runClawTask: (taskId) =>
    ipcRenderer.invoke('claw:task:run', taskId),
  getScheduleStatus: () => ipcRenderer.invoke('schedule:status'),
  runScheduleTask: (taskId) =>
    ipcRenderer.invoke('schedule:task:run', taskId),
  getWorkflowStatus: () => ipcRenderer.invoke('workflow:status'),
  runWorkflow: (workflowId, input) => ipcRenderer.invoke('workflow:run', workflowId, input),
  stopWorkflow: (workflowId) => ipcRenderer.invoke('workflow:stop', workflowId),
  runWorkflowNode: (workflowId, nodeId) =>
    ipcRenderer.invoke('workflow:node:run', { workflowId, nodeId }),
  testWorkflowNode: (workflowId, nodeId, mockJson) =>
    ipcRenderer.invoke('workflow:node:test', { workflowId, nodeId, mockJson }),
  resolveWorkflowApproval: (token, decision) =>
    ipcRenderer.invoke('workflow:approval:resolve', { token, decision }),
  checkWorkflowCode: (language, code) => ipcRenderer.invoke('workflow:code:check', { language, code }),
  startClawImInstallQr: (provider, options) =>
    ipcRenderer.invoke('claw:im-install:qrcode', { provider, isLark: options?.isLark }),
  pollClawImInstall: (provider, deviceCode) =>
    ipcRenderer.invoke('claw:im-install:poll', { provider, deviceCode }),
  connectTelegramBot: (botToken, allowedChatIds) =>
    ipcRenderer.invoke('claw:im-install:telegram-token', { botToken, allowedChatIds }),
  pickWorkspaceDirectory: (defaultPath) =>
    ipcRenderer.invoke('workspace:pick-directory', defaultPath),
  confirmDialog: (options) =>
    ipcRenderer.invoke('dialog:confirm', options),
  detectLegacySessions: () =>
    ipcRenderer.invoke('kun:sessions:detect-legacy'),
  importLegacySessions: (sourceDir) =>
    ipcRenderer.invoke('kun:sessions:import-legacy', { sourceDir }),
  pickLegacySessionDir: () =>
    ipcRenderer.invoke('kun:sessions:pick-source-dir'),
  listSkills: (workspaceRoot) =>
    ipcRenderer.invoke('skill:list', { workspaceRoot }),
  listSkillRoots: (workspaceRoot) =>
    ipcRenderer.invoke('skill:list-roots', { workspaceRoot }),
  saveSkillFile: (rootPath, skillName, content, manifestContent) =>
    ipcRenderer.invoke('skill:save-file', { rootPath, skillName, content, manifestContent }),
  importSkillsFromGitHub: (rootPath, url) =>
    ipcRenderer.invoke('skill:import-github', { rootPath, url }),
  openSkillRoot: (rootPath) =>
    ipcRenderer.invoke('skill:open-root', rootPath),
  listUiPlugins: () =>
    ipcRenderer.invoke('ui-plugin:list'),
  installUiPlugin: () =>
    ipcRenderer.invoke('ui-plugin:install'),
  removeUiPlugin: (id) =>
    ipcRenderer.invoke('ui-plugin:remove', { id }),
  loadUiPlugin: (id) =>
    ipcRenderer.invoke('ui-plugin:load', { id }),
  getKunConfigFile: () =>
    ipcRenderer.invoke('kun:config:read'),
  setKunConfigFile: (content) =>
    ipcRenderer.invoke('kun:config:write', content),
  openKunConfigDir: () =>
    ipcRenderer.invoke('kun:config:open-dir'),
  getGitBranches: (workspaceRoot) =>
    ipcRenderer.invoke('git:branches', workspaceRoot),
  switchGitBranch: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:switch-branch', { workspaceRoot, branch }),
  createAndSwitchGitBranch: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:create-and-switch-branch', { workspaceRoot, branch }),
  createGitCheckpoint: (payload) =>
    ipcRenderer.invoke('git:checkpoint:create', payload),
  restoreGitCheckpoint: (payload) =>
    ipcRenderer.invoke('git:checkpoint:restore', payload),
  checkoutGitBranchWorktree: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:checkout-branch-worktree', { workspaceRoot, branch }),
  createGitBranchWorktree: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:create-branch-worktree', { workspaceRoot, branch }),
  listGitBranchWorktrees: (params) =>
    ipcRenderer.invoke('git:branch-worktrees', params),
  removeGitBranchWorktree: (params) =>
    ipcRenderer.invoke('git:remove-branch-worktree', params),
  acquireWorktree: (params) =>
    ipcRenderer.invoke('worktree:acquire', params),
  releaseWorktree: (params) =>
    ipcRenderer.invoke('worktree:release', params),
  listWorktrees: (params) =>
    ipcRenderer.invoke('worktree:list', params),
  removeWorktree: (params) =>
    ipcRenderer.invoke('worktree:remove', params),
  getWorktreeChanges: (params) =>
    ipcRenderer.invoke('worktree:changes', params),
  commitWorktree: (params) =>
    ipcRenderer.invoke('worktree:commit', params),
  mergeWorktree: (params) =>
    ipcRenderer.invoke('worktree:merge', params),
  abortWorktreeMerge: (params) =>
    ipcRenderer.invoke('worktree:abort-merge', params),
  continueWorktreeMerge: (params) =>
    ipcRenderer.invoke('worktree:continue-merge', params),
  syncWorktreeFromMain: (params) =>
    ipcRenderer.invoke('worktree:sync', params),
  abortWorktreeRebase: (params) =>
    ipcRenderer.invoke('worktree:abort-rebase', params),
  cleanupWorktrees: (params) =>
    ipcRenderer.invoke('worktree:cleanup', params),
  findAvailableWorktreePoolIndex: (params) =>
    ipcRenderer.invoke('worktree:find-available', params),
  listEditors: () => ipcRenderer.invoke('editor:list'),
  openEditorPath: (options) =>
    ipcRenderer.invoke('editor:open-path', options),
  listWorkspaceDirectory: (options) =>
    ipcRenderer.invoke('file:list-workspace-directory', options),
  resolveWorkspaceFile: (options) =>
    ipcRenderer.invoke('file:resolve-workspace', options),
  readWorkspaceFile: (options) =>
    ipcRenderer.invoke('file:read-workspace', options),
  readWorkspaceImage: (options) =>
    ipcRenderer.invoke('file:read-workspace-image', options),
  readWorkspacePdf: (options) =>
    ipcRenderer.invoke('file:read-workspace-pdf', options),
  saveWorkspaceFileAs: (payload) =>
    ipcRenderer.invoke('file:save-as', payload),
  writeWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:write-workspace', payload),
  createWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:create-workspace', payload),
  createWorkspaceDirectory: (payload) =>
    ipcRenderer.invoke('file:create-workspace-directory', payload),
  saveWorkspaceClipboardImage: (payload) =>
    ipcRenderer.invoke('file:save-workspace-clipboard-image', payload),
  readClipboardImage: () =>
    ipcRenderer.invoke('clipboard:read-image'),
  getPathForFile: (file) =>
    webUtils.getPathForFile(file),
  renameWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:rename-workspace-entry', payload),
  deleteWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:delete-workspace-entry', payload),
  watchWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:watch-workspace', payload),
  unwatchWorkspaceFile: (watchId) =>
    ipcRenderer.invoke('file:unwatch-workspace', watchId),
  onWorkspaceFileChanged: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('file:workspace-changed', wrapped)
    return () => ipcRenderer.removeListener('file:workspace-changed', wrapped)
  },
  exportWriteDocument: (payload) =>
    ipcRenderer.invoke('write:export', payload),
  copyWriteDocumentAsRichText: (payload) =>
    ipcRenderer.invoke('write:copy-rich-text', payload),
  requestWriteInlineCompletion: (payload) =>
    ipcRenderer.invoke('write:inline-completion', payload),
  retrieveWriteContext: (payload) =>
    ipcRenderer.invoke('write:retrieve-context', payload),
  generateWriteInfographic: (payload) =>
    ipcRenderer.invoke('write:generate-infographic', payload),
  authorizeWritePrototype: (payload) =>
    ipcRenderer.invoke('write:authorize-prototype', payload),
  openWritePrototype: (payload) =>
    ipcRenderer.invoke('write:open-prototype', payload),
  transcribeSpeech: (payload) =>
    ipcRenderer.invoke('speech:transcribe', payload),
  getLocalWhisperModelStatus: (modelId) =>
    ipcRenderer.invoke('speech:local-whisper:status', modelId),
  downloadLocalWhisperModel: (payload) =>
    ipcRenderer.invoke('speech:local-whisper:download', payload),
  cancelLocalWhisperModel: (modelId) =>
    ipcRenderer.invoke('speech:local-whisper:cancel', modelId),
  checkLocalWhisperDownloadSources: (payload) =>
    ipcRenderer.invoke('speech:local-whisper:sources', payload),
  deleteLocalWhisperModel: (modelId) =>
    ipcRenderer.invoke('speech:local-whisper:delete', modelId),
  onLocalWhisperModelProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('speech:local-whisper:progress', wrapped)
    return () => ipcRenderer.removeListener('speech:local-whisper:progress', wrapped)
  },
  listWriteInlineCompletionDebugEntries: () =>
    ipcRenderer.invoke('write:inline-completion-debug:list'),
  clearWriteInlineCompletionDebugEntries: () =>
    ipcRenderer.invoke('write:inline-completion-debug:clear'),
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
  onTrayAction: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('tray:action', wrapped)
    return () => ipcRenderer.removeListener('tray:action', wrapped)
  },
  onRuntimeStatus: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('runtime:status', wrapped)
    return () => ipcRenderer.removeListener('runtime:status', wrapped)
  },
  mirrorClawChannelMessage: (threadId, text, direction) =>
    ipcRenderer.invoke('claw:channel:mirror', { threadId, text, direction }),
  mirrorClawChannelMessageToFeishu: (threadId, text, direction) =>
    ipcRenderer.invoke('claw:channel:mirror-to-feishu', { threadId, text, direction }),
  createClawTaskFromText: (text, options) =>
    ipcRenderer.invoke('claw:task:create-from-text', {
      text,
      channelId: options?.channelId,
      providerId: options?.providerId,
      modelHint: options?.modelHint,
      reasoningEffort: options?.reasoningEffort,
      mode: options?.mode
    }),
  createScheduleTaskFromText: (text, options) =>
    ipcRenderer.invoke('schedule:task:create-from-text', {
      text,
      workspaceRoot: options?.workspaceRoot,
      clawChannelId: options?.clawChannelId,
      providerId: options?.providerId,
      modelHint: options?.modelHint,
      reasoningEffort: options?.reasoningEffort,
      mode: options?.mode
    }),
  runDesktopCommand: (command) =>
    ipcRenderer.invoke('desktop:command', command),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  getComputerUsePermissions: () => ipcRenderer.invoke('computer-use:permissions'),
  requestComputerUsePermission: (kind) =>
    ipcRenderer.invoke('computer-use:request-permission', kind),
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
  openLogDir: () => ipcRenderer.invoke('log:open-dir'),
  createTerminal: (payload) => ipcRenderer.invoke('terminal:create', payload),
  writeToTerminal: (payload) => ipcRenderer.invoke('terminal:write', payload),
  resizeTerminal: (payload) => ipcRenderer.invoke('terminal:resize', payload),
  disposeTerminal: (sessionId) => ipcRenderer.invoke('terminal:dispose', sessionId),
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
  }
} satisfies KunGuiApi

contextBridge.exposeInMainWorld('kunGui', api)
