import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  type LarkChannel,
  type NormalizedMessage,
  type SendInput,
  type SendOptions,
  type SendResult
} from '@larksuiteoapi/node-sdk'
import type { AppSettingsV1, ClawImChannelV1 } from '../shared/app-settings'
import type { ClawGeneratedFileV1 } from '../shared/app-settings'
import { deliverImGeneratedFiles, type ImAttachmentDeliveryResult } from './im-attachment-pipeline'

export type FeishuTransportAdapterDeps = {
  logError: (category: string, message: string, detail?: unknown) => void
  onMessage: (channelId: string, message: NormalizedMessage) => void | Promise<void>
  allowedFileDirs: (settings: AppSettingsV1, channel: ClawImChannelV1) => string[]
  createChannel?: typeof createLarkChannel
  suppressSdkLogs?: boolean
}

/** Owns Feishu/Lark SDK connections; callers only coordinate normalized messages. */
export class FeishuTransportAdapter {
  private readonly channels = new Map<string, LarkChannel>()
  private readonly channelKeys = new Map<string, string>()
  private readonly syncTasks = new Set<Promise<void>>()
  private syncVersion = 0
  private stopped = false

  constructor(private readonly deps: FeishuTransportAdapterDeps) {}

  has(channelId: string): boolean {
    return this.channels.has(channelId)
  }

  get(channelId: string): LarkChannel | undefined {
    return this.channels.get(channelId)
  }

  /** @internal Compatibility seam for existing transport characterization tests. */
  get channelRegistry(): Map<string, LarkChannel> {
    return this.channels
  }

