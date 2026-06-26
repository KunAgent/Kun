import { app, dialog, ipcMain, shell, type BrowserWindow, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  type AppSettingsPatch,
  type AppSettingsV1,
  type ClawRunResult,
  type ClawTaskFromTextResult,
  type ClawRuntimeStatus,
  type ScheduleRunResult,
  type ScheduleRuntimeStatus,
  type ScheduleTaskFromTextResult,
  type WorkflowCodeCheckResult,
  type WorkflowNodeTestResult,
  type WorkflowRunResult,
  type WorkflowRuntimeStatus
} from '../../shared/app-settings'
import type {
  ClawImInstallPollResult,
  ClawImInstallQrResult,
  ConversationWorkspaceCreateResult,
  DesktopCommand,
  RuntimeRequestResult,
  SystemNotificationResult,
  TurnCompleteNotificationPayload,
  UpstreamModelsResult,
  WorkspacePickResult
} from '../../shared/kun-gui-api'
import type { WorkspaceFileSaveAsResult } from '../../shared/workspace-file'
import type { GuiUpdateDownloadResult, GuiUpdateInfo, GuiUpdateInstallResult, GuiUpdateState } from '../../shared/gui-update'
import {
  clawMirrorPayloadSchema,
  clawImInstallPollPayloadSchema,
  clawImTelegramTokenPayloadSchema,
  confirmDialogPayloadSchema,
  clawTaskFromTextPayloadSchema,
  computerUsePermissionKindSchema,
  deepseekConfigContentSchema,
  desktopCommandSchema,
  defaultPathSchema,
  gitBranchPayloadSchema,
  gitCheckpointCreatePayloadSchema,
  gitCheckpointRestorePayloadSchema,
  gitWorktreeRemoveSchema,
  guiUpdateChannelSchema,
  localPdfTextTargetPayloadSchema,
  logErrorPayloadSchema,
  notificationPayloadSchema,
  openEditorPathPayloadSchema,
  providerProbePayloadSchema,
  rootPathSchema,
  worktreeCommitSchema,
  worktreeContinueMergeSchema,
  worktreeMergeSchema,
  worktreePoolIndexSchema,
  worktreePoolSchema,
  worktreeProjectPathSchema,
  worktreeOptionalRootSchema,
  worktreePathSchema,
  runtimeRequestPayloadSchema,
  scheduleTaskFromTextPayloadSchema,
  shellOpenExternalUrlSchema,
  skillGithubImportPayloadSchema,
  skillListPayloadSchema,
  skillSaveFilePayloadSchema,
  settingsPatchSchema,
  streamIdSchema,
  workflowRunNodePayloadSchema,
  workflowTestNodePayloadSchema,
  workflowResolveApprovalPayloadSchema,
  workflowCodeCheckPayloadSchema,
  uiPluginIdPayloadSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceClipboardImageSavePayloadSchema,
  workspaceImagePickPayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  workspaceFileCreatePayloadSchema,
  workspaceFileSaveAsPayloadSchema,
  workspaceFileTargetPayloadSchema,
  workspaceFileWatchPayloadSchema,
  workspaceFileWritePayloadSchema,
  localWhisperDownloadPayloadSchema,
  localWhisperModelIdPayloadSchema,
  localWhisperSourceStatusPayloadSchema,
  speechTranscribePayloadSchema,
  writeExportPayloadSchema,
  designExportPayloadSchema,
  writeRichClipboardPayloadSchema,
  writeInfographicPayloadSchema,
  writeInlineCompletionPayloadSchema,
  writePrototypeFilePayloadSchema,
  writeRetrievalPayloadSchema,
  workspaceRootSchema,
  legacySessionImportPayloadSchema
} from './app-ipc-schemas'
import {
  DEFAULT_KUN_DATA_DIR,
  resolveKunRuntimeSettings,
  resolveModelProviderProxyUrl
} from '../../shared/app-settings'
import { detectLegacySessions, importLegacySessions } from '../services/legacy-session-import-service'
import { claudeSubscriptionStatus, runClaudeSetupToken } from '../claude-subscription-auth'
import { fetchSdkModels } from '../claude-subscription-models'
import { agentSdkStatus, installClaudeBinary, resolveClaudeBinary } from '../agent-sdk-installer'
import type { JsonSettingsStore } from '../settings-store'
import { probeModelProvider } from '../provider-connection'
import type { ClawRuntime } from '../claw-runtime'
import type { ScheduleRuntime } from '../schedule-runtime'
import { verifyTelegramBotToken } from '../telegram-runtime'
import { startCodexDeviceAuth, pollCodexDeviceAuth, startCodexBrowserAuth } from '../codex-auth'
import type { WorkflowRuntime } from '../workflow-runtime'
import { checkWorkflowCode } from '../workflow-runtime'
import {
  checkoutGitBranchWorktree,
  createAndSwitchGitBranch,
  createGitBranchWorktree,
  getGitBranches,
  listGitBranchWorktrees,
  removeGitBranchWorktree,
  switchGitBranch
} from '../services/git-service'
import { createGitCheckpoint, restoreGitCheckpoint } from '../services/git-checkpoint-service'
import {
  abortMerge,
  abortRebase,
  acquireWorktree,
  cleanupWorktrees,
  commitWorktree,
  continueMerge,
  findAvailablePoolIndex,
  getWorktreeChanges,
  listWorktrees,
  mergeWorktreeToMain,
  releaseWorktree,
  removeWorktree,
  syncWorktreeFromMain
} from '../services/worktree-service'
import {
  installUiPluginFromDirectory,
  listUiPlugins,
  loadUiPluginFigures,
  removeUiPlugin
} from '../services/ui-plugin-service'
import { ensureBundledUiPlugins } from '../ui-plugin-bundled'
import { ensureBundledSkills } from '../skill-bundled'
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  expandHomePath,
  listEditorsResult,
  listWorkspaceDirectory,
  openEditorPath,
  openPathWithShell,
  readClipboardImage,
  readWorkspaceImage,
  readWorkspaceFile,
  readWorkspacePdf,
  renameWorkspaceEntry,
  resolveOpenTargetPath,
  resolveWorkspaceFile,
  pickAndSaveWorkspaceImage,
  saveWorkspaceClipboardImage,
  writeWorkspaceFile
} from '../services/workspace-service'
import {
  clearWriteInlineCompletionDebugEntries,
  listWriteInlineCompletionDebugEntries,
  requestWriteInlineCompletion
} from '../services/write-inline-completion-service'
import { retrieveWriteContext } from '../services/write-retrieval-service'
import { requestWriteInfographic } from '../services/write-infographic-service'
import { authorizePrototypePath } from '../services/prototype-embed-registry'
import { requestSpeechTranscription } from '../services/speech-to-text-service'
import {
  cancelLocalWhisperModel,
  deleteLocalWhisperModel,
  checkLocalWhisperDownloadSources,
  downloadLocalWhisperModel,
  getLocalWhisperModelStatus,
  setLocalWhisperProgressEmitter
} from '../services/local-whisper-service'
import {
  getComputerUsePermissions,
  requestComputerUsePermission
} from '../services/computer-use-permissions'
import {
  copyWriteDocumentAsRichText,
  exportDesignPrototype,
  exportWriteDocument
} from '../services/write-export-service'
import { importGithubSkillsToRoot } from '../services/github-skill-import-service'
import { readLocalPdfText } from '../services/write-pdf-text-service'
import { saveGuiSkillPackage } from '../services/skill-save-service'
import { listGuiSkillRoots, listGuiSkills } from '../services/skill-service'

