import {
  app,
  dialog,
  screen,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents
} from 'electron'
import {
  createHash
} from 'node:crypto'
import {
  basename,
  dirname,
  extname,
  join,
  resolve
} from 'node:path'
import {
  access,
  copyFile,
  mkdir,
  writeFile
} from 'node:fs/promises'
import {
  z
} from 'zod'
import {
  getKunRuntimeSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../../shared/app-settings'
import type {
  DesktopCommand
} from '../../shared/kun-gui-api'
import type {
  WorkspaceFileSaveAsResult
} from '../../shared/workspace-file'
import {
  workspaceFileSaveAsPayloadSchema
} from './app-ipc-schemas'
import {
  reloadRenderer
} from '../dev-renderer-cache'
import {
  expandHomePath,
  resolveOpenTargetPath
} from '../services/workspace-service'
import { trustedRendererSenderIsCurrent } from '../renderer-trust-policy'
import { trustedWorkbenchRendererUrl } from '../main-window'

type DialogParentState = {
  destroyed: boolean
  visible?: boolean
  minimized?: boolean
  focused?: boolean
}

type OptionalDialogParentMethods = Partial<Pick<BrowserWindow,
  'isVisible' | 'isMinimized' | 'isFocused' | 'restore' | 'show' | 'focus'>>

export function dialogParentState(parent: BrowserWindow): DialogParentState {
  if (parent.isDestroyed()) return { destroyed: true }
  const window = parent as BrowserWindow & OptionalDialogParentMethods
  return {
    destroyed: false,
    ...(window.isVisible ? { visible: window.isVisible() } : {}),
    ...(window.isMinimized ? { minimized: window.isMinimized() } : {}),
    ...(window.isFocused ? { focused: window.isFocused() } : {})
  }
}

export function revealDialogParent(parent: BrowserWindow): void {
  const window = parent as BrowserWindow & OptionalDialogParentMethods
  if (window.isMinimized?.()) window.restore?.()
  if (window.isVisible && !window.isVisible()) window.show?.()
  window.focus?.()
}

export function dialogParentIsAvailable(parent: BrowserWindow): boolean {
  if (parent.isDestroyed()) return false
  try {
    const contents = parent.webContents as unknown as { isDestroyed?: () => boolean }
    return contents.isDestroyed?.() !== true
  } catch {
    return false
  }
}

export function approvalLogReference(approvalId: string): string {
  return `sha256:${createHash('sha256').update(approvalId).digest('hex').slice(0, 16)}`
}

export function formatZodIssuePath(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => typeof segment === 'symbol' ? segment.toString() : String(segment))
    .join('.')
}

export function parseIpcPayload<T>(channel: string, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const message = issue?.message ?? 'Bad request.'
  const path = issue?.path?.length ? formatZodIssuePath(issue.path) : ''
  throw new Error(
    path
      ? `Invalid payload for ${channel}: ${path}: ${message}`
      : `Invalid payload for ${channel}: ${message}`
  )
}

export function withoutRendererProjectConfigGrants(partial: AppSettingsPatch): AppSettingsPatch {
  const kun = partial.agents?.kun
  if (!kun || kun.projectConfig === undefined) return partial
  const { projectConfig: _projectConfig, ...safeKun } = kun
  void _projectConfig
  return {
    ...partial,
    agents: {
      ...partial.agents,
      kun: safeKun
    }
  }
}

export function trustedWorkbenchSenderIsCurrent(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: BrowserWindow | null
): boolean {
  return trustedRendererSenderIsCurrent(event, window, {
    trustedRendererUrl: trustedWorkbenchRendererUrl(),
    surface: 'workbench'
  })
}

export function assertTrustedWorkbenchSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: () => BrowserWindow | null
): void {
  if (!trustedWorkbenchSenderIsCurrent(event, getMainWindow())) {
    throw new Error('IPC sender is not the trusted workbench frame.')
  }
}

