import { ipcMain, type IpcMainInvokeEvent } from 'electron'

export type RemoteIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<unknown> | unknown

const handlers = new Map<string, RemoteIpcHandler>()
let installed = false

/**
 * Records every `ipcMain.handle`/`handleOnce` registration so the Remote
 * gateway can dispatch browser invokes through the exact same handlers the
 * desktop renderer uses. Install before any channel is registered.
 */
export function installRemoteIpcRegistry(): void {
  if (installed) return
  installed = true
  const originalHandle = ipcMain.handle.bind(ipcMain)
  const originalRemoveHandler = ipcMain.removeHandler.bind(ipcMain)
  ipcMain.handle = (channel: string, listener: RemoteIpcHandler): void => {
    handlers.set(channel, listener)
    originalHandle(channel, listener)
  }
  ipcMain.removeHandler = (channel: string): void => {
    handlers.delete(channel)
    originalRemoveHandler(channel)
  }
}

export function remoteIpcHandlerFor(channel: string): RemoteIpcHandler | undefined {
  return handlers.get(channel)
}

/** Test hook: inspect the recorded channel list. */
export function remoteIpcChannels(): string[] {
  return [...handlers.keys()]
}
