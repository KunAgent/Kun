import {
  ipcMain,
  shell
} from 'electron'
import {
  resolve
} from 'node:path'
import {
  z
} from 'zod'
import {
  type ClawTaskFromTextResult,
  type ClawRuntimeStatus,
  type DaemonActionResult,
  type DaemonLogPage,
  type DaemonRuntimeStatus,
  type ScheduleRunResult,
  type ScheduleRuntimeStatus,
  type ScheduleTaskCreateInput,
  type ScheduleTaskDeleteResult,
  type ScheduleTaskMutationResult,
  type ScheduleTaskUpdateInput,
  type ScheduleTaskFromTextResult,
  resolveProviderProxyUrl,
  type WorkflowCodeCheckResult,
  type WorkflowNodeTestResult,
  type WorkflowRunResult,
  type WorkflowRuntimeStatus
} from '../../shared/app-settings'
import {
  clawMirrorPayloadSchema,
  clawImInstallPollPayloadSchema,
  clawImTelegramTokenPayloadSchema,
  clawTaskFromTextPayloadSchema,
  modelsDevCatalogPayloadSchema,
  providerProbePayloadSchema,
  promptOptimizationPayloadSchema,
  scheduleTaskCreatePayloadSchema,
  scheduleTaskUpdatePayloadSchema,
  scheduleTaskFromTextPayloadSchema,
  streamIdSchema,
  daemonLogsPayloadSchema,
  workflowRunNodePayloadSchema,
  workflowTestNodePayloadSchema,
  workflowResolveApprovalPayloadSchema,
  workflowCodeCheckPayloadSchema
} from './app-ipc-schemas'
import {
  probeModelProvider
} from '../provider-connection'
import {
  importExternalProvider,
  scanExternalProviders,
  withRegistryCredentials as withRegistryCredentialFingerprints
} from '../provider-external-import'
import {
  commitProviderImportLink,
  stageProviderImportLink
} from '../provider-import-link'
import {
  importProviderIcon,
  providerIconDataUrl,
  pruneProviderIcons
} from '../provider-icons'
import { getModelProviderSettings } from '../../shared/app-settings'
import type { ModelProviderProfileV1 } from '../../shared/app-settings'
import {
  requestRuntimeProviderQuotas
} from '../runtime-provider-quota'
import {
  fetchModelsDevCatalog
} from '../models-dev-catalog'
import {
  verifyTelegramBotToken
} from '../telegram-runtime'
import {
  startCodexDeviceAuth,
  pollCodexDeviceAuth,
  startCodexBrowserAuth
} from '../codex-auth'
import {
  startGrokBrowserAuth,
  submitGrokBrowserAuthCode,
  cancelGrokBrowserAuth
} from '../grok-auth'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import {
  checkWorkflowCode
} from '../workflow-runtime'
import {
  optimizePrompt
} from '../services/prompt-optimization-service'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'

