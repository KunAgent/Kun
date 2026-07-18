import {
  AccountSessionSchema,
  ArtifactHostActionRequestSchema,
  ArtifactHostActionResultSchema,
  ComposerContextAttachmentRequestSchema,
  ComposerContextAttachmentSchema,
  ExtensionManifestSchema,
  LocaleSchema,
  PermissionSchema,
  ThemeSchema,
  MediaOpenViewResourceRequestSchema,
  MediaReleaseRequestSchema,
  MediaResourceLeaseSchema,
  type Locale,
  type Theme
} from '@kun/extension-api'
import {
  dialog,
  ipcMain,
  shell,
  webContents,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  ExtensionComposerContextEvent,
  ExtensionConsentRequest,
  ExtensionNotificationSnapshot,
  ExtensionRuntimeRequestResult,
  ExtensionViewEventPayload
} from '../../shared/extension-ipc'
import { EXTENSION_ID_PATTERN } from '../../shared/extension-ipc'
import {
  extensionAccountSessionRequestSchema,
  extensionCommandInvocationRequestSchema,
  extensionConsentRequestSchema,
  extensionCompleteAccountSessionRequestSchema,
  extensionCreateAccountSessionRequestSchema,
  extensionCreateApiKeyAccountRequestSchema,
  extensionDeleteAccountRequestSchema,
  extensionEnableRequestSchema,
  extensionExternalBrowserControlSchema,
  extensionGuestCancelSchema,
  extensionGuestNotificationSchema,
  extensionGuestRequestSchema,
  extensionHostContentScriptBridgeRequestSchema,
  extensionIdSchema,
  extensionInstallRequestSchema,
  extensionListAccountsRequestSchema,
  extensionListProviderModelsRequestSchema,
  extensionListRequestSchema,
  extensionLoadConfigurationRequestSchema,
  extensionNotificationResponseRequestSchema,
  extensionNotificationSnapshotResponseSchema,
  extensionPermissionGrantRequestSchema,
  extensionReloadRequestSchema,
  extensionRenameAccountRequestSchema,
  extensionReplaceApiKeyAccountRequestSchema,
  extensionRollbackRequestSchema,
  extensionSetProviderBindingRequestSchema,
  extensionScopedRequestSchema,
  extensionSessionIdSchema,
  extensionSyncHostContentScriptsRequestSchema,
  extensionUninstallRequestSchema,
  extensionUpdateConfigurationRequestSchema,
  extensionViewEventsRequestSchema,
  extensionViewMessageRequestSchema,
  extensionViewSessionDisposePayloadSchema,
  extensionViewSessionCreateRequestSchema,
  extensionViewSessionRequestSchema,
  extensionWorkspaceRequestSchema,
  MAX_EXTENSION_CONFIGURATION_BODY_BYTES,
  MAX_EXTENSION_IPC_BODY_BYTES
} from './app-ipc-schemas/extensions'
import type { ExtensionContentScriptController } from '../extensions/extension-content-script-controller'
import type {
  ExtensionDescriptorResolver,
  ResolvedExtensionView
} from '../extensions/extension-descriptor-resolver'
import {
  ExtensionConsentError,
  ProtectedExtensionActionService,
  type ExtensionConsentBinding
} from '../extensions/extension-consent-service'
import type { ProtectedCredentialSurfaceController } from '../extensions/protected-credential-surface'
import type { ExtensionViewSessionRegistry } from '../extensions/extension-view-sessions'
import type { ExtensionViewProtocolRegistry } from '../extensions/extension-view-protocol-registry'
import type { ExtensionMediaProtocolRegistry } from '../extensions/extension-media-protocol'
import type { ExtensionExternalBrowserManager } from '../extensions/extension-external-browser'
import { isAllowedExtensionViewMethod } from '../extensions/extension-view-methods'
import {
  assertProtectedViewBindingCurrent,
  pickExtensionMediaFiles,
  pickExtensionMediaSaveTarget,
  requireProtectedViewBinding
} from '../extensions/extension-media-picker'
import {
  ExtensionArtifactResolutionSchema,
  ExtensionMediaLeaseRegistrationSchema
} from '../../shared/extension-media-ipc'

