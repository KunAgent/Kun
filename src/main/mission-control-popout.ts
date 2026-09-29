import { app, BrowserWindow, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  __dirname,
  appEnvironment,
  appIcon,
  developmentRendererUrl,
  mainState
} from './main-app-context'
import { resolveNamedPreloadPath } from './main-paths'
import { dispatchTrayAction } from './main-tray'
import { hardenTrustedRendererWindow } from './main-window'
import { registerAuxiliaryWorkbenchWindow } from './renderer-trust-policy'
import {
  assertTrustedWorkbenchSender,
  parseIpcPayload,
  trustedWorkbenchSenderIsCurrent
} from './ipc/app-ipc-handler-utils'
import { appWindowTitleForFlavor } from '../shared/app-environment'

/**
 * Mission Control popout (docs/ade/impl p2 P2-09): a single auxiliary
 * workbench window that renders the Mission Control board surface
 * (`?popout=1`). It reuses the workbench preload and trust surface, so its
 * renderer talks to the same Kun activity/team APIs as the main window.
 * Closing it never quits the app; it is closed together with the main
 * window like every other auxiliary window.
 */
let popoutWindow: BrowserWindow | null = null

export function missionControlPopoutIsOpen(): boolean {
  return popoutWindow !== null && !popoutWindow.isDestroyed()
}

function openMissionControlPopout(): void {
  if (missionControlPopoutIsOpen()) {
    popoutWindow!.show()
    popoutWindow!.focus()
    return
  }
  const window = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: `${appWindowTitleForFlavor(appEnvironment.flavor)} — Mission Control`,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: resolveNamedPreloadPath(app.getAppPath(), 'index'),
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      additionalArguments: [
        `--kun-home-dir=${homedir()}`,
        `--kun-app-environment=${encodeURIComponent(JSON.stringify(appEnvironment))}`
      ]
    }
  })
  popoutWindow = window
  hardenTrustedRendererWindow(window, 'workbench')
  registerAuxiliaryWorkbenchWindow(window)
  // The board shares the main window's lifecycle: closing the main window
  // tears the popout down even before the quit barrier runs.
  const owner = mainState.mainWindow
  if (owner && !owner.isDestroyed()) {
    owner.once('closed', () => {
      if (!window.isDestroyed()) window.close()
    })
  }
  window.on('closed', () => {
    if (popoutWindow === window) popoutWindow = null
  })
  const devUrl = developmentRendererUrl()
  if (devUrl) {
    const target = new URL(devUrl)
    target.searchParams.set('popout', '1')
    void window.loadURL(target.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { popout: '1' }
    })
  }
  window.once('ready-to-show', () => window.show())
}

const openThreadPayloadSchema = z.object({ threadId: z.string().min(1) })

export function registerMissionControlPopoutIpc(
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('mission-control:popout:toggle', (event) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    openMissionControlPopout()
    return { open: true }
  })
  ipcMain.handle('mission-control:open-thread', (event, payload: unknown) => {
    // Only the popout frame itself may push a thread selection into the main
    // window — the same per-window sender proof the workbench handlers use.
    if (!trustedWorkbenchSenderIsCurrent(event, popoutWindow)) {
      throw new Error('IPC sender is not the Mission Control popout frame.')
    }
    const { threadId } = parseIpcPayload('mission-control:open-thread', openThreadPayloadSchema, payload)
    dispatchTrayAction({ type: 'open-thread', threadId })
  })
}
