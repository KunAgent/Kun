import type { LarkChannel } from '@larksuiteoapi/node-sdk'
import type {
  AppSettingsV1,
  ClawGeneratedFileV1,
  ClawImChannelV1,
  ClawImConversationV1,
  ClawImRemoteSessionV1,
  ClawRunResult
} from '../shared/app-settings'
import {
  DEFAULT_CLAW_MODEL,
  buildClawRuntimePrompt,
  parseClawUserPromptForDisplay
} from '../shared/app-settings'
import {
  IM_COMPLETED_NO_TEXT_REPLY,
  IM_PROCESSING_ACK,
  asString,
  createDeferredCloseHandle,
  finalAssistantReplyText,
  isRunningStatus,
  latestGeneratedFiles,
  nestedRecord,
  normalizeTaskModel,
  parseJsonObject,
  replyTextForGeneratedFiles,
  runtimeErrorMessage,
  sanitizePathSegment,
  sleep,
  subscribeRuntimeThreadEvents,
  type RunPromptOptions,
  type SseSubscriber,
  type ThreadDetailJson,
  type ThreadRecordJson
} from './claw-runtime-helpers'
import {
  buildImRuntimePrompt,
  effectiveImRuntimeModel,
  errorMessage,
  imRuntimeStartError,
  isMissingThreadResult,
  settingsWithImModelProvider
} from './claw-im-model-support'
import { getRuntimeBaseUrlForSettings, runtimeAuthHeaders } from './runtime/kun-adapter'
import { FeishuStreamer } from './feishu-streamer'
import { ClawRuntimeCore } from './claw-runtime-core'

const RESULT_PUSH_MAX_WAIT_MS = 30 * 60 * 1_000