type RuntimeRequest = (
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
  credentialSurface: ProtectedCredentialSurfaceController
  contentScripts: ExtensionContentScriptController
  getWorkbenchEnvironment: () => Promise<ExtensionWorkbenchEnvironment>
  logError?: (category: string, message: string, detail?: unknown) => void
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

export function startExtensionSecretRevealConsentPump(
  options: RegisterExtensionIpcHandlersOptions,
  intervalMs = 750
): () => void {
  let disposed = false
  let polling = false
  let timer: NodeJS.Timeout | undefined
  const handled = new Set<string>()

  const schedule = (): void => {
    if (disposed) return
    timer = setTimeout(() => void poll(), Math.max(250, intervalMs))
    timer.unref?.()
  }
  const poll = async (): Promise<void> => {
    if (disposed || polling) return
    polling = true
    try {
      const parent = options.getMainWindow()
      if (!parent || parent.isDestroyed()) return
      const result = await options.runtimeRequest('/v1/extensions/secret-reveal-requests', 'GET')
      if (!result.ok) return
      const payload = safeJsonParse(result.body)
      if (!isRecord(payload) || !Array.isArray(payload.requests)) return
      const request = payload.requests.find((candidate) => {
        if (!isRecord(candidate)) return false
        return typeof candidate.id === 'string' && !handled.has(candidate.id)
      })
      if (!isRecord(request)) return
      const requestId = typeof request.id === 'string' ? request.id : ''
      const extensionId = typeof request.extensionId === 'string' ? request.extensionId : ''
      const extensionVersion = typeof request.extensionVersion === 'string'
        ? request.extensionVersion
        : ''
      const accountId = typeof request.accountId === 'string' ? request.accountId : ''
      const operation = typeof request.operation === 'string' ? request.operation : ''
      if (
        !/^secret_reveal_[0-9a-f-]{36}$/i.test(requestId) ||
        !EXTENSION_ID_PATTERN.test(extensionId) ||
        !extensionVersion ||
        !accountId ||
        !operation
      ) return
      handled.add(requestId)
      const decision = await dialog.showMessageBox(parent, {
        type: 'warning',
        title: 'Reveal provider secret to extension',
        message: `${extensionId} ${extensionVersion} requests raw credential access.`,
        detail: [
          `Account: ${accountId.slice(0, 256)}`,
          `Operation: ${operation.slice(0, 256)}`,
          'The secret will be returned only to this extension\'s Node host for this single request. Webviews and content scripts cannot access it.'
        ].join('\n\n'),
        buttons: ['Deny', 'Allow once'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        normalizeAccessKeys: true
      })
      await options.runtimeRequest(
        `/v1/extensions/secret-reveal-requests/${encodeURIComponent(requestId)}/decision`,
        'POST',
        JSON.stringify({ decision: decision.response === 1 ? 'allow' : 'deny' })
      )
    } catch (error) {
      options.logError?.('extension-account', 'Secret reveal consent pump failed.', {
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      polling = false
      schedule()
    }
  }
  void poll()
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
  }
}

/**
 * Polls the runtime-owned pending notification table and projects a validated
 * snapshot into the trusted workbench. Re-sending snapshots is intentional:
 * renderer reloads cannot strand a pending extension request.
 */
export function startExtensionNotificationPump(
  options: RegisterExtensionIpcHandlersOptions,
  intervalMs = 500
): () => void {
  let disposed = false
  let polling = false
  let timer: NodeJS.Timeout | undefined
  let hadNotifications = false
  const schedule = (): void => {
    if (disposed) return
    timer = setTimeout(() => void poll(), Math.max(250, intervalMs))
    timer.unref?.()
  }
  const poll = async (): Promise<void> => {
    if (disposed || polling) return
    polling = true
    try {
      const parent = options.getMainWindow()
      if (!parent || parent.isDestroyed() || parent.webContents.isDestroyed()) return
      const result = await options.runtimeRequest(
        '/v1/extensions/workbench/notifications',
        'GET'
      )
      if (!result.ok) return
      const parsed = extensionNotificationSnapshotResponseSchema.safeParse(safeJsonParse(result.body))
      if (!parsed.success) {
        options.logError?.('extension-notification', 'Kun returned an invalid notification snapshot.', {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        })
        return
      }
      const payload: ExtensionNotificationSnapshot = {
        notifications: parsed.data.notifications
      }
      if (payload.notifications.length === 0 && !hadNotifications) return
      hadNotifications = payload.notifications.length > 0
      parent.webContents.send('extension:notifications', payload)
    } catch (error) {
      options.logError?.('extension-notification', 'Extension notification pump failed.', {
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      polling = false
      schedule()
    }
  }
  void poll()
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    void options.runtimeRequest(
      '/v1/extensions/workbench/presence',
      'DELETE'
    ).catch(() => undefined)
  }
}

export function registerExtensionIpcHandlers(
  options: RegisterExtensionIpcHandlersOptions
): ExtensionIpcRegistration {
  const limiter = new ExtensionViewRequestLimiter()

  ipcMain.on('extension:content-script:bootstrap', (event) => {
    try {
      assertTrustedWorkbenchSender(event, options.getMainWindow)
      event.returnValue = options.contentScripts.bootstrap(event.sender)
    } catch (error) {
      options.logError?.('extension-content-script', 'Denied content-script preload bootstrap.', {
        message: error instanceof Error ? error.message : 'Invalid bootstrap sender.'
      })
      event.returnValue = { version: 1, generation: 'denied', bindings: [] }
    }
  })

  ipcMain.handle('extension:content-script:bridge', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:content-script:bridge',
      extensionHostContentScriptBridgeRequestSchema,
      payload
    )
    options.contentScripts.handleBridgeRequest(event.sender, request)
    return { ok: true }
  })

  ipcMain.handle('extension:pick-package', async (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const parent = options.getMainWindow()
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: 'Install Kun extension package',
          properties: ['openFile'],
          filters: [{ name: 'Kun Extension', extensions: ['kunx'] }]
        })
      : await dialog.showOpenDialog({
          title: 'Install Kun extension package',
          properties: ['openFile'],
          filters: [{ name: 'Kun Extension', extensions: ['kunx'] }]
        })
    return { canceled: result.canceled, path: result.canceled ? null : result.filePaths[0] ?? null }
  })

  ipcMain.handle('extension:pick-development-directory', async (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const parent = options.getMainWindow()
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: 'Load Kun extension development directory',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Load Kun extension development directory',
          properties: ['openDirectory']
        })
    return { canceled: result.canceled, path: result.canceled ? null : result.filePaths[0] ?? null }
  })

  ipcMain.handle('extension:workbench:get', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:workbench:get',
      extensionWorkspaceRequestSchema,
      payload
    )
    const query = new URLSearchParams()
    if (request?.workspaceRoot) query.set('workspace_root', request.workspaceRoot)
    if (request?.locale) query.set('locale', request.locale)
    return options.runtimeRequest(
      `/v1/extensions/workbench${query.size ? `?${query}` : ''}`,
      'GET'
    )
  })

  ipcMain.handle('extension:model-providers:list', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:model-providers:list',
      extensionWorkspaceRequestSchema,
      payload
    )
    const query = new URLSearchParams()
    if (request?.workspaceRoot) query.set('workspace_root', request.workspaceRoot)
    return options.runtimeRequest(
      `/v1/extensions/model-providers${query.size ? `?${query}` : ''}`,
      'GET'
    )
  })

  ipcMain.handle('extension:model-providers:list-models', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:model-providers:list-models',
      extensionListProviderModelsRequestSchema,
      payload
    )
    const query = new URLSearchParams({
      extension_id: request.extensionId,
      extension_version: request.extensionVersion,
      provider_id: request.providerId,
      account_id: request.accountId
    })
    if (request.workspaceRoot) query.set('workspace_root', request.workspaceRoot)
    return options.runtimeRequest(
      `/v1/extensions/model-providers/models?${query}`,
      'GET'
    )
  })

  ipcMain.handle('extension:configuration:load', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:configuration:load',
      extensionLoadConfigurationRequestSchema,
      payload
    )
    return options.runtimeRequest(
      '/v1/extensions/configuration/snapshot',
      'POST',
      stringifyBoundedRuntimeBody(
        'extension:configuration:load',
        request,
        MAX_EXTENSION_CONFIGURATION_BODY_BYTES
      )
    )
  })

  ipcMain.handle('extension:configuration:update', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:configuration:update',
      extensionUpdateConfigurationRequestSchema,
      payload
    )
    return options.runtimeRequest(
      '/v1/extensions/configuration',
      'PUT',
      stringifyBoundedRuntimeBody(
        'extension:configuration:update',
        request,
        MAX_EXTENSION_CONFIGURATION_BODY_BYTES
      )
    )
  })

  ipcMain.handle('extension:list', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload('extension:list', extensionListRequestSchema, payload)
    const query = new URLSearchParams()
    if (request?.limit !== undefined) query.set('limit', String(request.limit))
    if (request?.cursor) query.set('cursor', request.cursor)
    if (request?.workspaceRoot) query.set('workspace_root', request.workspaceRoot)
    if (request?.locale) query.set('locale', request.locale)
    return options.runtimeRequest(`/v1/extensions${query.size ? `?${query}` : ''}`, 'GET')
  })

  ipcMain.handle('extension:get', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const extensionId = parsePayload('extension:get', extensionIdSchema, payload)
    return options.runtimeRequest(`/v1/extensions/${encodeURIComponent(extensionId)}`, 'GET')
  })

  ipcMain.handle('extension:diagnostics', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const extensionId = extensionIdSchema.optional().parse(payload)
    const result = await options.runtimeRequest(
      extensionId
        ? `/v1/extensions/${encodeURIComponent(extensionId)}/diagnostics`
        : '/v1/extensions/diagnostics',
      'GET'
    )
    if (!result.ok) return result
    const runtimeDiagnostics = safeJsonParse(result.body)
    if (!isRecord(runtimeDiagnostics)) return result
    const contentScriptDiagnostics = options.contentScripts
      .recentDiagnostics(200)
      .filter((diagnostic) => !extensionId || diagnostic.extensionId === extensionId)
    return {
      ...result,
      body: JSON.stringify({ ...runtimeDiagnostics, contentScriptDiagnostics })
    }
  })

  ipcMain.handle('extension:install', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload('extension:install', extensionInstallRequestSchema, payload)
    const { consentRequestId, ...inputBody } = request
    const identity = await resolveInstallIdentity(inputBody, options.runtimeRequest)
    const body = {
      ...inputBody,
      grantedPermissions: inputBody.grantedPermissions ?? identity.requestedPermissions
    }
    const result = await performProtectedRuntimeOperation(options, event, {
      extensionId: identity.extensionId,
      extensionVersion: identity.extensionVersion,
      operationKind: 'extension.install',
      parameters: body,
      senderId: event.sender.id
    }, consentRequestId, {
      title: 'Install extension',
      message: `Install ${identity.extensionId} ${identity.extensionVersion}?`,
      detail: formatInstallReviewDetail(identity)
    }, () => options.runtimeRequest('/v1/extensions/install', 'POST', JSON.stringify(body)))
    if (!result.ok) throw runtimeResultError(result)
    options.viewSessions.disposeForExtension(identity.extensionId)
    await revokeContentScripts(options, event.sender, identity.extensionId, 'install-or-version-switch')
    return safeJsonParse(result.body)
  })

  ipcMain.handle('extension:enable', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload('extension:enable', extensionEnableRequestSchema, payload)
    const { consentRequestId } = request
    const parameters = {
      extensionId: request.extensionId,
      ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
    }
    const extension = await options.descriptors.resolvePackage(request.extensionId, request.workspaceRoot)
    const result = await performProtectedRuntimeOperation(options, event, {
      extensionId: request.extensionId,
      extensionVersion: extension.extensionVersion,
      operationKind: 'extension.enable',
      parameters,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, consentRequestId, {
      title: 'Enable extension',
      message: `Enable ${request.extensionId} ${extension.extensionVersion}?`,
      detail: 'Enabled Node code can run with your user account privileges.'
    }, () => options.runtimeRequest(
      `/v1/extensions/${encodeURIComponent(request.extensionId)}/enable`,
      'POST',
      JSON.stringify(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
    ))
    return result
  })

  ipcMain.handle('extension:disable', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload('extension:disable', extensionScopedRequestSchema, payload)
    const result = await options.runtimeRequest(
      `/v1/extensions/${encodeURIComponent(request.extensionId)}/disable`,
      'POST',
      JSON.stringify(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
    )
    if (result.ok) {
      disposeViewSessions(options, request.extensionId, request.workspaceRoot)
      await revokeContentScripts(
        options,
        event.sender,
        request.extensionId,
        'disable',
        request.workspaceRoot
      )
    }
    return result
  })

  ipcMain.handle('extension:set-permissions', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:set-permissions',
      extensionPermissionGrantRequestSchema,
      payload
    )
    const { consentRequestId, expectedVersion, enableAfterApply } = request
    const extension = await options.descriptors.resolvePackage(
      request.extensionId,
      request.workspaceRoot
    )
    if (extension.extensionVersion !== expectedVersion) {
      throw new Error('Extension version changed; review permissions again.')
    }
    const currentPermissions = [...extension.grantedPermissions].sort()
    const nextPermissions = [...(request.permissions ?? [])].sort()
    const permissionsUnchanged =
      request.permissions !== null &&
      extension.workspaceTrusted &&
      currentPermissions.length === nextPermissions.length &&
      currentPermissions.every((permission, index) => permission === nextPermissions[index])
    if (permissionsUnchanged && !enableAfterApply) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ unchanged: true })
      }
    }
    const parameters = {
      extensionId: request.extensionId,
      expectedVersion,
      permissions: request.permissions,
      ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {}),
      ...(enableAfterApply ? { enableAfterApply } : {})
    }
    let permissionsChanged = false
    const result = await performProtectedRuntimeOperation(options, event, {
      extensionId: request.extensionId,
      extensionVersion: expectedVersion,
      operationKind: 'extension.permissions',
      parameters,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, consentRequestId, {
      title: enableAfterApply
        ? 'Review permissions and enable extension'
        : 'Change extension permissions',
      message: enableAfterApply
        ? `Review permissions and enable ${request.extensionId} ${expectedVersion}?`
        : `Change permissions for ${request.extensionId} ${expectedVersion}?`,
      detail: [
        enableAfterApply === 'global'
          ? 'After approval, Kun will apply these permissions to the selected workspace and enable the extension globally.'
          : enableAfterApply === 'workspace'
            ? 'After approval, Kun will apply these permissions and enable the extension in the selected workspace.'
            : '',
        formatPermissionChangeReviewDetail(currentPermissions, nextPermissions)
      ].filter(Boolean).join('\n\n')
    }, async () => {
      if (!permissionsUnchanged) {
        const permissionResult = await options.runtimeRequest(
          `/v1/extensions/${encodeURIComponent(request.extensionId)}/permissions`,
          'PUT',
          JSON.stringify({
            workspaceRoot: request.workspaceRoot,
            permissions: request.permissions,
            expectedVersion
          })
        )
        if (!permissionResult.ok) return permissionResult
        permissionsChanged = true
        if (!enableAfterApply) return permissionResult
      }
      if (!enableAfterApply) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ unchanged: true })
        }
      }
      return options.runtimeRequest(
        `/v1/extensions/${encodeURIComponent(request.extensionId)}/enable`,
        'POST',
        JSON.stringify(enableAfterApply === 'workspace'
          ? { workspaceRoot: request.workspaceRoot }
          : {})
      )
    })
    // Every effective permission change invalidates sender-bound principals;
    // retaining a View here could preserve revoked account/network/storage
    // grants until the next reload.
    if (permissionsChanged) {
      disposeViewSessions(options, request.extensionId, request.workspaceRoot)
      await revokeContentScripts(
        options,
        event.sender,
        request.extensionId,
        'permission-change',
        request.workspaceRoot
      )
    }
    return result
  })

  ipcMain.handle('extension:review-permissions', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:review-permissions',
      extensionScopedRequestSchema,
      payload
    )
    const extension = await options.descriptors.resolvePackage(
      request.extensionId,
      request.workspaceRoot
    )
    const permissions = [...extension.grantedPermissions].sort()
    const parameters = {
      extensionId: request.extensionId,
      extensionVersion: extension.extensionVersion,
      permissions,
      ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
    }
    const authorization = await options.protectedActions.authorize({
      extensionId: request.extensionId,
      extensionVersion: extension.extensionVersion,
      operationKind: 'extension.permissions',
      parameters,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, {
      title: 'Review extension permissions',
      message: `Review permissions for ${request.extensionId} ${extension.extensionVersion}.`,
      detail: permissions.length > 0
        ? `Requested broker permissions:\n${permissions.map((permission) => `• ${permission}`).join('\n')}\n\nNode extensions execute with your operating-system user privileges; this permission list is not an OS sandbox.`
        : 'This version requests no broker permissions. Node code still executes with your operating-system user privileges.'
    })
    return authorization.approved
      ? {
          approved: true,
          consentRequestId: authorization.requestId,
          expiresAt: new Date(authorization.expiresAt).toISOString(),
          extensionVersion: extension.extensionVersion,
          permissions
        }
      : { approved: false }
  })

  ipcMain.handle('extension:rollback', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload('extension:rollback', extensionRollbackRequestSchema, payload)
    const { consentRequestId, ...body } = request
    const extension = await options.descriptors.resolvePackage(request.extensionId)
    const result = await performProtectedRuntimeOperation(options, event, {
      extensionId: request.extensionId,
      extensionVersion: extension.extensionVersion,
      operationKind: 'extension.rollback',
      parameters: body,
      senderId: event.sender.id
    }, consentRequestId, {
      title: 'Roll back extension',
      message: `Roll back ${request.extensionId}?`,
      detail: 'Kun will switch to the retained previous package and a compatible state snapshot.'
    }, () => options.runtimeRequest(
      `/v1/extensions/${encodeURIComponent(request.extensionId)}/rollback`,
      'POST',
      '{}'
    ))
    if (result.ok) {
      options.viewSessions.disposeForExtension(request.extensionId)
      await revokeContentScripts(options, event.sender, request.extensionId, 'rollback')
    }
    return result
  })

  ipcMain.handle('extension:uninstall', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload('extension:uninstall', extensionUninstallRequestSchema, payload)
    const { consentRequestId, ...body } = request
    const extension = await options.descriptors.resolvePackage(request.extensionId)
    const result = await performProtectedRuntimeOperation(options, event, {
      extensionId: request.extensionId,
      extensionVersion: request.version ?? extension.extensionVersion,
      operationKind: 'extension.uninstall',
      parameters: body,
      senderId: event.sender.id
    }, consentRequestId, {
      title: 'Uninstall extension',
      message: `Uninstall ${request.extensionId}${request.version ? ` ${request.version}` : ''}?`,
      detail: 'Package files will be removed. Extension data and credentials are preserved unless deleted separately.'
    }, async () => {
      options.viewSessions.disposeForExtension(request.extensionId)
      const path = request.version
        ? `/v1/extensions/${encodeURIComponent(request.extensionId)}/versions/${encodeURIComponent(request.version)}`
        : `/v1/extensions/${encodeURIComponent(request.extensionId)}`
      return options.runtimeRequest(path, 'DELETE')
    })
    if (result.ok) {
      await revokeContentScripts(options, event.sender, request.extensionId, 'uninstall')
    }
    return result
  })

  ipcMain.handle('extension:reload', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload('extension:reload', extensionReloadRequestSchema, payload)
    const { consentRequestId, ...body } = request
    const extension = await options.descriptors.resolvePackage(request.extensionId)
    const result = await performProtectedRuntimeOperation(options, event, {
      extensionId: request.extensionId,
      extensionVersion: extension.extensionVersion,
      operationKind: 'extension.reload',
      parameters: body,
      senderId: event.sender.id
    }, consentRequestId, {
      title: 'Reload development extension',
      message: `Reload ${request.extensionId} from its development directory?`,
      detail: 'The mutable development source will be validated again before activation.'
    }, () => options.runtimeRequest(
      `/v1/extensions/${encodeURIComponent(request.extensionId)}/reload`,
      'POST',
      '{}'
    ))
    if (result.ok) {
      options.viewSessions.disposeForExtension(request.extensionId)
      await revokeContentScripts(options, event.sender, request.extensionId, 'development-reload')
    }
    return result
  })

  ipcMain.handle('extension:invoke-command', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:invoke-command',
      extensionCommandInvocationRequestSchema,
      payload
    )
    const result = await options.runtimeRequest(
      '/v1/extensions/commands/invoke',
      'POST',
      JSON.stringify(request)
    )
    if (!result.ok) throw runtimeResultError(result)
    const body = safeJsonParse(result.body)
    return isRecord(body) && 'result' in body ? body.result : body
  })

  ipcMain.handle('extension:notification:respond', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:notification:respond',
      extensionNotificationResponseRequestSchema,
      payload
    )
    const result = await options.runtimeRequest(
      `/v1/extensions/workbench/notifications/${encodeURIComponent(request.notificationId)}/respond`,
      'POST',
      JSON.stringify(request.actionId === undefined ? {} : { actionId: request.actionId })
    )
    if (!result.ok) throw runtimeResultError(result)
    const response = safeJsonParse(result.body)
    if (!isRecord(response) || response.responded !== true) {
      throw new Error('Kun returned an invalid extension notification response.')
    }
    return true
  })

  const viewRegistration = registerViewIpcHandlers(options, limiter)
  registerAccountIpcHandlers(options)
  registerConsentIpcHandler(options)

  ipcMain.handle('extension:sync-host-content-scripts', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:sync-host-content-scripts',
      extensionSyncHostContentScriptsRequestSchema,
      payload
    )
    if (!event.senderFrame) {
      return { ok: false, code: 'EXTENSION_SENDER_INVALID', message: 'Sender frame is unavailable.' }
    }
    if (request.protectedSurface) {
      return options.contentScripts.sync(event.sender, request)
    }
    if (!request.surface) {
      await options.contentScripts.clearFrame(event.sender, true, 'unsupported-route')
      return { ok: true, active: [] }
    }
    return options.contentScripts.sync(event.sender, {
      surface: request.surface,
      protectedSurface: undefined,
      workspaceRoot: request.workspaceRoot,
      descriptors: request.descriptors.map((descriptor) => ({
        extensionId: descriptor.extensionId,
        contributionId: localContributionId(descriptor.contributionId, descriptor.extensionId)
      }))
    })
  })

  return viewRegistration
}

