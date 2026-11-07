import { ipcMain } from 'electron'
import { CONTROL_PACKAGE_CHANNELS as channels } from '../../shared/control-package'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import type { RegisterAppIpcHandlersOptions } from '../ipc/app-ipc-handler-options'
import { controlRuntimeHost } from '../control-host/runtime-host'
export function registerControlPackage(options: RegisterAppIpcHandlersOptions) {
  for (const operation of ['status', 'check', 'install', 'apply'] as const) {
    ipcMain.handle(channels[operation], async event => {
      assertTrustedWorkbenchSender(event, options.getMainWindow)
      const host = controlRuntimeHost()
      return operation === 'status' ? host.manager.status() : host.packageOperation(operation)
    })
  }
}
