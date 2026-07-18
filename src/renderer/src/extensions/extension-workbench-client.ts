import {
  AccountSchema,
  AccountSessionSchema,
  JsonValueSchema,
  ProviderModelSchema,
  type Account,
  type AccountSession,
  type AuthenticationProviderDeclaration,
  type JsonValue,
  type ModelProviderDeclaration,
  type ProviderModel
} from '@kun/extension-api'
import type {
  ExtensionInstallRequest,
  ExtensionListProviderModelsRequest,
  ExtensionRuntimeRequestResult,
  ExtensionWorkspaceRequest,
  ExtensionViewSessionDescriptor
} from '@shared/extension-ipc'
import {
  ExtensionWorkbenchSnapshotSchema,
  type ExtensionWorkbenchSnapshot
} from './contribution-registry'

export type ExtensionViewSession = ExtensionViewSessionDescriptor

export type ProtectedExtensionInstallRequest =
  | Pick<Extract<ExtensionInstallRequest, { source: 'archive' }>, 'source' | 'path'>
  | Pick<Extract<ExtensionInstallRequest, { source: 'development' }>, 'source' | 'path'>
  | Pick<Extract<ExtensionInstallRequest, { source: 'index' }>, 'source' | 'indexUrl' | 'extensionId' | 'version'>

export type ExtensionManagementVersion = {
  id: string
  version: string
  path?: string
  source: { type: string; locator?: string; indexUrl?: string }
  signatureStatus?: string
  requestedPermissions: string[]
  grantedPermissions: string[]
  installedAt?: string
  registeredAt?: string
  reloadedAt?: string
  generation?: number
  apiVersion: string
  manifestVersion: number
  stateSchemaVersion: number
  displayName?: string
  description?: string
  icon?: string
  views?: Array<{
    id: string
    title: string
    point: 'views.rightSidebar' | 'views.editorTab' | 'views.fullPage'
  }>
  modelProviders?: ModelProviderDeclaration[]
  authentication?: AuthenticationProviderDeclaration[]
  mutable: boolean
}

export type ExtensionManagementEntry = {
  id: string
  selectedVersion?: string
  previousSelectedVersion?: string
  globallyEnabled: boolean
  effectiveEnabled?: boolean
  effectiveWorkspaceEnabled?: boolean
  workspaceTrusted?: boolean
  workspaceGrantedPermissions?: string[]
  workspaceEnablement: Record<string, boolean>
  workspacePermissionGrants: Record<string, string[]>
  useDevelopment: boolean
  versions: ExtensionManagementVersion[]
  development?: ExtensionManagementVersion
}

export type ExtensionHostDiagnostic = {
  extensionId: string
  version?: string
  lifecycleState: string
  activationEvent?: string
  processId?: number
  restartCount: number
  consecutiveFailures: number
  circuitOpen: boolean
  active: boolean
  logPath?: string
  lastError?: { code?: string; message?: string }
}

export type BundledExtensionSeedDiagnostic = {
  extensionId: string
  version: string
  outcome: 'installed' | 'updated-selected' | 'updated-unselected' | 'unchanged' |
    'user-managed' | 'removed' | 'skipped-downgrade' | 'skipped-permission-change' |
    'skipped-version-conflict' | 'failed'
  code?: string
  message?: string
}

export type ExtensionAccountProtection = {
  mode: 'system' | 'encrypted-fallback' | 'unavailable'
  degraded: boolean
  available: boolean
}

export type ExtensionAccountList = {
  accounts: Account[]
  protection: ExtensionAccountProtection
}

export type ExtensionProviderCatalogEntry = {
  extensionId: string
  extensionVersion: string
  extensionDisplayName: string
  localProviderId: string
  providerId: string
  displayName: string
  models: ProviderModel[]
  accounts: Account[]
  dataAccess: {
    digest: string
    categories: Array<
      'conversation-history' |
      'system-and-mode-instructions' |
      'attachments' |
      'tool-schemas'
    >
    requiresAcknowledgement: boolean
  }
  binding: {
    accountId: string
    modelId: string
    acknowledgedAt: string
    valid: boolean
  } | null
  selectable: boolean
  unavailableReason?: string
  discoveryError?: string
}

