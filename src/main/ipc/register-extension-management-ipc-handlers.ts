import {
  dialog,
  ipcMain
} from 'electron'
import {
  join
} from 'node:path'
import {
  extensionCommandInvocationRequestSchema,
  extensionEnableRequestSchema,
  extensionHostContentScriptBridgeRequestSchema,
  extensionIdSchema,
  extensionInstallRequestSchema,
  extensionListProviderModelsRequestSchema,
  extensionListRequestSchema,
  extensionLoadConfigurationRequestSchema,
  extensionNotificationResponseRequestSchema,
  extensionPermissionGrantRequestSchema,
  extensionReloadRequestSchema,
  extensionRollbackRequestSchema,
  extensionScopedRequestSchema,
  extensionSyncHostContentScriptsRequestSchema,
  extensionUninstallRequestSchema,
  extensionUpdateConfigurationRequestSchema,
  extensionWorkspaceRequestSchema,
  MAX_EXTENSION_CONFIGURATION_BODY_BYTES
} from './app-ipc-schemas/extensions'
import type {
  ExtensionIpcRegistration,
  RegisterExtensionIpcHandlersOptions
} from './extension-ipc-handler-options'
import {
  assertTrustedWorkbenchSender,
  disposeViewSessions,
  isRecord,
  parsePayload,
  performProtectedRuntimeOperation,
  revokeContentScripts,
  runtimeResultError,
  safeJsonParse,
  stringifyBoundedRuntimeBody
} from './extension-ipc-common'
import {
  formatInstallReviewDetail,
  formatPermissionChangeReviewDetail,
  resolveInstallIdentity
} from './extension-ipc-install-review'
import { localContributionId } from './extension-ipc-view-utils'

export function registerExtensionManagementIpcHandlers(
  options: RegisterExtensionIpcHandlersOptions,
  registerDomains: () => ExtensionIpcRegistration
): ExtensionIpcRegistration {
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
      const uninstall = () => options.runtimeRequest(path, 'DELETE')
      return options.withWidgetAppUninstall
        ? options.withWidgetAppUninstall(request.extensionId, request.version, uninstall)
        : uninstall()
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


  const registration = registerDomains()

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

  return registration
}
