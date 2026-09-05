import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import {
  join
} from 'node:path'
import {
  access
} from 'node:fs/promises'
import {
  type AppSettingsPatch,
  type AppSettingsV1
} from '../../shared/app-settings'
import type {
  CredentialRecoveryResetResult,
  ModelProviderCredentialRevealResult
} from '../../shared/kun-gui-api'
import {
  cursorSubscriptionDiscoveryPayloadSchema,
  modelProviderCredentialRevealPayloadSchema,
  runtimeRequestPayloadSchema,
  runtimeRequestCancelPayloadSchema,
  runtimeImageAttachmentUploadPayloadSchema,
  runtimeDocumentAttachmentUploadPayloadSchema,
  kunProtectedApprovalPayloadSchema,
  settingsPatchSchema
} from './app-ipc-schemas'
import {
  uploadRuntimeImageAttachment
} from '../services/runtime-image-attachment-service'
import {
  uploadRuntimeDocumentAttachment
} from '../services/runtime-document-attachment-service'
import {
  createApprovalConsentToken,
  KUN_APPROVAL_CONSENT_HEADER
} from '../approval-consent'
import {
  NativeDialogCoordinator
} from '../native-dialog-coordinator'
import {
  KunExecutionSettingsConsentService,
  executionSettingsEqual,
  kunExecutionSettingsChange,
  type KunExecutionSettingsConsentAction
} from '../execution-settings-consent'
import {
  resolveModelProviderProxyUrl
} from '../../shared/app-settings'
import {
  claudeSubscriptionStatus,
  probeClaudeSubscription,
  runClaudeSubscriptionLogin
} from '../claude-subscription-auth'
import {
  fetchSdkModels
} from '../claude-subscription-models'
import {
  agentSdkDownloadState,
  agentSdkStatus,
  resolveClaudeBinary,
  startAgentSdkInstall
} from '../agent-sdk-installer'
import {
  requestOfficialProviderCliInstall,
  requestOfficialProviderCliModels,
  requestOfficialProviderCliStatus,
  startOfficialProviderCliProgress
} from '../runtime-official-provider-cli'
import {
  discoverCursorSubscription
} from '../cursor-subscription-models'
import {
  geminiCliSubscriptionModels,
  geminiCliSubscriptionStatus
} from '../gemini-cli-subscription'
import type {
  ProtectedRuntimeRequestLease,
  RegisterAppIpcHandlersOptions
} from './app-ipc-handler-options'
import {
  approvalLogReference,
  assertTrustedWorkbenchSender,
  dialogParentIsAvailable,
  dialogParentState,
  parseIpcPayload,
  revealDialogParent,
  trustedWorkbenchSenderIsCurrent,
  withoutRendererPlaintextCredentials,
  withoutRendererProjectConfigGrants
} from './app-ipc-handler-utils'

