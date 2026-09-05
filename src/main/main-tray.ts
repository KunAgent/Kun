import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Notification,
  screen,
  Tray,
  type ContextMenuParams,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'node:path'
import {
  notificationIconOptions,
  pickTrayIcon,
  prepareTrayIcon
} from './app-icon'
import {
  buildTrayMenuTemplate,
  parseTrayThreads,
  type TrayThreadSummary
} from './tray-session-menu'
import {
  resolveTrayQuotaAnchorBounds,
  resolveTrayQuotaPopoverPosition
} from './tray-quota-position'
import {
  resolveTrayQuotaWindowPlatformOptions,
  resolveTrayQuotaWorkspaceOptions
} from './tray-quota-window-options'
import { TRAY_PROVIDER_QUOTA_CHANNELS } from '../shared/tray-provider-quota'
import { syncLoginItemSettings } from './desktop-behavior'
import { resolveNamedPreloadPath } from './main-paths'
import {
  type AppSettingsV1,
  type WindowCloseAction
} from '../shared/app-settings'
import type {
  TrayActionPayload,
  TurnCompleteNotificationPayload
} from '../shared/kun-gui-api'
import {
  getRuntimeBaseUrlForSettings,
  kunRuntimeAdapter,
  runtimeAuthHeaders
} from './runtime/kun-adapter'
import { logError, logWarn } from './logger'
import { resolveMainWindowCloseDecision } from './window-close-behavior'
import { turnCompleteNotificationDisabledReason } from './notification-preferences'
import {
  __dirname,
  appEnvironment,
  appIcon,
  developmentRendererUrl,
  mainState,
  nativeDialogCoordinator,
  trayIcon
} from './main-app-context'
import { runtimeShutdown } from './main-lifecycle'

function windowCloseLabels(locale: AppSettingsV1['locale']): {
  title: string
  message: string
  detail: string
  minimizeToTray: string
  quit: string
  cancel: string
  remember: string
  trayUnavailable: string
} {
  if (locale === 'zh') {
    return {
      title: '关闭窗口',
      message: '关闭窗口时要怎么处理？',
      detail: '最小化到托盘会让 Kun 和当前 Runtime 继续在后台运行，不会影响当前任务。退出应用会停止桌面端拥有的 Runtime，运行中的 Agent 任务和待审批操作会中断；已保存的对话、设置和工作区文件不会被删除。',
      minimizeToTray: '最小化到托盘',
      quit: '退出应用',
      cancel: '取消',
      remember: '记住我的选择，不再询问',
      trayUnavailable: '系统托盘当前不可用。为避免窗口消失后无法恢复，本次只能退出或取消。'
    }
  }
  return {
    title: 'Close window',
    message: 'What should Kun do when this window closes?',
    detail: 'Minimize to tray keeps Kun and its current Runtime running in the background without interrupting the current task. Quitting stops the Runtime owned by this desktop app, interrupting running Agent work and pending approvals. Saved conversations, settings, and workspace files are not deleted.',
    minimizeToTray: 'Minimize to tray',
    quit: 'Quit app',
    cancel: 'Cancel',
    remember: 'Remember my choice and do not ask again',
    trayUnavailable: 'The system tray is unavailable. To keep the window recoverable, this close can only quit or be cancelled.'
  }
}

export function revealMainWindow(): void {
  if (!mainState.mainWindow || mainState.mainWindow.isDestroyed()) {
    mainState.createWindow()
    return
  }
  if (mainState.mainWindow.isMinimized()) mainState.mainWindow.restore()
  mainState.mainWindow.show()
  mainState.mainWindow.focus()
}

