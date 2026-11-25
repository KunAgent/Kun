import type { Locale, Theme } from '@kun/extension-api'
import type { BrowserWindow } from 'electron'
import type { ExtensionRuntimeRequestResult } from '../../shared/extension-ipc'
import type { ExtensionContentScriptController } from '../extensions/extension-content-script-controller'
import type { ExtensionDescriptorResolver } from '../extensions/extension-descriptor-resolver'
import type { ExtensionViewSessionRegistry } from '../extensions/extension-view-sessions'
import type { ExtensionViewProtocolRegistry } from '../extensions/extension-view-protocol-registry'
import type { ExtensionMediaProtocolRegistry } from '../extensions/extension-media-protocol'
import type { ExtensionExternalBrowserManager } from '../extensions/extension-external-browser'
import type {
  ProtectedExtensionActionService
} from '../extensions/extension-consent-service'
import type { ProtectedCredentialSurfaceController } from '../extensions/protected-credential-surface'
import type { NativeDialogCoordinator } from '../native-dialog-coordinator'

export type RuntimeRequest = (
  path: string,
  method?: string,
  body?: string,
  headers?: Record<string, string>
) => Promise<ExtensionRuntimeRequestResult>

export type RegisterExtensionIpcHandlersOptions = {
  getMainWindow: () => BrowserWindow | null
  runtimeRequest: RuntimeRequest
  descriptors: ExtensionDescriptorResolver
  viewSessions: ExtensionViewSessionRegistry
  viewProtocols: ExtensionViewProtocolRegistry
  externalBrowsers: ExtensionExternalBrowserManager
  mediaProtocols?: ExtensionMediaProtocolRegistry
  protectedActions: ProtectedExtensionActionService
  withWidgetAppUninstall?: (id: string, version: string | undefined,
    uninstall: () => Promise<ExtensionRuntimeRequestResult>) => Promise<ExtensionRuntimeRequestResult>
  credentialSurface: ProtectedCredentialSurfaceController
  contentScripts: ExtensionContentScriptController
  getWorkbenchEnvironment: () => Promise<ExtensionWorkbenchEnvironment>
  logError?: (category: string, message: string, detail?: unknown) => void
  /** Shared per-window queue for Main-owned native confirmations. */
  nativeDialogs?: NativeDialogCoordinator
}

export type ExtensionWorkbenchEnvironment = {
  theme: Theme
  locale: Locale
}

export type ExtensionIpcRegistration = {
  bindMainWindow(window: BrowserWindow): void
  publishWorkbenchEnvironmentChanged(): Promise<void>
  dispose(): void
}