/** Renderer settings are an editable projection, never a credential transport. */
export function withoutRendererPlaintextCredentials(settings: AppSettingsV1): AppSettingsV1 {
  const runtime = getKunRuntimeSettings(settings)
  const redactMedia = <T extends { apiKey: string }>(media: T): T => ({
    ...media,
    apiKey: '',
    ...(media.apiKey.trim() ? { apiKeyConfigured: true } : {})
  } as T)
  return {
    ...settings,
    provider: {
      ...settings.provider,
      apiKey: '',
      providers: settings.provider.providers.map((provider) => ({
        ...provider,
        apiKey: ''
      }))
    },
    agents: {
      ...settings.agents,
      kun: {
        ...runtime,
        apiKey: '',
        runtimeToken: '',
        imageGeneration: redactMedia(runtime.imageGeneration),
        speechToText: redactMedia(runtime.speechToText),
        textToSpeech: redactMedia(runtime.textToSpeech),
        musicGeneration: redactMedia(runtime.musicGeneration),
        videoGeneration: redactMedia(runtime.videoGeneration)
      }
    }
  }
}

// node:fs/promises 没有内置 pathExists;用 access 实现。
export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export function safeSaveAsFileName(input: string | undefined, fallback = 'generated-file'): string {
  const candidate = (input ?? '').trim().replace(/\0/g, '')
  const name = basename(candidate) || fallback
  if (name === '.' || name === '..') return fallback
  return name
}

export function saveDialogFilters(fileName: string, mimeType: string | undefined): Electron.FileFilter[] {
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

export async function saveWorkspaceFileAs(
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

export function validateMcpConfigContent(content: string): void {
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

export function sameProjectWorkspace(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const path = resolve(value).replaceAll('\\', '/').replace(/\/+$/g, '')
    return process.platform === 'win32' ? path.toLowerCase() : path
  }
  return normalize(left) === normalize(right)
}

const MINI_WINDOW_WIDTH = 380
const MINI_WINDOW_HEIGHT = 480
const MINI_WINDOW_MARGIN = 24

// Bounds captured before entering mini mode so restoring puts the window back
// exactly where the user left it. Weak keys release closed windows.
const miniWindowSavedBounds = new WeakMap<BrowserWindow, {
  bounds: Rectangle
  maximized: boolean
  minimumSize: number[]
  alwaysOnTop: boolean
}>()

export function isMiniWindowMode(mainWindow: BrowserWindow | null): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && miniWindowSavedBounds.has(mainWindow)
}

export function toggleMiniWindowMode(mainWindow: BrowserWindow | null): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (miniWindowSavedBounds.has(mainWindow)) {
    const saved = miniWindowSavedBounds.get(mainWindow)
    miniWindowSavedBounds.delete(mainWindow)
    mainWindow.setAlwaysOnTop(saved!.alwaysOnTop)
    mainWindow.setMinimumSize(saved!.minimumSize[0]!, saved!.minimumSize[1]!)
    // setBounds() is a no-op while the window is maximized, so unmaximize
    // first: if the user maximized while in mini mode, exiting must restore
    // the saved normal bounds instead of keeping the mini-sized normal frame.
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    if (saved?.bounds) mainWindow.setBounds(saved.bounds)
    if (saved?.maximized) mainWindow.maximize()
    return false
  }
  miniWindowSavedBounds.set(mainWindow, {
    bounds: mainWindow.getNormalBounds(),
    maximized: mainWindow.isMaximized(),
    minimumSize: mainWindow.getMinimumSize(),
    alwaysOnTop: mainWindow.isAlwaysOnTop()
  })
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  mainWindow.setMinimumSize(320, 240)
  const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea
  mainWindow.setBounds({
    width: MINI_WINDOW_WIDTH,
    height: MINI_WINDOW_HEIGHT,
    x: area.x + area.width - MINI_WINDOW_WIDTH - MINI_WINDOW_MARGIN,
    y: area.y + area.height - MINI_WINDOW_HEIGHT - MINI_WINDOW_MARGIN
  })
  mainWindow.setAlwaysOnTop(true)
  return true
}

export function runDesktopCommand(
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
      reloadRenderer(contents)
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
    case 'toggleMini': {
      const mini = toggleMiniWindowMode(mainWindow)
      if (contents && !contents.isDestroyed()) contents.send('window:mini-mode', mini)
      return
    }
    case 'close':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
      return
    case 'quit':
      app.quit()
      return
  }
}