type ExtensionWorkbenchTransport = {
  getWorkbench: (
    request?: ExtensionWorkspaceRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  listModelProviders: (
    request?: ExtensionWorkspaceRequest
  ) => Promise<ExtensionRuntimeRequestResult>
  listProviderModels: (
    request: ExtensionListProviderModelsRequest
  ) => Promise<ExtensionRuntimeRequestResult>
}

const trustedWorkbenchTransport: ExtensionWorkbenchTransport = {
  getWorkbench: (request) => window.kunGui.extensionGetWorkbench(request),
  listModelProviders: (request) => window.kunGui.extensionListModelProviders(request),
  listProviderModels: (request) => window.kunGui.extensionListProviderModels(request)
}

export class ExtensionWorkbenchClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

function parseBody(result: { ok: boolean; status: number; body: string }): unknown {
  let body: unknown
  try {
    body = result.body ? JSON.parse(result.body) : undefined
  } catch {
    throw new ExtensionWorkbenchClientError(
      'EXTENSION_RESPONSE_INVALID',
      `Extension service returned invalid JSON (${result.status})`,
      result.status
    )
  }
  if (result.ok) return body
  const error = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  throw new ExtensionWorkbenchClientError(
    typeof error.code === 'string' ? error.code : 'EXTENSION_REQUEST_FAILED',
    typeof error.message === 'string' ? error.message : `Extension request failed (${result.status})`,
    result.status
  )
}

export class ExtensionWorkbenchClient {
  constructor(private readonly transport: ExtensionWorkbenchTransport = trustedWorkbenchTransport) {}

  async loadContributions(
    workspaceRoot?: string,
    locale?: string
  ): Promise<ExtensionWorkbenchSnapshot> {
    const request = {
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(locale ? { locale } : {})
    }
    const result = await this.transport.getWorkbench(
      Object.keys(request).length > 0 ? request : undefined
    )
    return ExtensionWorkbenchSnapshotSchema.parse(parseBody(result))
  }

  async listExtensions(
    workspaceRoot?: string,
    locale?: string
  ): Promise<ExtensionManagementEntry[]> {
    const value = parseBody(await window.kunGui.extensionList({
      limit: 500,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(locale ? { locale } : {})
    }))
    if (!value || typeof value !== 'object' || !Array.isArray((value as { extensions?: unknown }).extensions)) {
      throw new ExtensionWorkbenchClientError('EXTENSION_RESPONSE_INVALID', 'Extension list is malformed')
    }
    return (value as { extensions: ExtensionManagementEntry[] }).extensions
  }

  async listDiagnostics(): Promise<Array<{
    extensionId: string
    extension?: ExtensionManagementEntry
    host: ExtensionHostDiagnostic
    seed?: BundledExtensionSeedDiagnostic
  }>> {
    const value = parseBody(await window.kunGui.extensionDiagnostics())
    if (!value || typeof value !== 'object' || !Array.isArray((value as { diagnostics?: unknown }).diagnostics)) {
      throw new ExtensionWorkbenchClientError('EXTENSION_RESPONSE_INVALID', 'Extension diagnostics are malformed')
    }
    return (value as { diagnostics: Array<{
      extensionId: string
      extension?: ExtensionManagementEntry
      host: ExtensionHostDiagnostic
      seed?: BundledExtensionSeedDiagnostic
    }> }).diagnostics
  }

  async pickPackage(): Promise<string | null> {
    const result = await window.kunGui.extensionPickPackage()
    return result.canceled ? null : result.path
  }

  async pickDevelopmentDirectory(): Promise<string | null> {
    const result = await window.kunGui.extensionPickDevelopmentDirectory()
    return result.canceled ? null : result.path
  }

  async install(request: ProtectedExtensionInstallRequest): Promise<void> {
    const result = await window.kunGui.extensionInstall(request)
    if (isRuntimeRequestResult(result)) parseBody(result)
    this.notifyChanged()
  }

  async reviewPermissions(extensionId: string, workspaceRoot?: string): Promise<void> {
    await window.kunGui.extensionReviewPermissions({ extensionId, workspaceRoot })
    this.notifyChanged()
  }

  async setPermissions(
    extensionId: string,
    expectedVersion: string,
    permissions: string[],
    workspaceRoot?: string
  ): Promise<void> {
    parseBody(await window.kunGui.extensionSetPermissions({
      extensionId,
      expectedVersion,
      permissions,
      workspaceRoot
    }))
    this.notifyChanged()
  }

  async setPermissionsAndEnable(
    extensionId: string,
    expectedVersion: string,
    permissions: string[],
    workspaceRoot: string,
    enableScope: 'global' | 'workspace'
  ): Promise<void> {
    parseBody(await window.kunGui.extensionSetPermissions({
      extensionId,
      expectedVersion,
      permissions,
      workspaceRoot,
      enableAfterApply: enableScope
    }))
    this.notifyChanged()
  }

  async setEnabled(extensionId: string, enabled: boolean, workspaceRoot?: string): Promise<void> {
    const request = {
      extensionId,
      ...(workspaceRoot ? { workspaceRoot } : {})
    }
    const result = enabled
      ? await window.kunGui.extensionEnable(request)
      : await window.kunGui.extensionDisable(request)
    parseBody(result)
    this.notifyChanged()
  }

  async rollback(extensionId: string): Promise<void> {
    parseBody(await window.kunGui.extensionRollback({ extensionId }))
    this.notifyChanged()
  }

  async reload(extensionId: string): Promise<void> {
    parseBody(await window.kunGui.extensionReload({ extensionId }))
    this.notifyChanged()
  }

  async uninstall(extensionId: string): Promise<void> {
    parseBody(await window.kunGui.extensionUninstall({ extensionId }))
    this.notifyChanged()
  }

  async listAccounts(
    extensionId: string,
    providerId?: string,
    includeUnavailable = true
  ): Promise<ExtensionAccountList> {
    const value = parseBody(await window.kunGui.extensionListAccounts({
      extensionId,
      ...(providerId ? { providerId } : {}),
      includeUnavailable
    }))
    if (!isRecord(value) || !Array.isArray(value.accounts) || !isRecord(value.protection)) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Extension account list is malformed'
      )
    }
    const protection = value.protection
    if (
      !['system', 'encrypted-fallback', 'unavailable'].includes(String(protection.mode)) ||
      typeof protection.degraded !== 'boolean' ||
      typeof protection.available !== 'boolean'
    ) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Extension account protection status is malformed'
      )
    }
    return {
      accounts: value.accounts.map((account) => AccountSchema.parse(account)),
      protection: {
        mode: protection.mode as ExtensionAccountProtection['mode'],
        degraded: protection.degraded,
        available: protection.available
      }
    }
  }

  async listModelProviders(workspaceRoot?: string): Promise<ExtensionProviderCatalogEntry[]> {
    const value = parseBody(await this.transport.listModelProviders(
      workspaceRoot ? { workspaceRoot } : undefined
    ))
    if (!isRecord(value) || !Array.isArray(value.providers)) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Extension model provider catalog is malformed'
      )
    }
    return value.providers.map(parseProviderCatalogEntry)
  }

  async listProviderModels(input: {
    extensionId: string
    extensionVersion: string
    providerId: string
    accountId: string
    workspaceRoot?: string
  }): Promise<ProviderModel[]> {
    const value = parseBody(await this.transport.listProviderModels(input))
    if (!isRecord(value) || !Array.isArray(value.models)) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Extension provider model list is malformed'
      )
    }
    return value.models.map((model) => ProviderModelSchema.parse(model))
  }

  async setProviderBinding(input: {
    extensionId: string
    extensionVersion: string
    providerId: string
    accountId: string
    modelId: string
    workspaceRoot?: string
  }): Promise<void> {
    parseBody(await window.kunGui.extensionSetProviderBinding(input))
    this.notifyChanged()
    window.dispatchEvent(new CustomEvent('kun:provider-bindings-changed'))
  }

  async createAccountSession(input: {
    extensionId: string
    extensionVersion: string
    providerId: string
    authenticationProviderId: string
    label?: string
    scopes?: string[]
    workspaceRoot?: string
  }): Promise<AccountSession> {
    const value = parseBody(await window.kunGui.extensionCreateAccountSession(input))
    if (!isRecord(value) || !('session' in value)) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Extension account session is malformed'
      )
    }
    return AccountSessionSchema.parse(value.session)
  }

  async getAccountSession(extensionId: string, sessionId: string): Promise<AccountSession> {
    const value = parseBody(await window.kunGui.extensionGetAccountSession({ extensionId, sessionId }))
    if (!isRecord(value) || !('session' in value)) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Extension account session is malformed'
      )
    }
    return AccountSessionSchema.parse(value.session)
  }

  async completeAccountSession(input: {
    extensionId: string
    extensionVersion: string
    sessionId: string
    workspaceRoot?: string
  }): Promise<AccountSession> {
    const value = parseBody(await window.kunGui.extensionCompleteAccountSession({
      ...input
    }))
    if (!isRecord(value) || !('session' in value)) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Completed extension account session is malformed'
      )
    }
    return AccountSessionSchema.parse(value.session)
  }

  async cancelAccountSession(extensionId: string, sessionId: string): Promise<void> {
    parseBody(await window.kunGui.extensionCancelAccountSession({ extensionId, sessionId }))
  }

  async createApiKeyAccount(input: {
    extensionId: string
    extensionVersion: string
    providerId: string
    authenticationProviderId: string
    label?: string
    workspaceRoot?: string
  }): Promise<Account> {
    const value = parseBody(await window.kunGui.extensionCreateApiKeyAccount(input))
    if (!isRecord(value) || !('account' in value)) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Created extension account is malformed'
      )
    }
    return AccountSchema.parse(value.account)
  }

  async deleteAccount(input: {
    extensionId: string
    extensionVersion: string
    accountId: string
    providerId: string
    workspaceRoot?: string
  }): Promise<void> {
    parseBody(await window.kunGui.extensionDeleteAccount(input))
  }

  async renameAccount(input: {
    extensionId: string
    extensionVersion: string
    accountId: string
    providerId: string
    workspaceRoot?: string
  }): Promise<Account> {
    const value = parseBody(await window.kunGui.extensionRenameAccount(input))
    if (!isRecord(value) || !('account' in value)) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Renamed extension account is malformed'
      )
    }
    return AccountSchema.parse(value.account)
  }

  async replaceApiKeyAccount(input: {
    extensionId: string
    extensionVersion: string
    accountId: string
    providerId: string
    workspaceRoot?: string
  }): Promise<Account> {
    const value = parseBody(await window.kunGui.extensionReplaceApiKeyAccount(input))
    if (!isRecord(value) || !('account' in value)) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Updated extension account is malformed'
      )
    }
    return AccountSchema.parse(value.account)
  }

  async createViewSession(
    contributionId: string,
    workspaceRoot?: string,
    options: { retryHost?: boolean } = {}
  ): Promise<ExtensionViewSession> {
    const normalizedWorkspaceRoot = workspaceRoot?.trim()
    return window.kunGui.extensionCreateViewSession({
      contributionId,
      ...(normalizedWorkspaceRoot ? { workspaceRoot: normalizedWorkspaceRoot } : {}),
      ...(options.retryHost ? { retryHost: true } : {})
    })
  }

  async disposeViewSession(sessionId: string): Promise<void> {
    await window.kunGui.extensionDisposeViewSession({ sessionId })
  }

  async postViewMessage(sessionId: string, message: {
    channel: string
    payload: JsonValue
  }): Promise<void> {
    parseBody(await window.kunGui.extensionPostViewMessage({
      sessionId,
      channel: message.channel,
      payload: message.payload
    }))
  }

  async invokeCommand(
    commandId: string,
    context: JsonValue,
    workspaceRoot?: string
  ): Promise<JsonValue> {
    const request = { commandId, context, ...(workspaceRoot ? { workspaceRoot } : {}) }
    const response = await window.kunGui.extensionInvokeCommand(request)
    const value = isRuntimeRequestResult(response) ? parseBody(response) : response
    if (value && typeof value === 'object' && 'result' in value) {
      return JsonValueSchema.parse((value as { result: unknown }).result)
    }
    return JsonValueSchema.parse(value)
  }

  private notifyChanged(): void {
    window.dispatchEvent(new CustomEvent('kun:extensions-changed'))
  }
}