function registerViewIpcHandlers(
  options: RegisterExtensionIpcHandlersOptions,
  limiter: ExtensionViewRequestLimiter
): ExtensionIpcRegistration {
  const eventPumps = new Map<string, AbortController>()
  const runtimeDisposals = new Map<string, Promise<ExtensionRuntimeRequestResult>>()
  const boundParentIds = new Set<number>()
  let lastTheme = ''
  let lastLocale = ''
  const workbenchEnvironmentSync = createWorkbenchEnvironmentSyncQueue(
    options,
    (environment) => {
      const theme = JSON.stringify(environment.theme)
      const locale = JSON.stringify(environment.locale)
      if (theme !== lastTheme) {
        lastTheme = theme
        options.viewSessions.broadcastToGuests('ui.themeChanged', environment.theme)
      }
      if (locale !== lastLocale) {
        lastLocale = locale
        options.viewSessions.broadcastToGuests('ui.localeChanged', environment.locale)
      }
    }
  )
  const stopDisposeObserver = options.viewSessions.onDidDispose((record) => {
    options.viewProtocols.dispose(record.sessionId)
    eventPumps.get(record.sessionId)?.abort()
    eventPumps.delete(record.sessionId)
    if (runtimeDisposals.has(record.sessionId)) return
    const cleanup = options.runtimeRequest(
      `/v1/extensions/view-sessions/${encodeURIComponent(record.runtimeSessionId)}`,
      'DELETE'
    ).catch((error) => runtimeFailure(
      'EXTENSION_VIEW_SESSION_DISPOSE_FAILED',
      error instanceof Error ? error.message : 'View session disposal failed.',
      0
    ))
    runtimeDisposals.set(record.sessionId, cleanup)
    void cleanup.finally(() => {
      if (runtimeDisposals.get(record.sessionId) === cleanup) runtimeDisposals.delete(record.sessionId)
    })
  })
  ipcMain.handle('extension:view-session:create', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:view-session:create',
      extensionViewSessionCreateRequestSchema,
      payload
    )
    const identity = parseQualifiedContributionId(request.contributionId)
    const view = await options.descriptors.resolveView(
      identity.extensionId,
      identity.localId,
      request.workspaceRoot
    )
    await workbenchEnvironmentSync.syncToRuntime()
    if (request.retryHost) {
      const retried = await options.runtimeRequest(
        `/v1/extensions/${encodeURIComponent(identity.extensionId)}/retry`,
        'POST'
      )
      if (!retried.ok) throw runtimeResultError(retried)
    }
    const result = await options.runtimeRequest(
      '/v1/extensions/view-sessions',
      'POST',
      JSON.stringify({
        contributionId: request.contributionId,
        ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
      })
    )
    if (!result.ok) throw runtimeResultError(result)
    const runtimeSession = parseRuntimeViewSession(result.body)
    if (!runtimeSession) throw new Error('Kun returned an invalid extension View Session.')
    if (
      runtimeSession.extensionId !== identity.extensionId ||
      runtimeSession.extensionVersion !== view.extensionVersion ||
      runtimeSession.contributionId !== request.contributionId
    ) throw new Error('Kun returned a mismatched extension View Session.')
    const record = options.viewSessions.create({
      sessionId: runtimeSession.sessionId,
      runtimeSessionId: runtimeSession.sessionId,
      nonce: runtimeSession.nonce,
      extensionId: identity.extensionId,
      extensionVersion: view.extensionVersion,
      contributionId: request.contributionId,
      workspaceRoot: request.workspaceRoot,
      entryPath: view.entry,
      externalWebviewHosts: view.grantedPermissions.includes('webview.external')
        ? view.grantedPermissions
          .filter((permission) => permission.startsWith('network:'))
          .map((permission) => permission.slice('network:'.length))
        : [],
      parentWebContentsId: event.sender.id
    })
    try {
      options.viewProtocols.prepare(record, view)
    } catch (error) {
      options.viewSessions.dispose(record.sessionId)
      throw error
    }
    const controller = new AbortController()
    eventPumps.set(record.sessionId, controller)
    void pumpExtensionViewEvents(options, record.sessionId, controller.signal).finally(() => {
      if (eventPumps.get(record.sessionId) === controller) eventPumps.delete(record.sessionId)
    })
    return {
      sessionId: record.sessionId,
      nonce: record.nonce,
      extensionId: record.extensionId,
      extensionVersion: record.extensionVersion,
      contributionId: record.contributionId,
      src: record.sourceUrl,
      partition: record.partition
    }
  })

  ipcMain.handle('extension:view-session:dispose', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const requestValue = parsePayload(
      'extension:view-session:dispose',
      extensionViewSessionDisposePayloadSchema,
      payload
    )
    const request = typeof requestValue === 'string' ? { sessionId: requestValue } : requestValue
    const record = options.viewSessions.get(request.sessionId)
    if (!record || record.parentWebContentsId !== event.sender.id) {
      return runtimeFailure('EXTENSION_VIEW_SESSION_NOT_FOUND', 'View Session was not found.', 404)
    }
    options.viewSessions.dispose(request.sessionId)
    return (await runtimeDisposals.get(request.sessionId))?.ok ?? true
  })

  ipcMain.handle('extension:external-browser:control', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:external-browser:control',
      extensionExternalBrowserControlSchema,
      payload
    )
    const record = requireWorkbenchOwnedSession(options, event.sender, request.sessionId)
    const window = options.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('Workbench window is unavailable.')
    if (request.action === 'mount') {
      return options.externalBrowsers.mount(
        record,
        window,
        request.siteId,
        request.url,
        request.bounds,
        request.presentation
      )
    }
    if (request.action === 'activate') {
      return options.externalBrowsers.activate(
        record.sessionId,
        request.siteId,
        request.url,
        request.presentation
      )
    }
    if (request.action === 'bounds') {
      return options.externalBrowsers.updateBounds(record.sessionId, request.bounds)
    }
    if (request.action === 'navigate') {
      return options.externalBrowsers.navigate(record.sessionId, request.url)
    }
    if (request.action === 'state') return options.externalBrowsers.state(record.sessionId)
    return options.externalBrowsers.command(record.sessionId, request.action)
  })

  ipcMain.handle('extension:view-session:message', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:view-session:message',
      extensionViewMessageRequestSchema,
      payload
    )
    const record = requireWorkbenchOwnedSession(options, event.sender, request.sessionId)
    return options.runtimeRequest(
      `/v1/extensions/view-sessions/${encodeURIComponent(record.runtimeSessionId)}/host-messages`,
      'POST',
      JSON.stringify({ channel: request.channel, payload: request.payload })
    )
  })

  ipcMain.handle('extension:view-session:events', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:view-session:events',
      extensionViewEventsRequestSchema,
      payload
    )
    const record = requireWorkbenchOwnedSession(options, event.sender, request.sessionId)
    const query = new URLSearchParams()
    if (request.cursor !== undefined) query.set('cursor', String(request.cursor))
    if (request.limit !== undefined) query.set('limit', String(request.limit))
    const result = await options.runtimeRequest(
      `/v1/extensions/view-sessions/${encodeURIComponent(record.runtimeSessionId)}/events${query.size ? `?${query}` : ''}`,
      'GET',
      undefined,
      extensionSessionHeaders(record)
    )
    if (result.ok) dispatchViewEvents(
      record.sessionId,
      record.guestWebContentsId,
      result.body,
      event.sender,
      options.viewSessions
    )
    return result
  })

  ipcMain.handle('extension:view:request', async (event, payload: unknown) => {
    const request = parsePayload('extension:view:request', extensionGuestRequestSchema, payload)
    const record = options.viewSessions.requireGuest(event.sender.id, request.sessionId, request.sessionNonce)
    if (!isAllowedExtensionViewMethod(request.method)) throw new Error('View method is not available.')
    const release = limiter.begin(event.sender, payload)
    try {
      if (request.method === 'ui.attachComposerContext') {
        const currentRecord = options.viewSessions.requireCurrentGuestMainFrame(
          event.sender.id,
          record.sessionId,
          record.nonce,
          event.senderFrame
        )
        const input = ComposerContextAttachmentRequestSchema.parse(request.params)
        const identity = parseQualifiedContributionId(currentRecord.contributionId)
        const view = await options.descriptors.resolveView(
          identity.extensionId,
          identity.localId,
          currentRecord.workspaceRoot
        )
        const reboundRecord = options.viewSessions.requireCurrentGuestMainFrame(
          event.sender.id,
          currentRecord.sessionId,
          currentRecord.nonce,
          event.senderFrame
        )
        if (
          view.extensionId !== reboundRecord.extensionId ||
          view.extensionVersion !== reboundRecord.extensionVersion ||
          view.contributionId !== identity.localId
        ) {
          throw new Error('Extension View identity changed; attach the context again.')
        }
        if (!view.grantedPermissions.includes('ui.actions')) {
          throw new Error('Composer context permission is not granted.')
        }
        const parent = options.getMainWindow()
        if (
          !parent ||
          parent.isDestroyed() ||
          parent.webContents.id !== reboundRecord.parentWebContentsId ||
          parent.webContents.isDestroyed()
        ) {
          throw new Error('The owning workbench is unavailable.')
        }
        const canonicalWorkspaceRoot = reboundRecord.workspaceRoot
          ? resolve(reboundRecord.workspaceRoot)
          : undefined
        const workspaceId = createHash('sha256')
          .update(canonicalWorkspaceRoot ?? '')
          .digest('hex')
        const attachment = ComposerContextAttachmentSchema.parse({
          ...input,
          attachmentId: `extension-context:${createHash('sha256')
            .update([
              reboundRecord.extensionId,
              reboundRecord.extensionVersion,
              reboundRecord.contributionId,
              workspaceId,
              input.id
            ].join('\0'))
            .digest('hex')}`,
          provenance: {
            extensionId: reboundRecord.extensionId,
            extensionVersion: reboundRecord.extensionVersion,
            viewContributionId: reboundRecord.contributionId,
            workspaceId
          }
        })
        const contextEvent: ExtensionComposerContextEvent = {
          ...(canonicalWorkspaceRoot ? { workspaceRoot: canonicalWorkspaceRoot } : {}),
          attachment
        }
        parent.webContents.send('extension:composer-context-attached', contextEvent)
        return attachment
      }
      if (request.method === 'ui.getTheme' || request.method === 'ui.getLocale') {
        const environment = await loadWorkbenchEnvironment(options)
        return request.method === 'ui.getTheme' ? environment.theme : environment.locale
      }
      if (request.method === 'media.pickFiles') {
        return pickExtensionMediaFiles({
          event,
          record,
          viewSessions: options.viewSessions,
          getMainWindow: options.getMainWindow,
          runtimeRequest: options.runtimeRequest,
          getWorkbenchLocale: async () => (await loadWorkbenchEnvironment(options)).locale,
          onCleanupFailure: (detail) => options.logError?.(
            'extension-media-picker',
            'Failed to confirm protected media selection rollback.',
            detail
          )
        }, request.params)
      }
      if (request.method === 'media.pickSaveTarget') {
        return pickExtensionMediaSaveTarget({
          event,
          record,
          viewSessions: options.viewSessions,
          getMainWindow: options.getMainWindow,
          runtimeRequest: options.runtimeRequest,
          getWorkbenchLocale: async () => (await loadWorkbenchEnvironment(options)).locale,
          onCleanupFailure: (detail) => options.logError?.(
            'extension-media-picker',
            'Failed to confirm protected media selection rollback.',
            detail
          )
        }, request.params)
      }
      if (request.method === 'media.openViewResource') {
        if (!options.mediaProtocols) throw new Error('Media protocol is unavailable.')
        const input = MediaOpenViewResourceRequestSchema.parse(request.params)
        const binding = requireProtectedViewBinding({
          event,
          record,
          viewSessions: options.viewSessions,
          getMainWindow: options.getMainWindow,
          runtimeRequest: options.runtimeRequest
        })
        const pickerContext = {
          event,
          record,
          viewSessions: options.viewSessions,
          getMainWindow: options.getMainWindow,
          runtimeRequest: options.runtimeRequest
        }
        const resolved = await options.runtimeRequest(
          '/v1/extensions/media/leases/resolve',
          'POST',
          JSON.stringify({ binding, handleId: input.handleId })
        )
        assertProtectedViewBindingCurrent(pickerContext, binding)
        if (!resolved.ok) throw runtimeResultError(resolved)
        const registration = ExtensionMediaLeaseRegistrationSchema.parse(safeJsonParse(resolved.body))
        const lease = MediaResourceLeaseSchema.parse(await options.mediaProtocols.createLease({
          viewSessionId: record.sessionId,
          extensionId: record.extensionId,
          extensionVersion: record.extensionVersion,
          contributionId: record.contributionId,
          ...(record.workspaceRoot ? { workspaceRoot: record.workspaceRoot } : {}),
          handleId: registration.handleId,
          absolutePath: registration.absolutePath,
          mimeType: registration.mimeType,
          fileIdentity: registration.fileIdentity,
          expiresAt: new Date(registration.expiresAt).getTime()
        }))
        try {
          assertProtectedViewBindingCurrent(pickerContext, binding)
        } catch (error) {
          options.mediaProtocols.revokeLease(lease.leaseId, 'released')
          throw error
        }
        return lease
      }
      if (request.method === 'media.performArtifactAction') {
        const input = ArtifactHostActionRequestSchema.parse(request.params)
        const binding = requireProtectedViewBinding({
          event,
          record,
          viewSessions: options.viewSessions,
          getMainWindow: options.getMainWindow,
          runtimeRequest: options.runtimeRequest
        })
        const pickerContext = {
          event,
          record,
          viewSessions: options.viewSessions,
          getMainWindow: options.getMainWindow,
          runtimeRequest: options.runtimeRequest
        }
        if (!binding.workspaceRoot) throw new Error('Generated artifact requires an active workspace.')
        const workspaceRoot = resolve(binding.workspaceRoot)
        const resolved = await options.runtimeRequest(
          '/v1/extensions/media/artifacts/resolve',
          'POST',
          JSON.stringify({
            artifactId: input.artifactId,
            ownerExtensionId: binding.extensionId,
            ownerExtensionVersion: binding.extensionVersion,
            workspaceId: createHash('sha256').update(workspaceRoot).digest('hex'),
            workspaceRoot
          })
        )
        assertProtectedViewBindingCurrent(pickerContext, binding)
        if (!resolved.ok) throw runtimeResultError(resolved)
        const artifact = ExtensionArtifactResolutionSchema.parse(safeJsonParse(resolved.body))
        if (artifact.artifactId !== input.artifactId) {
          throw new Error('Generated artifact is unavailable.')
        }
        if (input.action === 'reveal') {
          shell.showItemInFolder(artifact.absolutePath)
        } else {
          const error = await shell.openPath(artifact.absolutePath)
          if (error) throw new Error('The generated artifact could not be opened.')
        }
        return ArtifactHostActionResultSchema.parse({ performed: true })
      }
      if (request.method === 'media.release') {
        const input = MediaReleaseRequestSchema.parse(request.params)
        if (input.resource === 'lease') {
          if (!options.mediaProtocols) throw new Error('Media protocol is unavailable.')
          return { released: options.mediaProtocols.revokeLease(input.leaseId, 'released') }
        }
      }
      const result = await options.runtimeRequest(
        `/v1/extensions/view-sessions/${encodeURIComponent(record.runtimeSessionId)}/requests`,
        'POST',
        JSON.stringify({
          requestId: request.requestId,
          method: request.method,
          params: request.params,
          timeoutMs: request.timeoutMs
        }),
        extensionSessionHeaders(record)
      )
      if (!result.ok) throw runtimeResultError(result)
      const response = safeJsonParse(result.body)
      return isRecord(response) && 'result' in response ? response.result : response
    } finally {
      release()
    }
  })

  ipcMain.handle('extension:view:notify', async (event, payload: unknown) => {
    const request = parsePayload('extension:view:notify', extensionGuestNotificationSchema, payload)
    const record = options.viewSessions.requireGuest(event.sender.id, request.sessionId, request.sessionNonce)
    if (!isAllowedExtensionViewMethod(request.method)) throw new Error('View method is not available.')
    const release = limiter.begin(event.sender, payload)
    try {
      const result = await options.runtimeRequest(
        `/v1/extensions/view-sessions/${encodeURIComponent(record.runtimeSessionId)}/requests`,
        'POST',
        JSON.stringify({
          requestId: `view-notify-${randomUUID()}`,
          method: request.method,
          params: request.params
        }),
        extensionSessionHeaders(record)
      )
      if (!result.ok) throw runtimeResultError(result)
    } finally {
      release()
    }
  })

  ipcMain.handle('extension:view:cancel', async (event, payload: unknown) => {
    const request = parsePayload('extension:view:cancel', extensionGuestCancelSchema, payload)
    const record = options.viewSessions.requireGuest(event.sender.id, request.sessionId, request.sessionNonce)
    await options.runtimeRequest(
      `/v1/extensions/view-sessions/${encodeURIComponent(record.runtimeSessionId)}/requests/${encodeURIComponent(request.requestId)}/cancel`,
      'POST',
      '{}',
      extensionSessionHeaders(record)
    )
    return true
  })

  ipcMain.on('extension:view:dispose', (event, payload: unknown) => {
    const parsed = extensionGuestCancelSchema.omit({ requestId: true }).safeParse(payload)
    if (!parsed.success) return
    try {
      const record = options.viewSessions.requireGuest(
        event.sender.id,
        parsed.data.sessionId,
        parsed.data.sessionNonce
      )
      options.viewSessions.dispose(record.sessionId)
    } catch {
      // Stale guest teardown is intentionally ignored.
    }
  })

  return {
    bindMainWindow(window: BrowserWindow): void {
      const parentId = window.webContents.id
      if (boundParentIds.has(parentId)) return
      boundParentIds.add(parentId)
      window.webContents.once('destroyed', () => {
        boundParentIds.delete(parentId)
        options.protectedActions.revokeSender(parentId)
        options.viewSessions.disposeForParent(parentId)
      })
    },
    publishWorkbenchEnvironmentChanged(): Promise<void> {
      return workbenchEnvironmentSync.publishChanged()
    },
    dispose(): void {
      workbenchEnvironmentSync.dispose()
      const main = options.getMainWindow()
      if (main && !main.isDestroyed()) options.viewSessions.disposeForParent(main.webContents.id)
      for (const controller of eventPumps.values()) controller.abort()
      eventPumps.clear()
      options.viewProtocols.disposeAll()
      options.externalBrowsers.disposeAll()
      boundParentIds.clear()
      stopDisposeObserver()
    }
  }
}

