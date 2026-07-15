import type { IpcMain } from 'electron'

// EXT-SEAM: Extension IPC registration
export function registerExtensionIpc(ipcMain: IpcMain): void {
  // Stage 0: no-op (Stage 1+ will register experts/design IPC)
}
