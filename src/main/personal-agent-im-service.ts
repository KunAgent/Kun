import { randomUUID } from 'node:crypto'
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { PersonalAgentImRequest, PersonalAgentImResult } from '../shared/personal-agent-im'
import type { AppSettingsV1, ClawImChannelV1 } from '../shared/app-settings'
import type { ClawRuntimeDeps } from './claw-runtime-types'
import type { PersonalImConnection, PersonalImStore } from './personal-agent-im-store'
import { FeishuTransportAdapter } from './feishu-transport-adapter'
import { startFeishuInstallQrcode, pollFeishuInstall } from './claw-platform-install'
import { setPrivateAgentWeixinHandler } from './personal-agent-weixin-boundary'
import { startWeixinLogin, waitForWeixinLogin, startAccountMonitor, stopWeixinChannels,
  textFromItemList } from './weixin-bridge-channel'
import { activeLogins, type WeixinMessage } from './weixin-bridge-state'

type Attempt = { id: string; roomId: string; cardId: string; agentId: string; provider: 'feishu' | 'weixin';
  deviceCode: string; expiresAt: number; cancelled: boolean; connectionId?: string; polling?: Promise<PersonalAgentImResult> }
type Delivery = { messages: Array<{ id: string; text: string; hasAttachments: boolean; seq: number }>;
  cursor: number; hasMore: boolean; attention: string[] }
export type PersonalImServiceDeps = Pick<ClawRuntimeDeps, 'store' | 'runtimeRequest' | 'sendWeixinBridgeMessage'> & {
  secureStore: PersonalImStore
  logError: ClawRuntimeDeps['logError']
  feishu?: Pick<FeishuTransportAdapter, 'sync' | 'stop' | 'sendText'>
  startFeishu?: typeof startFeishuInstallQrcode
  pollFeishu?: typeof pollFeishuInstall
  startWeixin?: typeof startWeixinLogin
  pollWeixin?: typeof waitForWeixinLogin
  startWeixinMonitor?: typeof startAccountMonitor
}

/** Desktop-owned transports for a user's existing private Agent, separate from legacy Connect phone channels. */
export class PersonalAgentImService {
  private readonly attempts = new Map<string, Attempt>()
  private connections: PersonalImConnection[] = []
  private readonly transport: Pick<FeishuTransportAdapter, 'sync' | 'stop' | 'sendText'>
  private ready?: Promise<void>
  private writes: Promise<unknown> = Promise.resolve()
  private readonly jobs = new Map<string, Promise<void>>()
  private readonly stopping = new AbortController()
  private timer?: ReturnType<typeof setTimeout>
  private settings?: AppSettingsV1
  private lastError = ''
  private transportReady = false