export const extensionWorkbenchClient = new ExtensionWorkbenchClient()

function isRuntimeRequestResult(value: unknown): value is { ok: boolean; status: number; body: string } {
  return typeof value === 'object' && value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean' &&
    typeof (value as { status?: unknown }).status === 'number' &&
    typeof (value as { body?: unknown }).body === 'string'
}

function parseProviderCatalogEntry(value: unknown): ExtensionProviderCatalogEntry {
  if (!isRecord(value) || !isRecord(value.dataAccess)) {
    throw new ExtensionWorkbenchClientError(
      'EXTENSION_RESPONSE_INVALID',
      'Extension provider catalog entry is malformed'
    )
  }
  for (const key of [
    'extensionId',
    'extensionVersion',
    'extensionDisplayName',
    'localProviderId',
    'providerId',
    'displayName'
  ] as const) {
    if (typeof value[key] !== 'string' || !value[key]) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        `Extension provider catalog ${key} is malformed`
      )
    }
  }
  if (!Array.isArray(value.models) || !Array.isArray(value.accounts)) {
    throw new ExtensionWorkbenchClientError(
      'EXTENSION_RESPONSE_INVALID',
      'Extension provider models or accounts are malformed'
    )
  }
  const categories = value.dataAccess.categories
  const allowedCategories = new Set([
    'conversation-history',
    'system-and-mode-instructions',
    'attachments',
    'tool-schemas'
  ])
  if (
    typeof value.dataAccess.digest !== 'string' ||
    !Array.isArray(categories) ||
    categories.some((category) => typeof category !== 'string' || !allowedCategories.has(category)) ||
    typeof value.dataAccess.requiresAcknowledgement !== 'boolean' ||
    typeof value.selectable !== 'boolean'
  ) {
    throw new ExtensionWorkbenchClientError(
      'EXTENSION_RESPONSE_INVALID',
      'Extension provider data-access metadata is malformed'
    )
  }
  let binding: ExtensionProviderCatalogEntry['binding'] = null
  if (value.binding !== null && value.binding !== undefined) {
    if (
      !isRecord(value.binding) ||
      typeof value.binding.accountId !== 'string' ||
      typeof value.binding.modelId !== 'string' ||
      typeof value.binding.acknowledgedAt !== 'string' ||
      typeof value.binding.valid !== 'boolean'
    ) {
      throw new ExtensionWorkbenchClientError(
        'EXTENSION_RESPONSE_INVALID',
        'Extension provider binding is malformed'
      )
    }
    binding = {
      accountId: value.binding.accountId,
      modelId: value.binding.modelId,
      acknowledgedAt: value.binding.acknowledgedAt,
      valid: value.binding.valid
    }
  }
  return {
    extensionId: String(value.extensionId),
    extensionVersion: String(value.extensionVersion),
    extensionDisplayName: String(value.extensionDisplayName),
    localProviderId: String(value.localProviderId),
    providerId: String(value.providerId),
    displayName: String(value.displayName),
    models: value.models.map((model) => ProviderModelSchema.parse(model)),
    accounts: value.accounts.map((account) => AccountSchema.parse(account)),
    dataAccess: {
      digest: value.dataAccess.digest,
      categories: categories as ExtensionProviderCatalogEntry['dataAccess']['categories'],
      requiresAcknowledgement: value.dataAccess.requiresAcknowledgement
    },
    binding,
    selectable: value.selectable,
    ...(typeof value.unavailableReason === 'string'
      ? { unavailableReason: value.unavailableReason }
      : {}),
    ...(typeof value.discoveryError === 'string'
      ? { discoveryError: value.discoveryError }
      : {})
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
