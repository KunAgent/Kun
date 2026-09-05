import { ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerBuiltinGitHubMcpAuthorizationIpc } from '../github-mcp-authorization-ipc'
import { ensureBundledSkills } from '../skill-bundled'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { registerAppContentIpcHandlers } from './register-app-content-ipc-handlers'
import { registerAppFileIpcHandlers } from './register-app-file-ipc-handlers'
import { registerAppGitIpcHandlers } from './register-app-git-ipc-handlers'
import { registerAppKunConfigIpcHandlers } from './register-app-kun-config-ipc-handlers'
import { registerAppRuntimeIpcHandlers } from './register-app-runtime-ipc-handlers'
import { registerAppSettingsIpcHandlers } from './register-app-settings-ipc-handlers'
import { registerAppUiPluginIpcHandlers } from './register-app-ui-plugin-ipc-handlers'
import { registerAppWorkspaceIpcHandlers } from './register-app-workspace-ipc-handlers'

export function registerAppIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  // Keep domain registration calls in the original channel order.
  void ensureBundledSkills(join(homedir(), '.kun'))
  registerAppSettingsIpcHandlers(options)
  registerBuiltinGitHubMcpAuthorizationIpc({
    ipcMain,
    getMainWindow: options.getMainWindow,
    getSettings: () => options.store.load(),
    applySettingsPatch: options.applySettingsPatch
  })
  registerAppRuntimeIpcHandlers(options)
  registerAppWorkspaceIpcHandlers(options)
  registerAppUiPluginIpcHandlers(options)
  registerAppKunConfigIpcHandlers(options)
  registerAppGitIpcHandlers(options)
  registerAppFileIpcHandlers(options)
  registerAppContentIpcHandlers(options)
}
