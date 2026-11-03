import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { URL } from 'node:url'
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { AppSettingsV1 } from '../shared/app-settings'
import {
  IM_COMPLETED_NO_TEXT_REPLY,
  IM_PROCESSING_ACK,
  extractIncomingChannelId,
  extractIncomingPrompt,
  extractIncomingProvider,
  extractIncomingRemoteSession,
  extractSenderLabel,
  parseJsonObject,
  readRequestBody,
  shouldSendGeneratedFilesForPrompt,
  writeJson,
  type ClawRuntimeDeps
} from './claw-runtime-helpers'
import { currentImModelResolution, imKunErrorText } from './claw-im-model-support'
import { ClawRuntimeInbound } from './claw-runtime-inbound'
import type { TelegramInboundPayload } from './telegram-runtime'
import { handleTelegramInbound } from './telegram-inbound-coordinator'
import { handleFeishuInbound } from './feishu-inbound-coordinator'
import { describeLocalListenError } from './local-listen-error'

export { imWelcomeText } from './claw-im-model-support'

export class ClawRuntime extends ClawRuntimeInbound {
  async mirrorThreadMessageToIm(
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: 'Message is empty.' }
    const settings = await this.deps.store.load()
    const target = this.findImChannelForThread(settings, threadId)
    if (!target) return { ok: false, message: 'Channel not found.' }
    return this.imTransport.mirror({
      channel: target.channel,
      conversation: target.conversation,
      threadId,
      text: trimmed,
      direction
    })
  }
  async mirrorThreadMessageToFeishu(
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    return this.mirrorThreadMessageToIm(threadId, text, direction)
  }

  /**
   * Entry point for inbound Telegram updates. The {@link TelegramRuntime}
   * long-poll loop calls this with a normalized payload per private-chat
   * message. Mirrors {@link handleFeishuMessage}: welcome, slash commands,
   * scheduled-task detection, then the regular agent turn — but adapts to
   * Telegram's chat-id/message-id scheme and image attachments.
   */
  async handleTelegramUpdate(payload: TelegramInboundPayload): Promise<void> {
    return handleTelegramInbound(payload, {
      loadSettings: () => this.deps.store.load(),
      telegramRuntime: this.deps.telegramRuntime,
      resolveIncomingWorkspaceRoot: (settings, channel, conversation, remoteSession) =>
        this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession),
      resolveChannelWorkspaceRoot: (settings, channel) =>
        this.resolveChannelWorkspaceRoot(settings, channel),
      pendingWelcomeText: (settings, channel) => this.pendingWelcomeText(settings, channel),
      beginWelcome: (channelId) => {
        this.welcomeInFlight.add(channelId)
      },
      endWelcome: (channelId) => {
        this.welcomeInFlight.delete(channelId)
      },
      markWelcomeSent: (channelId) => this.markChannelWelcomeSent(channelId),
      handleCommand: (settings, input) => this.handleIncomingImCommandSafely(settings, input),
      resolveModel: (settings, channel, conversation) => {
        const resolution = currentImModelResolution(settings, channel, conversation)
        return { providerId: resolution.provider.id, model: resolution.model }
      },
      createScheduledTaskFromText: this.deps.createScheduledTaskFromText,
      processPrompt: (settings, input) => this.processIncomingImPrompt(settings, input),
      scheduleResultPush: (settings, input) => this.scheduleImResultPush(settings, input),
      resolveGeneratedFiles: (files, workspaceRoot, context) =>
        this.resolveImGeneratedFiles(files, workspaceRoot, context),
      formatError: imKunErrorText,
      logError: this.deps.logError
    })
  }

  protected handleFeishuMessage(channelId: string, message: NormalizedMessage): Promise<void> {
    return handleFeishuInbound(channelId, message, {
      getBridge: (id) => this.feishuTransport.get(id),
      loadSettings: () => this.deps.store.load(),
      rememberRemoteSession: (settings, channel, remoteSession) =>
        this.rememberImRemoteSession(settings, channel, remoteSession),
      resolveIncomingWorkspaceRoot: (settings, channel, conversation, remoteSession) =>
        this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession),
      resolveChannelWorkspaceRoot: (settings, channel) =>
        this.resolveChannelWorkspaceRoot(settings, channel),
      pendingWelcomeText: (settings, channel) => this.pendingWelcomeText(settings, channel),
      beginWelcome: (id) => {
        this.welcomeInFlight.add(id)
      },
      endWelcome: (id) => {
        this.welcomeInFlight.delete(id)
      },
      markWelcomeSent: (id) => this.markChannelWelcomeSent(id),
      sendMessage: (bridge, to, input, options, context) =>
        this.feishuTransport.send(bridge, to, input, options, context),
      sendGeneratedFiles: (bridge, to, files, options, context) =>
        this.feishuTransport.sendFilesWithBridge(bridge, to, files, context, options),
      handleCommand: (settings, input) => this.handleIncomingImCommandSafely(settings, input),
      resolveModel: (settings, channel, conversation) => {
        const resolution = currentImModelResolution(settings, channel, conversation)
        return { providerId: resolution.provider.id, model: resolution.model }
      },
      createScheduledTaskFromText: this.deps.createScheduledTaskFromText,
      formatError: imKunErrorText,
      resolveGeneratedFiles: (files, workspaceRoot, context) =>
        this.resolveImGeneratedFiles(files, workspaceRoot, context),
      recentGeneratedFiles: (settings, threadId, workspaceRoot, context, turnId) =>
        this.recentGeneratedFilesForThread(settings, threadId, workspaceRoot, context, turnId),
      processPrompt: (settings, input) => this.processIncomingImPrompt(settings, input),
      runStreamingReply: (input) => this.runStreamingReply(input),
      scheduleResultPush: (settings, input) => this.scheduleImResultPush(settings, input),
      logError: this.deps.logError
    })
  }


  protected syncWebhook(settings: AppSettingsV1): void {
    const im = settings.claw.im
    // A disabled webhook answers every request with 503, so it does not need its port at all.
    if (!settings.claw.enabled || !im.enabled) {
      void this.closeWebhook()
      return
    }
    const key = `${im.port}|${im.path}`
    if (this.server && this.serverKey === key) return
    void this.closeWebhook()

    const server = createServer((req, res) => {
      this.trackLifecycleTask('Claw webhook handler failed', this.handleWebhook(req, res))
    })
    server.on('error', (error) => {
      this.deps.logError('claw-webhook', 'Claw IM webhook server failed', describeLocalListenError(error, im.port, 'Settings > IM'))
      if (this.server === server) {
        void this.closeWebhook()
      }
    })
    server.listen(im.port, '127.0.0.1')
    this.server = server
    this.serverKey = key
  }

  protected closeWebhook(forceConnections = false): Promise<void> {
    if (!this.server) return Promise.resolve()
    const server = this.server
    this.server = null
    this.serverKey = ''
    const task = new Promise<void>((resolve) => {
      try {
        server.close(() => resolve())
        if (forceConnections) server.closeAllConnections?.()
      } catch {
        resolve()
      }
    })
    this.webhookCloseTasks.add(task)
    void task.finally(() => this.webhookCloseTasks.delete(task))
    return task
  }

  protected async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (this.stopController.signal.aborted) {
        writeJson(res, 503, { ok: false, message: 'Kun: Claw runtime is stopping.' })
        return
      }
      const settings = await this.deps.store.load()
      const im = settings.claw.im
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/claw/internal/gui-plan/create' && req.method === 'POST') {
        // The legacy `gui_plan_create` MCP bridge is no longer the
        // active plan path. GUI plan creation now flows through the
        // native Kun `create_plan` tool. Reject legacy calls
        // loudly so older clients see a clear migration error.
        writeJson(res, 410, {
          ok: false,
          code: 'gui_plan_create_retired',
          message:
            'Kun: The /claw/internal/gui-plan/create endpoint is no longer active. Use the Kun create_plan tool.'
        })
        return
      }
      if (req.method !== 'POST' || url.pathname !== im.path) {
        writeJson(res, 404, { ok: false, message: 'Kun: Not found.' })
        return
      }
      if (!settings.claw.enabled || !im.enabled) {
        writeJson(res, 503, { ok: false, message: 'Kun: Claw IM webhook is disabled.' })
        return
      }
      if (im.secret) {
        const auth = req.headers.authorization ?? ''
        // 新名字 x-kun-secret 优先;旧名字 x-deepseek-gui-secret 已配置
        // 在外部系统里,属于对外契约,必须长期兼容。
        const rawHeaderSecret = req.headers['x-kun-secret'] ?? req.headers['x-deepseek-gui-secret']
        const headerSecret = Array.isArray(rawHeaderSecret) ? rawHeaderSecret[0] : rawHeaderSecret
        if (auth !== `Bearer ${im.secret}` && headerSecret !== im.secret) {
          writeJson(res, 401, { ok: false, message: 'Kun: Unauthorized.' })
          return
        }
      }

      const body = await readRequestBody(req)
      const payload = parseJsonObject(body)
      if (!payload) {
        writeJson(res, 400, { ok: false, message: 'Kun: Expected a JSON object.' })
        return
      }
      const prompt = extractIncomingPrompt(payload)
      if (!prompt) {
        writeJson(res, 400, { ok: false, message: 'Kun: No message text found.' })
        return
      }
      const sender = extractSenderLabel(payload)
      const provider = extractIncomingProvider(payload, im.provider)
      const incomingChannelId = extractIncomingChannelId(payload)
      const channel = incomingChannelId
        ? settings.claw.channels.find(
            (item) => item.enabled && item.id === incomingChannelId
          ) ?? settings.claw.channels.find(
            (item) => item.enabled && item.provider === provider
          )
        : settings.claw.channels.find(
            (item) => item.enabled && item.provider === provider
          )
      const remoteSession = extractIncomingRemoteSession(payload) ??
        this.imTransport.legacyRemoteSession(provider, payload, sender)
      if (channel && remoteSession) await this.rememberImRemoteSession(settings, channel, remoteSession)
      const conversation =
        channel && remoteSession
          ? this.findChannelConversation(channel, {
              chatId: remoteSession.chatId,
              threadId: remoteSession.threadId
            })
          : undefined
      // First inbound message on a freshly connected channel: push the
      // intro over the WeChat bridge when possible (it lands before the
      // model reply), otherwise prepend it to this response.
      let welcomePrefix = ''
      const welcomeText = this.pendingWelcomeText(settings, channel)
      if (welcomeText && channel) {
        this.welcomeInFlight.add(channel.id)
        try {
          const pushed = await this.imTransport.pushWelcome({
            channel,
            remoteSession: remoteSession ?? undefined,
            text: welcomeText
          })
          if (!pushed) welcomePrefix = `${welcomeText}\n\n---\n\n`
          await this.markChannelWelcomeSent(channel.id)
        } finally {
          this.welcomeInFlight.delete(channel.id)
        }
      }
      const commandReply = await this.handleIncomingImCommandSafely(settings, {
        text: prompt,
        channel,
        conversation,
        remoteSession: remoteSession ?? undefined
      })
      if (commandReply !== null) {
        writeJson(res, 200, { ok: true, reply: `${welcomePrefix}${commandReply}` })
        return
      }
      const modelResolution = currentImModelResolution(settings, channel, conversation)
      const taskCreation = await this.deps.createScheduledTaskFromText?.(prompt, {
        workspaceRoot: this.resolveChannelWorkspaceRoot(settings, channel),
        clawChannelId: channel?.id ?? null,
        providerId: modelResolution.provider.id,
        modelHint: modelResolution.model,
        mode: im.mode
      }) ?? { kind: 'noop' as const }
      if (taskCreation.kind === 'created') {
        writeJson(res, 200, { ok: true, createdTaskId: taskCreation.taskId, reply: `${welcomePrefix}${taskCreation.confirmationText}` })
        return
      }
      if (taskCreation.kind === 'error') {
        const reply = imKunErrorText(settings, taskCreation.message)
        writeJson(res, 500, { ok: false, message: reply, reply })
        return
      }
      const result = await this.processIncomingImPrompt(settings, {
        prompt,
        sender,
        provider,
        channel,
        conversation,
        remoteSession: remoteSession ?? undefined
      })
      if (!result.ok) {
        writeJson(res, 500, {
          ...result,
          message: imKunErrorText(settings, result.message),
          reply: imKunErrorText(settings, result.message)
        })
        return
      }
      if (result.completed === false) {
        // The turn outran the response window. Ack now and push the real
        // result back when it finishes, instead of replying with whatever
        // intermediate text happened to exist at the timeout.
        this.scheduleImResultPush(settings, {
          channel,
          remoteSession: remoteSession ?? undefined,
          threadId: result.threadId,
          turnId: result.turnId,
          workspaceRoot: this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession ?? undefined)
        })
        writeJson(res, 200, {
          ok: true,
          threadId: result.threadId,
          turnId: result.turnId,
          reply: `${welcomePrefix}${IM_PROCESSING_ACK}`
        })
        return
      }
      // Current-turn deliverable media files ride along in the response so
      // push-capable bridges (WeChat) can upload them after the text reply.
      // The prompt heuristic remains as a fallback for explicit file-send
      // requests when the current run returns an empty list.
      const generatedFiles = result.files ?? []
      const files = generatedFiles.length > 0 || shouldSendGeneratedFilesForPrompt(prompt)
        ? await this.resolveImGeneratedFiles(
            generatedFiles,
            this.resolveIncomingWorkspaceRoot(settings, channel, conversation, remoteSession ?? undefined),
            {
              purpose: 'im-webhook-file-resolve',
              provider,
              channelId: channel?.id,
              threadId: result.threadId,
              turnId: result.turnId
            }
          )
        : []
      const replyBody = result.text?.trim() || result.message?.trim() || IM_COMPLETED_NO_TEXT_REPLY
      writeJson(res, 200, { ...result, files, reply: `${welcomePrefix}${replyBody}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('claw-webhook', 'Claw IM webhook request failed', { message })
      writeJson(res, 500, { ok: false, message: 'Kun: Internal server error.' })
    }
  }
}

export function createClawRuntime(deps: ClawRuntimeDeps): ClawRuntime {
  return new ClawRuntime(deps)
}
