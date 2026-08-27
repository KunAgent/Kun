import {
  BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent
} from 'electron'
import {
  BrowserUseControlInputSchema,
  BrowserUseDecisionInputSchema,
  BrowserUseMountInputSchema,
  BrowserUseNavigationInputSchema,
  BrowserUseThreadInputSchema
} from '../../shared/browser-use'
import type { BrowserUseManager } from './browser-use-manager'
import { trustedRendererSenderIsCurrent } from '../renderer-trust-policy'
import { trustedWorkbenchRendererUrl } from '../main-window'

const CHANNELS = [
  'browser-use:state:get',
  'browser-use:mount',
  'browser-use:origin:decide',
  'browser-use:action:decide',
  'browser-use:control',
  'browser-use:navigate',
  'browser-use:stop',
  'browser-use:clear'
] as const

export function registerBrowserUseIpc(options: {
  ipcMain: IpcMain
  manager: BrowserUseManager
  getMainWindow: () => BrowserWindow | null
}): () => void {
  const { ipcMain, manager, getMainWindow } = options
  ipcMain.handle('browser-use:state:get', (event, raw) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = BrowserUseThreadInputSchema.parse(raw)
    return manager.stateForThread(input.threadId)
  })
  ipcMain.handle('browser-use:mount', (event, raw) => {
    const window = assertTrustedWorkbenchSender(event, getMainWindow)
    const input = BrowserUseMountInputSchema.parse(raw)
    return manager.mount(
      input.threadId,
      window,
      input.bounds,
      input.visible,
      input.supervisionActive
    )
  })
  ipcMain.handle('browser-use:origin:decide', (event, raw) => {
    const window = assertTrustedWorkbenchSender(event, getMainWindow)
    const input = BrowserUseDecisionInputSchema.parse(raw)
    assertBoundSession(manager, input.threadId, window)
    return manager.decideOrigin(input)
  })
  ipcMain.handle('browser-use:action:decide', (event, raw) => {
    const window = assertTrustedWorkbenchSender(event, getMainWindow)
    const input = BrowserUseDecisionInputSchema.parse(raw)
    assertBoundSession(manager, input.threadId, window)
    return manager.decideAction(input)
  })
  ipcMain.handle('browser-use:control', (event, raw) => {
    const window = assertTrustedWorkbenchSender(event, getMainWindow)
    const input = BrowserUseControlInputSchema.parse(raw)
    assertBoundSession(manager, input.threadId, window)
    return manager.setControlOwner(input.threadId, input.controlOwner)
  })
  ipcMain.handle('browser-use:navigate', (event, raw) => {
    const window = assertTrustedWorkbenchSender(event, getMainWindow)
    const input = BrowserUseNavigationInputSchema.parse(raw)
    assertBoundSession(manager, input.threadId, window)
    return manager.navigate(input.threadId, input.command)
  })
  ipcMain.handle('browser-use:stop', (event, raw) => {
    const window = assertTrustedWorkbenchSender(event, getMainWindow)
    const input = BrowserUseThreadInputSchema.parse(raw)
    assertBoundSession(manager, input.threadId, window)
    return manager.stop(input.threadId)
  })
  ipcMain.handle('browser-use:clear', async (event, raw) => {
    const window = assertTrustedWorkbenchSender(event, getMainWindow)
    const input = BrowserUseThreadInputSchema.parse(raw)
    assertBoundSession(manager, input.threadId, window)
    await manager.clear(input.threadId)
    return manager.stateForThread(input.threadId)
  })
  return () => {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel)
  }
}

function assertTrustedWorkbenchSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: () => BrowserWindow | null
): BrowserWindow {
  const window = getMainWindow()
  if (!trustedRendererSenderIsCurrent(event, window, {
    trustedRendererUrl: trustedWorkbenchRendererUrl(),
    surface: 'workbench'
  })) {
    throw new Error('Browser Use IPC sender is not the trusted workbench frame.')
  }
  return window as BrowserWindow
}

function assertBoundSession(
  manager: BrowserUseManager,
  threadId: string,
  window: BrowserWindow
): void {
  if (!manager.isBoundToWindow(threadId, window)) {
    throw new Error('Browser Use session is not bound to this workbench window.')
  }
}
