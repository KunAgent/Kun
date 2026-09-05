import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type WebContents
} from 'electron'
import {
  randomBytes
} from 'node:crypto'
import {
  join
} from 'node:path'
import {
  mkdir,
  stat
} from 'node:fs/promises'
import {
  z
} from 'zod'
import type {
  ConversationWorkspaceCreateResult,
  WorkspaceCreationTimeEntry,
  WorkspacePickResult
} from '../../shared/kun-gui-api'
import {
  alertDialogPayloadSchema,
  confirmDialogPayloadSchema,
  defaultPathSchema,
  rootPathSchema,
  skillGithubImportPayloadSchema,
  skillListPayloadSchema,
  skillSaveFilePayloadSchema,
  workspaceCreationTimesPayloadSchema,
  workspaceRootSchema
} from './app-ipc-schemas'
import {
  NativeDialogCoordinator
} from '../native-dialog-coordinator'
import {
  expandHomePath,
  openPathWithShell
} from '../services/workspace-service'
import {
  importGithubSkillsToRoot
} from '../services/github-skill-import-service'
import {
  saveGuiSkillPackage
} from '../services/skill-save-service'
import {
  listGuiSkillRoots,
  listGuiSkills
} from '../services/skill-service'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { bundledSkillsDirectory } from '../bundled-skill-resources'
import { parseIpcPayload, pathExists } from './app-ipc-handler-utils'

export function registerAppWorkspaceIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const { store, getMainWindow } = options
  const nativeDialogs = options.nativeDialogs ?? new NativeDialogCoordinator()
  const showMainWindowMessageBox = (
    parent: BrowserWindow,
    messageBoxOptions: Electron.MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> => nativeDialogs.run(parent.webContents, async () => {
    if (parent.isDestroyed()) throw new Error('Native dialog parent window is unavailable.')
    return dialog.showMessageBox(parent, messageBoxOptions)
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

  ipcMain.handle('workspace:directory-exists', async (_, workspaceRoot: unknown): Promise<boolean> => {
    const normalizedWorkspaceRoot = parseIpcPayload(
      'workspace:directory-exists',
      workspaceRootSchema,
      workspaceRoot
    )
    try {
      return (await stat(expandHomePath(normalizedWorkspaceRoot))).isDirectory()
    } catch {
      return false
    }
  })

  ipcMain.handle(
    'workspace:creation-times',
    async (_, payload: unknown): Promise<WorkspaceCreationTimeEntry[]> => {
      const request = parseIpcPayload(
        'workspace:creation-times',
        workspaceCreationTimesPayloadSchema,
        payload
      )
      return Promise.all(request.workspaceRoots.map(async (workspaceRoot) => {
        const target = expandHomePath(workspaceRoot)
        if (!target) return { path: workspaceRoot, createdAtMs: null }
        try {
          const stats = await stat(target)
          // Some Linux filesystems report no birthtime (0); fall back to mtime
          // so the sidebar still gets a usable creation ordering there.
          const createdAtMs = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs
          return Number.isFinite(createdAtMs) && createdAtMs > 0
            ? { path: workspaceRoot, createdAtMs }
            : { path: workspaceRoot, createdAtMs: null }
        } catch {
          return { path: workspaceRoot, createdAtMs: null }
        }
      }))
    }
  )

  ipcMain.handle('file:pick-local-files', async (_, defaultPath: unknown) => {
    const normalizedDefaultPath = parseIpcPayload(
      'file:pick-local-files',
      z.object({ defaultPath: defaultPathSchema }).strict(),
      { defaultPath }
    ).defaultPath
    const options: Electron.OpenDialogOptions = {
      title: 'Add files to conversation',
      defaultPath: normalizedDefaultPath,
      properties: ['openFile', 'multiSelections', 'dontAddToRecent']
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      paths: result.canceled ? [] : result.filePaths
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
        // 同秒内连建两个对话会得到相同时间戳目录。冲突时追加随机后缀保证唯一。
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
        // 用户显式创建对话时，补建其配置的根目录。不要在设置加载期间创建自定义
        // 路径，避免应用启动时意外恢复不可用的网络盘或已删除的目录。
        await mkdir(root, { recursive: true })
        await mkdir(workspacePath)
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

  ipcMain.handle('dialog:alert', async (_, payload: unknown): Promise<void> => {
    const request = parseIpcPayload('dialog:alert', alertDialogPayloadSchema, payload)
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: [request.buttonLabel ?? 'OK'],
      defaultId: 0,
      cancelId: 0,
      message: request.message,
      detail: request.detail,
      noLink: true
    }
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      await showMainWindowMessageBox(mainWindow, options)
      return
    }
    await dialog.showMessageBox(options)
  })

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
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await showMainWindowMessageBox(mainWindow, options)
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
    return listGuiSkills(settings, request.workspaceRoot, bundledSkillsDirectory())
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

}