export function dispatchTrayAction(action: TrayActionPayload): void {
  revealMainWindow()
  const window = mainState.mainWindow
  if (!window || window.isDestroyed()) return
  const send = (): void => {
    if (!window.isDestroyed()) window.webContents.send('tray:action', action)
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

export function showRendererContextMenu(window: BrowserWindow, params: ContextMenuParams): void {
  const template: MenuItemConstructorOptions[] = []
  const hasSelection = params.selectionText.trim().length > 0
  if (params.isEditable) {
    template.push(
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy || hasSelection },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    )
  } else if (hasSelection) {
    template.push(
      { role: 'copy', enabled: true },
      { type: 'separator' },
      { role: 'selectAll' }
    )
  }
  if (!app.isPackaged) {
    if (template.length > 0) template.push({ type: 'separator' })
    template.push({
      label: 'Inspect Element',
      click: () => window.webContents.inspectElement(params.x, params.y)
    })
  }
  if (template.length === 0) return
  Menu.buildFromTemplate(template).popup({ window, x: params.x, y: params.y })
}

function quitFromTray(): void {
  runtimeShutdown.requestQuit()
  app.quit()
}

function createTrayMenu(settings: AppSettingsV1, threads: TrayThreadSummary[]): Menu {
  return Menu.buildFromTemplate(buildTrayMenuTemplate({
    locale: settings.locale,
    threads,
    actions: {
      openThread: (threadId) => dispatchTrayAction({ type: 'open-thread', threadId }),
      newChat: () => dispatchTrayAction({ type: 'new-chat' }),
      openApp: revealMainWindow,
      quit: quitFromTray
    }
  }))
}

const TRAY_QUOTA_WINDOW_WIDTH = 420
const TRAY_QUOTA_WINDOW_HEIGHT = 660
const TRAY_QUOTA_WINDOW_MARGIN = 8

function positionTrayQuotaWindow(window: BrowserWindow): void {
  if (!mainState.tray || mainState.tray.isDestroyed() || window.isDestroyed()) return
  const trayBounds = resolveTrayQuotaAnchorBounds(
    mainState.tray.getBounds(),
    screen.getCursorScreenPoint()
  )
  const display = screen.getDisplayMatching(trayBounds)
  const width = Math.max(1, Math.min(
    TRAY_QUOTA_WINDOW_WIDTH,
    display.workArea.width - TRAY_QUOTA_WINDOW_MARGIN * 2
  ))
  const height = Math.max(1, Math.min(
    TRAY_QUOTA_WINDOW_HEIGHT,
    display.workArea.height - TRAY_QUOTA_WINDOW_MARGIN * 2
  ))
  window.setSize(width, height, false)
  const position = resolveTrayQuotaPopoverPosition({
    trayBounds,
    windowSize: { width, height },
    workArea: display.workArea,
    margin: TRAY_QUOTA_WINDOW_MARGIN
  })
  window.setPosition(position.x, position.y, false)
}

async function ensureTrayQuotaWindow(): Promise<BrowserWindow> {
  if (mainState.trayQuotaWindow && !mainState.trayQuotaWindow.isDestroyed()) {
    await mainState.trayQuotaWindowReady
    return mainState.trayQuotaWindow
  }

  const window = new BrowserWindow({
    width: TRAY_QUOTA_WINDOW_WIDTH,
    height: TRAY_QUOTA_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    ...resolveTrayQuotaWindowPlatformOptions(process.platform),
    webPreferences: {
      preload: resolveNamedPreloadPath(__dirname, 'tray-quota'),
      contextIsolation: true,
      sandbox: true
    }
  })
  mainState.trayQuotaWindow = window
  positionTrayQuotaWindow(window)
  window.setVisibleOnAllWorkspaces(true, resolveTrayQuotaWorkspaceOptions(process.platform))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    logError('tray-quota', 'Failed to load tray quota preload.', {
      preloadPath,
      message: error instanceof Error ? error.message : String(error)
    })
  })
  window.on('blur', () => {
    if (!window.webContents.isDevToolsOpened()) window.hide()
  })
  window.on('closed', () => {
    if (mainState.trayQuotaWindow === window) {
      mainState.trayQuotaWindow = null
      mainState.trayQuotaWindowReady = null
    }
  })

  const devUrl = developmentRendererUrl()
  mainState.trayQuotaWindowReady = devUrl
    ? (() => {
        const target = new URL(devUrl)
        target.pathname = '/tray-quota.html'
        target.search = ''
        target.hash = ''
        return window.loadURL(target.toString())
      })()
    : window.loadFile(join(__dirname, '../renderer/tray-quota.html'))
  try {
    await mainState.trayQuotaWindowReady
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  return window
}

