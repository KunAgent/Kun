import { ipcMain, type BrowserWindow } from 'electron'
import {
  AdeProjectDefaultsMutationSchema,
  AdeProjectDefaultsQuerySchema
} from '../../shared/ade-project-defaults'
import type { createAdeProjectDefaultsService } from '../ade-project-defaults-service'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'

type Service = ReturnType<typeof createAdeProjectDefaultsService>

export function registerAdeProjectDefaultsIpc(options: {
  service: Service
  getMainWindow: () => BrowserWindow | null
}): void {
  ipcMain.handle('settings:ade-project-defaults:get', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parseIpcPayload('settings:ade-project-defaults:get', AdeProjectDefaultsQuerySchema, payload)
    return options.service.get(request)
  })
  ipcMain.handle('settings:ade-project-defaults:save', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parseIpcPayload('settings:ade-project-defaults:save', AdeProjectDefaultsMutationSchema, payload)
    return options.service.save(request)
  })
}