  constructor(private readonly deps: PersonalImServiceDeps) {
    this.transport = deps.feishu ?? new FeishuTransportAdapter({
      allowedFileDirs: () => [], suppressSdkLogs: true,
      // Never forward provider bodies/SDK error payloads to logs: they may include credentials.
      logError: (_category, message) => {
        if (message === 'Feishu channel reconnected') this.lastError = ''
        else this.reportError()
      },
      onMessage: (id, message) => { void this.feishuInbound(id, message).catch(() => this.reportError()) }
    })
  }
  private reportError(): void {
    const alreadyReported = Boolean(this.lastError)
    this.lastError = 'The IM connection needs attention. Check connectivity or reconnect from Kun.'
    if (!alreadyReported) this.deps.logError('personal-agent-im', 'IM operation did not complete; credentials and message content omitted')
  }
  private async initialize(): Promise<void> {
    this.ready ??= this.deps.secureStore.load().then((connections) => { this.connections = connections })
      .catch((error) => { this.ready = undefined; throw error })
    return this.ready
  }
  private async api<T>(path: string, body?: unknown): Promise<T> {
    if (this.stopping.signal.aborted) throw new Error('IM service is stopping')
    const result = await this.deps.runtimeRequest(await this.deps.store.load(), path,
      { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: this.stopping.signal })
    if (!result.ok) throw new Error('The Agent conversation changed or the local runtime is unavailable')
    return JSON.parse(result.body) as T
  }
  private cardPath(roomId: string, cardId: string): string {
    return `/v1/rooms/${encodeURIComponent(roomId)}/im-cards/${encodeURIComponent(cardId)}`
  }
  private connectionPath(connection: PersonalImConnection): string {
    return `/v1/rooms/${encodeURIComponent(connection.roomId)}/im-connections/${encodeURIComponent(connection.id)}`
  }
  private persist(): Promise<void> {
    const save = this.writes.catch(() => undefined).then(() => this.deps.secureStore.save(structuredClone(this.connections)))
    this.writes = save
    return save
  }
  async sync(settings: AppSettingsV1): Promise<void> {
    if (this.stopping.signal.aborted) return
    this.settings = settings
    await this.initialize()
    if (this.stopping.signal.aborted) return
    setPrivateAgentWeixinHandler((message, accountId) => this.weixinInbound(message, accountId))
    const channels: ClawImChannelV1[] = this.connections.filter((item) => item.enabled && item.provider === 'feishu')
      .map((item) => ({ id: item.id, provider: 'feishu', label: 'Personal Agent', enabled: true,
        model: '', threadId: '', workspaceRoot: '', conversations: [],
        agentProfile: { name: '', identity: '', description: '', personality: '', userContext: '', replyRules: '' },
        platformCredential: { kind: 'feishu', appId: item.appId!, appSecret: item.appSecret!, domain: item.domain!, createdAt: '' },
        createdAt: '', updatedAt: '' }))
    this.transportReady = false
    await this.transport.sync({ ...settings, claw: { ...settings.claw, enabled: true, channels } })
    this.transportReady = true
    if (this.stopping.signal.aborted) return
    for (const connection of this.connections.filter((item) => item.enabled && item.provider === 'weixin')) {
      await (this.deps.startWeixinMonitor ?? startAccountMonitor)(connection.accountId!)
    }
    this.wakeDeliveries()
  }
  async handle(input: PersonalAgentImRequest): Promise<PersonalAgentImResult> {
    try {
      for (const entry of this.attempts.values()) {
        if (entry.cancelled || Date.now() >= entry.expiresAt) this.cancelAttempt(entry.id, entry.roomId, entry.cardId)
      }
      await this.initialize()
      if (this.stopping.signal.aborted) throw new Error('Keep Kun open to use IM')
      const connection = this.connections.find((item) => item.roomId === input.roomId && item.cardId === input.cardId)
      if (input.action === 'status') {
        if (connection?.enabled) return connection.delivery?.uncertainIds.length ? { status: 'error', message: 'A reply could not be confirmed in IM. Its full content is saved in this Kun conversation; it will not be resent automatically.' } : this.lastError ? { status: 'error', message: this.lastError } : { status: 'connected', connectionId: connection.id }
        return { status: connection && !connection.pendingPairing ? 'disconnected' : 'requested' }
      }
      if (input.action === 'disconnect') {
        if (!connection) return { status: 'disconnected' }
        // Close admission before awaiting any network operation.
        connection.enabled = false
        connection.pendingPairing = false
        await this.persist()
        await this.api(this.connectionPath(connection) + '/disconnect', {})
        if (connection.provider === 'weixin') await stopWeixinChannels({ accountId: connection.accountId })
        if (this.settings) await this.sync(this.settings)
        return { status: 'disconnected' }
      }
      if (input.action === 'cancel') {
        const attempt = input.attemptId ? this.attempts.get(input.attemptId) : undefined
        this.cancelAttempt(input.attemptId, input.roomId, input.cardId)
        if (attempt?.roomId === input.roomId && attempt.cardId === input.cardId) await this.abortPairedAttempt(attempt)
        return { status: 'cancelled' }
      }
      if (input.action === 'poll') {
        const attempt = input.attemptId ? this.attempts.get(input.attemptId) : undefined
        if (!attempt || attempt.roomId !== input.roomId || attempt.cardId !== input.cardId || attempt.cancelled || Date.now() >= attempt.expiresAt) {
          throw new Error('This QR code expired or was cancelled. Start again.')
        }
        attempt.polling ??= this.poll(attempt).catch((error) => { this.cancelAttempt(attempt.id, attempt.roomId, attempt.cardId); throw error }).finally(() => { attempt.polling = undefined })
        return await attempt.polling
      }
      if (connection?.enabled) return { status: 'connected', connectionId: connection.id }
      await this.deps.secureStore.assertAvailable()
      if (connection?.pendingPairing) {
        await this.api(this.cardPath(connection.roomId, connection.cardId) + '/complete', { connectionId: connection.id, ownerId: connection.ownerId })
        connection.enabled = true; connection.pendingPairing = false
        try { await this.persist() } catch (error) { connection.enabled = false; connection.pendingPairing = true; throw error }
        await this.sync(this.settings ?? await this.deps.store.load())
        return { status: 'connected', connectionId: connection.id }
      }
      const card = await this.api<{ agentId: string; provider: Attempt['provider']; status: string }>(this.cardPath(input.roomId, input.cardId))
      if (card.status !== 'requested') throw new Error('Ask your Agent for a new connection card')
      // Only a trusted desktop IPC click reaches this method. The model cannot initiate registration.
      for (const old of this.attempts.values()) {
        if (old.roomId === input.roomId && old.cardId === input.cardId) this.cancelAttempt(old.id, old.roomId, old.cardId)
      }
      if (this.attempts.size >= 8) throw new Error('Close the other connection attempts and try again')
      const attempt: Attempt = { id: randomUUID(), roomId: input.roomId, cardId: input.cardId, agentId: card.agentId,
        provider: card.provider, deviceCode: '', expiresAt: Date.now() + 300_000, cancelled: false }
      this.attempts.set(attempt.id, attempt)
      let url: string, interval = 3
      if (card.provider === 'feishu') {
        const qr = await (this.deps.startFeishu ?? startFeishuInstallQrcode)(input.isLark === true)
        if (!qr.ok) throw new Error('Official Feishu registration is unavailable. Try again later.')
        attempt.deviceCode = qr.deviceCode
        attempt.expiresAt = Date.now() + Math.min(qr.expireIn, 300) * 1000
        url = qr.url; interval = qr.interval
      } else {
        const qr = await (this.deps.startWeixin ?? startWeixinLogin)({ force: true, protectCredentials: true })
        attempt.deviceCode = String(qr.sessionKey ?? '')
        url = String(qr.qrUrl ?? '')
      }
      if (!url || !attempt.deviceCode || attempt.cancelled || this.stopping.signal.aborted) throw new Error('Connection attempt was cancelled')
      return { status: 'qr', attemptId: attempt.id, url, expiresAt: attempt.expiresAt, interval }
    } catch (error) {
      for (const entry of this.attempts.values()) {
        if (entry.roomId === input.roomId && entry.cardId === input.cardId) this.cancelAttempt(entry.id, entry.roomId, entry.cardId)
      }
      // Deliberately keep SDK/provider errors out of the renderer and conversation history.
      const safe = error instanceof Error && /^(Unlock |This QR |This account |Ask your |Close the |Keep Kun |Official |Connection attempt)/.test(error.message)
        ? error.message : 'Could not connect securely. Check the official app and try again.'
      return { status: 'error', message: safe }
    }
  }
  private cancelAttempt(id: string | undefined, roomId: string, cardId: string): void {
    const attempt = id ? this.attempts.get(id) : undefined
    if (!attempt || attempt.roomId !== roomId || attempt.cardId !== cardId) return
    attempt.cancelled = true
    const connection = this.connections.find((item) => item.id === attempt.connectionId)
    if (connection) connection.enabled = false
    if (attempt.provider === 'weixin') activeLogins.delete(attempt.deviceCode)
    this.attempts.delete(attempt.id)
  }
  private async abortPairedAttempt(attempt: Attempt): Promise<void> {
    const connection = this.connections.find((item) => item.id === attempt.connectionId)
    if (!connection) return
    connection.enabled = false; connection.pendingPairing = false
    await this.persist()
    if (this.stopping.signal.aborted) return
    // The runtime may not have committed yet; local admission remains closed in either case.
    await this.api(this.connectionPath(connection) + '/disconnect', {}).catch(() => undefined)
    if (connection.provider === 'weixin') await stopWeixinChannels({ accountId: connection.accountId })
    if (this.settings) await this.sync(this.settings)
  }
  private async poll(attempt: Attempt): Promise<PersonalAgentImResult> {
    let connection: PersonalImConnection
    if (attempt.provider === 'feishu') {
      const result = await (this.deps.pollFeishu ?? pollFeishuInstall)(attempt.deviceCode)
      if (!result.done) {
        if (result.error) throw new Error('Official Feishu authorization did not complete. Start again.')
        return { status: 'pending' }
      }
      if (result.kind !== 'feishu' || !result.ownerId) throw new Error('Provider did not verify the scanning account')
      connection = { id: randomUUID(), roomId: attempt.roomId, cardId: attempt.cardId, agentId: attempt.agentId,
        provider: 'feishu', ownerId: result.ownerId, appId: result.appId, appSecret: result.appSecret,
        domain: result.domain, enabled: false, pendingPairing: true }
    } else {
      const result = await (this.deps.pollWeixin ?? waitForWeixinLogin)({ accountId: attempt.deviceCode, timeoutMs: 35_000 })
      if (result.pending === true) return { status: 'pending' }
      if (result.connected !== true || !result.userId || !result.accountId) throw new Error('Official WeChat authorization did not verify the owner. Start again.')
      connection = { id: randomUUID(), roomId: attempt.roomId, cardId: attempt.cardId, agentId: attempt.agentId,
        provider: 'weixin', ownerId: String(result.userId), accountId: String(result.accountId), enabled: false, pendingPairing: true }
    }
    if (attempt.cancelled || Date.now() >= attempt.expiresAt || this.stopping.signal.aborted) return { status: 'cancelled' }
    const duplicate = this.connections.some((item) => item.enabled && item.provider === connection.provider &&
      (connection.provider === 'feishu' ? item.appId === connection.appId : item.accountId === connection.accountId))
    const legacy = (await this.deps.store.load()).claw.channels.some((item) => item.enabled &&
      (connection.provider === 'feishu' ? item.platformCredential?.kind === 'feishu' && item.platformCredential.appId === connection.appId
        : item.platformCredential?.kind === 'weixin' && item.platformCredential.accountId === connection.accountId))
    if (duplicate || legacy) throw new Error('This account is already connected. Disconnect its existing channel before pairing this Agent.')
    // First persist secrets securely, then bind the verified account, and only then enable transport.
    attempt.connectionId = connection.id
    this.connections.push(connection)
    await this.persist()
    if (attempt.cancelled || this.stopping.signal.aborted) return { status: 'cancelled' }
    await this.api(this.cardPath(attempt.roomId, attempt.cardId) + '/complete', { connectionId: connection.id, ownerId: connection.ownerId })
    if (attempt.cancelled || this.stopping.signal.aborted) return { status: 'cancelled' }
    connection.enabled = true; connection.pendingPairing = false
    try { await this.persist() } catch (error) { connection.enabled = false; connection.pendingPairing = true; throw error }
    if (attempt.cancelled || this.stopping.signal.aborted) {
      connection.enabled = false
      await this.persist()
      if (!this.stopping.signal.aborted) await this.api(this.connectionPath(connection) + '/disconnect', {})
      return { status: 'cancelled' }
    }
    this.lastError = ''
    await this.sync(this.settings ?? await this.deps.store.load())
    if (attempt.cancelled || this.stopping.signal.aborted) { await this.abortPairedAttempt(attempt); return { status: 'cancelled' } }
    this.attempts.delete(attempt.id)
    return { status: 'connected', connectionId: connection.id }
  }
  async feishuInbound(id: string, message: NormalizedMessage): Promise<void> {
    await this.initialize()
    const connection = this.connections.find((item) => item.id === id && item.enabled)
    if (!connection || message.chatType !== 'p2p' || message.senderId !== connection.ownerId || !message.messageId) return
    await this.admit(connection, message.senderId, message.chatId, message.messageId, message.content)
  }
  async weixinInbound(message: WeixinMessage, accountId: string): Promise<boolean> {
    await this.initialize()
    const connection = this.connections.find((item) => item.accountId === accountId && item.provider === 'weixin')
    if (!connection) return false
    if (!connection.enabled || message.from_user_id !== connection.ownerId || message.group_id || message.message_type !== 1) return true
    const messageId = typeof message.message_id === 'string' ? message.message_id.trim()
      : Number.isSafeInteger(message.message_id) && Number(message.message_id) >= 0 ? String(message.message_id) : ''
    if (!messageId) return true
    await this.admit(connection, message.from_user_id, message.from_user_id, messageId, textFromItemList(message.item_list))
    return true
  }
  private async admit(connection: PersonalImConnection, senderId: string, chatId: string, messageId: string, text: string): Promise<void> {
    if (this.stopping.signal.aborted || !connection.enabled || !text.trim()) return
    // Persist the return route before admission, so a crash after acceptance still recovers delivery.
    if (!connection.delivery) {
      connection.delivery = { chatId, cursor: 0, sentIds: [], attentionIds: [], uncertainIds: [] }
      await this.persist()
    }
    if (connection.delivery.chatId !== chatId) return
    await this.api<{ requestId: string }>(this.connectionPath(connection) + '/messages', { senderId, chatId, messageId, text })
    this.wakeDeliveries()
  }
  private wakeDeliveries(): void {
    if (this.stopping.signal.aborted) return
    for (const connection of this.connections.filter((item) => item.enabled && item.delivery)) {
      const key = connection.id
      if (this.jobs.has(key)) continue
      const job = this.deliver(connection).catch(() => this.reportError()).finally(() => this.jobs.delete(key))
      this.jobs.set(key, job)
    }
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.wakeDeliveries() }, 2000)
  }
  private async deliver(connection: PersonalImConnection): Promise<void> {
    if (connection.provider === 'feishu' && !this.transportReady) return
    const delivery = connection.delivery!
    const result = await this.api<Delivery>(this.connectionPath(connection) + '/delivery?cursor=' + delivery.cursor)
    if (!connection.enabled || this.stopping.signal.aborted) return
    for (const message of result.messages) {
      if (delivery.sentIds.includes(message.id)) continue
      // Reserve before the external send. An ambiguous result is shown in Kun, never automatically replayed.
      delivery.sentIds.push(message.id)
      delivery.uncertainIds = [...delivery.uncertainIds, message.id].slice(-1000)
      await this.persist()
      if (!connection.enabled || this.stopping.signal.aborted) return
      await this.send(connection, delivery.chatId, message.text + (message.hasAttachments ? '\n\nOpen Kun to view the attached files and task cards.' : ''))
      delivery.uncertainIds = delivery.uncertainIds.filter((id) => id !== message.id)
      await this.persist()
    }
    delivery.cursor = result.cursor
    delivery.sentIds = delivery.sentIds.slice(-1000)
    const freshAttention = result.attention.filter((id) => !delivery.attentionIds.includes(id))
    if (freshAttention.length) {
      delivery.attentionIds = [...delivery.attentionIds, ...freshAttention].slice(-1000)
      await this.persist()
      await this.send(connection, delivery.chatId, 'This task needs your approval or input. Open this Agent in Kun to review it; replying here does not approve it.')
    }
    await this.persist()
    this.lastError = ''
  }
  private async send(connection: PersonalImConnection, chatId: string, text: string): Promise<void> {
    if (!text.trim() || !connection.enabled || this.stopping.signal.aborted) return
    const result = connection.provider === 'feishu'
      ? await this.transport.sendText(connection.id, chatId, text)
      : await this.deps.sendWeixinBridgeMessage?.({ accountId: connection.accountId!, to: connection.ownerId, text })
    if (!result?.ok) throw new Error('IM delivery was not confirmed')
  }
  async stop(): Promise<void> {
    this.stopping.abort()
    if (this.timer) clearTimeout(this.timer)
    for (const attempt of this.attempts.values()) this.cancelAttempt(attempt.id, attempt.roomId, attempt.cardId)
    setPrivateAgentWeixinHandler(undefined)
    await this.transport.stop()
    await Promise.allSettled([...this.jobs.values(), this.writes])
  }
}
