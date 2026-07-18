import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api'
import { registerExtensionContentScriptPreload } from './extension-content-script'

registerExtensionContentScriptPreload({ contextBridge, ipcRenderer, webFrame })

// The preload runs sandboxed (webPreferences.sandbox = true), so it cannot
// require node built-ins like node:os. The home dir is passed in from the main
// process via additionalArguments and read off process.argv instead.
const HOME_DIR_ARG = '--kun-home-dir='
const homeDirFromArgs =
  process.argv.find((arg) => arg.startsWith(HOME_DIR_ARG))?.slice(HOME_DIR_ARG.length) ?? ''

const api = {
  platform: process.platform,
  homeDir: homeDirFromArgs,
  dataMigration: {
    pickExportPackage: (defaultPath) => ipcRenderer.invoke('data-migration:pick-export', { defaultPath }),
    pickImportPackage: (defaultPath) => ipcRenderer.invoke('data-migration:pick-import', { defaultPath }),
    pickDestinationDirectory: (defaultPath) => ipcRenderer.invoke('data-migration:pick-destination', { defaultPath }),
    estimateExport: (input) => ipcRenderer.invoke('data-migration:estimate-export', input),
    inspectPackage: (input) => ipcRenderer.invoke('data-migration:inspect', input),
    planImport: (input) => ipcRenderer.invoke('data-migration:plan-import', input),
    startExport: (input) => ipcRenderer.invoke('data-migration:start-export', input),
    startImport: (input) => ipcRenderer.invoke('data-migration:start-import', input),
    cancel: (operationId) => ipcRenderer.invoke('data-migration:cancel', { operationId }),
    recover: (operationId, action) => ipcRenderer.invoke('data-migration:recover', { operationId, action }),
    getStatus: () => ipcRenderer.invoke('data-migration:status'),
    listReports: () => ipcRenderer.invoke('data-migration:reports:list'),
    getReport: (operationId) => ipcRenderer.invoke('data-migration:reports:get', { operationId }),
    deleteReport: (operationId) => ipcRenderer.invoke('data-migration:reports:delete', { operationId }),
    onProgress: (handler) => {
      let latest: Parameters<typeof handler>[0] | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      const flush = () => {
        timer = null
        if (!latest) return
        const value = latest
        latest = null
        handler(value)
      }
      const wrapped = (_: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => {
        latest = payload
        if (!timer) timer = setTimeout(flush, 100)
      }
      ipcRenderer.on('data-migration:progress', wrapped)
      return () => {
        ipcRenderer.removeListener('data-migration:progress', wrapped)
        if (timer) clearTimeout(timer)
        timer = null
        latest = null
      }
    },
    onRendererRequest: (handler) => {
      const wrapped = (_: Electron.IpcRendererEvent, request: Parameters<typeof handler>[0]) => handler(request)
      ipcRenderer.on('data-migration:renderer-request', wrapped)
      return () => ipcRenderer.removeListener('data-migration:renderer-request', wrapped)
    },
    respondRendererRequest: (response) => ipcRenderer.invoke('data-migration:renderer-response', response)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  claudeSubscriptionStatus: () => ipcRenderer.invoke('claude-subscription:status'),
  claudeSubscriptionLogin: () => ipcRenderer.invoke('claude-subscription:login'),
  claudeSubscriptionModels: (token) => ipcRenderer.invoke('claude-subscription:models', token),
  claudeSubscriptionSdkStatus: () => ipcRenderer.invoke('claude-subscription:sdk-status'),
  claudeSubscriptionSdkInstall: () => ipcRenderer.invoke('claude-subscription:sdk-install'),
  onClaudeSubscriptionSdkProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('claude-subscription:sdk-progress', wrapped)
    return () => ipcRenderer.removeListener('claude-subscription:sdk-progress', wrapped)
  },
  setSettings: (partial) =>
    ipcRenderer.invoke('settings:set', partial),
  saveSettingsSilent: (partial) =>
    ipcRenderer.invoke('settings:save-silent', partial),
  runtimeRequest: (path, method, body) =>
    ipcRenderer.invoke('runtime:request', { path, method, body }),
  resolveKunApproval: (request) => ipcRenderer.invoke('approval:decide', request),
  restartRuntime: () => ipcRenderer.invoke('runtime:restart'),
  fetchUpstreamModels: () => ipcRenderer.invoke('upstream:models'),
  probeModelProvider: (payload) => ipcRenderer.invoke('provider:probe', payload),
  optimizePrompt: (payload) => ipcRenderer.invoke('prompt:optimize', payload),
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
  startCodexAuth: () =>
    ipcRenderer.invoke('codex:auth:start'),
  pollCodexAuth: (deviceCode, userCode) =>
    ipcRenderer.invoke('codex:auth:poll', { deviceCode, userCode }),
  startCodexBrowserAuth: () =>
    ipcRenderer.invoke('codex:auth:browser'),
  pickWorkspaceDirectory: (defaultPath) =>
    ipcRenderer.invoke('workspace:pick-directory', defaultPath),
  workspaceDirectoryExists: (workspaceRoot) =>
    ipcRenderer.invoke('workspace:directory-exists', workspaceRoot),
  pickLocalFiles: (defaultPath) =>
    ipcRenderer.invoke('file:pick-local-files', defaultPath),
  createConversationWorkspace: (root) =>
    ipcRenderer.invoke('conversation:create-workspace', { root }),
  alertDialog: (options) =>
    ipcRenderer.invoke('dialog:alert', options),
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
  ensurePptMaster: () => ipcRenderer.invoke('ppt-master:ensure'),
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
  activateUiPluginTheme: (id) =>
    ipcRenderer.invoke('ui-plugin:theme:activate', { id }),
  deactivateUiPluginTheme: () =>
    ipcRenderer.invoke('ui-plugin:theme:deactivate'),
  getKunConfigFile: () =>
    ipcRenderer.invoke('kun:config:read'),
  setKunConfigFile: (content) =>
    ipcRenderer.invoke('kun:config:write', content),
  openKunConfigDir: () =>
    ipcRenderer.invoke('kun:config:open-dir'),
  getKunProjectConfigFile: (workspaceRoot) =>
    ipcRenderer.invoke('kun:project-config:read', { workspaceRoot }),
  setKunProjectConfigFile: (workspaceRoot, content) =>
    ipcRenderer.invoke('kun:project-config:write', { workspaceRoot, content }),
  setKunProjectConfigTrust: (workspaceRoot, trusted, expectedDigest) =>
    ipcRenderer.invoke('kun:project-config:trust', {
      workspaceRoot,
      trusted,
      ...(trusted && expectedDigest ? { expectedDigest } : {})
    }),
  openKunProjectConfigDir: (workspaceRoot) =>
    ipcRenderer.invoke('kun:project-config:open-dir', { workspaceRoot }),
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
  lintProjectDesignMd: (content) =>
    ipcRenderer.invoke('design:lint-project-design-md', { content }),
  readWorkspaceImage: (options) =>
    ipcRenderer.invoke('file:read-workspace-image', options),
  readWorkspacePdf: (options) =>
    ipcRenderer.invoke('file:read-workspace-pdf', options),
  readLocalPdfText: (options) =>
    ipcRenderer.invoke('file:read-local-pdf-text', options),
  saveWorkspaceFileAs: (payload) =>
    ipcRenderer.invoke('file:save-as', payload),
  openExtensionArtifact: (payload) =>
    ipcRenderer.invoke('extension:artifact:open', payload),
  writeWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:write-workspace', payload),
  createWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:create-workspace', payload),
  createWorkspaceDirectory: (payload) =>
    ipcRenderer.invoke('file:create-workspace-directory', payload),
  saveWorkspaceClipboardImage: (payload) =>
    ipcRenderer.invoke('file:save-workspace-clipboard-image', payload),
  pickWorkspaceImage: (payload) =>
    ipcRenderer.invoke('file:pick-workspace-image', payload),
  saveWorkspaceImageBytes: (payload) =>
    ipcRenderer.invoke('file:save-workspace-image-bytes', payload),
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
  exportMemoryMarkdown: (payload) =>
    ipcRenderer.invoke('memory:export-markdown', payload),
  exportDesignPrototype: (payload) =>
    ipcRenderer.invoke('design:export-prototype', payload),
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
  startSse: (threadId, sinceSeq, streamId, options) =>
    ipcRenderer.invoke('runtime:sse:start', { threadId, sinceSeq, streamId, ...options }),
  stopSse: (streamId) => ipcRenderer.invoke('runtime:sse:stop', streamId),
  ackSse: (streamId, batchId) => ipcRenderer.invoke('runtime:sse:ack', { streamId, batchId }),
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
  extensionPickPackage: () => ipcRenderer.invoke('extension:pick-package'),
  extensionPickDevelopmentDirectory: () =>
    ipcRenderer.invoke('extension:pick-development-directory'),
  extensionGetWorkbench: (request) =>
    ipcRenderer.invoke('extension:workbench:get', request),
  extensionList: (request) => ipcRenderer.invoke('extension:list', request),
  extensionGet: (extensionId) => ipcRenderer.invoke('extension:get', extensionId),
  extensionDiagnostics: (extensionId) =>
    ipcRenderer.invoke('extension:diagnostics', extensionId),
  extensionInstall: (request) => ipcRenderer.invoke('extension:install', request),
  extensionEnable: (request) => ipcRenderer.invoke('extension:enable', request),
  extensionDisable: (request) => ipcRenderer.invoke('extension:disable', request),
  extensionSetPermissions: (request) =>
    ipcRenderer.invoke('extension:set-permissions', request),
  extensionReviewPermissions: (request) =>
    ipcRenderer.invoke('extension:review-permissions', request),
  extensionRollback: (request) => ipcRenderer.invoke('extension:rollback', request),
  extensionUninstall: (request) => ipcRenderer.invoke('extension:uninstall', request),
  extensionReload: (request) => ipcRenderer.invoke('extension:reload', request),
  extensionInvokeCommand: (request) =>
    ipcRenderer.invoke('extension:invoke-command', request),
  extensionCreateViewSession: (request) =>
    ipcRenderer.invoke('extension:view-session:create', request),
  extensionDisposeViewSession: (request) =>
    ipcRenderer.invoke('extension:view-session:dispose', request),
  extensionExternalBrowserControl: (request) =>
    ipcRenderer.invoke('extension:external-browser:control', request),
  onExtensionExternalBrowserState: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('extension:external-browser-state', wrapped)
    return () => ipcRenderer.removeListener('extension:external-browser-state', wrapped)
  },
  extensionPostViewMessage: (request) =>
    ipcRenderer.invoke('extension:view-session:message', request),
  extensionReadViewEvents: (request) =>
    ipcRenderer.invoke('extension:view-session:events', request),
  onExtensionViewEvent: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('extension:view-event', wrapped)
    return () => ipcRenderer.removeListener('extension:view-event', wrapped)
  },
  onExtensionComposerContext: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('extension:composer-context-attached', wrapped)
    return () => ipcRenderer.removeListener('extension:composer-context-attached', wrapped)
  },
  onExtensionNotifications: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('extension:notifications', wrapped)
    return () => ipcRenderer.removeListener('extension:notifications', wrapped)
  },
  extensionRespondNotification: (request) =>
    ipcRenderer.invoke('extension:notification:respond', request),
  extensionListAccounts: (request) =>
    ipcRenderer.invoke('extension:accounts:list', request),
  extensionListModelProviders: (request) =>
    ipcRenderer.invoke('extension:model-providers:list', request),
  extensionListProviderModels: (request) =>
    ipcRenderer.invoke('extension:model-providers:list-models', request),
  extensionLoadConfiguration: (request) =>
    ipcRenderer.invoke('extension:configuration:load', request),
  extensionUpdateConfiguration: (request) =>
    ipcRenderer.invoke('extension:configuration:update', request),
  extensionCreateAccountSession: (request) =>
    ipcRenderer.invoke('extension:accounts:create-session', request),
  extensionGetAccountSession: (request) =>
    ipcRenderer.invoke('extension:accounts:get-session', request),
  extensionCompleteAccountSession: (request) =>
    ipcRenderer.invoke('extension:accounts:complete-session', request),
  extensionCancelAccountSession: (request) =>
    ipcRenderer.invoke('extension:accounts:cancel-session', request),
  extensionDeleteAccount: (request) =>
    ipcRenderer.invoke('extension:accounts:delete', request),
  extensionRenameAccount: (request) =>
    ipcRenderer.invoke('extension:accounts:rename', request),
  extensionReplaceApiKeyAccount: (request) =>
    ipcRenderer.invoke('extension:accounts:replace-api-key', request),
  extensionCreateApiKeyAccount: (request) =>
    ipcRenderer.invoke('extension:accounts:create-api-key', request),
  extensionSetProviderBinding: (request) =>
    ipcRenderer.invoke('extension:providers:set-binding', request),
  extensionRequestConsent: (request) =>
    ipcRenderer.invoke('extension:consent:request', request),
  extensionSyncHostContentScripts: (request) =>
    ipcRenderer.invoke('extension:sync-host-content-scripts', request),
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
