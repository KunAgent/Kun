import { ipcMain, type BrowserWindow } from 'electron'
import type { createAdeCollaborationSettingsService } from '../ade-collaboration-settings-service'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'
import { adeCollaborationMutationSchema } from './ade-collaboration-settings-schema'

type Service = ReturnType<typeof createAdeCollaborationSettingsService>

export function registerAdeCollaborationSettingsIpc(options: {
  service: Service
  getMainWindow: () => BrowserWindow | null
}): void {
  ipcMain.handle('settings:ade-collaboration:get', async (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return options.service.get()
  })
  ipcMain.handle('settings:ade-collaboration:save', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parseIpcPayload(
      'settings:ade-collaboration:save',
      adeCollaborationMutationSchema,
      payload
    )
    return options.service.save(request)
  })
}
