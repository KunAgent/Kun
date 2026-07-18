import type {
  ComposerContextAttachment,
  HostContentScriptContext,
  HostContentScriptDiagnostic,
  JsonValue
} from '@kun/extension-api'

export const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/

export type ExtensionRuntimeRequestResult = {
  ok: boolean
  status: number
  body: string
}

export type ExtensionPackagePickResult = {
  canceled: boolean
  path: string | null
}

export type ExtensionListRequest = {
  limit?: number
  cursor?: string
  workspaceRoot?: string
  locale?: string
}

export type ExtensionWorkspaceRequest = {
  workspaceRoot?: string
  locale?: string
}

export type ExtensionListProviderModelsRequest = {
  extensionId: string
  extensionVersion: string
  providerId: string
  accountId: string
  workspaceRoot?: string
}

export type ExtensionLoadConfigurationRequest = {
  contributionIds: string[]
  workspaceRoot?: string
}

export type ExtensionUpdateConfigurationRequest = {
  contributionId: string
  key: string
  value: JsonValue
  expectedRevision: number
  workspaceRoot?: string
}

export type ExtensionScopedRequest = {
  extensionId: string
  workspaceRoot?: string
}

export type ExtensionInstallRequest =
  | {
      source: 'archive'
      path: string
      grantedPermissions?: string[]
      select?: boolean
      enable?: boolean
      consentRequestId?: string
    }
  | {
      source: 'development'
      path: string
      grantedPermissions?: string[]
      select?: boolean
      enable?: boolean
      consentRequestId?: string
    }
  | {
      source: 'index'
      indexUrl: string
      extensionId: string
      version: string
      grantedPermissions?: string[]
      select?: boolean
      enable?: boolean
      consentRequestId?: string
    }

export type ExtensionEnableRequest = ExtensionScopedRequest & {
  consentRequestId?: string
}

export type ExtensionDisableRequest = ExtensionScopedRequest

export type ExtensionRollbackRequest = {
  extensionId: string
  consentRequestId?: string
}

export type ExtensionUninstallRequest = {
  extensionId: string
  version?: string
  consentRequestId?: string
}

export type ExtensionReloadRequest = {
  extensionId: string
  consentRequestId?: string
}

export type ExtensionPermissionGrantRequest = ExtensionScopedRequest & {
  permissions: string[] | null
  expectedVersion: string
  /** Apply the reviewed workspace grant, then enable in the same protected decision. */
  enableAfterApply?: 'global' | 'workspace'
  consentRequestId?: string
}

export type ExtensionPermissionReviewResult =
  | { approved: false }
  | {
      approved: true
      consentRequestId: string
      expiresAt: string
      extensionVersion: string
      permissions: string[]
    }

export type ExtensionCommandInvocationRequest = {
  commandId: string
  context: unknown
  workspaceRoot?: string
}

export type ExtensionViewSessionCreateRequest = {
  contributionId: string
  workspaceRoot?: string
  /** Explicit user recovery after a Host crash/backoff/circuit failure. */
  retryHost?: boolean
}

export type ExtensionViewSessionDescriptor = {
  sessionId: string
  nonce: string
  extensionId: string
  extensionVersion: string
  contributionId: string
  src: string
  partition: string
}

export type ExtensionViewSessionRequest = {
  sessionId: string
}

