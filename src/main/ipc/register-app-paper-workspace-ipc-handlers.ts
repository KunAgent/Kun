import { app, ipcMain } from 'electron'
import { z } from 'zod'
import type { PaperWorkspaceEnsureResult } from '../../shared/paper/paper-workspace-types'
import { createPaperWorkspaceEnsurer } from '../services/paper/paper-workspace-service'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'

export function registerAppPaperWorkspaceIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const ensure = createPaperWorkspaceEnsurer({ store: options.store, userDataDir: () => app.getPath('userData') })
  ipcMain.handle('paper-workspace:ensure', async (event, payload: unknown): Promise<PaperWorkspaceEnsureResult> => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    // Fixed app-owned destination; never accept an arbitrary creation path.
    parseIpcPayload('paper-workspace:ensure', z.undefined(), payload)
    const result = await ensure()
    if (!result.ok) options.logError?.('paper-workspace', 'paper-workspace:ensure failed', result)
    return result
  })
}