export function hideTrayQuotaPopover(): void {
  mainState.trayQuotaToggleGeneration += 1
  if (mainState.trayQuotaWindow && !mainState.trayQuotaWindow.isDestroyed()) mainState.trayQuotaWindow.hide()
}

export function destroyTrayQuotaPopover(): void {
  mainState.trayQuotaToggleGeneration += 1
  if (mainState.trayQuotaWindow && !mainState.trayQuotaWindow.isDestroyed()) mainState.trayQuotaWindow.destroy()
  mainState.trayQuotaWindow = null
  mainState.trayQuotaWindowReady = null
}

export function notifyTrayQuotaRefresh(): void {
  const window = mainState.trayQuotaWindow
  if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) return
  window.webContents.send(TRAY_PROVIDER_QUOTA_CHANNELS.refresh)
}

async function toggleTrayQuotaPopover(): Promise<void> {
  if (mainState.trayQuotaWindow?.isVisible()) {
    hideTrayQuotaPopover()
    return
  }
  const generation = ++mainState.trayQuotaToggleGeneration
  const window = await ensureTrayQuotaWindow()
  if (
    generation !== mainState.trayQuotaToggleGeneration ||
    window.isDestroyed() ||
    !mainState.tray ||
    mainState.tray.isDestroyed()
  ) return
  positionTrayQuotaWindow(window)
  window.webContents.send(TRAY_PROVIDER_QUOTA_CHANNELS.refresh)
  window.show()
  window.focus()
}