export type ExtensionExternalBrowserBounds = {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export type ExtensionExternalBrowserPresentation = 'desktop' | 'mobile'

export type ExtensionExternalBrowserControlRequest =
  | {
      sessionId: string
      action: 'mount'
      siteId: string
      url: string
      presentation: ExtensionExternalBrowserPresentation
      bounds: ExtensionExternalBrowserBounds
    }
  | {
      sessionId: string
      action: 'activate'
      siteId: string
      url: string
      presentation: ExtensionExternalBrowserPresentation
    }
  | {
      sessionId: string
      action: 'bounds'
      bounds: ExtensionExternalBrowserBounds
    }
  | {
      sessionId: string
      action: 'navigate'
      url: string
    }
  | {
      sessionId: string
      action: 'back' | 'forward' | 'reload' | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'state'
    }

export type ExtensionExternalBrowserState = {
  sessionId: string
  siteId: string
  presentation: ExtensionExternalBrowserPresentation
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  zoomFactor: number
  error?: string
}

export type ExtensionViewMessageRequest = ExtensionViewSessionRequest & {
  channel: string
  payload: unknown
}

export type ExtensionViewEventsRequest = ExtensionViewSessionRequest & {
  cursor?: number
  limit?: number
}

export type ExtensionViewEventPayload = {
  sessionId: string
  cursor?: number
  events: unknown[]
}

/** Main-authenticated handoff from an isolated extension View to the composer. */
export type ExtensionComposerContextEvent = {
  /** Host-only scope fence; never forwarded to Kun as model-visible context. */
  workspaceRoot?: string
  attachment: ComposerContextAttachment
}

export type ExtensionWorkbenchNotification = {
  notificationId: string
  extensionId: string
  extensionVersion: string
  sourceId: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'error'
  actions: Array<{ id: string; title: string }>
  createdAt: string
  expiresAt: string
}

export type ExtensionNotificationSnapshot = {
  notifications: ExtensionWorkbenchNotification[]
}

export type ExtensionNotificationResponseRequest = {
  notificationId: string
  actionId?: string
}

export type ExtensionListAccountsRequest = {
  extensionId: string
  providerId?: string
  includeUnavailable?: boolean
}

export type ExtensionCreateAccountSessionRequest = {
  extensionId: string
  extensionVersion: string
  providerId: string
  authenticationProviderId: string
  label?: string
  scopes?: string[]
  workspaceRoot?: string
}

export type ExtensionAccountSessionRequest = {
  extensionId: string
  sessionId: string
}

/**
 * The OAuth callback URL is deliberately absent. Electron Main collects it in
 * a protected, host-owned window and forwards it directly to Kun.
 */
export type ExtensionCompleteAccountSessionRequest = ExtensionAccountSessionRequest & {
  extensionVersion: string
  workspaceRoot?: string
}

export type ExtensionDeleteAccountRequest = {
  extensionId: string
  extensionVersion: string
  accountId: string
  providerId: string
  workspaceRoot?: string
  consentRequestId?: string
}

export type ExtensionRenameAccountRequest = {
  extensionId: string
  extensionVersion: string
  accountId: string
  providerId: string
  workspaceRoot?: string
}

/**
 * The replacement key is deliberately absent. Electron Main collects it in a
 * protected host-owned window and forwards it directly to Kun.
 */
export type ExtensionReplaceApiKeyAccountRequest = ExtensionRenameAccountRequest

/**
 * The credential value is deliberately absent. Electron Main collects it in a
 * protected, host-owned window and forwards it directly to Kun.
 */
export type ExtensionCreateApiKeyAccountRequest = {
  extensionId: string
  extensionVersion: string
  providerId: string
  authenticationProviderId: string
  label?: string
  workspaceRoot?: string
}

export type ExtensionSetProviderBindingRequest = {
  extensionId: string
  extensionVersion: string
  providerId: string
  accountId: string
  modelId: string
  workspaceRoot?: string
}

export const EXTENSION_PROTECTED_OPERATION_KINDS = [
  'extension.install',
  'extension.enable',
  'extension.permissions',
  'extension.rollback',
  'extension.reload',
  'extension.uninstall',
  'account.create-session',
  'account.complete-session',
  'account.create-api-key',
  'account.rename',
  'account.replace-api-key',
  'account.delete',
  'provider.bind'
] as const

export type ExtensionProtectedOperationKind =
  (typeof EXTENSION_PROTECTED_OPERATION_KINDS)[number]

export type ExtensionConsentRequest = {
  extensionId: string
  extensionVersion: string
  operationKind: ExtensionProtectedOperationKind
  parameters: unknown
  workspaceRoot?: string
  title: string
  message: string
  detail?: string
}

export type ExtensionConsentResult =
  | { approved: false }
  | { approved: true; consentRequestId: string; expiresAt: string }

export const EXTENSION_HOST_SURFACES = [
  'workbench:code',
  'workbench:design',
  'workbench:write',
  'workbench:connect'
] as const

export type ExtensionHostSurface = (typeof EXTENSION_HOST_SURFACES)[number]

export type ExtensionHostContentScriptDescriptor = {
  extensionId: string
  contributionId: string
}

export type ExtensionSyncHostContentScriptsRequest = {
  surface: ExtensionHostSurface | null
  protectedSurface?: string
  workspaceRoot?: string
  descriptors: Array<ExtensionHostContentScriptDescriptor & Record<string, unknown>>
}

export type ExtensionSyncHostContentScriptsResult =
  | {
      ok: true
      active: Array<{ extensionId: string; contributionId: string }>
      reloadScheduled?: boolean
      diagnostics?: ExtensionHostContentScriptDiagnosticRecord[]
    }
  | { ok: false; code: string; message: string; reloadScheduled?: boolean }

export type ExtensionHostContentScriptBootstrapBinding = {
  bindingId: string
  nonce: string
  worldId: number
  context: HostContentScriptContext
  scripts: Array<{ code: string; url: string }>
  styles: Array<{ css: string; url: string }>
}

export type ExtensionHostContentScriptBootstrap = {
  version: 1
  generation: string
  bindings: ExtensionHostContentScriptBootstrapBinding[]
}

export type ExtensionHostContentScriptBridgeRequest = {
  bindingId: string
  nonce: string
  method: 'reportDiagnostic'
  diagnostic: HostContentScriptDiagnostic
}

export type ExtensionHostContentScriptDiagnosticRecord = {
  code: string
  extensionId?: string
  extensionVersion?: string
  contributionId?: string
  workspaceScope?: string
  message: string
  at: string
}

export type ExtensionIpcApi = {
  extensionPickPackage: () => Promise<ExtensionPackagePickResult>
  extensionPickDevelopmentDirectory: () => Promise<ExtensionPackagePickResult>
  extensionGetWorkbench: (
    request?: ExtensionWorkspaceRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionList: (request?: ExtensionListRequest) => Promise<ExtensionRuntimeRequestResult>
  extensionGet: (extensionId: string) => Promise<ExtensionRuntimeRequestResult>
  extensionDiagnostics: (extensionId?: string) => Promise<ExtensionRuntimeRequestResult>
  extensionInstall: (request: ExtensionInstallRequest) => Promise<unknown>
  extensionEnable: (request: ExtensionEnableRequest) => Promise<ExtensionRuntimeRequestResult>
  extensionDisable: (request: ExtensionDisableRequest) => Promise<ExtensionRuntimeRequestResult>
  extensionSetPermissions: (
    request: ExtensionPermissionGrantRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionReviewPermissions: (
    request: ExtensionScopedRequest
  ) => Promise<ExtensionPermissionReviewResult>
  extensionRollback: (request: ExtensionRollbackRequest) => Promise<ExtensionRuntimeRequestResult>
  extensionUninstall: (request: ExtensionUninstallRequest) => Promise<ExtensionRuntimeRequestResult>
  extensionReload: (request: ExtensionReloadRequest) => Promise<ExtensionRuntimeRequestResult>
  extensionInvokeCommand: (
    request: ExtensionCommandInvocationRequest
  ) => Promise<unknown>
  extensionCreateViewSession: (
    request: ExtensionViewSessionCreateRequest
  ) => Promise<ExtensionViewSessionDescriptor>
  extensionDisposeViewSession: (
    request: ExtensionViewSessionRequest | string
  ) => Promise<boolean>
  extensionExternalBrowserControl: (
    request: ExtensionExternalBrowserControlRequest
  ) => Promise<ExtensionExternalBrowserState>
  onExtensionExternalBrowserState: (
    handler: (state: ExtensionExternalBrowserState) => void
  ) => () => void
  extensionPostViewMessage: (
    request: ExtensionViewMessageRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionReadViewEvents: (
    request: ExtensionViewEventsRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  onExtensionViewEvent: (
    handler: (payload: ExtensionViewEventPayload) => void
  ) => () => void
  onExtensionComposerContext: (
    handler: (payload: ExtensionComposerContextEvent) => void
  ) => () => void
  onExtensionNotifications: (
    handler: (payload: ExtensionNotificationSnapshot) => void
  ) => () => void
  extensionRespondNotification: (
    request: ExtensionNotificationResponseRequest
  ) => Promise<boolean>
  extensionListAccounts: (
    request: ExtensionListAccountsRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionListModelProviders: (
    request?: ExtensionWorkspaceRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionListProviderModels: (
    request: ExtensionListProviderModelsRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionLoadConfiguration: (
    request: ExtensionLoadConfigurationRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionUpdateConfiguration: (
    request: ExtensionUpdateConfigurationRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionCreateAccountSession: (
    request: ExtensionCreateAccountSessionRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionGetAccountSession: (
    request: ExtensionAccountSessionRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionCompleteAccountSession: (
    request: ExtensionCompleteAccountSessionRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionCancelAccountSession: (
    request: ExtensionAccountSessionRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionDeleteAccount: (
    request: ExtensionDeleteAccountRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionRenameAccount: (
    request: ExtensionRenameAccountRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionReplaceApiKeyAccount: (
    request: ExtensionReplaceApiKeyAccountRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionCreateApiKeyAccount: (
    request: ExtensionCreateApiKeyAccountRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionSetProviderBinding: (
    request: ExtensionSetProviderBindingRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  extensionRequestConsent: (
    request: ExtensionConsentRequest
  ) => Promise<ExtensionConsentResult>
  extensionSyncHostContentScripts: (
    request: ExtensionSyncHostContentScriptsRequest
  ) => Promise<ExtensionSyncHostContentScriptsResult>
}