  async send(
    bridge: LarkChannel,
    to: string,
    input: SendInput,
    options: SendOptions,
    context: Record<string, unknown>
  ): Promise<SendResult> {
    try {
      return await bridge.send(to, input, options)
    } catch (error) {
      const initialMessage = error instanceof Error ? error.message : String(error)
      if (!options.replyTo) {
        this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark message', {
          ...context, message: initialMessage, to
        })
        throw error
      }
      this.deps.logError(
        'claw-feishu',
        'Failed to send Feishu / Lark reply; falling back to plain chat message.',
        {
          ...context,
          message: initialMessage,
          replyTo: options.replyTo,
          replyInThread: options.replyInThread,
          to
        }
      )
      try {
        return await bridge.send(to, input, {
          ...options,
          replyTo: undefined,
          replyInThread: undefined
        })
      } catch (fallbackError) {
        this.deps.logError('claw-feishu', 'Failed to send Feishu / Lark fallback message', {
          ...context,
          initialMessage,
          message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          to
        })
        throw fallbackError
      }
    }
  }

  async sendText(
    channelId: string,
    to: string,
    text: string,
    context: Record<string, unknown> = {}
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const bridge = this.get(channelId)
    if (!bridge) return { ok: false, message: 'Feishu / Lark bridge is not connected.' }
    try {
      await this.send(bridge, to, { markdown: text }, {}, context)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async sendFiles(
    channelId: string,
    to: string,
    files: readonly ClawGeneratedFileV1[],
    context: Record<string, unknown> = {},
    options: SendOptions = {}
  ): Promise<ImAttachmentDeliveryResult> {
    const bridge = this.get(channelId)
    if (!bridge) {
      return {
        sent: [],
        failed: files.map((file) => ({ file, message: 'Feishu / Lark bridge is not connected.' }))
      }
    }
    return this.sendFilesWithBridge(bridge, to, files, context, options)
  }

  async sendFilesWithBridge(
    bridge: LarkChannel,
    to: string,
    files: readonly ClawGeneratedFileV1[],
    context: Record<string, unknown> = {},
    options: SendOptions = {}
  ): Promise<ImAttachmentDeliveryResult> {
    return deliverImGeneratedFiles({
      files,
      upload: async (file) => {
        await this.send(
          bridge,
          to,
          { file: { source: file.path, fileName: file.fileName } },
          options,
          { ...context, purpose: 'agent-file', filePath: file.path, fileName: file.fileName }
        )
      },
      onFailure: (file, message) => this.deps.logError(
        'claw-feishu',
        'Failed to send Feishu / Lark file attachment',
        { ...context, filePath: file.path, fileName: file.fileName, message }
      )
    })
  }

  sync(settings: AppSettingsV1): Promise<void> {
    if (this.stopped) return Promise.resolve()
    let task: Promise<void>
    task = this.runSync(settings).finally(() => this.syncTasks.delete(task))
    this.syncTasks.add(task)
    return task
  }

  private async runSync(settings: AppSettingsV1): Promise<void> {
    const version = ++this.syncVersion
    const targets = settings.claw.enabled
      ? settings.claw.channels.filter(isConfiguredFeishuChannel)
      : []
    const targetMap = new Map(targets.map((channel) => [channel.id, channel]))
    await Promise.all(
      [...this.channels.keys()]
        .filter((channelId) => !targetMap.has(channelId))
        .map((channelId) => this.close(channelId))
    )
    if (this.stopped || version !== this.syncVersion) return

    for (const target of targets) {
      const credential = target.platformCredential
      if (credential?.kind !== 'feishu') continue
      const appId = credential.appId.trim()
      const appSecret = credential.appSecret.trim()
      const domain = credential.domain.trim().toLowerCase() === 'lark' ? 'lark' : 'feishu'
      const allowedFileDirs = this.deps.allowedFileDirs(settings, target)
        .map((entry) => entry.trim())
        .filter((entry, index, entries) => entry && entries.indexOf(entry) === index)
      const nextKey = `${target.id}|${appId}|${appSecret}|${domain}|${allowedFileDirs.join('|')}`
      if (this.channels.has(target.id) && this.channelKeys.get(target.id) === nextKey) continue
      if (this.channels.has(target.id)) {
        await this.close(target.id)
        if (this.stopped || version !== this.syncVersion) return
      }
      try {
        const bridge = (this.deps.createChannel ?? createLarkChannel)({
          appId,
          appSecret,
          domain: domain === 'lark' ? Domain.Lark : Domain.Feishu,
          loggerLevel: LoggerLevel.warn,
          ...(this.deps.suppressSdkLogs ? { logger: { error() {}, warn() {}, info() {}, debug() {}, trace() {} } } : {}),
          source: 'kun',
          transport: 'websocket',
          policy: { dmMode: 'open', requireMention: true, respondToMentionAll: true },
          ...(allowedFileDirs.length > 0 ? { outbound: { allowedFileDirs } } : {})
        })
        bridge.on('message', async (message) => this.deps.onMessage(target.id, message))
        bridge.on('error', (error) => this.deps.logError('claw-feishu', 'Feishu channel error', {
          message: error.message, code: error.code, channelId: target.id
        }))
        bridge.on('reject', (event) => this.deps.logError(
          'claw-feishu',
          'Feishu message rejected by channel policy',
          { ...event, channelId: target.id }
        ))
        bridge.on('reconnecting', () => this.deps.logError(
          'claw-feishu', 'Feishu channel reconnecting', { channelId: target.id }
        ))
        bridge.on('reconnected', () => this.deps.logError(
          'claw-feishu', 'Feishu channel reconnected', { channelId: target.id }
        ))
        registerReadReceiptNoop(bridge)
        await bridge.connect()
        if (this.stopped || version !== this.syncVersion) {
          await bridge.disconnect().catch(() => undefined)
          return
        }
        this.channels.set(target.id, bridge)
        this.channelKeys.set(target.id, nextKey)
      } catch (error) {
        this.deps.logError('claw-feishu', 'Failed to start Feishu channel bridge', {
          message: error instanceof Error ? error.message : String(error),
          channelId: target.id
        })
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.syncVersion += 1
    await Promise.allSettled([...this.syncTasks])
    await Promise.all([...this.channels.keys()].map((channelId) => this.close(channelId)))
  }

  private async close(channelId: string): Promise<void> {
    const bridge = this.channels.get(channelId)
    if (!bridge) return
    this.channels.delete(channelId)
    this.channelKeys.delete(channelId)
    await bridge.disconnect().catch((error) => {
      this.deps.logError('claw-feishu', 'Failed to stop Feishu channel bridge', {
        message: error instanceof Error ? error.message : String(error),
        channelId
      })
    })
  }
}

function isConfiguredFeishuChannel(channel: ClawImChannelV1): boolean {
  const credential = channel.platformCredential
  return channel.enabled && channel.provider === 'feishu' && credential?.kind === 'feishu' &&
    Boolean(credential.appId.trim() && credential.appSecret.trim())
}

function registerReadReceiptNoop(bridge: LarkChannel): void {
  const dispatcher = (bridge as unknown as {
    dispatcher?: { register(handles: Record<string, (raw: unknown) => Promise<void> | void>): void }
  }).dispatcher
  dispatcher?.register({ 'im.message.message_read_v1': () => undefined })
}
