import {
  app,
  BrowserWindow,
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
import { resolveNamedPreloadPath } from './main-paths'
import type { AppSettingsV1 } from '../shared/app-settings'
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
  trayIcon
} from './main-app-context'
import { runtimeShutdown } from './main-lifecycle'

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

export function handleMainWindowClose(_window: BrowserWindow, event: Electron.Event): void {
  const decision = resolveMainWindowCloseDecision({
    isQuitting: runtimeShutdown.isQuitRequested,
    isUpdateInstallQuitting: runtimeShutdown.isUpdateInstallQuit
  })
  if (decision === 'allow') return
  event.preventDefault()
  runtimeShutdown.requestQuit()
  app.quit()
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
      if (payload.roomId) mainState.mainWindow?.webContents.send('runtime:sse-event', {
        streamId: 'rooms-navigation', events: [{ kind: 'navigate', roomId: payload.roomId }]
      })
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
