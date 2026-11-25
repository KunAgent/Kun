import { app, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { developmentRendererUrl, mainState } from './main-app-context'
import { registerDailyNotesIpc } from './daily-notes/window'
import type { DailyNotesAppearance } from '../shared/daily-notes'

/**
 * Shell-level IPC registered before the workbench window loads. Only
 * channels that are safe without background services belong here:
 * - `startup:state:get` powers the renderer's first paint progress.
 * - `log:open-dir` keeps the recovery UI usable while services start.
 * - Daily notes reads and writes the local profile independently of the runtime.
 *
 * The full registration (settings, runtime, extensions, terminal, ...)
 * happens later in registerMainIpc() once initializeMainServices() settles;
 * it replaces the `startup:state:get` handler with the same payload shape.
 */
export function registerShellIpc({ locale, theme }: DailyNotesAppearance): void {
  mainState.openDailyNotes = registerDailyNotesIpc({
    getMainWindow: () => mainState.mainWindow,
    developmentUrl: developmentRendererUrl(),
    getAppearance: () => {
      const current = mainState.settledRuntimeSettings
      return { locale: current?.locale ?? locale, theme: current?.theme ?? theme }
    }
  })
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