export abstract class ClawRuntimePrompt extends ClawRuntimeCore {
  protected abstract resolveImGeneratedFiles(
    files: readonly ClawGeneratedFileV1[],
    workspaceRoot: string,
    context: Record<string, unknown>
  ): Promise<ClawGeneratedFileV1[]>
  protected async runPrompt(settings: AppSettingsV1, options: RunPromptOptions): Promise<ClawRunResult> {
    const workspace = options.workspaceRoot.trim() || settings.workspaceRoot
    const existingThreadId = options.threadId?.trim()
    const requestedModel = normalizeTaskModel(options.model) ?? (settings.agents.kun.model.trim() || DEFAULT_CLAW_MODEL)
    const runtimeSettings = settingsWithImModelProvider(settings, options.providerId, requestedModel)
    const model = effectiveImRuntimeModel(runtimeSettings, requestedModel)
    const createThread = async (): Promise<ThreadRecordJson | null> => {
      const body: Record<string, unknown> = { workspace, model, mode: options.mode }
      if (options.source === 'im') {
        body.approvalPolicy = runtimeSettings.agents.kun.approvalPolicy
        body.sandboxMode = runtimeSettings.agents.kun.sandboxMode
      }
      const create = await this.requestRuntime(runtimeSettings, '/v1/threads', {
        method: 'POST',
        body: JSON.stringify(body)
      })
      if (!create.ok) return null
      return JSON.parse(create.body) as ThreadRecordJson
    }
    const patchThreadTitle = (thread: ThreadRecordJson): void => {
      if (!options.title.trim()) return
      void this.requestRuntime(runtimeSettings, `/v1/threads/${encodeURIComponent(thread.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: options.title.trim() })
      }).catch((error) => {
        if (this.stopController.signal.aborted) return
        this.deps.logError('claw-runtime', 'Failed to update the IM thread title.', {
          threadId: thread.id,
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
    let thread: ThreadRecordJson | null = existingThreadId ? { id: existingThreadId } : await createThread()
    if (!thread) return { ok: false, message: 'Failed to create thread.' }
    if (!existingThreadId) patchThreadTitle(thread)

    const runtimePrompt = options.source === 'im'
      ? buildImRuntimePrompt(options.prompt)
      : buildClawRuntimePrompt(runtimeSettings, options.prompt, { channel: options.channel })
    const displayText = options.displayText?.trim() || parseClawUserPromptForDisplay(options.prompt).text
    const turnBody: Record<string, unknown> = {
      prompt: runtimePrompt,
      mode: options.mode
    }
    if (displayText && displayText !== runtimePrompt) turnBody.displayText = displayText
    if (model) turnBody.model = model
    // IM senders can only reply in their chat app; they cannot answer
    // GUI prompts, so the runtime must not expose user-input tools.
    // Permission fields are pure passthrough from the agent settings so
    // IM turns follow the same policy the user picked for the GUI.
    if (options.source === 'im') {
      turnBody.clientSurface = 'im'
      turnBody.disableUserInput = true
      turnBody.imContext = true
      turnBody.approvalPolicy = runtimeSettings.agents.kun.approvalPolicy
      turnBody.sandboxMode = runtimeSettings.agents.kun.sandboxMode
    }
    let turn = await this.startRuntimeTurn(runtimeSettings, thread.id, turnBody)
    if (!turn.ok && isMissingThreadResult(turn)) {
      const missingThreadId = thread.id
      this.deps.logError('claw-runtime', 'Configured IM thread was missing; creating a replacement thread.', {
        threadId: missingThreadId,
        channelId: options.channel?.id,
        source: options.source
      })
      thread = await createThread()
      if (!thread) return { ok: false, message: 'Failed to create thread.' }
      patchThreadTitle(thread)
      turn = await this.startRuntimeTurn(runtimeSettings, thread.id, turnBody)
    }
    if (!turn.ok) {
      return { ok: false, message: imRuntimeStartError(runtimeSettings, turn, 'Failed to start turn.') }
    }

    const parsedTurn = parseJsonObject(turn.body)
    const turnId = asString(parsedTurn?.turnId) || asString(nestedRecord(parsedTurn?.turn).id)
    if (!turnId) {
      return { ok: false, message: 'Failed to start turn: missing turn id.' }
    }
    if (turnId && options.onTurnStarted) {
      await options.onTurnStarted({ threadId: thread.id, turnId })
    }
    if (!options.waitForResult) {
      return { ok: true, threadId: thread.id, turnId, message: 'Started' }
    }

    const outcome = await this.waitForAssistantResult(
      runtimeSettings,
      thread.id,
      turnId,
      options.responseTimeoutMs,
      workspace
    )
    if (outcome.status === 'failed' || outcome.status === 'aborted') {
      return { ok: false, message: outcome.error || `Agent turn ${outcome.status}.` }
    }
    if (outcome.status === 'timeout') {
      // The turn outran the response window but keeps running in the
      // runtime. Ack now; the caller pushes the real result back when
      // the turn finishes (see `scheduleImResultPush`). Returning the
      // last-seen text here is what used to leak an intermediate plan.
      return {
        ok: true,
        threadId: thread.id,
        turnId,
        text: '',
        message: IM_PROCESSING_ACK,
        files: [],
        completed: false
      }
    }
    return {
      ok: true,
      threadId: thread.id,
      turnId,
      text: outcome.text,
      message: outcome.text || IM_COMPLETED_NO_TEXT_REPLY,
      files: outcome.files,
      completed: true
    }
  }

  /**
   * Polls a turn to completion. Resolves with the turn's concluding
   * text (never an intermediate plan) and any generated files.
   */
  protected async waitForAssistantResult(
    settings: AppSettingsV1,
    threadId: string,
    turnId: string,
    timeoutMs: number,
    workspaceRoot?: string
  ): Promise<{
    status: 'completed' | 'failed' | 'aborted' | 'timeout'
    text: string
    files: ClawGeneratedFileV1[]
    error?: string
  }> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await sleep(1_500, this.stopController.signal)
      if (this.stopController.signal.aborted) {
        return { status: 'aborted', text: '', files: [], error: 'Claw runtime stopped.' }
      }
      const detailRes = await this.requestRuntime(
        settings,
        `/v1/threads/${encodeURIComponent(threadId)}`,
        { method: 'GET' }
      )
      if (this.stopController.signal.aborted) {
        return { status: 'aborted', text: '', files: [], error: 'Claw runtime stopped.' }
      }
      if (!detailRes.ok) {
        throw new Error(runtimeErrorMessage(detailRes, 'Failed to read thread result.'))
      }
      const detail = JSON.parse(detailRes.body) as ThreadDetailJson
      const targetTurn = Array.isArray(detail.turns)
        ? detail.turns.find((turn) => turn.id === turnId)
        : undefined
      if (!targetTurn) continue
      if (isRunningStatus(targetTurn.status)) continue
      if (targetTurn.status === 'failed' || targetTurn.status === 'aborted') {
        return {
          status: targetTurn.status,
          text: '',
          files: [],
          error: targetTurn.error?.trim() || `Agent turn ${targetTurn.status}.`
        }
      }
      if (targetTurn.status === 'completed') {
        return {
          status: 'completed',
          text: finalAssistantReplyText(detail, { turnId }),
          files: latestGeneratedFiles(detail, { turnId, workspaceRoot })
        }
      }
    }
    return { status: 'timeout', text: '', files: [] }
  }

  protected async subscribeSse(
    settings: AppSettingsV1,
    threadId: string,
    streamer: FeishuStreamer,
    signal: AbortSignal
  ): Promise<{ close: () => void }> {
    const baseUrl = getRuntimeBaseUrlForSettings(settings)
    if (!baseUrl) throw new Error('runtime_base_url_unavailable')
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    const auth = runtimeAuthHeaders(settings).get('Authorization')
    if (auth) headers.Authorization = auth
    const onEvent = (event: { kind?: string; [k: string]: unknown }): void => {
      streamer.onSseEvent(event as Record<string, unknown>)
    }
    return subscribeRuntimeThreadEvents({
      baseUrl,
      threadId,
      headers,
      onEvent,
      signal,
      logError: (category, message, detail) => this.deps.logError(category, message, detail)
    })
  }

  protected subscribeSseForStreamer(
    settings: AppSettingsV1,
    threadId: string,
    streamer: FeishuStreamer
  ): SseSubscriber {
    return (signal) => {
      // subscribeRuntimeThreadEvents is async, but SseSubscriber contract is
      // synchronous (returns a { close } handle). Kick off the async
      // subscription and surface its close synchronously by racing the
      // setup; if the setup itself throws (e.g. no base URL) we log via
      // deps.logError and continue with a no-op close. The streamer will
      // still rely on its own responseTimeoutMs abort as a backstop.
      return createDeferredCloseHandle(
        this.subscribeSse(settings, threadId, streamer, signal),
        (error) => {
          this.deps.logError('claw-feishu-stream', 'SSE subscription setup failed', {
            message: error instanceof Error ? error.message : String(error),
            threadId
          })
        }
      )
    }
  }

  protected async runStreamingReply(input: {
    bridge: LarkChannel
    chatId: string
    threadId: string
    turnId: string
    replyOptions: { replyTo?: string; replyInThread?: boolean }
    responseTimeoutMs: number
    context: Record<string, unknown>
  }): Promise<{ ok: boolean; messageId: string; finalText: string; fellBack: boolean; message: string }> {
    const streamer = new FeishuStreamer({
      bridge: input.bridge,
      chatId: input.chatId,
      turnId: input.turnId,
      threadId: input.threadId,
      replyOptions: input.replyOptions,
      logger: (category, message, detail) => this.deps.logError(category, message, detail)
    })
    const stopSignal = this.stopController.signal
    const stopStreaming = (): void => streamer.abort()
    if (stopSignal.aborted) stopStreaming()
    else stopSignal.addEventListener('abort', stopStreaming, { once: true })
    const timeout = setTimeout(() => streamer.abort(), input.responseTimeoutMs)
    try {
      const settings = await this.deps.store.load()
      const result = await streamer.start({
        subscribe: this.subscribeSseForStreamer(settings, input.threadId, streamer)
      })
      return {
        ok: result.ok,
        messageId: result.messageId,
        finalText: result.finalText,
        fellBack: result.fellBack,
        message: result.ok ? 'streamed' : 'stream_failed'
      }
    } catch (error) {
      if (stopSignal.aborted) {
        return {
          ok: false,
          messageId: '',
          finalText: streamer.getAccumulatedText(),
          fellBack: false,
          message: 'stopped'
        }
      }
      this.deps.logError('claw-feishu-stream', 'Streaming reply failed; falling back to one-shot send.', {
        message: error instanceof Error ? error.message : String(error),
        ...input.context
      })
      const finalText = streamer.getAccumulatedText() || ''
      try {
        const fb = await input.bridge.send(
          input.chatId,
          { markdown: finalText || 'Sorry, I could not finish streaming the response.' },
          input.replyOptions
        )
        return { ok: true, messageId: fb.messageId, finalText, fellBack: true, message: 'fell_back' }
      } catch (fbError) {
        return {
          ok: false,
          messageId: '',
          finalText,
          fellBack: true,
          message: fbError instanceof Error ? fbError.message : String(fbError)
        }
      }
    } finally {
      clearTimeout(timeout)
      stopSignal.removeEventListener('abort', stopStreaming)
      streamer.dispose()
    }
  }

  protected requestRuntime(
    settings: AppSettingsV1,
    pathAndQuery: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {}
  ): Promise<{ ok: boolean; status: number; body: string }> {
    return this.deps.runtimeRequest(settings, pathAndQuery, {
      ...init,
      signal: this.stopController.signal
    })
  }

  protected startRuntimeTurn(
    settings: AppSettingsV1,
    threadId: string,
    turnBody: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; body: string }> {
    return this.requestRuntime(
      settings,
      `/v1/threads/${encodeURIComponent(threadId)}/turns`,
      { method: 'POST', body: JSON.stringify(turnBody) }
    )
  }

  /**
   * Fire-and-forget delivery of a turn's result that outran the IM
   * response window. Keeps polling in the background and pushes the
   * concluding text (or a completion note) back over the bridge when the
   * turn finishes. No-op for providers/recipients we cannot push to, and
   * deduped per turn so a retried inbound never double-pushes.
   */
  protected scheduleImResultPush(
    settings: AppSettingsV1,
    input: {
      channel?: ClawImChannelV1
      remoteSession?: Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'>
      threadId: string
      turnId?: string
      workspaceRoot: string
    }
  ): void {
    const { channel, turnId } = input
    if (!channel || !turnId) return
    if (this.stopController.signal.aborted) return
    if (!this.imTransport.canPush(channel)) return
    const key = `${input.threadId}:${turnId}`
    if (this.pendingResultPushes.has(key)) return
    this.pendingResultPushes.add(key)
    let task: Promise<void>
    task = (async () => {
      try {
        const outcome = await this.waitForAssistantResult(
          settings,
          input.threadId,
          turnId,
          RESULT_PUSH_MAX_WAIT_MS,
          input.workspaceRoot
        )
        if (this.stopController.signal.aborted) return
        if (outcome.status === 'timeout') {
          this.deps.logError(
            'claw-im',
            'Gave up pushing a delayed agent result: turn still running after the maximum wait.',
            { threadId: input.threadId, turnId }
          )
          return
        }
        const files =
          outcome.status === 'completed'
            ? await this.resolveImGeneratedFiles(outcome.files, input.workspaceRoot, {
                purpose: 'agent-file-delayed-resolve',
                channelId: channel.id,
                threadId: input.threadId,
                turnId,
                chatId: input.remoteSession?.chatId
              })
            : []
        const body =
          outcome.status === 'completed'
            ? replyTextForGeneratedFiles(outcome.text.trim() || IM_COMPLETED_NO_TEXT_REPLY, files)
            : `❌ 任务未完成：${outcome.error || outcome.status}`
        await this.pushImMessage(channel, input.remoteSession, body)
        if (outcome.status === 'completed') {
          await this.pushImGeneratedFiles(channel, input.remoteSession, files, {
            channelId: channel.id,
            threadId: input.threadId,
            turnId,
            chatId: input.remoteSession?.chatId
          })
        }
      } catch (error) {
        this.deps.logError('claw-im', 'Failed to push a delayed agent result.', {
          message: errorMessage(error),
          threadId: input.threadId,
          turnId
        })
      } finally {
        this.pendingResultPushes.delete(key)
      }
    })().finally(() => {
      this.resultPushTasks.delete(task)
    })
    this.resultPushTasks.add(task)
    void task
  }

  /** Pushes generated files for a delayed IM turn that finished after the response window. */
  protected async pushImGeneratedFiles(
    channel: ClawImChannelV1,
    remoteSession: Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'> | undefined,
    files: readonly ClawGeneratedFileV1[],
    context: Record<string, unknown>
  ): Promise<void> {
    await this.imTransport.sendFiles({ channel, remoteSession, files, context })
  }
  /** Pushes a standalone bridge message to the sender of an inbound IM. */
  protected async pushImMessage(
    channel: ClawImChannelV1,
    remoteSession: Pick<ClawImRemoteSessionV1, 'chatId' | 'messageId' | 'threadId' | 'senderId' | 'senderName'> | undefined,
    text: string
  ): Promise<void> {
    await this.imTransport.sendText({
      channel,
      remoteSession,
      text,
      context: { purpose: 'agent-reply-delayed', channelId: channel.id }
    })
  }

  protected resolveChannelWorkspaceRoot(settings: AppSettingsV1, channel?: ClawImChannelV1): string {
    return channel?.workspaceRoot.trim() || settings.claw.im.workspaceRoot.trim() || settings.workspaceRoot
  }

  protected legacyEmptyBaseConversationWorkspaceRoot(
    session: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'>
  ): string {
    const key = sanitizePathSegment(session.threadId.trim() || session.chatId.trim(), 'conversation')
    return `/conversations/${key}`
  }

  protected resolveConversationWorkspaceRoot(
    settings: AppSettingsV1,
    channel: ClawImChannelV1,
    session: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'>
  ): string {
    const base = this.resolveChannelWorkspaceRoot(settings, channel).trim()
    const key = sanitizePathSegment(session.threadId.trim() || session.chatId.trim(), 'conversation')
    return base ? `${base.replace(/\/+$/, '')}/conversations/${key}` : ''
  }

  protected resolveIncomingWorkspaceRoot(
    settings: AppSettingsV1,
    channel: ClawImChannelV1 | undefined,
    conversation: ClawImConversationV1 | undefined,
    remoteSession: Pick<ClawImRemoteSessionV1, 'chatId' | 'threadId'> | undefined
  ): string {
    const storedConversationRoot = conversation?.workspaceRoot.trim() ?? ''
    if (storedConversationRoot && remoteSession) {
      const legacyEmptyBaseRoot = this.legacyEmptyBaseConversationWorkspaceRoot(remoteSession)
      if (storedConversationRoot !== legacyEmptyBaseRoot) return storedConversationRoot
    } else if (storedConversationRoot) {
      return storedConversationRoot
    }
    const conversationRoot = channel && remoteSession
      ? this.resolveConversationWorkspaceRoot(settings, channel, remoteSession)
      : ''
    return conversationRoot || this.resolveChannelWorkspaceRoot(settings, channel)
  }

}
