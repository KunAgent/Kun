import type { Server } from 'node:http'
import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type {
  AppSettingsV1,
  ClawImChannelV1,
  ClawRunResult,
  ClawRuntimeStatus
} from '../shared/app-settings'
import { webhookUrl, type ClawRuntimeDeps } from './claw-runtime-helpers'
import { FeishuTransportAdapter } from './feishu-transport-adapter'
import { WeixinTransportAdapter } from './weixin-transport-adapter'
import { ImTransportRouter } from './im-transport-router'
import { syncWeixinConnectWelcomes as runWeixinConnectWelcomes } from './weixin-welcome-coordinator'
import { imWelcomeText } from './claw-im-model-support'

export abstract class ClawRuntimeCore {
  protected abstract syncWebhook(settings: AppSettingsV1): void
  protected abstract closeWebhook(forceConnections?: boolean): Promise<void>
  protected abstract handleFeishuMessage(channelId: string, message: NormalizedMessage): Promise<void>
  protected abstract resolveChannelWorkspaceRoot(settings: AppSettingsV1, channel?: ClawImChannelV1): string
  readonly personalIm?: import('./personal-agent-im-service').PersonalAgentImService
  protected readonly deps: ClawRuntimeDeps
  protected server: Server | null = null
  protected serverKey = ''
  protected readonly feishuTransport: FeishuTransportAdapter
  protected readonly weixinTransport: WeixinTransportAdapter
  protected readonly imTransport: ImTransportRouter
  /** Channels with an in-flight first-message welcome delivery. */
  protected readonly welcomeInFlight = new Set<string>()
  /** WeChat channels already greeted (or attempted) at connect time this run. */
  protected readonly weixinConnectWelcomeAttempted = new Set<string>()
  /** `${threadId}:${turnId}` of turns with an in-flight delayed-result push. */
  protected readonly pendingResultPushes = new Set<string>()
  protected readonly resultPushTasks = new Set<Promise<void>>()
  protected readonly lifecycleTasks = new Set<Promise<void>>()
  protected readonly webhookCloseTasks = new Set<Promise<void>>()
  protected readonly stopController = new AbortController()

  constructor(deps: ClawRuntimeDeps) {
    this.deps = deps
    this.personalIm = deps.createPersonalIm?.()
    this.feishuTransport = new FeishuTransportAdapter({
      logError: deps.logError,
      onMessage: (channelId, message) => this.trackLifecycleTask(
        'Feishu inbound handler failed',
        this.handleFeishuMessage(channelId, message)
      ),
      allowedFileDirs: (settings, channel) => [
        this.resolveChannelWorkspaceRoot(settings, channel),
        settings.claw.im.workspaceRoot,
        settings.workspaceRoot
      ]
    })
    this.weixinTransport = new WeixinTransportAdapter({
      send: deps.sendWeixinBridgeMessage,
      resolveAccountUserId: deps.resolveWeixinAccountUserId,
      logError: deps.logError
    })
    this.imTransport = new ImTransportRouter({
      feishu: this.feishuTransport,
      weixin: this.weixinTransport,
      telegram: deps.telegramRuntime,
      logError: deps.logError
    })
  }

  /** @internal Legacy characterization seam; lifecycle ownership stays in the adapter. */
  protected get feishuChannels(): Map<string, LarkChannel> {
    return this.feishuTransport.channelRegistry
  }

  sync(settings: AppSettingsV1): void {
    if (this.stopController.signal.aborted) return
    if (this.personalIm) this.trackLifecycleTask('Private Agent IM sync failed', this.personalIm.sync(settings))
    this.syncWebhook(settings)
    this.trackLifecycleTask('Feishu channel sync failed', this.feishuTransport.sync(settings))
    this.pruneWeixinWelcomeAttempts(settings)
    this.trackLifecycleTask('WeChat welcome sync failed', this.syncWeixinConnectWelcomes(settings))
    this.syncTelegramChannels(settings)
  }