function registerAccountIpcHandlers(options: RegisterExtensionIpcHandlersOptions): void {
  ipcMain.handle('extension:accounts:list', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:accounts:list',
      extensionListAccountsRequestSchema,
      payload
    )
    const query = new URLSearchParams({ extension_id: request.extensionId })
    if (request.providerId) query.set('provider_id', request.providerId)
    if (request.includeUnavailable !== undefined) {
      query.set('include_unavailable', String(request.includeUnavailable))
    }
    return options.runtimeRequest(`/v1/extensions/accounts?${query}`, 'GET')
  })

  ipcMain.handle('extension:accounts:create-session', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:accounts:create-session',
      extensionCreateAccountSessionRequestSchema,
      payload
    )
    const extension = await options.descriptors.resolvePackage(
      request.extensionId,
      request.workspaceRoot
    )
    if (extension.extensionVersion !== request.extensionVersion) {
      return runtimeFailure(
        'EXTENSION_VERSION_CONFLICT',
        'Extension version changed; repeat the protected action.',
        409
      )
    }
    const provider = extension.manifest.contributes.modelProviders.find(
      (candidate) => candidate.id === request.providerId
    )
    const authentication = extension.manifest.contributes.authentication.find(
      (candidate) => candidate.id === request.authenticationProviderId
    )
    if (
      !provider ||
      !authentication ||
      provider.authenticationProviderId !== authentication.id
    ) {
      return runtimeFailure(
        'EXTENSION_AUTHENTICATION_MISMATCH',
        'Authentication contribution does not match the selected provider.',
        400
      )
    }
    const declaredScopes = authentication.scopes ?? []
    const effectiveScopes = [...new Set(request.scopes ?? declaredScopes)]
    if (effectiveScopes.some((scope) => !declaredScopes.includes(scope))) {
      return runtimeFailure(
        'EXTENSION_AUTHENTICATION_SCOPE_INVALID',
        'Requested authentication scope is not declared by the provider.',
        400
      )
    }
    const normalizedRequest = { ...request, scopes: effectiveScopes }
    const result = await performProtectedRuntimeOperation(options, event, {
      extensionId: request.extensionId,
      extensionVersion: extension.extensionVersion,
      operationKind: 'account.create-session',
      parameters: normalizedRequest,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, undefined, {
      title: 'Connect provider account',
      message: `Start account authorization for ${request.providerId}?`,
      detail: [
        `Kun will activate ${request.extensionId} for the declared authentication flow. Extension Webviews cannot approve this action.`,
        effectiveScopes.length ? `OAuth scopes: ${effectiveScopes.join(', ')}` : undefined
      ].filter(Boolean).join('\n\n')
    }, () => options.runtimeRequest(
      '/v1/extensions/accounts/sessions',
      'POST',
      JSON.stringify(normalizedRequest)
    ))
    return presentProtectedAccountAuthorization(
      options,
      result,
      request.extensionId,
      request.providerId
    )
  })

  ipcMain.handle('extension:accounts:get-session', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:accounts:get-session',
      extensionAccountSessionRequestSchema,
      payload
    )
    const result = await options.runtimeRequest(
      `/v1/extensions/accounts/sessions/${encodeURIComponent(request.sessionId)}?extension_id=${encodeURIComponent(request.extensionId)}`,
      'GET'
    )
    return redactAccountSessionInteraction(result)
  })

  ipcMain.handle('extension:accounts:complete-session', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:accounts:complete-session',
      extensionCompleteAccountSessionRequestSchema,
      payload
    )
    const extension = await options.descriptors.resolvePackage(
      request.extensionId,
      request.workspaceRoot
    )
    if (extension.extensionVersion !== request.extensionVersion) {
      return runtimeFailure(
        'EXTENSION_VERSION_CONFLICT',
        'Extension version changed; repeat the protected action.',
        409
      )
    }
    const callback = await options.credentialSurface.prompt(options.getMainWindow(), {
      title: 'Complete provider authorization',
      message: 'Paste the final OAuth callback URL from your browser.',
      detail: `Kun will validate the authorization state and connect it to ${request.extensionId}. The callback URL is never exposed to extension code or Webviews.`,
      label: 'OAuth callback URL',
      placeholder: 'https://callback.example/?code=...&state=...',
      submitLabel: 'Complete authorization'
    })
    if (!callback.submitted) {
      return runtimeFailure('EXTENSION_CONSENT_DENIED', 'Account authorization was cancelled.', 403)
    }
    const parameters = {
      ...request,
      callbackDigest: createHash('sha256').update(callback.value).digest('hex')
    }
    return options.protectedActions.performAfterProtectedDecision({
      extensionId: request.extensionId,
      extensionVersion: extension.extensionVersion,
      operationKind: 'account.complete-session',
      parameters,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, callback.protectedWindowSessionId, () => options.runtimeRequest(
      `/v1/extensions/accounts/sessions/${encodeURIComponent(request.sessionId)}/complete`,
      'POST',
      JSON.stringify({
        extensionId: request.extensionId,
        extensionVersion: request.extensionVersion,
        callbackUrl: callback.value,
        ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
      })
    ))
  })

  ipcMain.handle('extension:accounts:cancel-session', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:accounts:cancel-session',
      extensionAccountSessionRequestSchema,
      payload
    )
    return options.runtimeRequest(
      `/v1/extensions/accounts/sessions/${encodeURIComponent(request.sessionId)}/cancel`,
      'POST',
      JSON.stringify({ extensionId: request.extensionId })
    )
  })

  ipcMain.handle('extension:accounts:delete', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:accounts:delete',
      extensionDeleteAccountRequestSchema,
      payload
    )
    const { consentRequestId, ...body } = request
    const extension = await options.descriptors.resolvePackage(
      request.extensionId,
      request.workspaceRoot
    )
    if (extension.extensionVersion !== request.extensionVersion) {
      return runtimeFailure(
        'EXTENSION_VERSION_CONFLICT',
        'Extension version changed; repeat the protected action.',
        409
      )
    }
    return performProtectedRuntimeOperation(options, event, {
      extensionId: request.extensionId,
      extensionVersion: request.extensionVersion,
      operationKind: 'account.delete',
      parameters: body,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, consentRequestId, {
      title: 'Delete provider account',
      message: `Delete the selected ${request.providerId} account?`,
      detail: 'Stored credentials will be deleted and dependent provider bindings will require another account.'
    }, () => options.runtimeRequest(
      `/v1/extensions/accounts/${encodeURIComponent(request.accountId)}`,
      'DELETE',
      JSON.stringify({
        extensionId: request.extensionId,
        extensionVersion: request.extensionVersion,
        providerId: request.providerId,
        ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
      })
    ))
  })

  ipcMain.handle('extension:accounts:create-api-key', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:accounts:create-api-key',
      extensionCreateApiKeyAccountRequestSchema,
      payload
    )
    const extension = await options.descriptors.resolvePackage(
      request.extensionId,
      request.workspaceRoot
    )
    if (extension.extensionVersion !== request.extensionVersion) {
      return runtimeFailure(
        'EXTENSION_VERSION_CONFLICT',
        'Extension version changed; repeat the protected action.',
        409
      )
    }
    const credential = await options.credentialSurface.prompt(options.getMainWindow(), {
      title: 'Add provider account',
      message: `Enter an API key for ${request.providerId}.`,
      detail: `The key will be stored by Kun and associated with ${request.extensionId}. Extension Webviews never receive it.`,
      label: 'API key',
      placeholder: 'Paste API key',
      submitLabel: 'Save account'
    })
    if (!credential.submitted) {
      return runtimeFailure('EXTENSION_CONSENT_DENIED', 'Account creation was cancelled.', 403)
    }
    const parameters = {
      ...request,
      secretDigest: createHash('sha256').update(credential.value).digest('hex')
    }
    return options.protectedActions.performAfterProtectedDecision({
      extensionId: request.extensionId,
      extensionVersion: request.extensionVersion,
      operationKind: 'account.create-api-key',
      parameters,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, credential.protectedWindowSessionId, () => options.runtimeRequest(
      '/v1/extensions/accounts/api-key',
      'POST',
      JSON.stringify({ ...request, secret: credential.value })
    ))
  })

  ipcMain.handle('extension:accounts:rename', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:accounts:rename',
      extensionRenameAccountRequestSchema,
      payload
    )
    const extension = await options.descriptors.resolvePackage(
      request.extensionId,
      request.workspaceRoot
    )
    if (extension.extensionVersion !== request.extensionVersion) {
      return runtimeFailure(
        'EXTENSION_VERSION_CONFLICT',
        'Extension version changed; repeat the protected action.',
        409
      )
    }
    const label = await options.credentialSurface.prompt(options.getMainWindow(), {
      title: 'Rename provider account',
      message: `Choose a new label for the selected ${request.providerId} account.`,
      detail: 'The stable account reference and existing provider bindings will not change.',
      label: 'Account label',
      placeholder: 'Account label',
      submitLabel: 'Rename account',
      secret: false
    })
    if (!label.submitted) {
      return runtimeFailure('EXTENSION_CONSENT_DENIED', 'Account rename was cancelled.', 403)
    }
    const parameters = { ...request, label: label.value }
    return options.protectedActions.performAfterProtectedDecision({
      extensionId: request.extensionId,
      extensionVersion: request.extensionVersion,
      operationKind: 'account.rename',
      parameters,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, label.protectedWindowSessionId, () => options.runtimeRequest(
      `/v1/extensions/accounts/${encodeURIComponent(request.accountId)}/label`,
      'PATCH',
      JSON.stringify({ ...request, label: label.value })
    ))
  })

  ipcMain.handle('extension:accounts:replace-api-key', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:accounts:replace-api-key',
      extensionReplaceApiKeyAccountRequestSchema,
      payload
    )
    const extension = await options.descriptors.resolvePackage(
      request.extensionId,
      request.workspaceRoot
    )
    if (extension.extensionVersion !== request.extensionVersion) {
      return runtimeFailure(
        'EXTENSION_VERSION_CONFLICT',
        'Extension version changed; repeat the protected action.',
        409
      )
    }
    const credential = await options.credentialSurface.prompt(options.getMainWindow(), {
      title: 'Replace provider API key',
      message: `Enter the replacement API key for the selected ${request.providerId} account.`,
      detail: 'Kun replaces the protected credential atomically. The account reference and existing provider bindings stay unchanged.',
      label: 'Replacement API key',
      placeholder: 'Paste replacement API key',
      submitLabel: 'Replace API key'
    })
    if (!credential.submitted) {
      return runtimeFailure('EXTENSION_CONSENT_DENIED', 'API-key replacement was cancelled.', 403)
    }
    const parameters = {
      ...request,
      secretDigest: createHash('sha256').update(credential.value).digest('hex')
    }
    return options.protectedActions.performAfterProtectedDecision({
      extensionId: request.extensionId,
      extensionVersion: request.extensionVersion,
      operationKind: 'account.replace-api-key',
      parameters,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, credential.protectedWindowSessionId, () => options.runtimeRequest(
      `/v1/extensions/accounts/${encodeURIComponent(request.accountId)}/api-key`,
      'PUT',
      JSON.stringify({ ...request, secret: credential.value })
    ))
  })

  ipcMain.handle('extension:providers:set-binding', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload(
      'extension:providers:set-binding',
      extensionSetProviderBindingRequestSchema,
      payload
    )
    const extension = await options.descriptors.resolvePackage(
      request.extensionId,
      request.workspaceRoot
    )
    if (extension.extensionVersion !== request.extensionVersion) {
      return runtimeFailure(
        'EXTENSION_VERSION_CONFLICT',
        'Extension version changed; repeat the protected action.',
        409
      )
    }
    const provider = extension.manifest.contributes.modelProviders.find(
      (candidate) => candidate.id === request.providerId
    )
    if (!provider) {
      return runtimeFailure(
        'EXTENSION_PROVIDER_NOT_FOUND',
        'The selected model provider is not declared by this extension.',
        404
      )
    }
    const body = request
    const inputKinds = [...new Set(provider.models.flatMap((model) => model.capabilities.input))]
    const dataCategories = [
      'complete conversation history',
      'system and mode instructions',
      `attachments when present (${inputKinds.join(', ') || 'declared input types'})`,
      'advertised tool names, descriptions, and input schemas'
    ]
    return performProtectedRuntimeOperation(options, event, {
      extensionId: request.extensionId,
      extensionVersion: request.extensionVersion,
      operationKind: 'provider.bind',
      parameters: body,
      workspaceRoot: request.workspaceRoot,
      senderId: event.sender.id
    }, undefined, {
      title: 'Use extension model provider',
      message: `Allow ${extension.manifest.displayName ?? request.extensionId} to handle Kun model requests?`,
      detail: [
        `Provider: ${provider.displayName} (${request.providerId})`,
        `Model: ${request.modelId}`,
        `Account reference: ${request.accountId}`,
        'The extension Node adapter can receive:',
        ...dataCategories.map((category) => `• ${category}`),
        'Kun stores only the provider, opaque account reference, model, extension version, and acknowledgement. Credential material is not copied into this binding. Requests will fail explicitly if this exact provider/account/model becomes unavailable.'
      ].join('\n')
    }, () => options.runtimeRequest(
      '/v1/extensions/model-providers/binding',
      'PUT',
      JSON.stringify({ ...body, acknowledgedDataAccess: true })
    ))
  })
}

