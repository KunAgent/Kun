import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { GOOGLE_WORKSPACE_CHANNELS, type GoogleWorkspaceAction } from '../shared/google-workspace'
import { assertTrustedWorkbenchSender } from './ipc/app-ipc-handler-utils'
import { createGoogleWorkspaceController, type GoogleWorkspaceHostRequest } from './google-workspace-controller'

export function registerGoogleWorkspaceIpc(options: {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  request: GoogleWorkspaceHostRequest
  openExternal: (url: string) => Promise<unknown>
  assertSender?: typeof assertTrustedWorkbenchSender
  assertReady: () => void
}): void {
  let authorizationEvent: IpcMainInvokeEvent | undefined
  const assertSender = options.assertSender ?? assertTrustedWorkbenchSender
  const controller = createGoogleWorkspaceController({
    ...options,
    openExternal: (url) => {
      if (!authorizationEvent) throw new Error('Google Workspace authorization is no longer active.')
      assertSender(authorizationEvent, options.getMainWindow)
      return options.openExternal(url)
    }
  })
  const register = (channel: string, action: (event: IpcMainInvokeEvent) => Promise<unknown>): void => {
    options.ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertSender(event, options.getMainWindow)
      if (args.length) throw new Error('Google Workspace IPC does not accept arguments.')
      options.assertReady()
      return action(event)
    })
  }
  register(GOOGLE_WORKSPACE_CHANNELS.status, controller.status)
  register(GOOGLE_WORKSPACE_CHANNELS.cancel, () => {
    authorizationEvent = undefined
    return controller.cancel()
  })
  register(GOOGLE_WORKSPACE_CHANNELS.openAuthorization, controller.openAuthorization)
  for (const action of ['login', 'setup', 'test', 'logout'] as const satisfies readonly GoogleWorkspaceAction[]) {
    register(GOOGLE_WORKSPACE_CHANNELS[action], (event) => {
      authorizationEvent = action === 'login' ? event : undefined
      return controller.start(action)
    })
  }
}