async function loadTrayThreads(settings: AppSettingsV1): Promise<TrayThreadSummary[]> {
  try {
    await kunRuntimeAdapter.resolveConnection(settings)
    const response = await fetch(`${getRuntimeBaseUrlForSettings(settings)}/v1/threads?limit=20`, {
      headers: runtimeAuthHeaders(settings),
      signal: AbortSignal.timeout(1_000)
    })
    return response.ok ? parseTrayThreads(await response.text()) : []
  } catch (error) {
    logWarn('tray', 'Failed to load tray sessions.', {
      message: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

function showTrayMenu(): void {
  if (!mainState.tray || mainState.trayMenuOpenPromise) return
  hideTrayQuotaPopover()
  const currentTray = mainState.tray
  mainState.trayMenuOpenPromise = (async () => {
    const settings = await mainState.store.load()
    const threads = await loadTrayThreads(settings)
    if (currentTray.isDestroyed()) return
    mainState.trayMenu = createTrayMenu(settings, threads)
    currentTray.popUpContextMenu(mainState.trayMenu)
  })().finally(() => {
    mainState.trayMenuOpenPromise = null
  })
}

export function syncTray(settings: AppSettingsV1): void {
  mainState.appBehavior = settings.appBehavior

  try {
    if (!mainState.tray) {
      // Tray 优先用专门的托盘图(在 16x16/24x24 任务栏尺寸下更清晰的剪影);
      // 托盘图加载失败时回退到主应用图,这样不会看到 electron 默认占位。
      const traySource = prepareTrayIcon(pickTrayIcon(trayIcon, appIcon))
      const createdTray = new Tray(traySource.isEmpty() ? nativeImage.createEmpty() : traySource)
      mainState.tray = createdTray
      createdTray.on('click', () => {
        void toggleTrayQuotaPopover().catch((error) => {
          logWarn('tray-quota', 'Failed to toggle tray quota popover.', {
            message: error instanceof Error ? error.message : String(error)
          })
        })
      })
      createdTray.on('double-click', () => {
        hideTrayQuotaPopover()
        revealMainWindow()
      })
      createdTray.on('right-click', showTrayMenu)
    }

    const currentTray = mainState.tray
    if (!currentTray) return
    currentTray.setToolTip(appEnvironment.appName)
    mainState.trayMenu = createTrayMenu(settings, [])
    currentTray.setContextMenu(null)
    mainState.trayAvailable = true
    notifyTrayQuotaRefresh()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainState.trayAvailable = false
    if (mainState.tray && !mainState.tray.isDestroyed()) mainState.tray.destroy()
    mainState.tray = null
    mainState.trayMenu = null
    console.warn('[kun-gui] tray initialization failed; continuing without tray:', error)
    logWarn('tray', 'Tray initialization failed; continuing without tray.', { message })
  }
}

async function saveWindowCloseActionPreference(closeAction: WindowCloseAction): Promise<void> {
  const saved = await mainState.store.patch({ appBehavior: { closeAction } })
  syncLoginItemSettings(saved)
  syncTray(saved)
}

async function promptWindowCloseAction(window: BrowserWindow): Promise<void> {
  if (mainState.closeWindowPromptOpen || window.isDestroyed()) return
  mainState.closeWindowPromptOpen = true
  try {
    const settings = await mainState.store.load()
    const labels = windowCloseLabels(settings.locale)
    const trayAvailable = mainState.trayAvailable
    const result = await nativeDialogCoordinator.run(window.webContents, async () => {
      if (window.isDestroyed()) {
        throw new Error('Close-window prompt parent was destroyed.')
      }
      return dialog.showMessageBox(window, {
        type: 'question',
        title: labels.title,
        message: labels.message,
        detail: trayAvailable ? labels.detail : labels.trayUnavailable,
        buttons: trayAvailable
          ? [labels.minimizeToTray, labels.quit, labels.cancel]
          : [labels.quit, labels.cancel],
        defaultId: trayAvailable ? 0 : 1,
        cancelId: trayAvailable ? 2 : 1,
        noLink: true,
        checkboxLabel: trayAvailable ? labels.remember : undefined,
        checkboxChecked: false
      })
    })
    if (!trayAvailable) {
      if (result.response === 0) {
        runtimeShutdown.requestQuit()
        app.quit()
      }
      return
    }
    if (result.response === 0) {
      if (result.checkboxChecked) {
        await saveWindowCloseActionPreference('tray')
      }
      window.hide()
      return
    }
    if (result.response === 1) {
      if (result.checkboxChecked) {
        await saveWindowCloseActionPreference('quit')
      }
      runtimeShutdown.requestQuit()
      app.quit()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[kun-gui] failed to handle close-window prompt:', error)
    logWarn('desktop-behavior', 'Failed to handle close-window prompt.', { message })
  } finally {
    mainState.closeWindowPromptOpen = false
  }
}

export function handleMainWindowClose(window: BrowserWindow, event: Electron.Event): void {
  const decision = resolveMainWindowCloseDecision({
    closeAction: mainState.appBehavior.closeAction,
    isQuitting: runtimeShutdown.isQuitRequested,
    isUpdateInstallQuitting: runtimeShutdown.isUpdateInstallQuit,
    trayAvailable: mainState.trayAvailable
  })
  if (decision === 'allow') return

  event.preventDefault()
  if (decision === 'hide-to-tray') {
    window.hide()
    return
  }
  if (decision === 'quit-app') {
    runtimeShutdown.requestQuit()
    app.quit()
    return
  }
  void promptWindowCloseAction(window)
}

function normalizeNotificationText(raw: string | undefined, fallback: string, maxLength: number): string {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

export async function showTurnCompleteNotification(
  payload: TurnCompleteNotificationPayload
): Promise<{ ok: true; shown: boolean; reason?: string } | { ok: false; message: string }> {
  const settings = await mainState.store.load()
  const disabledReason = turnCompleteNotificationDisabledReason(
    settings.notifications,
    payload.source
  )
  if (disabledReason) {
    return { ok: true, shown: false, reason: disabledReason }
  }
  if (!Notification.isSupported()) {
    return { ok: true, shown: false, reason: 'unsupported' }
  }

  const baseTitle = normalizeNotificationText(payload.title, appEnvironment.appName, 80)
  const title = appEnvironment.flavor === 'development'
    ? `[DV] ${baseTitle}`
    : baseTitle
  const body = normalizeNotificationText(payload.body, 'Conversation complete.', 180)

  try {
    const notification = new Notification({
      title,
      body,
      ...notificationIconOptions(appIcon)
    })
    notification.on('click', () => {
      revealMainWindow()
    })
    notification.show()
    return { ok: true, shown: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('notification', 'Failed to show turn completion notification', {
      message,
      threadId: payload.threadId
    })
    return { ok: false, message }
  }
}
