import { ipcMain, shell } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerBuiltinGitHubMcpAuthorizationIpc } from '../github-mcp-authorization-ipc'
import { registerGoogleWorkspaceIpc } from '../google-workspace-ipc'
import { ensureBundledSkills } from '../skill-bundled'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { registerAppContentIpcHandlers } from './register-app-content-ipc-handlers'
import { registerAppFileIpcHandlers } from './register-app-file-ipc-handlers'
import { registerAppGitIpcHandlers } from './register-app-git-ipc-handlers'
import { registerAppKunConfigIpcHandlers } from './register-app-kun-config-ipc-handlers'
import { registerAppPaperIpcHandlers } from './register-app-paper-ipc-handlers'
import { registerAppPaperLibraryIpcHandlers } from './register-app-paper-library-ipc-handlers'
import { registerAppPaperEvidenceIpcHandlers } from './register-app-paper-evidence-ipc-handlers'
import { registerAppPaperReaderIpcHandlers } from './register-app-paper-reader-ipc-handlers'
import { registerAppRuntimeIpcHandlers } from './register-app-runtime-ipc-handlers'
import { registerAppSettingsIpcHandlers } from './register-app-settings-ipc-handlers'
import { registerAppUiPluginIpcHandlers } from './register-app-ui-plugin-ipc-handlers'
import { registerAppWorkspaceIpcHandlers } from './register-app-workspace-ipc-handlers'
import { configureRuntimeModelExecutor } from '../services/runtime-model-requests'

export function registerAppIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  configureRuntimeModelExecutor(async (input) => {
    const response = await options.runtimeRequest('/v1/model-requests', 'POST', JSON.stringify(input), undefined,
      { signal: AbortSignal.timeout((input.timeoutMs ?? 30_000) + 5_000), priority: 'background' })
    if (!response.ok) return { ok: false, message: `Model runtime request failed (HTTP ${response.status}). Check provider configuration.` }
    const value = JSON.parse(response.body) as { ok?: unknown; text?: unknown; message?: unknown }
    return value.ok === true && typeof value.text === 'string' ? { ok: true, text: value.text }
      : { ok: false, message: typeof value.message === 'string' ? value.message : 'The model request could not be completed.' }
  })
  // Keep domain registration calls in the original channel order.
  void ensureBundledSkills(join(homedir(), '.kun'))
  registerAppSettingsIpcHandlers(options)
  registerBuiltinGitHubMcpAuthorizationIpc({
    ipcMain,
    getMainWindow: options.getMainWindow,
    getSettings: () => options.store.load(),
    applySettingsPatch: options.applySettingsPatch
  })
  registerGoogleWorkspaceIpc({
    ipcMain,
    getMainWindow: options.getMainWindow,
    request: options.runtimeRequest,
    openExternal: (url) => shell.openExternal(url),
    assertReady: options.assertRendererRuntimeReady
  })
  registerAppRuntimeIpcHandlers(options)
  registerAppWorkspaceIpcHandlers(options)
  registerAppUiPluginIpcHandlers(options)
  registerAppKunConfigIpcHandlers(options)
  registerAppGitIpcHandlers(options)
  registerAppFileIpcHandlers(options)
  registerAppPaperIpcHandlers(options)
  registerAppPaperLibraryIpcHandlers(options)
  registerAppPaperReaderIpcHandlers(options)
  registerAppPaperEvidenceIpcHandlers(options)
  registerAppContentIpcHandlers(options)
}