export function registerAppSettingsIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const {
    store,
    getMainWindow,
    applySettingsPatch,
    saveSettingsPatch,
    resetUnreadableCredentials,
    runtimeRequest,
    acquireRuntimeRequestLease,
    getRuntimeSettingsSyncStatus,
    restartRuntime,
    restartKunServe,
    resolveSettingsConfigPath,
    logError,
    logInfo: logInfoHandler = () => undefined
  } = options
  const runtimeRequestControllers = new Map<string, {
    ownerId: number
    controller: AbortController
  }>()
  const observedRuntimeRequestOwners = new Set<number>()
  const runtimeRequestKey = (ownerId: number, requestId: string): string => `${ownerId}:${requestId}`
  const observeRuntimeRequestOwner = (owner: IpcMainInvokeEvent['sender']): void => {
    if (observedRuntimeRequestOwners.has(owner.id)) return
    observedRuntimeRequestOwners.add(owner.id)
    owner.once('destroyed', () => {
      observedRuntimeRequestOwners.delete(owner.id)
      for (const [key, pending] of runtimeRequestControllers) {
        if (pending.ownerId !== owner.id) continue
        pending.controller.abort()
        runtimeRequestControllers.delete(key)
      }
    })
  }
  const withRegistryCredentials = options.withRegistryCredentials ?? (async (settings) => settings)
  const nativeDialogs = options.nativeDialogs ?? new NativeDialogCoordinator()
  ipcMain.handle('settings:open-config-file', async () => {
    try {
      await store.save(await store.load())
      const message = await shell.openPath(resolveSettingsConfigPath())
      return message ? { ok: false as const, message } : { ok: true as const }
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
    }
  })
  const showMainWindowMessageBox = (
    parent: BrowserWindow,
    messageBoxOptions: Electron.MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> => nativeDialogs.run(parent.webContents, async () => {
    if (parent.isDestroyed()) {
      throw new Error('Native dialog parent window is unavailable.')
    }
    return dialog.showMessageBox(parent, messageBoxOptions)
  })
  const executionSettingsConsents = new KunExecutionSettingsConsentService()
  const applyProtectedSettingsPatch = async (
    event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
    partial: AppSettingsPatch,
    persist: (patch: AppSettingsPatch) => Promise<AppSettingsV1>
  ): Promise<AppSettingsV1> => {
    const current = await store.load()
    const change = kunExecutionSettingsChange(current, partial)
    if (!change) return persist(partial)

    assertTrustedWorkbenchSender(event, getMainWindow)
    const parent = getMainWindow()
    const senderFrame = event.senderFrame
    if (!parent || parent.isDestroyed() || !senderFrame) {
      throw new Error('Protected execution-settings window is unavailable.')
    }
    const confirmation = await showMainWindowMessageBox(parent, {
      type: 'warning',
      title: 'Change Kun execution permissions',
      message: 'Apply this tool approval and sandbox configuration?',
      detail: [
        `Current approval policy: ${change.current.approvalPolicy}`,
        `Current sandbox: ${change.current.sandboxMode}`,
        `Current approval reviewer: ${change.current.approvalReviewer}`,
        `New approval policy: ${change.next.approvalPolicy}`,
        `New sandbox: ${change.next.sandboxMode}`,
        `New approval reviewer: ${change.next.approvalReviewer}`,
        ...(change.next.approvalPolicy === 'auto' &&
          change.next.sandboxMode === 'danger-full-access' &&
          change.next.approvalReviewer === 'user'
          ? [
              '',
              'Full access lets Kun access any local file, execute host commands, and use network-capable tools without Kun approval.'
            ]
          : []),
        '',
        'This protected native prompt cannot be confirmed by extension Webviews or Direct DOM content scripts.'
      ].join('\n'),
      buttons: ['Apply change', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      normalizeAccessKeys: true
    })
    if (confirmation.response !== 0) return current

    // Fail closed if another settings write raced the native decision. The
    // consent is for one exact transition, not whichever values are current
    // when the dialog eventually closes.
    const latest = await store.load()
    const latestExecution = {
      approvalPolicy: latest.agents.kun.approvalPolicy,
      sandboxMode: latest.agents.kun.sandboxMode,
      approvalReviewer: latest.agents.kun.approvalReviewer
    }
    if (!executionSettingsEqual(latestExecution, change.current)) {
      throw new Error('Kun execution settings changed while confirmation was open; retry the change.')
    }

    const action: KunExecutionSettingsConsentAction = {
      ...change,
      senderId: event.sender.id,
      senderProcessId: senderFrame.processId,
      senderRoutingId: senderFrame.routingId
    }
    const consent = executionSettingsConsents.issue(action)
    if (!executionSettingsConsents.consume(consent, action)) {
      throw new Error('Protected execution-settings consent is invalid or expired.')
    }
    return persist(partial)
  }
  ipcMain.handle('settings:get', async (event) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    return withoutRendererPlaintextCredentials(await withRegistryCredentials(await store.load()))
  })
  ipcMain.handle(
    'model-provider:credential:reveal',
    async (event, payload: unknown): Promise<ModelProviderCredentialRevealResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const { providerId } = parseIpcPayload(
        'model-provider:credential:reveal',
        modelProviderCredentialRevealPayloadSchema,
        payload
      )
      const stored = await store.load()
      if (!stored.provider.providers.some((provider) => provider.id === providerId)) {
        throw new Error(`Provider profile "${providerId}" is unavailable`)
      }
      const projected = await withRegistryCredentials(stored, [providerId])
      const credential = projected.provider.providers
        .find((provider) => provider.id === providerId)
        ?.apiKey.trim() ?? ''
      if (!credential) throw new Error('Protected provider credential is unavailable')
      return { providerId, credential }
    }
  )
  ipcMain.handle('credentials:reset-unreadable', async (event): Promise<CredentialRecoveryResetResult> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const parent = getMainWindow()
    if (!parent || parent.isDestroyed()) {
      throw new Error('Credential recovery window is unavailable.')
    }
    const confirmation = await showMainWindowMessageBox(parent, {
      type: 'warning',
      title: 'Reset encrypted credentials',
      message: 'Reset the credentials that Windows can no longer decrypt?',
      detail: [
        'Kun will back up the unreadable encrypted data before resetting it.',
        'Saved API keys and OAuth sessions must be entered or authorized again.',
        'Conversations, workspaces, and ordinary settings are not removed.'
      ].join('\n'),
      buttons: ['Back up and reset', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      normalizeAccessKeys: true
    })
    if (confirmation.response !== 0) return { reset: false }
    return resetUnreadableCredentials()
  })
  // The Claude Code binary (~222MB) is NOT bundled — it's downloaded on demand
  // into userData/agent-sdk and resolved from there (or kun/node_modules in dev).
  const claudeSubKunDirs = (): string[] =>
    [
      app.isPackaged ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked') : app.getAppPath(),
      process.cwd()
    ].map((root) => join(root, 'kun'))
  const claudeSubBinary = (): string | undefined =>
    resolveClaudeBinary(app.getPath('userData'), claudeSubKunDirs())
  const resolveProtectedProviderCredential = async (
    event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
    explicitCredential: unknown,
    providerId: unknown,
    expectedKind: 'agent-sdk' | 'cursor-sdk'
  ): Promise<string | undefined> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const explicit = typeof explicitCredential === 'string' ? explicitCredential.trim() : ''
    if (explicit) return explicit
    const id = typeof providerId === 'string' ? providerId.trim() : ''
    if (!id) return undefined
    const expectedProvider = (settings: AppSettingsV1) => {
      const provider = settings.provider.providers.find((candidate) => candidate.id === id)
      if (!provider) throw new Error(`Provider profile "${id}" is unavailable`)
      if (provider.kind !== expectedKind) {
        const kind = expectedKind === 'agent-sdk' ? 'an agent-sdk' : 'a cursor-sdk'
        throw new Error(`Provider profile "${id}" is not ${kind} provider`)
      }
      return provider
    }
    const storedSettings = await store.load()
    expectedProvider(storedSettings)
    const projectedSettings = await withRegistryCredentials(storedSettings, [id])
    return expectedProvider(projectedSettings).apiKey.trim() || undefined
  }
  // Claude Pro/Max subscription login. The official CLI owns browser OAuth and
  // platform credential storage; Kun observes only structured, redacted state.
  ipcMain.handle('claude-subscription:status', async () =>
    claudeSubscriptionStatus({ binaryPath: claudeSubBinary() })
  )
  ipcMain.handle('claude-subscription:sdk-status', async () => ({
    ...agentSdkStatus(app.getPath('userData'), claudeSubKunDirs()),
    download: agentSdkDownloadState()
  }))
  ipcMain.handle('claude-subscription:sdk-install', async () =>
    startAgentSdkInstall(
      {
        userDataDir: app.getPath('userData'),
        proxyUrl: resolveModelProviderProxyUrl(await store.load()),
        restartRuntime: restartKunServe
      },
      (state) => getMainWindow()?.webContents.send('claude-subscription:sdk-progress', state)
    )
  )
  ipcMain.handle('claude-subscription:login', async () =>
    runClaudeSubscriptionLogin({ binaryPath: claudeSubBinary() })
  )
  ipcMain.handle('claude-subscription:probe', async (event, token: unknown, providerId: unknown) =>
    probeClaudeSubscription({
      token: await resolveProtectedProviderCredential(event, token, providerId, 'agent-sdk'),
      binaryPath: claudeSubBinary()
    })
  )
  ipcMain.handle('claude-subscription:models', async (event, token: unknown, providerId: unknown) =>
    fetchSdkModels({
      token: await resolveProtectedProviderCredential(event, token, providerId, 'agent-sdk'),
      kunRoots: claudeSubKunDirs(),
      binaryPath: claudeSubBinary()
    })
  )
  ipcMain.handle('gemini-subscription:cli-status', async () =>
    requestOfficialProviderCliStatus(runtimeRequest)
  )
  let stopOfficialProviderCliProgress: (() => void) | undefined
  ipcMain.handle('gemini-subscription:cli-install', async () => {
    const state = await requestOfficialProviderCliInstall(runtimeRequest)
    if (!stopOfficialProviderCliProgress) {
      stopOfficialProviderCliProgress = startOfficialProviderCliProgress(
        runtimeRequest,
        (progress) => getMainWindow()?.webContents.send('gemini-subscription:cli-progress', progress)
      )
    }
    return state
  })
  ipcMain.handle('gemini-subscription:models', async () =>
    requestOfficialProviderCliModels(runtimeRequest)
  )
  ipcMain.handle('gemini-cli-subscription:status', async () =>
    geminiCliSubscriptionStatus()
  )
  ipcMain.handle('gemini-cli-subscription:models', async () =>
    geminiCliSubscriptionModels()
  )
  ipcMain.handle('cursor-subscription:discover', async (event, payload: unknown) => {
    const { apiKey, providerId } = parseIpcPayload(
      'cursor-subscription:discover',
      cursorSubscriptionDiscoveryPayloadSchema,
      payload
    )
    const credential = await resolveProtectedProviderCredential(
      event,
      apiKey,
      providerId,
      'cursor-sdk'
    )
    if (!credential) throw new Error('Cursor subscription credential is unavailable')
    return discoverCursorSubscription({
      apiKey: credential,
      kunRoots: claudeSubKunDirs()
    })
  })
  ipcMain.handle('settings:set', async (event, partial: unknown) => {
    const persisted = await applyProtectedSettingsPatch(
      event,
      withoutRendererProjectConfigGrants(
        parseIpcPayload('settings:set', settingsPatchSchema, partial) as AppSettingsPatch
      ),
      applySettingsPatch
    )
    return withoutRendererPlaintextCredentials(await withRegistryCredentials(persisted))
  })
  ipcMain.handle('settings:save-silent', async (event, partial: unknown) => {
    const persisted = await applyProtectedSettingsPatch(
      event,
      withoutRendererProjectConfigGrants(
        parseIpcPayload('settings:save-silent', settingsPatchSchema, partial) as AppSettingsPatch
      ),
      saveSettingsPatch
    )
    return withoutRendererPlaintextCredentials(await withRegistryCredentials(persisted))
  })

  ipcMain.handle('runtime:request', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    options.assertRendererRuntimeReady()
    const request = parseIpcPayload('runtime:request', runtimeRequestPayloadSchema, payload)
    if (!request.requestId) {
      return runtimeRequest(request.path, request.method, request.body, undefined, {
        priority: request.priority
      })
    }
    observeRuntimeRequestOwner(event.sender)
    const key = runtimeRequestKey(event.sender.id, request.requestId)
    runtimeRequestControllers.get(key)?.controller.abort()
    const controller = new AbortController()
    runtimeRequestControllers.set(key, { ownerId: event.sender.id, controller })
    try {
      return await runtimeRequest(request.path, request.method, request.body, undefined, {
        signal: controller.signal,
        priority: request.priority
      })
    } finally {
      if (runtimeRequestControllers.get(key)?.controller === controller) {
        runtimeRequestControllers.delete(key)
      }
    }
  })

  ipcMain.handle('runtime:request:cancel', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'runtime:request:cancel',
      runtimeRequestCancelPayloadSchema,
      payload
    )
    const key = runtimeRequestKey(event.sender.id, request.requestId)
    const pending = runtimeRequestControllers.get(key)
    if (!pending) return false
    pending.controller.abort()
    runtimeRequestControllers.delete(key)
    return true
  })

  ipcMain.handle('gateway:credential', async (event, action: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    options.assertRendererRuntimeReady()
    if (!['status', 'ensure', 'copy', 'rotate', 'revoke'].includes(String(action))) {
      throw new Error('gateway:credential received an invalid action')
    }
    const paths = {
      status: ['/v1/model-gateway/credential/status', 'GET'],
      ensure: ['/v1/model-gateway/credential/ensure', 'POST'],
      copy: ['/v1/model-gateway/credential/reveal', 'POST'],
      rotate: ['/v1/model-gateway/credential/rotate', 'POST'],
      revoke: ['/v1/model-gateway/credential', 'DELETE']
    } as const
    const [path, method] = paths[action as keyof typeof paths]
    const response = await runtimeRequest(path, method)
    const parsed = JSON.parse(response.body) as {
      key?: string
      credential?: { configured?: boolean; createdAt?: string; rotatedAt?: string }
    }
    if (action === 'copy') {
      if (!response.ok || typeof parsed.key !== 'string') {
        return { ok: false, status: response.status, credential: { configured: false } }
      }
      clipboard.writeText(parsed.key)
      return { ok: true, status: response.status, copied: true, credential: { configured: true } }
    }
    const credential = parsed.credential ?? { configured: false }
    return {
      ok: response.ok,
      status: response.status,
      credential: {
        configured: credential.configured === true,
        ...(credential.createdAt ? { createdAt: credential.createdAt } : {}),
        ...(credential.rotatedAt ? { rotatedAt: credential.rotatedAt } : {})
      }
    }
  })

  ipcMain.handle('runtime:attachment:upload-image', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    options.assertRendererRuntimeReady()
    const request = parseIpcPayload(
      'runtime:attachment:upload-image',
      runtimeImageAttachmentUploadPayloadSchema,
      payload
    )
    return uploadRuntimeImageAttachment(request, { runtimeRequest })
  })

  ipcMain.handle('runtime:attachment:upload-document', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    options.assertRendererRuntimeReady()
    const request = parseIpcPayload(
      'runtime:attachment:upload-document',
      runtimeDocumentAttachmentUploadPayloadSchema,
      payload
    )
    return uploadRuntimeDocumentAttachment(request, { runtimeRequest })
  })

  ipcMain.handle('approval:decide', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    options.assertRendererRuntimeReady()
    const request = parseIpcPayload(
      'approval:decide',
      kunProtectedApprovalPayloadSchema,
      payload
    )
    if (request.source === 'user') {
      const parent = getMainWindow()
      if (!parent || parent.isDestroyed()) throw new Error('Protected approval window is unavailable.')
      const allow = request.decision === 'allow'
      const approvalRef = approvalLogReference(request.approvalId)
      const startedAt = Date.now()
      let confirmation: Electron.MessageBoxReturnValue
      try {
        confirmation = await nativeDialogs.run(parent.webContents, async () => {
          if (parent.isDestroyed()) {
            throw new Error('Protected approval window was closed before confirmation.')
          }
          const windowBeforeReveal = dialogParentState(parent)
          revealDialogParent(parent)
          logInfoHandler('approval', 'Opening protected native approval dialog.', {
            approvalRef,
            decision: request.decision,
            platform: process.platform,
            windowBeforeReveal,
            windowAfterReveal: dialogParentState(parent)
          })
          return dialog.showMessageBox(parent, {
            type: 'warning',
            title: allow ? 'Approve tool action' : 'Deny tool action',
            message: allow
              ? 'Allow this pending Kun tool action once?'
              : 'Deny this pending Kun tool action?',
            detail: `Approval reference: ${approvalRef}\n\nThis protected native prompt cannot be controlled by extension Webviews or Direct DOM content scripts.`,
            buttons: [allow ? 'Allow once' : 'Deny', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            normalizeAccessKeys: true
          })
        })
      } catch (error) {
        logError('approval', 'Protected native approval dialog failed.', {
          approvalRef,
          decision: request.decision,
          durationMs: Date.now() - startedAt,
          platform: process.platform,
          window: dialogParentState(parent),
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
      logInfoHandler('approval', 'Protected native approval dialog resolved.', {
        approvalRef,
        decision: request.decision,
        response: confirmation.response,
        confirmed: confirmation.response === 0,
        durationMs: Date.now() - startedAt,
        platform: process.platform,
        window: dialogParentState(parent)
      })
      if (confirmation.response !== 0) return { confirmed: false as const }
      if (!dialogParentIsAvailable(parent) || !trustedWorkbenchSenderIsCurrent(event, parent)) {
        logInfoHandler('approval', 'Protected native approval confirmation was not submitted.', {
          approvalRef,
          decision: request.decision,
          reason: 'parent_or_sender_unavailable_after_confirmation',
          platform: process.platform,
          window: dialogParentState(parent)
        })
        return { confirmed: false as const }
      }
    }

    let lease: ProtectedRuntimeRequestLease
    try {
      lease = await acquireRuntimeRequestLease()
    } catch (error) {
      logError('approval', 'Protected approval Runtime lease acquisition failed.', {
        approvalRef: approvalLogReference(request.approvalId),
        decision: request.decision,
        errorType: error instanceof Error ? error.name : typeof error
      })
      return {
        confirmed: true as const,
        response: {
          ok: false,
          status: 0,
          body: JSON.stringify({
            code: 'runtime_unhealthy',
            message: 'Kun Runtime is unavailable. Retry after it finishes starting.'
          })
        }
      }
    }
    const parent = getMainWindow()
    if (!parent || !dialogParentIsAvailable(parent) || !trustedWorkbenchSenderIsCurrent(event, parent)) {
      logInfoHandler('approval', 'Protected native approval confirmation was not submitted.', {
        approvalRef: approvalLogReference(request.approvalId),
        decision: request.decision,
        reason: 'parent_or_sender_unavailable_after_runtime_ensure',
        platform: process.platform,
        ...(parent ? { window: dialogParentState(parent) } : {})
      })
      return { confirmed: false as const }
    }
    const consentToken = createApprovalConsentToken({
      runtimeToken: lease.runtimeToken,
      approvalId: request.approvalId,
      decision: request.decision,
      expiresAt: Date.now() + 30_000
    })
    const response = await lease.request(
      `/v1/approvals/${encodeURIComponent(request.approvalId)}`,
      'POST',
      JSON.stringify({ decision: request.decision }),
      { [KUN_APPROVAL_CONSENT_HEADER]: consentToken }
    )
    return { confirmed: true as const, response }
  })

  ipcMain.handle('runtime:restart', async (event) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    options.assertRendererRuntimeReady()
    return restartRuntime()
  })
  ipcMain.handle('runtime:restart-serve', async (event): Promise<{ accepted: boolean; error?: string }> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    options.assertRendererRuntimeReady()
    const parent = getMainWindow()
    if (!parent || parent.isDestroyed()) throw new Error('Kun restart window is unavailable.')
    const chinese = app.getLocale?.().toLowerCase().startsWith('zh') === true
    const confirmation = await showMainWindowMessageBox(parent, {
      type: 'warning',
      title: chinese ? '重启桌面 Runtime' : 'Restart desktop Runtime',
      message: chinese
        ? '停止并重新启动当前桌面应用拥有的 Runtime？'
        : 'Stop and restart the Runtime owned by this desktop app?',
      detail: chinese
        ? [
            '只会重启当前桌面应用拥有的 Kun Runtime；不会扫描或停止 TUI、其他数据目录的 Runtime 或 Kun Service Manager。',
            '运行中的 Agent 任务、工具调用、后台任务和待审批操作可能中断。已经开始的工作区修改会原样保留，可能处于未完成状态。',
            '已保存的会话和对话记录、记忆、归档、设置、日志及工作区文件不会被删除。'
          ].join('\n\n')
        : [
            'Only the Kun Runtime owned by this desktop app will restart. TUI processes, Runtimes for other data directories, and Kun Service Manager will not be scanned or stopped.',
            'Running Agent tasks, tool calls, background work, and pending approvals may be interrupted. Workspace changes already in progress will remain and may be incomplete.',
            'Saved sessions and conversations, memory, archives, settings, logs, and workspace files will not be deleted.'
          ].join('\n\n'),
      buttons: chinese ? ['重启桌面 Runtime', '取消'] : ['Restart desktop Runtime', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      normalizeAccessKeys: true
    })
    if (confirmation.response !== 0) return { accepted: false }
    try {
      await restartKunServe()
      return { accepted: true }
    } catch (error) {
      logError('runtime-restart-serve', 'Failed to restart the GUI-owned Kun Runtime', {
        message: error instanceof Error ? error.message : String(error)
      })
      await showMainWindowMessageBox(parent, {
        type: 'error',
        title: chinese ? 'Kun 重启失败' : 'Kun restart failed',
        message: chinese
          ? '桌面 Runtime 未能完成重启。'
          : 'The desktop Runtime could not finish restarting.',
        detail: chinese
          ? '原桌面 Runtime 可能已经停止。已保存的数据未被删除；请查看日志后重试。'
          : 'The previous desktop Runtime may already have stopped. Saved data was not deleted; check the logs and retry.',
        buttons: [chinese ? '知道了' : 'OK'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return {
        accepted: true,
        error: chinese ? '重启失败，请查看日志后重试。' : 'Restart failed. Check the logs and retry.'
      }
    }
  })
  ipcMain.handle('runtime:settings-sync-status:get', () => getRuntimeSettingsSyncStatus())

}