type GuiUpdaterModule = typeof import('../gui-updater')

type WorkspaceFileWatchRecord = {
  watcher: FSWatcher
  sender: WebContents
  path: string
  workspaceRoot: string
  timer: ReturnType<typeof setTimeout> | null
}

type RegisterAppIpcHandlersOptions = {
  store: JsonSettingsStore
  getMainWindow: () => BrowserWindow | null
  applySettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  saveSettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  runtimeRequest: (
    path: string,
    method?: string,
    body?: string
  ) => Promise<RuntimeRequestResult>
  restartRuntime: () => Promise<void>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  getClawRuntime: () => ClawRuntime | null
  getScheduleRuntime: () => ScheduleRuntime | null
  getWorkflowRuntime: () => WorkflowRuntime | null
  startFeishuInstallQrcode: (isLark: boolean) => Promise<ClawImInstallQrResult>
  pollFeishuInstall: (deviceCode: string) => Promise<ClawImInstallPollResult>
  startWeixinInstallQrcode: (weixinBridgeUrl?: string) => Promise<ClawImInstallQrResult>
  pollWeixinInstall: (deviceCode: string, weixinBridgeUrl?: string) => Promise<ClawImInstallPollResult>
  resolveKunConfigPath: () => string
  onKunMcpConfigWritten?: (path: string, content: string) => Promise<void> | void
  showTurnCompleteNotification: (
    payload: TurnCompleteNotificationPayload
  ) => Promise<SystemNotificationResult>
  getAppVersion: () => string
  readGuiUpdateState: () => Promise<GuiUpdateState>
  loadGuiUpdaterModule: () => Promise<GuiUpdaterModule>
  resolveLogDirectory: () => string
  logError: (category: string, message: string, detail?: unknown) => void
}

function parseIpcPayload<T>(channel: string, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new Error(`Invalid payload for ${channel}: ${issue?.message ?? 'Bad request.'}`)
}

// node:fs/promises 没有内置 pathExists;用 access 实现。
async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function safeSaveAsFileName(input: string | undefined, fallback = 'generated-file'): string {
  const candidate = (input ?? '').trim().replace(/\0/g, '')
  const name = basename(candidate) || fallback
  if (name === '.' || name === '..') return fallback
  return name
}

function saveDialogFilters(fileName: string, mimeType: string | undefined): Electron.FileFilter[] {
  const ext = extname(fileName).replace(/^\./, '').trim()
  const mime = mimeType?.toLowerCase().trim() ?? ''
  const filters: Electron.FileFilter[] = []
  if (mime.startsWith('image/')) {
    filters.push({ name: 'Images', extensions: ext ? [ext] : ['png', 'jpg', 'jpeg', 'webp', 'gif'] })
  } else if (mime.startsWith('video/')) {
    filters.push({ name: 'Videos', extensions: ext ? [ext] : ['mp4', 'webm', 'mov', 'm4v'] })
  } else if (ext) {
    filters.push({ name: `${ext.toUpperCase()} file`, extensions: [ext] })
  }
  filters.push({ name: 'All Files', extensions: ['*'] })
  return filters
}

