import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import {
  homedir
} from 'node:os'
import {
  dirname,
  join
} from 'node:path'
import {
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises'
import {
  getKunRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type {
  WorkspacePickResult
} from '../../shared/kun-gui-api'
import {
  deepseekConfigContentSchema,
  kunProjectConfigTrustPayloadSchema,
  kunProjectConfigWorkspacePayloadSchema,
  kunProjectConfigWritePayloadSchema,
  legacySessionImportPayloadSchema
} from './app-ipc-schemas'
import {
  NativeDialogCoordinator
} from '../native-dialog-coordinator'
import {
  DEFAULT_KUN_DATA_DIR,
  resolveKunRuntimeSettings
} from '../../shared/app-settings'
import {
  detectLegacySessions,
  importLegacySessions
} from '../services/legacy-session-import-service'
import {
  type GitCheckpointStorageOptions
} from '../services/git-checkpoint-service'
import {
  expandHomePath,
  openPathWithShell
} from '../services/workspace-service'
import {
  ensureKunProjectConfigDirectory,
  loadKunProjectConfig,
  readKunProjectConfigSource,
  writeKunProjectConfig
} from '../../../kun/src/config/project-config.js'
import {
  readProjectConfigState
} from '../services/project-config-service'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import {
  parseIpcPayload,
  sameProjectWorkspace,
  validateMcpConfigContent
} from './app-ipc-handler-utils'
import { isRemoteClientSender } from '../remote/remote-sender'

export function registerAppKunConfigIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const {
    store,
    getMainWindow,
    applySettingsPatch,
    resolveKunConfigPath,
    onKunMcpConfigWritten,
    onKunProjectConfigChanged,
    logError
  } = options
  const nativeDialogs = options.nativeDialogs ?? new NativeDialogCoordinator()
  const showMainWindowMessageBox = (
    parent: BrowserWindow,
    messageBoxOptions: Electron.MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> => nativeDialogs.run(parent.webContents, async () => {
    if (parent.isDestroyed()) throw new Error('Native dialog parent window is unavailable.')
    return dialog.showMessageBox(parent, messageBoxOptions)
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

  const projectConfigFileResult = async (
    workspaceRoot: string,
    settingsOverride?: AppSettingsV1
  ) => {
    const settings = settingsOverride ?? await store.load()
    const state = await readProjectConfigState(settings, workspaceRoot)
    const source = await readKunProjectConfigSource(workspaceRoot).catch(() => null)
    return {
      ...state,
      content: source?.content ?? '',
      exists: source?.exists ?? false
    }
  }

  ipcMain.handle('kun:project-config:read', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'kun:project-config:read',
      kunProjectConfigWorkspacePayloadSchema,
      payload
    )
    return projectConfigFileResult(request.workspaceRoot)
  })

  ipcMain.handle('kun:project-config:write', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'kun:project-config:write',
      kunProjectConfigWritePayloadSchema,
      payload
    )
    const written = await writeKunProjectConfig(request.workspaceRoot, request.content)
    try {
      await onKunProjectConfigChanged?.(written.path, request.content)
    } catch (error) {
      logError('project-config', 'Failed to apply project config change after write', {
        path: written.path,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return projectConfigFileResult(written.workspaceRoot)
  })

  ipcMain.handle('kun:project-config:trust', async (event: IpcMainInvokeEvent, payload: unknown) => {
    const request = parseIpcPayload(
      'kun:project-config:trust',
      kunProjectConfigTrustPayloadSchema,
      payload
    )
    const current = await store.load()
    const loaded = await loadKunProjectConfig(request.workspaceRoot)
    if (request.trusted && loaded.status !== 'valid') {
      throw new Error(
        loaded.status === 'invalid'
          ? loaded.message
          : 'Project config must exist and be valid before it can be approved.'
      )
    }
    if (request.trusted && loaded.status === 'valid' &&
      loaded.digest !== request.expectedDigest.toLowerCase()) {
      throw new Error('Project config changed after confirmation. Refresh, review, and approve it again.')
    }
    const canonicalRoot = loaded.workspaceRoot
    const currentState = await readProjectConfigState(current, canonicalRoot)
    const enabledServers = currentState.serverSummaries.filter((server) => server.enabled)
    const isChinese = current.locale.toLowerCase().startsWith('zh')
    const detail = request.trusted
      ? [
          isChinese ? `工作区：${canonicalRoot}` : `Workspace: ${canonicalRoot}`,
          isChinese ? '将启用的 MCP：' : 'Enabled MCP servers:',
          enabledServers.length > 0
            ? enabledServers.map((server) => `${server.id}: ${server.target}`).join('\n')
            : isChinese ? '（无）' : '(none)',
          loaded.status === 'valid' ? `SHA-256: ${loaded.digest}` : '',
          isChinese
            ? '仅批准你已审查且信任的项目配置。批准后，Kun 可以启动其中声明的命令。'
            : 'Approve only a project configuration you reviewed and trust. Kun may start its declared commands.'
        ].filter(Boolean).join('\n\n')
      : isChinese
        ? `工作区：${canonicalRoot}\n\n撤销后，项目 MCP 将在下一次配置应用时被移除。`
        : `Workspace: ${canonicalRoot}\n\nProject MCP will be removed on the next configuration apply.`
    const confirmationOptions: Electron.MessageBoxOptions = {
      type: 'warning',
      title: request.trusted
        ? isChinese ? '批准项目 MCP' : 'Approve project MCP'
        : isChinese ? '撤销项目 MCP' : 'Revoke project MCP',
      message: request.trusted
        ? isChinese ? '批准当前项目 MCP 配置？' : 'Approve the current project MCP configuration?'
        : isChinese ? '撤销当前项目 MCP 授权？' : 'Revoke the current project MCP grant?',
      detail,
      buttons: request.trusted
        ? [isChinese ? '批准' : 'Approve', isChinese ? '取消' : 'Cancel']
        : [isChinese ? '撤销' : 'Revoke', isChinese ? '取消' : 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    }
    const mainWindow = getMainWindow()
    // Remote clients review and confirm inside their own UI; a host-side
    // native prompt would be invisible, so their invoke is the consent.
    const confirmation = isRemoteClientSender(event.sender)
      ? { response: 0, checkboxChecked: false }
      : mainWindow && !mainWindow.isDestroyed()
        ? await showMainWindowMessageBox(mainWindow, confirmationOptions)
        : await dialog.showMessageBox(confirmationOptions)
    if (confirmation.response !== 0) {
      return projectConfigFileResult(canonicalRoot, current)
    }
    let confirmedDigest: string | undefined
    if (request.trusted) {
      const confirmed = await loadKunProjectConfig(canonicalRoot)
      if (confirmed.status !== 'valid' ||
        !sameProjectWorkspace(confirmed.workspaceRoot, canonicalRoot) ||
        confirmed.digest !== request.expectedDigest.toLowerCase()) {
        throw new Error('Project config changed during confirmation. Refresh, review, and approve it again.')
      }
      confirmedDigest = confirmed.digest
    }
    const grants = getKunRuntimeSettings(current).projectConfig.grants.filter((grant) =>
      !sameProjectWorkspace(grant.workspaceRoot, canonicalRoot)
    )
    if (request.trusted && confirmedDigest) {
      grants.push({ workspaceRoot: canonicalRoot, configDigest: confirmedDigest })
    }
    const saved = await applySettingsPatch({
      agents: { kun: { projectConfig: { grants } } }
    })
    return projectConfigFileResult(canonicalRoot, saved)
  })

  ipcMain.handle('kun:project-config:open-dir', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'kun:project-config:open-dir',
      kunProjectConfigWorkspacePayloadSchema,
      payload
    )
    try {
      const directory = await ensureKunProjectConfigDirectory(request.workspaceRoot)
      return openPathWithShell(directory)
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

  // Map the user's checkpoint settings (issue #651) to the service storage
  // options: an optional directory override (e.g. another drive) and the
  // per-thread retention cap. Home-relative paths are expanded.
  const resolveCheckpointStorageOptions = (
    cfg: { directory?: string; maxPerThread?: number; maxTotalBytes?: number; minFreeDiskBytes?: number }
  ): GitCheckpointStorageOptions => ({
    ...(cfg.directory?.trim() ? { checkpointsRoot: expandHomePath(cfg.directory.trim()) } : {}),
    ...(cfg.maxPerThread !== undefined ? { maxPerThread: cfg.maxPerThread } : {}),
    ...(cfg.maxTotalBytes !== undefined ? { maxTotalBytes: cfg.maxTotalBytes } : {}),
    ...(cfg.minFreeDiskBytes !== undefined ? { minFreeDiskBytes: cfg.minFreeDiskBytes } : {})
  })

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

}