export function registerAppRuntimeIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const {
    store,
    getMainWindow,
    runtimeRequest,
    fetchUpstreamModels,
    getClawRuntime,
    getScheduleRuntime,
    getDaemonRuntime,
    getWorkflowRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    startWeixinInstallQrcode,
    pollWeixinInstall
  } = options
  const withRegistryCredentials = options.withRegistryCredentials ?? (async (settings) => settings)
  const scheduleRuntime = getScheduleRuntime()
  if (typeof scheduleRuntime?.subscribeStatus === 'function') {
    scheduleRuntime.subscribeStatus((status) => {
      const window = getMainWindow()
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
      window.webContents.send('schedule:status-changed', status)
    })
  }
  const authProxySelectionSchema = z.object({
    providerId: z.string().trim().min(1),
    useProxy: z.boolean()
  }).strict()
  const resolveAuthProxyUrl = async (payload: unknown): Promise<string> => {
    const selection = parseIpcPayload('provider:auth-proxy', authProxySelectionSchema, payload)
    return resolveProviderProxyUrl(await store.load(), {
      id: selection.providerId,
      kind: 'http',
      useProxy: selection.useProxy
    })
  }
  ipcMain.handle('upstream:models', async () => fetchUpstreamModels())

  ipcMain.handle('provider:probe', async (_, payload: unknown) => {
    const request = parseIpcPayload('provider:probe', providerProbePayloadSchema, payload)
    return probeModelProvider(request, await store.load())
  })

  // Protocol detection for the custom-provider flow is a Kun route; forward
  // the draft verbatim (the optional credential is user input, not a stored
  // key) and return the sanitized JSON result.
  const detectProtocolPayloadSchema = z.object({
    baseUrl: z.string().url().max(2_048),
    credential: z.string().max(64 * 1024).optional(),
    customHeaders: z.record(z.string().min(1).max(128), z.string().max(8 * 1024)).optional(),
    verifyModel: z.string().min(1).max(512).optional(),
    useProxy: z.boolean().optional()
  }).strict()
  ipcMain.handle('provider:detect-protocol', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload('provider:detect-protocol', detectProtocolPayloadSchema, payload)
    const response = await runtimeRequest(
      '/v1/model-connections/detect-protocol',
      'POST',
      JSON.stringify(request)
    )
    let body: unknown
    try {
      body = JSON.parse(response.body)
    } catch {
      throw new Error('Kun returned malformed protocol detection data.')
    }
    if (!response.ok) {
      const message = body && typeof body === 'object' && !Array.isArray(body)
        ? ((body as Record<string, unknown>).message ?? (body as Record<string, unknown>).error)
        : undefined
      throw new Error(
        typeof message === 'string' && message.trim()
          ? message
          : `Kun protocol detection failed (HTTP ${response.status}).`
      )
    }
    return body
  })

  const quotaListPayloadSchema = z.object({
    forceRefresh: z.boolean().optional()
  }).strict().optional()
  ipcMain.handle('provider:quota:list', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    options.assertRendererRuntimeReady()
    const request = parseIpcPayload('provider:quota:list', quotaListPayloadSchema, payload)
    return requestRuntimeProviderQuotas(runtimeRequest, request?.forceRefresh === true)
  })

  ipcMain.handle('provider:models-dev-catalog', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'provider:models-dev-catalog',
      modelsDevCatalogPayloadSchema,
      payload
    )
    return fetchModelsDevCatalog(request, await store.load())
  })

  const externalImportPayloadSchema = z.object({
    source: z.enum(['cc-switch', 'claude-code', 'codex', 'opencode']),
    ref: z.string().min(1).max(512),
    name: z.string().trim().max(80).optional()
  }).strict()

  // Read-only scan of other tools' config. Credentials never leave the main
  // process: results carry hasKey/masked hints, and the commit step re-reads
  // the source file itself.
  ipcMain.handle('provider:external-scan', async (event) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const settings = await store.load()
    return withRegistryCredentialFingerprints(runtimeRequest, (credentialFingerprints) =>
      scanExternalProviders(settings, { credentialFingerprints }))
  })

  const appendProviderProfile = async (profile: ModelProviderProfileV1): Promise<void> => {
    await store.update((current) => {
      const providerSettings = getModelProviderSettings(current)
      return {
        ...current,
        provider: {
          ...providerSettings,
          providers: [...providerSettings.providers, profile]
        }
      }
    })
  }

  ipcMain.handle('provider:external-import', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'provider:external-import',
      externalImportPayloadSchema,
      payload
    )
    const result = importExternalProvider(await store.load(), request)
    if (!result.ok) return { ok: false, message: result.message }
    await appendProviderProfile(result.profile)
    return { ok: true, providerId: result.providerId }
  })

  // kun://import paste fallback. The staged key stays main-side; the renderer
  // only sees the sanitized draft + token until it commits.
  ipcMain.handle('provider:import-link:stage', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'provider:import-link:stage',
      z.object({ link: z.string().min(8).max(8192) }).strict(),
      payload
    )
    return stageProviderImportLink(request.link)
  })

  ipcMain.handle('provider:import-link:commit', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'provider:import-link:commit',
      z.object({ token: z.string().min(1).max(64) }).strict(),
      payload
    )
    const result = commitProviderImportLink(request.token, await store.load())
    if (!result.ok) return { ok: false, message: result.message }
    await appendProviderProfile(result.profile)
    return { ok: true, providerId: result.profile.id }
  })

  ipcMain.handle('provider:icon:import', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'provider:icon:import',
      z.object({
        mime: z.string().min(1).max(64),
        dataBase64: z.string().min(1).max(1_500_000)
      }).strict(),
      payload
    )
    const result = await importProviderIcon(request)
    if (result.ok) void pruneProviderIcons(await store.load()).catch(() => undefined)
    return result
  })

  ipcMain.handle('provider:icon:data', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'provider:icon:data',
      z.object({ iconId: z.string().min(1).max(128) }).strict(),
      payload
    )
    return { dataUrl: await providerIconDataUrl(request.iconId) }
  })

  ipcMain.handle('prompt:optimize', async (_, payload: unknown) => {
    const request = parseIpcPayload('prompt:optimize', promptOptimizationPayloadSchema, payload)
    return optimizePrompt(await withRegistryCredentials(await store.load()), request.text)
  })

  ipcMain.handle('claw:status', async (): Promise<ClawRuntimeStatus> =>
    getClawRuntime()?.status() ?? {
      imServerRunning: false,
      imUrl: '',
      runningTaskIds: []
    }
  )

  ipcMain.handle('claw:task:run', async (_, taskId: unknown): Promise<ScheduleRunResult> => {
    options.assertRendererRuntimeReady()
    const normalizedTaskId = parseIpcPayload('claw:task:run', streamIdSchema, taskId)
    const scheduleRuntime = getScheduleRuntime()
    if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
    return scheduleRuntime.runTask(normalizedTaskId)
  })

  ipcMain.handle('schedule:status', async (): Promise<ScheduleRuntimeStatus> =>
    getScheduleRuntime()?.status() ?? {
      internalServerRunning: false,
      internalUrl: '',
      runningTaskIds: [],
      queuedTaskIds: [],
      boundThreadTasks: [],
      powerSaveBlockerActive: false
    }
  )

  ipcMain.handle('schedule:task:create', async (_, payload: unknown): Promise<ScheduleTaskMutationResult> => {
    try {
      const input = parseIpcPayload('schedule:task:create', scheduleTaskCreatePayloadSchema, payload) as ScheduleTaskCreateInput
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
      const task = await scheduleRuntime.createTaskFromInput(input)
      return { ok: true, task }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('schedule:task:update', async (_, payload: unknown): Promise<ScheduleTaskMutationResult> => {
    try {
      const input = parseIpcPayload('schedule:task:update', scheduleTaskUpdatePayloadSchema, payload) as ScheduleTaskUpdateInput
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
      const task = await scheduleRuntime.updateTaskById(input.taskId, {
        providerId: input.providerId,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        schedule: input.schedule
      })
      return task ? { ok: true, task } : { ok: false, message: 'Scheduled task was not found.' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('schedule:task:delete', async (_, taskId: unknown): Promise<ScheduleTaskDeleteResult> => {
    try {
      const normalizedTaskId = parseIpcPayload('schedule:task:delete', streamIdSchema, taskId)
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
      return await scheduleRuntime.deleteTaskById(normalizedTaskId)
        ? { ok: true }
        : { ok: false, message: 'Scheduled task was not found.' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('schedule:task:run', async (_, taskId: unknown): Promise<ScheduleRunResult> => {
    options.assertRendererRuntimeReady()
    const normalizedTaskId = parseIpcPayload('schedule:task:run', streamIdSchema, taskId)
    const scheduleRuntime = getScheduleRuntime()
    if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
    return scheduleRuntime.runTask(normalizedTaskId)
  })

  ipcMain.handle('daemon:status', async (): Promise<DaemonRuntimeStatus> =>
    getDaemonRuntime()?.status() ?? {
      items: [],
      powerSaveBlockerActive: false
    }
  )

  ipcMain.handle('daemon:restart', async (_, payload: unknown): Promise<DaemonActionResult> => {
    options.assertRendererRuntimeReady()
    const daemonId = parseIpcPayload('daemon:restart', streamIdSchema, payload)
    const daemonRuntime = getDaemonRuntime()
    if (!daemonRuntime) return { ok: false, message: 'Daemon runtime is not initialized.' }
    return daemonRuntime.restart(daemonId)
  })

  ipcMain.handle('daemon:logs', async (_, payload: unknown): Promise<DaemonLogPage> => {
    const request = parseIpcPayload('daemon:logs', daemonLogsPayloadSchema, payload)
    const daemonRuntime = getDaemonRuntime()
    if (!daemonRuntime) return { lines: [], eof: true }
    return daemonRuntime.readLogs(request.id, { cursor: request.cursor, limit: request.limit })
  })

  ipcMain.handle('workflow:status', async (): Promise<WorkflowRuntimeStatus> =>
    getWorkflowRuntime()?.status() ?? {
      runningWorkflowIds: [],
      nodeStatus: {},
      nodeResults: {},
      powerSaveBlockerActive: false,
      pendingApprovals: []
    }
  )

  ipcMain.handle('workflow:run', async (_, workflowId: unknown, input?: unknown): Promise<WorkflowRunResult> => {
    options.assertRendererRuntimeReady()
    const normalizedId = parseIpcPayload('workflow:run', streamIdSchema, workflowId)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    // input is validated/coerced against the trigger's input schema inside runWorkflow.
    return workflowRuntime.runWorkflow(normalizedId, input)
  })

  ipcMain.handle('workflow:stop', async (_, workflowId: unknown): Promise<WorkflowRunResult> => {
    const normalizedId = parseIpcPayload('workflow:stop', streamIdSchema, workflowId)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.stopWorkflow(normalizedId)
  })

  ipcMain.handle('workflow:node:run', async (_, payload: unknown): Promise<WorkflowRunResult> => {
    options.assertRendererRuntimeReady()
    const request = parseIpcPayload('workflow:node:run', workflowRunNodePayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.runSingleNode(request.workflowId, request.nodeId)
  })

  ipcMain.handle('workflow:node:test', async (_, payload: unknown): Promise<WorkflowNodeTestResult> => {
    const request = parseIpcPayload('workflow:node:test', workflowTestNodePayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.testNode(request.workflowId, request.nodeId, request.mockJson)
  })

  ipcMain.handle('workflow:approval:resolve', async (_, payload: unknown): Promise<{ ok: boolean }> => {
    options.assertRendererRuntimeReady()
    const request = parseIpcPayload('workflow:approval:resolve', workflowResolveApprovalPayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false }
    return { ok: workflowRuntime.resolveApproval(request.token, request.decision) }
  })

  ipcMain.handle('workflow:code:check', async (_, payload: unknown): Promise<WorkflowCodeCheckResult> => {
    const request = parseIpcPayload('workflow:code:check', workflowCodeCheckPayloadSchema, payload)
    return checkWorkflowCode(request.language, request.code)
  })

  ipcMain.handle(
    'claw:channel:mirror',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:channel:mirror', clawMirrorPayloadSchema, payload)
      const clawRuntime = getClawRuntime()
      if (!clawRuntime) return { ok: false as const, message: 'Claw runtime is not initialized.' }
      return clawRuntime.mirrorThreadMessageToIm(
        request.threadId,
        request.text,
        request.direction
      )
    }
  )

  ipcMain.handle(
    'claw:channel:mirror-to-feishu',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:channel:mirror-to-feishu', clawMirrorPayloadSchema, payload)
      const clawRuntime = getClawRuntime()
      if (!clawRuntime) return { ok: false as const, message: 'Claw runtime is not initialized.' }
      return clawRuntime.mirrorThreadMessageToIm(
        request.threadId,
        request.text,
        request.direction
      )
    }
  )

  ipcMain.handle(
    'claw:task:create-from-text',
    async (_, payload: unknown): Promise<ClawTaskFromTextResult> => {
      const request = parseIpcPayload(
        'claw:task:create-from-text',
        clawTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      const settings = await store.load()
      const channel = request.channelId
        ? settings.claw.channels.find((item) => item.id === request.channelId)
        : undefined
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: channel?.workspaceRoot || settings.schedule.defaultWorkspaceRoot || settings.workspaceRoot,
        clawChannelId: channel?.id ?? request.channelId,
        providerId: request.providerId,
        modelHint: request.modelHint,
        reasoningEffort: request.reasoningEffort,
        mode: request.mode
      })
    }
  )

  ipcMain.handle(
    'schedule:task:create-from-text',
    async (_, payload: unknown): Promise<ScheduleTaskFromTextResult> => {
      const request = parseIpcPayload(
        'schedule:task:create-from-text',
        scheduleTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: request.workspaceRoot,
        clawChannelId: request.clawChannelId,
        providerId: request.providerId,
        modelHint: request.modelHint,
        reasoningEffort: request.reasoningEffort,
        mode: request.mode
      })
    }
  )

  ipcMain.handle(
    'claw:im-install:qrcode',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'claw:im-install:qrcode',
        z.object({ provider: z.enum(['feishu', 'weixin']), isLark: z.boolean().optional() }).strict(),
        payload
      )
      if (request.provider === 'weixin') {
        return startWeixinInstallQrcode()
      }
      return startFeishuInstallQrcode(request.isLark === true)
    }
  )

  ipcMain.handle(
    'claw:im-install:poll',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:im-install:poll', clawImInstallPollPayloadSchema, payload)
      if (request.provider === 'weixin') {
        return pollWeixinInstall(request.deviceCode)
      }
      return pollFeishuInstall(request.deviceCode)
    }
  )

  ipcMain.handle(
    'claw:im-install:telegram-token',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'claw:im-install:telegram-token',
        clawImTelegramTokenPayloadSchema,
        payload
      )
      return verifyTelegramBotToken(request.botToken, request.proxy)
    }
  )

  ipcMain.handle('codex:auth:start', async (_, payload: unknown) => {
    const proxyUrl = await resolveAuthProxyUrl(payload)
    return startCodexDeviceAuth({ fetcher: fetchWithOptionalProxy, proxyUrl })
  })

  ipcMain.handle('codex:auth:poll', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'codex:auth:poll',
      z.object({
        deviceCode: z.string().min(1),
        userCode: z.string().min(1),
        providerId: z.string().trim().min(1),
        useProxy: z.boolean()
      }).strict(),
      payload
    )
    const proxyUrl = await resolveAuthProxyUrl({
      providerId: request.providerId,
      useProxy: request.useProxy
    })
    return pollCodexDeviceAuth(request.deviceCode, request.userCode, {
      fetcher: fetchWithOptionalProxy,
      proxyUrl
    })
  })

  ipcMain.handle('codex:auth:browser', async (_, payload: unknown) => {
    const proxyUrl = await resolveAuthProxyUrl(payload)
    return startCodexBrowserAuth(async (url: string) => {
      await shell.openExternal(url)
    }, { fetcher: fetchWithOptionalProxy, proxyUrl })
  })

  ipcMain.handle('grok:auth:browser', async (_, payload: unknown) => {
    const proxyUrl = await resolveAuthProxyUrl(payload)
    const result = await startGrokBrowserAuth(async (url: string) => {
      await shell.openExternal(url)
    }, { fetcher: fetchWithOptionalProxy, proxyUrl })
    if (!result.ok) {
      options.logError('grok-auth', 'Grok browser authentication failed.', {
        code: result.code ?? 'unknown',
        platform: process.platform,
        proxyEnabled: Boolean(proxyUrl),
        message: result.message
      })
    }
    return result
  })

  ipcMain.handle('grok:auth:browser:paste', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'grok:auth:browser:paste',
      z.object({ code: z.string().min(1) }).strict(),
      payload
    )
    return submitGrokBrowserAuthCode(request.code)
  })

  ipcMain.handle('grok:auth:browser:cancel', async () => {
    cancelGrokBrowserAuth()
    return { ok: true as const }
  })

}