async function saveWorkspaceFileAs(
  payload: unknown,
  getMainWindow: () => BrowserWindow | null
): Promise<WorkspaceFileSaveAsResult> {
  const request = parseIpcPayload('file:save-as', workspaceFileSaveAsPayloadSchema, payload)
  try {
    const sourcePath = request.sourcePath
      ? await resolveOpenTargetPath(request.sourcePath, request.workspaceRoot, { allowBasenameFallback: false })
      : ''
    const fileName = safeSaveAsFileName(request.suggestedName || (sourcePath ? basename(sourcePath) : undefined))
    const defaultPath = request.workspaceRoot?.trim()
      ? join(expandHomePath(request.workspaceRoot), fileName)
      : fileName
    const options: Electron.SaveDialogOptions = {
      title: 'Save generated file',
      defaultPath,
      filters: saveDialogFilters(fileName, request.mimeType)
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, message: 'Save cancelled.' }
    }

    const targetPath = resolve(result.filePath)
    await mkdir(dirname(targetPath), { recursive: true })
    if (sourcePath) {
      if (resolve(sourcePath) !== targetPath) {
        await copyFile(sourcePath, targetPath)
      }
    } else if (request.dataBase64) {
      await writeFile(targetPath, Buffer.from(request.dataBase64, 'base64'))
    } else {
      return { ok: false, message: 'No file data was available to save.' }
    }
    return { ok: true, path: targetPath }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function validateMcpConfigContent(content: string): void {
  const trimmed = content.trim()
  if (!trimmed) return
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`MCP config must be JSON: ${message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP config must be a JSON object.')
  }
}

function runDesktopCommand(
  command: DesktopCommand,
  sender: WebContents,
  getMainWindow: () => BrowserWindow | null
): void {
  const mainWindow = getMainWindow()
  const contents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : sender

  switch (command) {
    case 'undo':
      contents.undo()
      return
    case 'redo':
      contents.redo()
      return
    case 'cut':
      contents.cut()
      return
    case 'copy':
      contents.copy()
      return
    case 'paste':
      contents.paste()
      return
    case 'selectAll':
      contents.selectAll()
      return
    case 'reload':
      contents.reload()
      return
    case 'zoomIn':
      contents.setZoomLevel(contents.getZoomLevel() + 1)
      return
    case 'zoomOut':
      contents.setZoomLevel(contents.getZoomLevel() - 1)
      return
    case 'resetZoom':
      contents.setZoomLevel(0)
      return
    case 'toggleDevTools':
      contents.toggleDevTools()
      return
    case 'minimize':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
      return
    case 'toggleMaximize':
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
      return
    case 'close':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
      return
    case 'quit':
      app.quit()
      return
  }
}

export function registerAppIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  // Seed the built-in "design system & craft" skill into ~/.kun/skills/ once.
  void ensureBundledSkills(join(homedir(), '.kun'))
  const {
    store,
    getMainWindow,
    applySettingsPatch,
    saveSettingsPatch,
    runtimeRequest,
    restartRuntime,
    fetchUpstreamModels,
    getClawRuntime,
    getScheduleRuntime,
    getWorkflowRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    startWeixinInstallQrcode,
    pollWeixinInstall,
    resolveKunConfigPath,
    onKunMcpConfigWritten,
    showTurnCompleteNotification,
    getAppVersion,
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory,
    logError
  } = options
  setLocalWhisperProgressEmitter((payload) => {
    getMainWindow()?.webContents.send('speech:local-whisper:progress', payload)
  })
  const workspaceFileWatchers = new Map<string, WorkspaceFileWatchRecord>()

  const disposeWorkspaceFileWatch = (watchId: string): boolean => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return false
    if (record.timer) clearTimeout(record.timer)
    try {
      record.watcher.close()
    } catch (error) {
      logError('workspace-watch', 'Failed to close workspace file watcher', {
        watchId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    workspaceFileWatchers.delete(watchId)
    return true
  }

  const disposeWorkspaceFileWatchesForSender = (sender: WebContents): void => {
    for (const [watchId, record] of workspaceFileWatchers) {
      if (record.sender.id === sender.id) {
        disposeWorkspaceFileWatch(watchId)
      }
    }
  }

  const emitWorkspaceFileChange = async (watchId: string): Promise<void> => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    const changedAt = new Date().toISOString()
    try {
      const result = await readWorkspaceFile({
        path: record.path,
        workspaceRoot: record.workspaceRoot
      })
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      if (result.ok) {
        latest.sender.send('file:workspace-changed', {
          ok: true,
          watchId,
          workspaceRoot: latest.workspaceRoot,
          path: result.path,
          content: result.content,
          size: result.size,
          truncated: result.truncated,
          changedAt
        })
        return
      }
      latest.sender.send('file:workspace-changed', {
        ok: false,
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: result.message,
        changedAt
      })
    } catch (error) {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      latest.sender.send('file:workspace-changed', {
        ok: false,
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: error instanceof Error ? error.message : String(error),
        changedAt
      })
    }
  }

  const scheduleWorkspaceFileChange = (watchId: string): void => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    if (record.timer) clearTimeout(record.timer)
    record.timer = setTimeout(() => {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest) return
      latest.timer = null
      void emitWorkspaceFileChange(watchId)
    }, 90)
  }

  ipcMain.handle('settings:get', async () => store.load())
  // Claude Pro/Max subscription login (compliant path: official CLI does the
  // OAuth; we only detect it / capture the setup-token).
  ipcMain.handle('claude-subscription:status', async () => claudeSubscriptionStatus())
  // The Claude Code binary (~222MB) is NOT bundled — it's downloaded on demand
  // into userData/agent-sdk and resolved from there (or kun/node_modules in dev).
  const claudeSubKunDirs = (): string[] =>
    [
      app.isPackaged ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked') : app.getAppPath(),
      process.cwd()
    ].map((root) => join(root, 'kun'))
  const claudeSubBinary = (): string | undefined =>
    resolveClaudeBinary(app.getPath('userData'), claudeSubKunDirs())
  ipcMain.handle('claude-subscription:sdk-status', async () =>
    agentSdkStatus(app.getPath('userData'), claudeSubKunDirs())
  )
  ipcMain.handle('claude-subscription:sdk-install', async () =>
    installClaudeBinary({
      userDataDir: app.getPath('userData'),
      proxyUrl: resolveModelProviderProxyUrl(await store.load())
    })
  )
  ipcMain.handle('claude-subscription:login', async () =>
    runClaudeSetupToken({ binaryPath: claudeSubBinary() })
  )
  ipcMain.handle('claude-subscription:models', async (_event, token: unknown) =>
    fetchSdkModels({
      token: typeof token === 'string' ? token : undefined,
      kunRoots: claudeSubKunDirs(),
      binaryPath: claudeSubBinary()
    })
  )
  ipcMain.handle('settings:set', async (_, partial: unknown) =>
    applySettingsPatch(
      parseIpcPayload('settings:set', settingsPatchSchema, partial) as AppSettingsPatch
    )
  )
  ipcMain.handle('settings:save-silent', async (_, partial: unknown) =>
    saveSettingsPatch(
      parseIpcPayload('settings:save-silent', settingsPatchSchema, partial) as AppSettingsPatch
    )
  )

  ipcMain.handle('runtime:request', async (_, payload: unknown) => {
    const request = parseIpcPayload('runtime:request', runtimeRequestPayloadSchema, payload)
    return runtimeRequest(request.path, request.method, request.body)
  })

  ipcMain.handle('runtime:restart', async () => restartRuntime())

  ipcMain.handle('upstream:models', async () => fetchUpstreamModels())

  ipcMain.handle('provider:probe', async (_, payload: unknown) => {
    const request = parseIpcPayload('provider:probe', providerProbePayloadSchema, payload)
    return probeModelProvider(request, await store.load())
  })

  ipcMain.handle('claw:status', async (): Promise<ClawRuntimeStatus> =>
    getClawRuntime()?.status() ?? {
      imServerRunning: false,
      imUrl: '',
      runningTaskIds: []
    }
  )

  ipcMain.handle('claw:task:run', async (_, taskId: unknown): Promise<ScheduleRunResult> => {
    const normalizedTaskId = parseIpcPayload('claw:task:run', streamIdSchema, taskId)
    const scheduleRuntime = getScheduleRuntime()
    if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
    return scheduleRuntime.runTask(normalizedTaskId)
  })

  ipcMain.handle('schedule:status', async (): Promise<ScheduleRuntimeStatus> =>
    getScheduleRuntime()?.status() ?? {
      internalServerRunning: false,
      internalUrl: '',
      runningTaskIds: [],
      queuedTaskIds: [],
      powerSaveBlockerActive: false
    }
  )

  ipcMain.handle('schedule:task:run', async (_, taskId: unknown): Promise<ScheduleRunResult> => {
    const normalizedTaskId = parseIpcPayload('schedule:task:run', streamIdSchema, taskId)
    const scheduleRuntime = getScheduleRuntime()
    if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
    return scheduleRuntime.runTask(normalizedTaskId)
  })

  ipcMain.handle('workflow:status', async (): Promise<WorkflowRuntimeStatus> =>
    getWorkflowRuntime()?.status() ?? {
      runningWorkflowIds: [],
      nodeStatus: {},
      nodeResults: {},
      powerSaveBlockerActive: false,
      pendingApprovals: []
    }
  )

  ipcMain.handle('workflow:run', async (_, workflowId: unknown, input?: unknown): Promise<WorkflowRunResult> => {
    const normalizedId = parseIpcPayload('workflow:run', streamIdSchema, workflowId)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    // input is validated/coerced against the trigger's input schema inside runWorkflow.
    return workflowRuntime.runWorkflow(normalizedId, input)
  })

  ipcMain.handle('workflow:stop', async (_, workflowId: unknown): Promise<WorkflowRunResult> => {
    const normalizedId = parseIpcPayload('workflow:stop', streamIdSchema, workflowId)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.stopWorkflow(normalizedId)
  })

  ipcMain.handle('workflow:node:run', async (_, payload: unknown): Promise<WorkflowRunResult> => {
    const request = parseIpcPayload('workflow:node:run', workflowRunNodePayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.runSingleNode(request.workflowId, request.nodeId)
  })

  ipcMain.handle('workflow:node:test', async (_, payload: unknown): Promise<WorkflowNodeTestResult> => {
    const request = parseIpcPayload('workflow:node:test', workflowTestNodePayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.testNode(request.workflowId, request.nodeId, request.mockJson)
  })

  ipcMain.handle('workflow:approval:resolve', async (_, payload: unknown): Promise<{ ok: boolean }> => {
    const request = parseIpcPayload('workflow:approval:resolve', workflowResolveApprovalPayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false }
    return { ok: workflowRuntime.resolveApproval(request.token, request.decision) }
  })

  ipcMain.handle('workflow:code:check', async (_, payload: unknown): Promise<WorkflowCodeCheckResult> => {
    const request = parseIpcPayload('workflow:code:check', workflowCodeCheckPayloadSchema, payload)
    return checkWorkflowCode(request.language, request.code)
  })

  ipcMain.handle(
    'claw:channel:mirror',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:channel:mirror', clawMirrorPayloadSchema, payload)
      const clawRuntime = getClawRuntime()
      if (!clawRuntime) return { ok: false as const, message: 'Claw runtime is not initialized.' }
      return clawRuntime.mirrorThreadMessageToIm(
        request.threadId,
        request.text,
        request.direction
      )
    }
  )

  ipcMain.handle(
    'claw:channel:mirror-to-feishu',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:channel:mirror-to-feishu', clawMirrorPayloadSchema, payload)
      const clawRuntime = getClawRuntime()
      if (!clawRuntime) return { ok: false as const, message: 'Claw runtime is not initialized.' }
      return clawRuntime.mirrorThreadMessageToIm(
        request.threadId,
        request.text,
        request.direction
      )
    }
  )

  ipcMain.handle(
    'claw:task:create-from-text',
    async (_, payload: unknown): Promise<ClawTaskFromTextResult> => {
      const request = parseIpcPayload(
        'claw:task:create-from-text',
        clawTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      const settings = await store.load()
      const channel = request.channelId
        ? settings.claw.channels.find((item) => item.id === request.channelId)
        : undefined
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: channel?.workspaceRoot || settings.schedule.defaultWorkspaceRoot || settings.workspaceRoot,
        clawChannelId: channel?.id ?? request.channelId,
        providerId: request.providerId,
        modelHint: request.modelHint,
        reasoningEffort: request.reasoningEffort,
        mode: request.mode
      })
    }
  )

  ipcMain.handle(
    'schedule:task:create-from-text',
    async (_, payload: unknown): Promise<ScheduleTaskFromTextResult> => {
      const request = parseIpcPayload(
        'schedule:task:create-from-text',
        scheduleTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: request.workspaceRoot,
        clawChannelId: request.clawChannelId,
        providerId: request.providerId,
        modelHint: request.modelHint,
        reasoningEffort: request.reasoningEffort,
        mode: request.mode
      })
    }
  )

  ipcMain.handle(
    'claw:im-install:qrcode',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'claw:im-install:qrcode',
        z.object({ provider: z.enum(['feishu', 'weixin']), isLark: z.boolean().optional() }).strict(),
        payload
      )
      if (request.provider === 'weixin') {
        return startWeixinInstallQrcode()
      }
      return startFeishuInstallQrcode(request.isLark === true)
    }
  )

  ipcMain.handle(
    'claw:im-install:poll',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:im-install:poll', clawImInstallPollPayloadSchema, payload)
      if (request.provider === 'weixin') {
        return pollWeixinInstall(request.deviceCode)
      }
      return pollFeishuInstall(request.deviceCode)
    }
  )

  ipcMain.handle(
    'claw:im-install:telegram-token',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'claw:im-install:telegram-token',
        clawImTelegramTokenPayloadSchema,
        payload
      )
      return verifyTelegramBotToken(request.botToken)
    }
  )

  ipcMain.handle('codex:auth:start', async () => {
    return startCodexDeviceAuth()
  })

  ipcMain.handle('codex:auth:poll', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'codex:auth:poll',
      z.object({ deviceCode: z.string().min(1), userCode: z.string().min(1) }).strict(),
      payload
    )
    return pollCodexDeviceAuth(request.deviceCode, request.userCode)
  })

  ipcMain.handle('codex:auth:browser', async () => {
    return startCodexBrowserAuth(async (url: string) => {
      await shell.openExternal(url)
    })
  })

  ipcMain.handle('workspace:pick-directory', async (_, defaultPath: unknown): Promise<WorkspacePickResult> => {
    const normalizedDefaultPath = parseIpcPayload(
      'workspace:pick-directory',
      z.object({ defaultPath: defaultPathSchema }).strict(),
      { defaultPath }
    ).defaultPath
    const options: Electron.OpenDialogOptions = {
      title: 'Select working directory',
      defaultPath: normalizedDefaultPath,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  // 在对话工作目录根下创建一个 YYYYMMDD-HHmmss 时间戳子目录作为新对话的工作目录。
  ipcMain.handle(
    'conversation:create-workspace',
    async (_, payload: unknown): Promise<ConversationWorkspaceCreateResult> => {
      try {
        const request = parseIpcPayload(
          'conversation:create-workspace',
          z.object({ root: defaultPathSchema }).strict(),
          payload ?? {}
        )
        const settings = await store.load()
        const rawRoot = request.root ?? settings.conversationWorkspaceRoot ?? ''
        const root = expandHomePath(rawRoot)
        if (!root) {
          return { ok: false, path: '', error: 'conversation workspace root is empty' }
        }
        const stamp = new Date()
        const pad = (n: number): string => String(n).padStart(2, '0')
        const base =
          `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
          `-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
        // 同秒内连建两个对话会得到相同时间戳目录;mkdir(recursive) 对已存在目录
        // 不报错,会导致两个会话静默共用目录。冲突时追加随机后缀保证唯一。
        let workspacePath = join(root, base)
        let suffixAttempt = 0
        while (await pathExists(workspacePath)) {
          suffixAttempt += 1
          // 形如 20260626-153012-a3f9;重试到上限仍未解决就用毫秒兜底。
          const suffix = suffixAttempt <= 6
            ? randomBytes(2).toString('hex')
            : `${stamp.getMilliseconds()}${randomBytes(1).toString('hex')}`
          workspacePath = join(root, `${base}-${suffix}`)
        }
        await mkdir(workspacePath, { recursive: true })
        return { ok: true, path: workspacePath }
      } catch (error) {
        return {
          ok: false,
          path: '',
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  // Replaces window.confirm in the renderer: the synchronous native confirm
  // leaves the WebContents unable to focus inputs after it closes
  // (electron/electron#19977), which froze the composer after deleting threads.
  ipcMain.handle('dialog:confirm', async (_, payload: unknown): Promise<boolean> => {
    const request = parseIpcPayload('dialog:confirm', confirmDialogPayloadSchema, payload)
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: [request.confirmLabel ?? 'OK', request.cancelLabel ?? 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: request.message,
      detail: request.detail,
      noLink: true
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options)
    return result.response === 0
  })

  ipcMain.handle(
    'skill:save-file',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('skill:save-file', skillSaveFilePayloadSchema, payload)
      try {
        const result = await saveGuiSkillPackage(request)
        return { ok: true as const, path: result.path }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle('skill:import-github', async (_, payload: unknown) => {
    const request = parseIpcPayload('skill:import-github', skillGithubImportPayloadSchema, payload)
    return importGithubSkillsToRoot(request)
  })

  ipcMain.handle('skill:list', async (_, payload: unknown) => {
    const request = parseIpcPayload('skill:list', skillListPayloadSchema, payload)
    const settings = await store.load()
    return listGuiSkills(settings, request.workspaceRoot)
  })

  ipcMain.handle('skill:list-roots', async (_, payload: unknown) => {
    const request = parseIpcPayload('skill:list-roots', skillListPayloadSchema, payload)
    const settings = await store.load()
    return listGuiSkillRoots(settings, request.workspaceRoot)
  })

  ipcMain.handle('skill:open-root', async (_, rootPath: unknown) => {
    const normalizedRootPath = parseIpcPayload('skill:open-root', rootPathSchema, rootPath)
    try {
      const target = expandHomePath(normalizedRootPath)
      if (!target) {
        return { ok: false as const, message: 'Skill directory is required.' }
      }
      await mkdir(target, { recursive: true })
      return openPathWithShell(target)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('ui-plugin:list', async () => {
    const kunHomeDir = join(homedir(), '.kun')
    await ensureBundledUiPlugins(kunHomeDir)
    return { plugins: await listUiPlugins(kunHomeDir) }
  })

  ipcMain.handle('ui-plugin:install', async () => {
    const mainWindow = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Select a UI plugin folder',
      properties: ['openDirectory', 'dontAddToRecent']
    }
    const picked = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    const sourceDir = picked.filePaths[0]
    if (picked.canceled || !sourceDir) {
      return { canceled: true as const }
    }
    const result = await installUiPluginFromDirectory(join(homedir(), '.kun'), sourceDir)
    if (!result.ok) {
      return { canceled: false as const, ok: false as const, errors: result.errors }
    }
    return { canceled: false as const, ok: true as const, plugin: result.plugin }
  })

  ipcMain.handle('ui-plugin:remove', async (_, payload: unknown) => {
    const request = parseIpcPayload('ui-plugin:remove', uiPluginIdPayloadSchema, payload)
    return { ok: await removeUiPlugin(join(homedir(), '.kun'), request.id) }
  })

  ipcMain.handle('ui-plugin:load', async (_, payload: unknown) => {
    const request = parseIpcPayload('ui-plugin:load', uiPluginIdPayloadSchema, payload)
    const kunHomeDir = join(homedir(), '.kun')
    await ensureBundledUiPlugins(kunHomeDir)
    return loadUiPluginFigures(kunHomeDir, request.id)
  })

  ipcMain.handle('kun:config:read', async () => {
    const path = resolveKunConfigPath()
    try {
      const content = await readFile(path, 'utf8')
      return { path, content, exists: true as const }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path, content: '', exists: false as const }
      }
      throw error
    }
  })

  ipcMain.handle('kun:config:write', async (_, content: unknown) => {
    const validatedContent = parseIpcPayload(
      'kun:config:write',
      deepseekConfigContentSchema,
      content
    )
    const path = resolveKunConfigPath()
    validateMcpConfigContent(validatedContent)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, validatedContent, 'utf8')
    try {
      await onKunMcpConfigWritten?.(path, validatedContent)
    } catch (error: unknown) {
      logError('mcp-config', 'Failed to apply MCP config change after write', {
        path,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return { ok: true as const, path }
  })

  ipcMain.handle('kun:config:open-dir', async () => {
    try {
      const path = resolveKunConfigPath()
      const dirPath = dirname(path)
      await mkdir(dirPath, { recursive: true })
      return openPathWithShell(dirPath)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  const resolveKunThreadsDataDir = async (): Promise<string> => {
    const settings = await store.load()
    const runtime = resolveKunRuntimeSettings(settings)
    return expandHomePath(runtime.dataDir?.trim() || DEFAULT_KUN_DATA_DIR)
  }

  ipcMain.handle('kun:sessions:detect-legacy', async () =>
    detectLegacySessions({ homeDir: homedir(), destDataDir: await resolveKunThreadsDataDir() })
  )

  ipcMain.handle('kun:sessions:import-legacy', async (_, payload: unknown) => {
    const request = parseIpcPayload('kun:sessions:import-legacy', legacySessionImportPayloadSchema, payload)
    try {
      const summary = await importLegacySessions({
        homeDir: homedir(),
        destDataDir: await resolveKunThreadsDataDir(),
        ...(request.sourceDir ? { sourceDir: request.sourceDir } : {}),
        log: (message, detail) => logError('legacy-session-import', message, detail)
      })
      return { ok: true as const, ...summary }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('kun:sessions:pick-source-dir', async (): Promise<WorkspacePickResult> => {
    const options: Electron.OpenDialogOptions = {
      title: 'Select a folder containing previous conversations',
      properties: ['openDirectory', 'dontAddToRecent']
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  ipcMain.handle('git:branches', async (_, workspaceRoot: unknown) =>
    getGitBranches(parseIpcPayload('git:branches', workspaceRootSchema, workspaceRoot))
  )
  ipcMain.handle(
    'git:switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:switch-branch', gitBranchPayloadSchema, payload)
      return switchGitBranch(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle(
    'git:create-and-switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'git:create-and-switch-branch',
        gitBranchPayloadSchema,
        payload
      )
      return createAndSwitchGitBranch(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle('git:checkpoint:create', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:checkpoint:create', gitCheckpointCreatePayloadSchema, payload)
    return createGitCheckpoint({
      dataDir: await resolveKunThreadsDataDir(),
      workspaceRoot: request.workspaceRoot,
      threadId: request.threadId
    })
  })
  ipcMain.handle('git:checkpoint:restore', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:checkpoint:restore', gitCheckpointRestorePayloadSchema, payload)
    return restoreGitCheckpoint({
      dataDir: await resolveKunThreadsDataDir(),
      checkpointId: request.checkpointId,
      // Bridge the main-process runtimeRequest into the shape restoreGitCheckpoint
      // expects ((path, {method, body}) => {ok,status,body}). On a transport-level
      // failure (runtime not up, connection refused) we return a non-ok result so
      // the busy guard fails closed instead of throwing past the handler.
      runtimeRequest: async (path, init) => {
        try {
          return await runtimeRequest(path, init?.method, init?.body)
        } catch (error) {
          return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) }
        }
      }
    })
  })
  ipcMain.handle(
    'git:checkout-branch-worktree',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:checkout-branch-worktree', gitBranchPayloadSchema, payload)
      return checkoutGitBranchWorktree(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle(
    'git:create-branch-worktree',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:create-branch-worktree', gitBranchPayloadSchema, payload)
      return createGitBranchWorktree(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle('git:branch-worktrees', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:branch-worktrees', worktreePoolSchema, payload)
    return listGitBranchWorktrees(request.projectPath, request.worktreeRoot)
  })
  ipcMain.handle('git:remove-branch-worktree', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:remove-branch-worktree', gitWorktreeRemoveSchema, payload)
    return removeGitBranchWorktree(request)
  })

  // Worktree pool management
  ipcMain.handle('worktree:acquire', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:acquire', worktreeOptionalRootSchema, payload)
    return acquireWorktree({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      taskId: r.taskId,
      force: r.force,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:release', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:release', worktreePoolIndexSchema, payload)
    return releaseWorktree({ projectPath: r.projectPath, poolIndex: r.poolIndex })
  })
  ipcMain.handle('worktree:list', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:list', worktreePoolSchema, payload)
    return listWorktrees({ projectPath: r.projectPath, worktreeRoot: r.worktreeRoot })
  })
  ipcMain.handle('worktree:remove', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:remove', worktreePoolIndexSchema, payload)
    return removeWorktree({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:changes', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:changes', worktreePathSchema, payload)
    return getWorktreeChanges({ worktreePath: r.worktreePath })
  })
  ipcMain.handle('worktree:commit', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:commit', worktreeCommitSchema, payload)
    return commitWorktree({ worktreePath: r.worktreePath, message: r.message })
  })
  ipcMain.handle('worktree:merge', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:merge', worktreeMergeSchema, payload)
    return mergeWorktreeToMain({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      commitMessage: r.commitMessage,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:abort-merge', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:abort-merge', worktreeProjectPathSchema, payload)
    return abortMerge({ projectPath: r.projectPath })
  })
  ipcMain.handle('worktree:continue-merge', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:continue-merge', worktreeContinueMergeSchema, payload)
    return continueMerge({ projectPath: r.projectPath, message: r.message })
  })
  ipcMain.handle('worktree:sync', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:sync', worktreePoolIndexSchema, payload)
    return syncWorktreeFromMain({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:abort-rebase', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:abort-rebase', worktreePathSchema, payload)
    return abortRebase({ worktreePath: r.worktreePath })
  })
  ipcMain.handle('worktree:cleanup', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:cleanup', worktreePoolSchema, payload)
    return cleanupWorktrees({ projectPath: r.projectPath, worktreeRoot: r.worktreeRoot })
  })
  ipcMain.handle('worktree:find-available', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:find-available', worktreePoolSchema, payload)
    return findAvailablePoolIndex({ projectPath: r.projectPath, worktreeRoot: r.worktreeRoot })
  })

  ipcMain.handle('editor:list', async () => listEditorsResult())
  ipcMain.handle('editor:open-path', async (_, payload: unknown) =>
    openEditorPath(parseIpcPayload('editor:open-path', openEditorPathPayloadSchema, payload))
  )

  ipcMain.handle('file:resolve-workspace', async (_, payload: unknown) =>
    resolveWorkspaceFile(
      parseIpcPayload('file:resolve-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:list-workspace-directory', async (_, payload: unknown) =>
    listWorkspaceDirectory(
      parseIpcPayload('file:list-workspace-directory', workspaceDirectoryTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace', async (_, payload: unknown) =>
    readWorkspaceFile(
      parseIpcPayload('file:read-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace-image', async (_, payload: unknown) =>
    readWorkspaceImage(
      parseIpcPayload('file:read-workspace-image', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace-pdf', async (_, payload: unknown) =>
    readWorkspacePdf(
      parseIpcPayload('file:read-workspace-pdf', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-local-pdf-text', async (_, payload: unknown) => {
    const result = await readLocalPdfText(
      parseIpcPayload('file:read-local-pdf-text', localPdfTextTargetPayloadSchema, payload)
    )
    if (!result.ok) return result
    return {
      ok: true,
      path: result.path,
      size: result.size,
      mtimeMs: result.mtimeMs,
      pageCount: result.pageCount,
      text: result.pages.map((page) => page.text).join('\n\n'),
      hasText: result.hasText,
      truncated: result.truncated
    }
  })
  ipcMain.handle('file:save-as', async (_, payload: unknown) =>
    saveWorkspaceFileAs(payload, getMainWindow)
  )
  ipcMain.handle('file:write-workspace', async (_, payload: unknown) =>
    writeWorkspaceFile(
      parseIpcPayload('file:write-workspace', workspaceFileWritePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:create-workspace', async (_, payload: unknown) =>
    createWorkspaceFile(
      parseIpcPayload('file:create-workspace', workspaceFileCreatePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:create-workspace-directory', async (_, payload: unknown) =>
    createWorkspaceDirectory(
      parseIpcPayload('file:create-workspace-directory', workspaceDirectoryCreatePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:save-workspace-clipboard-image', async (_, payload: unknown) =>
    saveWorkspaceClipboardImage(
      parseIpcPayload(
        'file:save-workspace-clipboard-image',
        workspaceClipboardImageSavePayloadSchema,
        payload
      )
    )
  )
  ipcMain.handle('file:pick-workspace-image', async (_, payload: unknown) =>
    pickAndSaveWorkspaceImage(
      parseIpcPayload('file:pick-workspace-image', workspaceImagePickPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('clipboard:read-image', async () => readClipboardImage())
  ipcMain.handle('file:rename-workspace-entry', async (_, payload: unknown) =>
    renameWorkspaceEntry(
      parseIpcPayload('file:rename-workspace-entry', workspaceEntryRenamePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:delete-workspace-entry', async (_, payload: unknown) =>
    deleteWorkspaceEntry(
      parseIpcPayload('file:delete-workspace-entry', workspaceEntryDeletePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:watch-workspace', async (event, payload: unknown) => {
    const request = parseIpcPayload('file:watch-workspace', workspaceFileWatchPayloadSchema, payload)
    const initial = await readWorkspaceFile(request)
    let watchedPath: string
    let initialContent: string
    let initialSize: number
    let initialTruncated: boolean
    if (initial.ok) {
      watchedPath = initial.path
      initialContent = initial.content
      initialSize = initial.size
      initialTruncated = initial.truncated
    } else {
      const initialImage = await readWorkspaceImage(request)
      if (!initialImage.ok) return initial
      watchedPath = initialImage.path
      initialContent = ''
      initialSize = initialImage.size
      initialTruncated = false
    }

    const watchId = randomUUID()
    try {
      const watcher = watch(watchedPath, { persistent: false }, () => {
        scheduleWorkspaceFileChange(watchId)
      })
      workspaceFileWatchers.set(watchId, {
        watcher,
        sender: event.sender,
        path: watchedPath,
        workspaceRoot: request.workspaceRoot,
        timer: null
      })
      event.sender.once('destroyed', () => disposeWorkspaceFileWatchesForSender(event.sender))
      return {
        ok: true as const,
        watchId,
        path: watchedPath,
        content: initialContent,
        size: initialSize,
        truncated: initialTruncated,
        startedAt: new Date().toISOString()
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('file:unwatch-workspace', async (_, watchId: unknown) =>
    disposeWorkspaceFileWatch(parseIpcPayload('file:unwatch-workspace', streamIdSchema, watchId))
  )
  ipcMain.handle('write:export', async (_, payload: unknown) =>
    exportWriteDocument(
      parseIpcPayload('write:export', writeExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('design:export-prototype', async (_, payload: unknown) =>
    exportDesignPrototype(
      parseIpcPayload('design:export-prototype', designExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('write:copy-rich-text', async (_, payload: unknown) =>
    copyWriteDocumentAsRichText(
      parseIpcPayload('write:copy-rich-text', writeRichClipboardPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:inline-completion', async (_, payload: unknown) =>
    requestWriteInlineCompletion(
      await store.load(),
      parseIpcPayload('write:inline-completion', writeInlineCompletionPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:retrieve-context', async (_, payload: unknown) => {
    try {
      const context = await retrieveWriteContext(
        parseIpcPayload('write:retrieve-context', writeRetrievalPayloadSchema, payload)
      )
      return { ok: true as const, context }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('write:generate-infographic', async (_, payload: unknown) =>
    requestWriteInfographic(
      await store.load(),
      parseIpcPayload('write:generate-infographic', writeInfographicPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:authorize-prototype', async (_, payload: unknown) => {
    const request = parseIpcPayload('write:authorize-prototype', writePrototypeFilePayloadSchema, payload)
    return authorizePrototypePath(request.path, request.workspaceRoot)
  })
  ipcMain.handle('write:open-prototype', async (_, payload: unknown) => {
    const request = parseIpcPayload('write:open-prototype', writePrototypeFilePayloadSchema, payload)
    const authorized = await authorizePrototypePath(request.path, request.workspaceRoot)
    if (!authorized.ok) return authorized
    return openPathWithShell(authorized.absolutePath)
  })
  ipcMain.handle('speech:transcribe', async (_, payload: unknown) =>
    requestSpeechTranscription(
      await store.load(),
      parseIpcPayload('speech:transcribe', speechTranscribePayloadSchema, payload)
    )
  )
  ipcMain.handle('speech:local-whisper:status', async (_, modelId: unknown) =>
    getLocalWhisperModelStatus(parseIpcPayload('speech:local-whisper:status', localWhisperModelIdPayloadSchema, modelId))
  )
  ipcMain.handle('speech:local-whisper:download', async (_, modelId: unknown) =>
    {
      const payload = parseIpcPayload('speech:local-whisper:download', localWhisperDownloadPayloadSchema, modelId)
      return downloadLocalWhisperModel(payload.modelId, payload.sourceId)
    }
  )
  ipcMain.handle('speech:local-whisper:cancel', async (_, modelId: unknown) =>
    cancelLocalWhisperModel(parseIpcPayload('speech:local-whisper:cancel', localWhisperModelIdPayloadSchema, modelId))
  )
  ipcMain.handle('speech:local-whisper:sources', async (_, payload: unknown) =>
    {
      const request = parseIpcPayload('speech:local-whisper:sources', localWhisperSourceStatusPayloadSchema, payload)
      return checkLocalWhisperDownloadSources(request.modelId)
    }
  )
  ipcMain.handle('speech:local-whisper:delete', async (_, modelId: unknown) =>
    deleteLocalWhisperModel(parseIpcPayload('speech:local-whisper:delete', localWhisperModelIdPayloadSchema, modelId))
  )
  ipcMain.handle('write:inline-completion-debug:list', async () => listWriteInlineCompletionDebugEntries())
  ipcMain.handle('write:inline-completion-debug:clear', async () => {
    clearWriteInlineCompletionDebugEntries()
    return true
  })
  ipcMain.handle('desktop:command', async (event, command: unknown) => {
    runDesktopCommand(
      parseIpcPayload('desktop:command', desktopCommandSchema, command),
      event.sender,
      getMainWindow
    )
  })
  ipcMain.handle('shell:open-external', async (_, url: unknown) => {
    const validatedUrl = parseIpcPayload('shell:open-external', shellOpenExternalUrlSchema, url)
    await shell.openExternal(validatedUrl)
  })
  ipcMain.handle('computer-use:permissions', async () => getComputerUsePermissions())
  ipcMain.handle('computer-use:request-permission', async (_, kind: unknown) => {
    const parsed = parseIpcPayload(
      'computer-use:request-permission',
      computerUsePermissionKindSchema,
      kind
    )
    return requestComputerUsePermission(parsed)
  })
  ipcMain.handle('notification:turn-complete', async (_, payload: unknown) =>
    showTurnCompleteNotification(
      parseIpcPayload('notification:turn-complete', notificationPayloadSchema, payload)
    )
  )
  ipcMain.handle('app:version', async () => getAppVersion())
  ipcMain.handle('gui:update-state', async () => readGuiUpdateState())
  ipcMain.handle('gui:update-check', async (_, channel: unknown): Promise<GuiUpdateInfo> => {
    const module = await loadGuiUpdaterModule()
    return module.checkGuiUpdate(
      parseIpcPayload(
        'gui:update-check',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  ipcMain.handle('gui:update-download', async (_, channel: unknown): Promise<GuiUpdateDownloadResult> => {
    const module = await loadGuiUpdaterModule()
    return module.downloadGuiUpdate(
      parseIpcPayload(
        'gui:update-download',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  ipcMain.handle('gui:update-install', async (): Promise<GuiUpdateInstallResult> => {
    const module = await loadGuiUpdaterModule()
    return module.installGuiUpdate()
  })

  ipcMain.handle('log:error', async (_, payload: unknown) => {
    const request = parseIpcPayload('log:error', logErrorPayloadSchema, payload)
    logError(request.category, request.message, request.detail)
  })
  ipcMain.handle('log:get-path', async () => resolveLogDirectory())
  ipcMain.handle('log:open-dir', async () => {
    const dir = resolveLogDirectory()
    try {
      await mkdir(dir, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
    const error = await shell.openPath(dir)
    if (error) return { ok: false, message: error }
    return { ok: true }
  })
}
