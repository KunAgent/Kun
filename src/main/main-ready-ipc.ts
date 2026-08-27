import { app, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { mainState } from './main-app-context'

/**
 * Shell-level IPC registered before the workbench window loads. Only
 * channels that are safe without background services belong here:
 * - `startup:state:get` powers the renderer's first paint progress.
 * - `log:open-dir` keeps the recovery UI usable while services start.
 *
 * The full registration (settings, runtime, extensions, terminal, ...)
 * happens later in registerMainIpc() once initializeMainServices() settles;
 * it replaces the `startup:state:get` handler with the same payload shape.
 */
export function registerShellIpc(): void {
  ipcMain.handle('startup:state:get', () => mainState.startupState.payload())
  ipcMain.handle('log:open-dir', async () => {
    const dir = mainState.logDir ?? join(app.getPath('userData'), 'logs')
    try {
      await mkdir(dir, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
    const error = await shell.openPath(dir)
    if (error) return { ok: false, message: error }
    return { ok: true }
  })
}
