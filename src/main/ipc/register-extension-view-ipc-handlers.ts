import {
  ArtifactHostActionRequestSchema,
  ArtifactHostActionResultSchema,
  ComposerContextAttachmentRequestSchema,
  ComposerContextAttachmentSchema,
  MediaOpenViewResourceRequestSchema,
  MediaReleaseRequestSchema,
  MediaResourceLeaseSchema
} from '@kun/extension-api'
import {
  ipcMain,
  shell,
  webContents,
  type BrowserWindow
} from 'electron'
import {
  createHash,
  randomUUID
} from 'node:crypto'
import {
  join,
  resolve
} from 'node:path'
import type {
  ExtensionComposerContextEvent,
  ExtensionRuntimeRequestResult
} from '../../shared/extension-ipc'
import {
  extensionExternalBrowserControlSchema,
  extensionGuestCancelSchema,
  extensionGuestNotificationSchema,
  extensionGuestRequestSchema,
  extensionViewEventsRequestSchema,
  extensionViewMessageRequestSchema,
  extensionViewSessionDisposePayloadSchema,
  extensionViewSessionCreateRequestSchema
} from './app-ipc-schemas/extensions'
import {
  isAllowedExtensionViewMethod
} from '../extensions/extension-view-methods'
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
import type {
  ExtensionIpcRegistration,
  RegisterExtensionIpcHandlersOptions
} from './extension-ipc-handler-options'
import {
  assertTrustedWorkbenchSender,
  isRecord,
  parsePayload,
  runtimeFailure,
  runtimeResultError,
  safeJsonParse
} from './extension-ipc-common'
import {
  createWorkbenchEnvironmentSyncQueue,
  dispatchViewEvents,
  extensionSessionHeaders,
  loadWorkbenchEnvironment,
  parseQualifiedContributionId,
  parseRuntimeViewSession,
  pumpExtensionViewEvents,
  requireWorkbenchOwnedSession
} from './extension-ipc-view-utils'
import type { ExtensionViewRequestLimiter } from './extension-view-request-limiter'

export function registerExtensionViewIpcHandlers(
  options: RegisterExtensionIpcHandlersOptions,
  limiter: ExtensionViewRequestLimiter
): ExtensionIpcRegistration {
  const eventPumps = new Map<string, AbortController>()
  const runtimeDisposals = new Map<string, Promise<ExtensionRuntimeRequestResult>>()
  const requestedDisposals = new Set<string>()
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
    const requested = requestedDisposals.delete(record.sessionId)
    if (!requested) {
      const parent = options.getMainWindow()?.webContents
      if (
        parent?.id === record.parentWebContentsId &&
        !parent.isDestroyed()
      ) {
        parent.send('extension:view-session:invalidated', {
          sessionId: record.sessionId
        })
      }
    }
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
    // Runtime activation may have waited for an in-flight version, permission,
    // or enablement change. Resolve the descriptor afterwards so Main never
    // binds local resources or external hosts from the pre-activation state.
    const view = await options.descriptors.resolveView(
      identity.extensionId,
      identity.localId,
      request.workspaceRoot
    ).catch((error: unknown) => throwAfterRuntimeViewSessionRollback(
      options,
      runtimeSession.sessionId,
      error
    ))
    if (
      runtimeSession.extensionId !== identity.extensionId ||
      runtimeSession.extensionVersion !== view.extensionVersion ||
      runtimeSession.contributionId !== request.contributionId
    ) {
      await throwAfterRuntimeViewSessionRollback(
        options,
        runtimeSession.sessionId,
        new Error('Kun returned a mismatched extension View Session.')
      )
    }
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
    requestedDisposals.add(request.sessionId)
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

async function throwAfterRuntimeViewSessionRollback(
  options: RegisterExtensionIpcHandlersOptions,
  runtimeSessionId: string,
  error: unknown
): Promise<never> {
  await options.runtimeRequest(
    `/v1/extensions/view-sessions/${encodeURIComponent(runtimeSessionId)}`,
    'DELETE'
  ).catch(() => undefined)
  throw error
}