function registerConsentIpcHandler(options: RegisterExtensionIpcHandlersOptions): void {
  ipcMain.handle('extension:consent:request', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parsePayload('extension:consent:request', extensionConsentRequestSchema, payload)
    const result = await options.protectedActions.authorize(
      consentBindingFromRequest(request, event.sender.id),
      { title: request.title, message: request.message, detail: request.detail }
    )
    return result.approved
      ? { approved: true, consentRequestId: result.requestId, expiresAt: new Date(result.expiresAt).toISOString() }
      : { approved: false }
  })
}

async function performProtectedRuntimeOperation(
  options: RegisterExtensionIpcHandlersOptions,
  event: IpcMainInvokeEvent,
  binding: Omit<ExtensionConsentBinding, 'protectedWindowSessionId'>,
  consentRequestId: string | undefined,
  copy: { title: string; message: string; detail?: string },
  perform: () => Promise<ExtensionRuntimeRequestResult>
): Promise<ExtensionRuntimeRequestResult> {
  try {
    if (consentRequestId) {
      options.protectedActions.consume(consentRequestId, binding)
      return perform()
    }
    const result = await options.protectedActions.authorizeAndPerform(binding, copy, perform)
    return result ?? runtimeFailure('EXTENSION_CONSENT_DENIED', 'The protected operation was cancelled.', 403)
  } catch (error) {
    if (error instanceof ExtensionConsentError) {
      return runtimeFailure(error.code, error.message, 403)
    }
    options.logError?.('extension-consent', 'Protected extension operation failed.', {
      extensionId: binding.extensionId,
      operationKind: binding.operationKind,
      message: error instanceof Error ? error.message : String(error)
    })
    throw error
  } finally {
    void event
  }
}

