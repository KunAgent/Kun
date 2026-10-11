import { dialog, ipcMain } from 'electron'
import { GATEWAY_CLIENTS, type GatewayClientId } from '../../shared/gateway-client-setup'
import type { GatewayLaunchProfileResult } from '../../shared/gateway-launch-profile'
import { GatewayLaunchProfileService } from '../services/gateway-launch-profile-service'
import { NativeDialogCoordinator } from '../native-dialog-coordinator'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from './app-ipc-handler-utils'

/** Folder selection stays Main-owned; renderer receives an expiring review token, never arbitrary write access. */
export function registerGatewayLaunchProfileIpc(options: Pick<RegisterAppIpcHandlersOptions, 'getMainWindow' | 'nativeDialogs'>): void {
  const service = new GatewayLaunchProfileService()
  const owners = new Map<string, number>()
  const dialogs = options.nativeDialogs ?? new NativeDialogCoordinator()
  ipcMain.handle('gateway:launch-profile', async (event, input: unknown): Promise<GatewayLaunchProfileResult> => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    if (!input || typeof input !== 'object') throw new Error('Invalid launch profile request')
    const request = input as Record<string, unknown>
    try {
      if (request.action === 'preview') {
        if (!GATEWAY_CLIENTS.some((client) => client.id === request.clientId) || typeof request.baseUrl !== 'string' ||
          typeof request.modelId !== 'string' || request.baseUrl.length > 2048 || request.modelId.length > 512) throw new Error('Invalid launch profile selection')
        const window = options.getMainWindow()
        if (!window) throw new Error('Open the Kun desktop window first')
        const picked = await dialogs.run(event.sender, () => dialog.showOpenDialog(window, {
          title: 'Choose a folder for an isolated Kun gateway launch profile', properties: ['openDirectory', 'createDirectory']
        }))
        if (picked.canceled || !picked.filePaths[0]) return { ok: true, canceled: true }
        const preview = service.preview(picked.filePaths[0], { clientId: request.clientId as GatewayClientId,
          baseUrl: request.baseUrl, modelId: request.modelId })
        owners.set(preview.planId, event.sender.id)
        if (owners.size > 64) owners.delete(owners.keys().next().value!)
        return { ok: true, preview }
      }
      if ((request.action !== 'apply' && request.action !== 'restore') || typeof request.planId !== 'string' ||
        owners.get(request.planId) !== event.sender.id) throw new Error('Choose a folder and review a fresh launch profile first')
      if (request.action === 'apply') return { ok: true, preview: service.apply(request.planId) }
      service.restore(request.planId)
      owners.delete(request.planId)
      return { ok: true, restored: true }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Launch profile operation failed' } }
  })
}