  protected trackLifecycleTask(message: string, task: Promise<void>): Promise<void> {
    const tracked = task.catch((error) => {
      this.deps.logError('claw-lifecycle', message, {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    this.lifecycleTasks.add(tracked)
    void tracked.finally(() => this.lifecycleTasks.delete(tracked))
    return tracked
  }

  protected pruneWeixinWelcomeAttempts(settings: AppSettingsV1): void {
    const configured = new Set(
      settings.claw.channels
        .filter((channel) => channel.enabled && channel.provider === 'weixin')
        .map((channel) => channel.id)
    )
    for (const channelId of this.weixinConnectWelcomeAttempted) {
      if (!configured.has(channelId)) this.weixinConnectWelcomeAttempted.delete(channelId)
    }
  }

  /**
   * Delegates Telegram channel reconciliation to the dedicated long-polling
   * runtime. Unlike Feishu (which owns its SDK channels here), Telegram's
   * connection state lives in {@link TelegramRuntime}; ClawRuntime only needs
   * to tell it about the current settings and check `has()` for outbound pushes.
   */
  protected syncTelegramChannels(settings: AppSettingsV1): void {
    this.deps.telegramRuntime?.sync(settings)
  }

  /**
   * Greets the WeChat owner right after a channel is first connected.
   * The QR login records the owner's user id, so the intro can be
   * pushed before any inbound message. Failures fall back to the
   * first-inbound-message welcome.
   */
  protected syncWeixinConnectWelcomes(settings: AppSettingsV1): Promise<void> {
    return runWeixinConnectWelcomes(settings, {
      alreadyAttempted: (channelId) => this.weixinConnectWelcomeAttempted.has(channelId),
      welcomeInFlight: (channelId) => this.welcomeInFlight.has(channelId),
      markAttempted: (channelId) => {
        this.weixinConnectWelcomeAttempted.add(channelId)
      },
      beginWelcome: (channelId) => {
        this.welcomeInFlight.add(channelId)
      },
      endWelcome: (channelId) => {
        this.welcomeInFlight.delete(channelId)
      },
      resolveOwner: (channel) => this.weixinTransport.resolveOwner(channel),
      sendWelcome: (channel, owner, text) => this.weixinTransport.sendText({
        channel,
        remoteSession: { chatId: owner },
        text,
        failureMessage: 'Failed to greet the WeChat owner after connect; the welcome will be sent on the first inbound message instead.'
      }),
      welcomeText: imWelcomeText,
      markWelcomeSent: (channelId) => this.markChannelWelcomeSent(channelId),
      logError: this.deps.logError,
      stopped: () => this.stopController.signal.aborted
    })
  }

  protected async markChannelWelcomeSent(channelId: string): Promise<void> {
    if (this.stopController.signal.aborted) return
    const settings = await this.deps.store.load()
    if (this.stopController.signal.aborted) return
    const now = new Date().toISOString()
    await this.deps.store.patch({
      claw: {
        channels: settings.claw.channels.map((item) =>
          item.id === channelId ? { ...item, welcomeSentAt: now, updatedAt: now } : item
        )
      }
    })
  }

  /** Welcome text still owed to this channel, or '' when already delivered. */
  protected pendingWelcomeText(settings: AppSettingsV1, channel: ClawImChannelV1 | undefined): string {
    if (!channel || channel.welcomeSentAt || this.welcomeInFlight.has(channel.id)) return ''
    return imWelcomeText(settings, channel)
  }

  async stop(): Promise<void> {
    this.stopController.abort()
    await this.personalIm?.stop()
    void this.closeWebhook(true)
    await this.feishuTransport.stop()
    while (
      this.lifecycleTasks.size > 0 ||
      this.resultPushTasks.size > 0 ||
      this.webhookCloseTasks.size > 0
    ) {
      await Promise.allSettled([
        ...this.lifecycleTasks,
        ...this.resultPushTasks,
        ...this.webhookCloseTasks
      ])
    }
    this.welcomeInFlight.clear()
    this.weixinConnectWelcomeAttempted.clear()
    this.pendingResultPushes.clear()
  }

  async status(): Promise<ClawRuntimeStatus> {
    const settings = await this.deps.store.load()
    return {
      imServerRunning: this.server !== null && settings.claw.enabled && settings.claw.im.enabled,
      imUrl: webhookUrl(settings),
      runningTaskIds: []
    }
  }

  async runTask(_taskId: string): Promise<ClawRunResult> {
    return { ok: false, message: 'Claw scheduled tasks have moved to Schedule.' }
  }

}
