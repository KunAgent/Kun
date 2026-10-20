import { registerMobileLink } from '../mobile-link/register'
import { registerKunArtIpc } from './register-kun-art-ipc'
import { ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerBuiltinGitHubMcpAuthorizationIpc } from '../github-mcp-authorization-ipc'
import { ensureBundledSkills } from '../skill-bundled'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { registerAppContentIpcHandlers } from './register-app-content-ipc-handlers'
import { registerAppFileIpcHandlers } from './register-app-file-ipc-handlers'
import { registerAppGitIpcHandlers } from './register-app-git-ipc-handlers'
import { registerAppGitCommitIpcHandlers } from './register-app-git-commit-ipc-handlers'
import { registerAppKunConfigIpcHandlers } from './register-app-kun-config-ipc-handlers'
import { registerAppMarketIpcHandlers } from './register-app-market-ipc-handlers'
import { registerAppPaperIpcHandlers } from './register-app-paper-ipc-handlers'
import { registerAppPaperLibraryIpcHandlers } from './register-app-paper-library-ipc-handlers'
import { registerAppPaperWorkspaceIpcHandlers } from './register-app-paper-workspace-ipc-handlers'
import { registerAppPaperEvidenceIpcHandlers } from './register-app-paper-evidence-ipc-handlers'
import { registerAppPaperReaderIpcHandlers } from './register-app-paper-reader-ipc-handlers'
import { registerAppRuntimeIpcHandlers } from './register-app-runtime-ipc-handlers'
import { registerAppSettingsIpcHandlers } from './register-app-settings-ipc-handlers'
import { registerAppUiPluginIpcHandlers } from './register-app-ui-plugin-ipc-handlers'
import { registerAppWorkspaceIpcHandlers } from './register-app-workspace-ipc-handlers'
import { configureRuntimeModelExecutor } from '../services/runtime-model-requests'
import { registerAgentIntegrationIpcHandlers } from './register-agent-integration-ipc-handlers'
import { registerKunAccountIpc } from './register-kun-account-ipc'
import { registerAppSandboxIpcHandlers } from '../app-sandbox/app-sandbox-host'

export function registerAppIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const accountAccess = registerKunAccountIpc(options.getMainWindow, (path, method, body) =>
    options.runtimeRequest(path, method, body, undefined, { priority: 'background' }))
  registerMobileLink(options, accountAccess)
  registerKunArtIpc(options.getMainWindow, (path, method, body) =>
    options.runtimeRequest(path, method, body, undefined, { priority: 'background' }), accountAccess)
  configureRuntimeModelExecutor(async (input, request) => {
    // Closing the HTTP request aborts the Runtime's provider stream, so a caller's cancel reaches the provider.
    const timeout = AbortSignal.timeout((input.timeoutMs ?? 30_000) + 5_000)
    const response = await options.runtimeRequest('/v1/model-requests', 'POST', JSON.stringify(input), undefined,
      { signal: request?.signal ? AbortSignal.any([request.signal, timeout]) : timeout, priority: 'background' })
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
  registerAppRuntimeIpcHandlers(options)
  registerAgentIntegrationIpcHandlers(options)
  registerAppWorkspaceIpcHandlers(options)
  registerAppMarketIpcHandlers()
  registerAppUiPluginIpcHandlers(options)
  registerAppKunConfigIpcHandlers(options)
  registerAppGitIpcHandlers(options)
  registerAppGitCommitIpcHandlers(options)
  registerAppFileIpcHandlers(options)
  registerAppPaperIpcHandlers(options)
  registerAppPaperLibraryIpcHandlers(options)
  registerAppPaperWorkspaceIpcHandlers(options)
  registerAppPaperReaderIpcHandlers(options)
  registerAppPaperEvidenceIpcHandlers(options)
  registerAppContentIpcHandlers(options)
  registerAppSandboxIpcHandlers({
    getMainWindow: options.getMainWindow,
    runtimeRequest: (path, method, body) => options.runtimeRequest(path, method, body)
  })
}