function consentBindingFromRequest(
  request: ExtensionConsentRequest,
  senderId: number
): Omit<ExtensionConsentBinding, 'protectedWindowSessionId'> {
  return {
    extensionId: request.extensionId,
    extensionVersion: request.extensionVersion,
    operationKind: request.operationKind,
    parameters: request.parameters,
    workspaceRoot: request.workspaceRoot,
    senderId
  }
}

function assertTrustedWorkbenchSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: () => BrowserWindow | null
): void {
  const window = getMainWindow()
  const senderFrame = event.senderFrame
  const mainFrame = window?.webContents.mainFrame
  if (
    !window ||
    window.isDestroyed() ||
    event.sender.id !== window.webContents.id ||
    !senderFrame ||
    !mainFrame ||
    senderFrame.processId !== mainFrame.processId ||
    senderFrame.routingId !== mainFrame.routingId
  ) {
    throw new Error('Extension IPC sender is not the trusted workbench frame.')
  }
}

async function revokeContentScripts(
  options: RegisterExtensionIpcHandlersOptions,
  sender: WebContents,
  extensionId: string,
  reason: string,
  workspaceRoot?: string
): Promise<void> {
  try {
    await options.contentScripts.revokeExtension(sender, extensionId, reason, workspaceRoot)
  } catch (error) {
    options.logError?.('extension-content-script', 'Failed to revoke Direct DOM content.', {
      extensionId,
      reason,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

function disposeViewSessions(
  options: RegisterExtensionIpcHandlersOptions,
  extensionId: string,
  workspaceRoot?: string
): number {
  return workspaceRoot === undefined
    ? options.viewSessions.disposeForExtension(extensionId)
    : options.viewSessions.disposeForExtensionWorkspace(extensionId, workspaceRoot)
}

function parsePayload<T>(
  channel: string,
  schema: { parse(value: unknown): T },
  payload: unknown
): T {
  let serialized: string
  try {
    if (payload === undefined) {
      serialized = ''
    } else {
      const encoded = JSON.stringify(payload)
      if (encoded === undefined) throw new Error('payload is not JSON')
      serialized = encoded
    }
  } catch {
    throw new Error(`Invalid payload for ${channel}: payload is not JSON.`)
  }
  if (Buffer.byteLength(serialized) > MAX_EXTENSION_IPC_BODY_BYTES) {
    throw new Error(`Invalid payload for ${channel}: payload is too large.`)
  }
  try {
    return schema.parse(payload)
  } catch (error) {
    throw new Error(`Invalid payload for ${channel}: ${error instanceof Error ? error.message : 'Bad request.'}`)
  }
}

function stringifyBoundedRuntimeBody(
  channel: string,
  payload: unknown,
  maxBytes: number
): string {
  const body = JSON.stringify(payload)
  if (Buffer.byteLength(body) > maxBytes) {
    throw new Error(`Invalid payload for ${channel}: payload is too large.`)
  }
  return body
}

async function resolveInstallIdentity(
  request:
    | { source: 'archive'; path: string }
    | { source: 'development'; path: string }
    | { source: 'index'; indexUrl: string; extensionId: string; version: string },
  runtimeRequest: RuntimeRequest
): Promise<ExtensionInstallReview> {
  if (request.source === 'index') {
    return readIndexInstallReview(request.indexUrl, request.extensionId, request.version)
  }
  if (request.source === 'archive') {
    const inspection = await runtimeRequest(
      '/v1/extensions/inspect',
      'POST',
      JSON.stringify({ path: request.path })
    )
    if (!inspection.ok) throw runtimeResultError(inspection)
    const parsed = safeJsonParse(inspection.body)
    const record = isRecord(parsed) && isRecord(parsed.inspection) ? parsed.inspection : undefined
    if (!record || typeof record.id !== 'string' || typeof record.version !== 'string') {
      throw new Error('Extension inspection did not return package identity.')
    }
    const manifest = ExtensionManifestSchema.safeParse(record.manifest)
    if (!manifest.success) throw new Error('Extension inspection did not return a valid manifest.')
    const archiveSha256 = typeof record.archiveSha256 === 'string' && /^[a-f0-9]{64}$/.test(record.archiveSha256)
      ? record.archiveSha256
      : undefined
    const signatureStatus = parseSignatureStatus(record.signatureStatus)
    return {
      extensionId: extensionIdSchema.parse(record.id),
      extensionVersion: String(record.version),
      requestedPermissions: [...manifest.data.permissions],
      sourceKind: 'Local .kunx archive',
      sourceLabel: request.path,
      mutable: false,
      ...(archiveSha256 ? { archiveSha256 } : {}),
      signatureStatus,
      contributionRisks: contributionRiskLabels(manifest.data)
    }
  }
  const manifest = ExtensionManifestSchema.parse(
    JSON.parse(await readFile(join(request.path, 'kun-extension.json'), 'utf8'))
  )
  return {
    extensionId: `${manifest.publisher}.${manifest.name}`,
    extensionVersion: manifest.version,
    requestedPermissions: [...manifest.permissions],
    sourceKind: 'Development directory',
    sourceLabel: request.path,
    mutable: true,
    signatureStatus: manifest.signature ? 'present-unverified' : 'unsigned',
    contributionRisks: contributionRiskLabels(manifest)
  }
}

type ExtensionInstallReview = {
  extensionId: string
  extensionVersion: string
  requestedPermissions: string[]
  sourceKind: string
  sourceLabel: string
  mutable: boolean
  archiveSha256?: string
  signatureStatus: 'unsigned' | 'present-unverified' | 'verified'
  contributionRisks: string[]
}

async function readIndexInstallReview(
  indexUrl: string,
  extensionId: string,
  version: string
): Promise<ExtensionInstallReview> {
  const response = await fetch(indexUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok || new URL(response.url).protocol !== 'https:') {
    throw new Error('Could not load the HTTPS extension index for permission review.')
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EXTENSION_IPC_BODY_BYTES) {
    throw new Error('Extension index is too large.')
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_EXTENSION_IPC_BODY_BYTES) throw new Error('Extension index is too large.')
  const document = safeJsonParse(text)
  if (!isRecord(document) || document.schemaVersion !== 1 || !Array.isArray(document.extensions)) {
    throw new Error('Extension index is invalid.')
  }
  const extension = document.extensions.find(
    (candidate) => isRecord(candidate) && candidate.id === extensionId
  )
  if (!isRecord(extension) || !Array.isArray(extension.versions)) {
    throw new Error('Extension is not present in the selected index.')
  }
  const selected = extension.versions.find(
    (candidate) => isRecord(candidate) && candidate.version === version
  )
  if (!isRecord(selected) || !Array.isArray(selected.permissions)) {
    throw new Error('Exact extension version is not present in the selected index.')
  }
  const requestedPermissions = selected.permissions.map((permission) => PermissionSchema.parse(permission))
  const archiveSha256 = typeof selected.sha256 === 'string' && /^[a-f0-9]{64}$/.test(selected.sha256)
    ? selected.sha256
    : undefined
  if (!archiveSha256) throw new Error('The selected Index version has no valid SHA-256 digest.')
  const packageUrl = typeof selected.url === 'string' ? new URL(selected.url) : undefined
  if (!packageUrl || packageUrl.protocol !== 'https:') {
    throw new Error('The selected Index package URL must use HTTPS.')
  }
  return {
    extensionId: extensionIdSchema.parse(extensionId),
    extensionVersion: version,
    requestedPermissions,
    sourceKind: 'Custom HTTPS Index',
    sourceLabel: `${indexUrl} -> ${packageUrl.toString()}`,
    mutable: false,
    archiveSha256,
    signatureStatus: isRecord(selected.signature) ? 'present-unverified' : 'unsigned',
    contributionRisks: permissionRiskLabels(requestedPermissions)
  }
}

function parseSignatureStatus(value: unknown): ExtensionInstallReview['signatureStatus'] {
  return value === 'verified' || value === 'present-unverified' ? value : 'unsigned'
}

function contributionRiskLabels(manifest: ReturnType<typeof ExtensionManifestSchema.parse>): string[] {
  const labels = permissionRiskLabels(manifest.permissions)
  if (manifest.main && !labels.includes('Runs Node code with your operating-system user privileges.')) {
    labels.unshift('Runs Node code with your operating-system user privileges.')
  }
  if (manifest.contributes.hostContentScripts.length > 0) {
    labels.push(`Direct DOM: can read or change visible Kun workbench content (${manifest.contributes.hostContentScripts.length} contribution(s)).`)
  }
  if (manifest.contributes.modelProviders.length > 0) {
    labels.push(`Model provider: receives complete model-visible prompts, attachments, and tool definitions when selected (${manifest.contributes.modelProviders.length} provider(s)).`)
  }
  const viewCount = manifest.contributes['views.leftSidebar'].length +
    manifest.contributes['views.rightSidebar'].length +
    manifest.contributes['views.auxiliaryPanel'].length +
    manifest.contributes['views.editorTab'].length +
    manifest.contributes['views.fullPage'].length
  if (viewCount > 0 || manifest.browser) {
    labels.push('Includes sandboxed extension UI; its brokered capabilities still depend on the grants below.')
  }
  return [...new Set(labels)]
}

function permissionRiskLabels(permissions: readonly string[]): string[] {
  const labels = ['Runs Node code with your operating-system user privileges.']
  if (permissions.some((permission) => permission === 'workspace.read' || permission === 'storage.workspace')) {
    labels.push('Workspace read permission can expose files and extension state from the approved workspace.')
  }
  if (permissions.some((permission) => permission === 'workspace.write')) {
    labels.push('Workspace write permission can create or modify files in the approved workspace.')
  }
  if (permissions.some((permission) => permission === 'media.read')) {
    labels.push('Media read permission can inspect user-selected local media through opaque grants.')
  }
  if (permissions.some((permission) => permission === 'media.process' || permission === 'jobs.manage')) {
    labels.push('Media processing and job permissions can run and manage durable local work.')
  }
  if (permissions.some((permission) => permission === 'media.export')) {
    labels.push('Media export permission can write to user-approved output targets.')
  }
  if (permissions.some((permission) => permission === 'agent.run' || permission === 'tools.register')) {
    labels.push('Agent and tool permissions can start private Agent runs and expose declared tools to Kun.')
  }
  if (permissions.some((permission) => permission === 'hostDom')) {
    labels.push('Direct DOM permission can read and alter visible workbench content and may imitate ordinary UI.')
  }
  if (permissions.some((permission) => permission === 'webview.external')) {
    labels.push('External Webview permission can display approved remote websites inside an isolated browser session.')
  }
  if (permissions.some((permission) => permission === 'providers.register')) {
    labels.push('Provider permission can receive full model inputs when the user explicitly selects that provider.')
  }
  if (permissions.some((permission) => permission.startsWith('accounts.secrets.read:'))) {
    labels.push('Secret-read permission can reveal a selected raw account secret to this extension\'s Node host after a separate allow-once decision.')
  }
  if (permissions.some((permission) => permission.startsWith('network:'))) {
    labels.push('Network permission can send brokered data to the declared destination hosts.')
  }
  if (permissions.some((permission) => permission === 'shell')) {
    labels.push('Shell permission can start external processes after applicable host policy and consent checks.')
  }
  return labels
}

function formatPermissionChangeReviewDetail(
  currentPermissions: readonly string[],
  nextPermissions: readonly string[]
): string {
  const current = new Set(currentPermissions)
  const next = new Set(nextPermissions)
  const added = [...next].filter((permission) => !current.has(permission)).sort()
  const removed = [...current].filter((permission) => !next.has(permission)).sort()
  const resulting = [...next].sort()
  const list = (values: readonly string[]): string => values.length > 0
    ? boundedReviewList(values, 40)
    : '• none'
  return [
    'This permission change applies only to the selected workspace.',
    `Added broker permissions:\n${list(added)}`,
    `Removed broker permissions:\n${list(removed)}`,
    `Resulting broker permissions:\n${list(resulting)}`,
    `Host-authored risk summary:\n${boundedReviewList(permissionRiskLabels(resulting), 12)}`,
    'Broker permissions are capability gates; the extension Node host itself is not an operating-system sandbox.'
  ].join('\n\n').slice(0, 16_384)
}

function formatInstallReviewDetail(review: ExtensionInstallReview): string {
  const signature = review.signatureStatus === 'verified'
    ? 'verified'
    : review.signatureStatus === 'present-unverified'
      ? 'signature present, but not verified by Kun'
      : 'unsigned'
  const permissions = boundedReviewList(review.requestedPermissions, 40)
  const risks = boundedReviewList(review.contributionRisks, 12)
  return [
    'Extensions with Node entrypoints execute with your operating-system user privileges. Broker permissions are not an OS sandbox.',
    `Source: ${safeReviewText(review.sourceKind, 120)}\n${safeReviewText(review.sourceLabel, 1_024)}`,
    review.mutable
      ? 'Package identity: mutable development directory (files can change without reinstalling).'
      : `Package SHA-256: ${review.archiveSha256 ?? 'not available before validation'}`,
    `Signature: ${signature}.`,
    risks.length > 0 ? `Host-authored risk summary:\n${risks}` : 'Host-authored risk summary: no additional high-risk contribution detected.',
    permissions.length > 0
      ? `Requested broker permissions:\n${permissions}`
      : 'This package requests no broker permissions.',
    review.sourceKind === 'Custom HTTPS Index'
      ? 'Kun will download this exact version, verify the displayed SHA-256, then revalidate the package manifest, integrity, compatibility, and permission metadata before activation.'
      : 'Kun will revalidate package integrity, compatibility, and declared resources before activation.'
  ].join('\n\n').slice(0, 16_384)
}

function boundedReviewList(values: readonly string[], maximum: number): string {
  const selected = values.slice(0, maximum).map((value) => `• ${safeReviewText(value, 512)}`)
  if (values.length > maximum) selected.push(`• …and ${values.length - maximum} more`)
  return selected.join('\n')
}

function safeReviewText(value: string, maximum: number): string {
  return value.replace(/\p{Cc}+/gu, ' ').trim().slice(0, maximum)
}

function parseRuntimeViewSession(body: string): {
  sessionId: string
  nonce: string
  contributionId: string
  extensionId: string
  extensionVersion: string
} | undefined {
  const parsed = safeJsonParse(body)
  if (!isRecord(parsed)) return undefined
  const record = isRecord(parsed.session) ? parsed.session : parsed
  const sessionId = extensionSessionIdSchema.safeParse(record.sessionId)
  if (
    !sessionId.success ||
    typeof record.nonce !== 'string' ||
    record.nonce.length < 32 ||
    record.nonce.length > 256 ||
    typeof record.contributionId !== 'string' ||
    typeof record.extensionId !== 'string' ||
    typeof record.extensionVersion !== 'string'
  ) return undefined
  return {
    sessionId: sessionId.data,
    nonce: record.nonce,
    contributionId: record.contributionId,
    extensionId: record.extensionId,
    extensionVersion: record.extensionVersion
  }
}

function parseQualifiedContributionId(value: string): { extensionId: string; localId: string } {
  const match = /^extension:([^/]+)\/([^/]+)$/.exec(value)
  if (!match) throw new Error('Extension contribution ID is invalid.')
  return { extensionId: extensionIdSchema.parse(match[1]), localId: match[2]! }
}

function localContributionId(value: string, extensionId: string): string {
  const parsed = parseQualifiedContributionId(value)
  if (parsed.extensionId !== extensionId) throw new Error('Content script identity mismatch.')
  return parsed.localId
}

function extensionSessionHeaders(record: { runtimeSessionId: string; nonce: string }): Record<string, string> {
  return {
    'x-kun-extension-session-id': record.runtimeSessionId,
    'x-kun-extension-session-nonce': record.nonce
  }
}

function requireWorkbenchOwnedSession(
  options: RegisterExtensionIpcHandlersOptions,
  sender: WebContents,
  sessionId: string
) {
  const record = options.viewSessions.get(sessionId)
  if (!record || record.parentWebContentsId !== sender.id || record.state === 'disposed') {
    throw new Error('Extension View Session is not owned by this workbench.')
  }
  return record
}

function dispatchViewEvents(
  sessionId: string,
  guestWebContentsId: number | undefined,
  body: string,
  workbench: WebContents,
  viewSessions: ExtensionViewSessionRegistry
): void {
  const payload = safeJsonParse(body)
  if (!isRecord(payload) || !Array.isArray(payload.events)) return
  const eventPayload: ExtensionViewEventPayload = {
    sessionId,
    cursor: typeof payload.nextCursor === 'number'
      ? payload.nextCursor
      : typeof payload.cursor === 'number' ? payload.cursor : undefined,
    events: payload.events
  }
  workbench.send('extension:view-event', eventPayload)
  for (const event of payload.events) {
    if (!isRecord(event)) continue
    const guest = guestWebContentsId === undefined ? undefined : webContents.fromId(guestWebContentsId)
    if (event.type === 'message' && isRecord(event.payload)) {
      guest?.send('extension:view:notification', {
        sessionId,
        method: 'ui.message',
        params: event.payload
      })
    } else if (event.type === 'notification') {
      guest?.send('extension:view:notification', {
        sessionId,
        method: 'ui.notification',
        params: event.payload
      })
    } else if (
      event.type === 'bridge' &&
      isRecord(event.payload) &&
      typeof event.payload.method === 'string' &&
      isAllowedExtensionViewNotification(event.payload.method)
    ) {
      viewSessions.sendToGuest(
        sessionId,
        event.payload.method,
        event.payload.params
      )
    }
  }
}

async function pumpExtensionViewEvents(
  options: RegisterExtensionIpcHandlersOptions,
  sessionId: string,
  signal: AbortSignal
): Promise<void> {
  let cursor = 0
  let consecutiveFailures = 0
  while (!signal.aborted) {
    const record = options.viewSessions.get(sessionId)
    if (!record || record.state === 'disposed') return
    if (record.state !== 'active') {
      await abortableDelay(50, signal)
      continue
    }
    const result = await options.runtimeRequest(
      `/v1/extensions/view-sessions/${encodeURIComponent(record.runtimeSessionId)}/events?cursor=${cursor}&limit=100`,
      'GET',
      undefined,
      extensionSessionHeaders(record)
    ).catch((error) => runtimeFailure(
      'EXTENSION_VIEW_EVENT_FETCH_FAILED',
      error instanceof Error ? error.message : 'View event fetch failed.',
      0
    ))
    if (signal.aborted) return
    if (result.ok) {
      consecutiveFailures = 0
      const payload = safeJsonParse(result.body)
      if (isRecord(payload)) {
        const nextCursor = payload.nextCursor
        if (typeof nextCursor === 'number' && Number.isSafeInteger(nextCursor) && nextCursor >= cursor) {
          cursor = nextCursor
        }
        const workbench = options.getMainWindow()?.webContents
        if (workbench && !workbench.isDestroyed()) {
          dispatchViewEvents(
            sessionId,
            record.guestWebContentsId,
            result.body,
            workbench,
            options.viewSessions
          )
        }
        if (payload.hasMore === true) continue
      }
    } else {
      consecutiveFailures += 1
      if (result.status === 409) {
        const failure = safeJsonParse(result.body)
        if (
          isRecord(failure) &&
          typeof failure.oldestAvailableCursor === 'number' &&
          Number.isSafeInteger(failure.oldestAvailableCursor) &&
          failure.oldestAvailableCursor >= 0
        ) {
          options.viewSessions.sendToGuest(sessionId, 'ui.message', {
            channel: 'kun.extension.view.overflow',
            payload: {
              code: 'cursor_expired',
              oldestAvailableCursor: failure.oldestAvailableCursor
            }
          })
          cursor = failure.oldestAvailableCursor
          continue
        }
      }
      if (result.status === 401 || result.status === 403 || result.status === 404) {
        options.viewSessions.dispose(sessionId)
        return
      }
    }
    await abortableDelay(Math.min(5_000, 350 * Math.max(1, consecutiveFailures)), signal)
  }
}

const EXTENSION_VIEW_NOTIFICATION_METHODS = new Set([
  'agent.event',
  'jobs.event',
  'modelProviders.statusChanged',
  'ui.localeChanged',
  'ui.themeChanged'
])

function isAllowedExtensionViewNotification(method: string): boolean {
  return EXTENSION_VIEW_NOTIFICATION_METHODS.has(method)
}

async function loadWorkbenchEnvironment(
  options: RegisterExtensionIpcHandlersOptions
): Promise<ExtensionWorkbenchEnvironment> {
  const environment = await options.getWorkbenchEnvironment()
  return {
    theme: ThemeSchema.parse(environment.theme),
    locale: LocaleSchema.parse(environment.locale)
  }
}

type WorkbenchEnvironmentSyncBatch = {
  notifyGuests: boolean
  promise: Promise<void>
}

function createWorkbenchEnvironmentSyncQueue(
  options: RegisterExtensionIpcHandlersOptions,
  notifyGuests: (environment: ExtensionWorkbenchEnvironment) => void
): {
    syncToRuntime(): Promise<void>
    publishChanged(): Promise<void>
    dispose(): void
  } {
  let disposed = false
  let tail = Promise.resolve()
  let pendingBatch: WorkbenchEnvironmentSyncBatch | undefined

  const schedule = (shouldNotifyGuests: boolean): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (pendingBatch) {
      pendingBatch.notifyGuests ||= shouldNotifyGuests
      return pendingBatch.promise
    }

    const batch: WorkbenchEnvironmentSyncBatch = {
      notifyGuests: shouldNotifyGuests,
      promise: Promise.resolve()
    }
    const run = tail.then(async () => {
      if (pendingBatch === batch) pendingBatch = undefined
      if (disposed) return

      // Read the authoritative Host state only after every older PUT has settled.
      // This keeps queued calls coalesced and makes the last requested state win.
      const environment = await loadWorkbenchEnvironment(options)
      await syncWorkbenchEnvironmentToRuntime(options, environment)
      if (batch.notifyGuests && pendingBatch?.notifyGuests !== true && !disposed) {
        notifyGuests(environment)
      }
    })
    batch.promise = run
    pendingBatch = batch
    tail = run.catch(() => undefined)
    return run
  }

  return {
    syncToRuntime: () => schedule(false),
    publishChanged: () => schedule(true),
    dispose: () => {
      disposed = true
      pendingBatch = undefined
    }
  }
}

async function syncWorkbenchEnvironmentToRuntime(
  options: RegisterExtensionIpcHandlersOptions,
  environment: ExtensionWorkbenchEnvironment
): Promise<void> {
  try {
    const result = await options.runtimeRequest(
      '/v1/extensions/workbench/environment',
      'PUT',
      JSON.stringify(environment)
    )
    if (!result.ok) {
      options.logError?.('extension-workbench', 'Kun rejected the workbench environment update.', {
        status: result.status
      })
    }
  } catch (error) {
    options.logError?.('extension-workbench', 'Failed to synchronize the workbench environment.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    timer.unref?.()
    const onAbort = (): void => {
      clearTimeout(timer)
      finish()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function presentProtectedAccountAuthorization(
  options: RegisterExtensionIpcHandlersOptions,
  result: ExtensionRuntimeRequestResult,
  extensionId: string,
  providerId: string
): Promise<ExtensionRuntimeRequestResult> {
  if (!result.ok) return result
  const payload = safeJsonParse(result.body)
  if (!isRecord(payload)) return result
  const parsed = AccountSessionSchema.safeParse(payload.session)
  if (!parsed.success || parsed.data.status !== 'pending' || !parsed.data.verificationUrl) {
    return result
  }
  const session = parsed.data
  const verificationUrl = session.verificationUrl!
  try {
    await options.credentialSurface.presentAuthorization(options.getMainWindow(), {
      title: 'Authorize provider account',
      message: `Complete authorization for ${providerId}.`,
      detail: `This protected Kun window is isolated from ${extensionId}, its Webviews, and host content scripts.`,
      verificationUrl,
      ...(session.userCode ? { userCode: session.userCode } : {}),
      ...(session.expiresAt ? { expiresAt: session.expiresAt } : {})
    })
  } catch (error) {
    await options.runtimeRequest(
      `/v1/extensions/accounts/sessions/${encodeURIComponent(session.id)}/cancel`,
      'POST',
      JSON.stringify({ extensionId })
    ).catch(() => undefined)
    options.logError?.('extension-account', 'Protected account authorization surface failed.', {
      extensionId,
      providerId,
      message: error instanceof Error ? error.message : String(error)
    })
    return runtimeFailure(
      'EXTENSION_PROTECTED_SURFACE_FAILED',
      'Kun could not present the protected account authorization window.',
      502
    )
  }
  return redactAccountSessionInteraction(result)
}

function redactAccountSessionInteraction(
  result: ExtensionRuntimeRequestResult
): ExtensionRuntimeRequestResult {
  if (!result.ok) return result
  const payload = safeJsonParse(result.body)
  if (!isRecord(payload)) return result
  const parsed = AccountSessionSchema.safeParse(payload.session)
  if (!parsed.success) return result
  const {
    verificationUrl: _verificationUrl,
    userCode: _userCode,
    ...redactedSession
  } = parsed.data
  return { ...result, body: JSON.stringify({ ...payload, session: redactedSession }) }
}

function runtimeFailure(code: string, message: string, status: number): ExtensionRuntimeRequestResult {
  return { ok: false, status, body: JSON.stringify({ code, message }) }
}

function runtimeResultError(result: ExtensionRuntimeRequestResult): Error {
  const parsed = safeJsonParse(result.body)
  const message = isRecord(parsed) && typeof parsed.message === 'string'
    ? parsed.message
    : `Kun extension request failed (${result.status}).`
  return new Error(message.slice(0, 2_000))
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

class ExtensionViewRequestLimiter {
  private readonly states = new Map<number, { startedAt: number; calls: number; outstanding: number }>()
  private readonly trackedSenders = new Set<number>()

  begin(sender: WebContents, payload: unknown): () => void {
    const size = Buffer.byteLength(JSON.stringify(payload))
    if (size > MAX_EXTENSION_IPC_BODY_BYTES) throw new Error('Extension View message is too large.')
    const now = Date.now()
    const state = this.states.get(sender.id) ?? { startedAt: now, calls: 0, outstanding: 0 }
    if (now - state.startedAt >= 60_000) {
      state.startedAt = now
      state.calls = 0
    }
    if (state.calls >= 120) throw new Error('Extension View request rate limit exceeded.')
    if (state.outstanding >= 16) throw new Error('Extension View outstanding request limit exceeded.')
    state.calls += 1
    state.outstanding += 1
    this.states.set(sender.id, state)
    const release = (): void => {
      const current = this.states.get(sender.id)
      if (!current) return
      current.outstanding = Math.max(0, current.outstanding - 1)
    }
    if (!this.trackedSenders.has(sender.id)) {
      this.trackedSenders.add(sender.id)
      sender.once('destroyed', () => {
        this.states.delete(sender.id)
        this.trackedSenders.delete(sender.id)
      })
    }
    return release
  }
}
