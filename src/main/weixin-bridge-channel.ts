import { randomUUID } from 'node:crypto'
import { logError, logWarn } from './logger'
import {
  BACKOFF_DELAY_MS,
  contextTokenStore,
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_LONG_POLL_TIMEOUT_MS,
  LOGIN_TTL_MS,
  MessageItemType,
  MessageState,
  MessageType,
  monitors,
  QR_LONG_POLL_TIMEOUT_MS,
  RETRY_DELAY_MS,
  runtimeAbortController,
  WEIXIN_API_BASE_URL,
  WEIXIN_CDN_BASE_URL,
  WEIXIN_DEFAULT_BOT_TYPE,
  weixinBridgeState,
  activeLogins,
  type JsonRecord,
  type WeixinAccount,
  type WeixinLoginSession,
  type WeixinMessage,
  type WeixinMessageItem,
  type WeixinMonitor
} from './weixin-bridge-state'
import {
  apiGet,
  apiPost,
  asRecord,
  buildBaseInfo,
  clearStaleAccountsForUserId,
  clearWeixinAccount,
  contextTokensPath,
  listIndexedWeixinAccountIds,
  loadWeixinAccountData,
  normalizeAccountId,
  readBridgeConfig,
  readJsonResponse,
  readJsonFile,
  readWeixinPackageInfo,
  recordString,
  resolveRuntimeContext,
  resolveWeixinAccount,
  saveWeixinAccount,
  sleep,
  requestSignal,
  syncBufPath,
  validateWeixinBusinessOk,
  writeJsonIfChanged
} from './weixin-bridge-storage'

export function isLoginFresh(login: WeixinLoginSession): boolean {
  return Date.now() - login.startedAt < LOGIN_TTL_MS
}

export function purgeExpiredLogins(): void {
  for (const [key, login] of activeLogins) {
    if (!isLoginFresh(login)) activeLogins.delete(key)
  }
}

export async function localTokenList(): Promise<string[]> {
  const ids = await listIndexedWeixinAccountIds()
  const tokens: string[] = []
  for (let index = ids.length - 1; index >= 0 && tokens.length < 10; index -= 1) {
    const data = await loadWeixinAccountData(ids[index])
    const token = data?.token?.trim()
    if (token) tokens.push(token)
  }
  return tokens
}

export async function fetchQRCode(botType = WEIXIN_DEFAULT_BOT_TYPE): Promise<JsonRecord> {
  return apiPost(
    WEIXIN_API_BASE_URL,
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    { local_token_list: await localTokenList() },
    { label: 'fetchQRCode' }
  )
}

export async function pollQRStatus(baseUrl: string, qrcode: string, signal?: AbortSignal): Promise<JsonRecord> {
  try {
    return await apiGet(
      baseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      QR_LONG_POLL_TIMEOUT_MS,
      'pollQRStatus',
      signal
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return { status: 'wait' }
    logWarn('weixin-bridge', 'QR status polling failed; retrying.', {
      message: error instanceof Error ? error.message : String(error)
    })
    return { status: 'wait' }
  }
}

export async function startWeixinLogin(params: JsonRecord): Promise<JsonRecord> {
  readWeixinPackageInfo()
  purgeExpiredLogins()
  const force = params.force === true
  const sessionKey = recordString(params, 'accountId') || randomUUID()
  const existing = activeLogins.get(sessionKey)
  if (!force && existing && isLoginFresh(existing) && existing.qrcodeUrl) {
    return {
      qrcode: existing.qrcodeUrl,
      qrUrl: existing.qrcodeUrl,
      qrDataUrl: existing.qrcodeUrl,
      sessionKey,
      message: '二维码已显示，请用手机微信扫描。'
    }
  }

  const qr = await fetchQRCode(recordString(params, 'botType') || WEIXIN_DEFAULT_BOT_TYPE)
  const qrcode = recordString(qr, 'qrcode')
  const qrcodeUrl = recordString(qr, 'qrcode_img_content') || recordString(qr, 'qrcodeUrl')
  if (!qrcode || !qrcodeUrl) {
    throw new Error(recordString(qr, 'message') || 'WeChat QR response is incomplete.')
  }
  activeLogins.set(sessionKey, {
    sessionKey,
    qrcode,
    qrcodeUrl,
    startedAt: Date.now(),
    currentApiBaseUrl: WEIXIN_API_BASE_URL
  })
  return {
    qrcode: qrcodeUrl,
    qrUrl: qrcodeUrl,
    qrDataUrl: qrcodeUrl,
    sessionKey,
    message: '用手机微信扫描二维码，以继续连接。'
  }
}

export async function waitForWeixinLogin(params: JsonRecord): Promise<JsonRecord> {
  const sessionKey = recordString(params, 'accountId') || recordString(params, 'sessionKey')
  const login = activeLogins.get(sessionKey)
  if (!login) return { connected: false, message: '当前没有进行中的登录，请先发起登录。' }
  if (!isLoginFresh(login)) {
    activeLogins.delete(sessionKey)
    return { connected: false, message: '二维码已过期，请重新生成。' }
  }

  const timeoutMs = Math.max(Number(params.timeoutMs) || 480_000, 1_000)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const signal = runtimeAbortController.signal
    if (signal.aborted) return { connected: false, message: '微信连接已停止。' }
    const status = await pollQRStatus(
      login.currentApiBaseUrl ?? WEIXIN_API_BASE_URL,
      login.qrcode,
      signal
    )
    switch (recordString(status, 'status')) {
      case 'wait':
      case 'scaned':
        break
      case 'need_verifycode':
        return {
          connected: false,
          message: '微信要求输入手机端验证码。当前 GUI 登录流程暂不支持验证码，请重新生成二维码后再试。'
        }
      case 'expired':
        activeLogins.delete(sessionKey)
        return { connected: false, message: '二维码已过期，请重新生成。' }
      case 'verify_code_blocked':
        activeLogins.delete(sessionKey)
        return { connected: false, message: '多次输入错误，连接流程已停止。请稍后再试。' }
      case 'binded_redirect':
        activeLogins.delete(sessionKey)
        return {
          connected: true,
          alreadyConnected: true,
          accountId: normalizeAccountId(sessionKey),
          sessionKey,
          message: '已连接过此 Kun，无需重复连接。'
        }
      case 'scaned_but_redirect': {
        const redirectHost = recordString(status, 'redirect_host')
        if (redirectHost) login.currentApiBaseUrl = `https://${redirectHost}`
        break
      }
      case 'confirmed': {
        const rawAccountId = recordString(status, 'ilink_bot_id')
        const token = recordString(status, 'bot_token')
        if (!rawAccountId || !token) {
          activeLogins.delete(sessionKey)
          return { connected: false, message: '登录失败：服务器未返回完整账号信息。' }
        }
        const accountId = normalizeAccountId(rawAccountId)
        const baseUrl = recordString(status, 'baseurl') || WEIXIN_API_BASE_URL
        const userId = recordString(status, 'ilink_user_id')
        await saveWeixinAccount(accountId, { token, baseUrl, userId })
        await clearStaleAccountsForUserId(accountId, userId)
        activeLogins.delete(sessionKey)
        return {
          connected: true,
          accountId,
          sessionKey,
          baseUrl,
          userId,
          message: '已将此 Kun 连接到微信。'
        }
      }
    }
    await sleep(1_000, signal)
  }
  activeLogins.delete(sessionKey)
  return { connected: false, message: '登录超时，请重试。' }
}

const contextTokenPersistenceTails = new Map<string, Promise<void>>()

export function contextTokenKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`
}

export async function persistContextTokens(accountId: string): Promise<void> {
  const prefix = `${accountId}:`
  const tokens: Record<string, string> = {}
  for (const [key, value] of contextTokenStore) {
    if (key.startsWith(prefix)) tokens[key.slice(prefix.length)] = value
  }
  await writeJsonIfChanged(contextTokensPath(accountId), tokens)
}

export async function restoreContextTokens(accountId: string): Promise<void> {
  try {
    const parsed = await readJsonFile(contextTokensPath(accountId))
    for (const [userId, token] of Object.entries(asRecord(parsed))) {
      if (typeof token === 'string' && token) {
        const key = contextTokenKey(accountId, userId)
        if (!contextTokenStore.has(key)) contextTokenStore.set(key, token)
      }
    }
  } catch {
    /* no persisted tokens */
  }
}

export async function setContextToken(accountId: string, userId: string, token: string): Promise<void> {
  contextTokenStore.set(contextTokenKey(accountId, userId), token)
  const previous = contextTokenPersistenceTails.get(accountId) ?? Promise.resolve()
  const pending = previous.then(() => persistContextTokens(accountId))
  contextTokenPersistenceTails.set(accountId, pending)
  try {
    await pending
  } finally {
    if (contextTokenPersistenceTails.get(accountId) === pending) contextTokenPersistenceTails.delete(accountId)
  }
}

export function getContextToken(accountId: string, userId: string): string | undefined {
  return contextTokenStore.get(contextTokenKey(accountId, userId))
}

export async function loadSyncBuf(accountId: string): Promise<string> {
  try {
    const parsed = await readJsonFile(syncBufPath(accountId))
    const value = asRecord(parsed).get_updates_buf
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

export async function saveSyncBuf(accountId: string, getUpdatesBuf: string): Promise<void> {
  await writeJsonIfChanged(syncBufPath(accountId), { get_updates_buf: getUpdatesBuf })
}

export async function notifyStart(account: WeixinAccount): Promise<void> {
  await apiPost(
    account.baseUrl,
    'ilink/bot/msg/notifystart',
    { base_info: buildBaseInfo() },
    { token: account.token, timeoutMs: 10_000, label: 'notifyStart' }
  )
}

export async function notifyStop(account: WeixinAccount): Promise<void> {
  await apiPost(
    account.baseUrl,
    'ilink/bot/msg/notifystop',
    { base_info: buildBaseInfo() },
    { token: account.token, timeoutMs: 10_000, label: 'notifyStop' }
  )
}

export async function getUpdates(
  account: WeixinAccount,
  getUpdatesBuf: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<JsonRecord> {
  try {
    return await apiPost(
      account.baseUrl,
      'ilink/bot/getupdates',
      {
        get_updates_buf: getUpdatesBuf,
        base_info: buildBaseInfo()
      },
      { token: account.token, timeoutMs, label: 'getUpdates', ...(signal ? { signal } : {}) }
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf }
    }
    throw error
  }
}

export function generateMessageId(): string {
  return `kun-weixin-${randomUUID()}`
}

export async function sendMessageWeixin(params: {
  account: WeixinAccount
  to: string
  text: string
  contextToken?: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<{ messageId: string }> {
  const messageId = generateMessageId()
  await apiPost(
    params.account.baseUrl,
    'ilink/bot/sendmessage',
    {
      msg: {
        from_user_id: '',
        to_user_id: params.to,
        client_id: messageId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: params.text } }],
        context_token: params.contextToken
      },
      base_info: buildBaseInfo()
    },
    {
      token: params.account.token,
      timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
      label: 'sendMessage',
      validate: validateWeixinBusinessOk,
      ...(params.signal ? { signal: params.signal } : {})
    }
  )
  return { messageId }
}

export function textFromItemList(itemList: unknown): string {
  if (!Array.isArray(itemList)) return ''
  for (const item of itemList) {
    const record = asRecord(item)
    if (record.type === MessageItemType.TEXT) {
      const text = asRecord(record.text_item).text
      if (text != null) return String(text).trim()
    }
    if (record.type === MessageItemType.VOICE) {
      const text = asRecord(record.voice_item).text
      if (text != null) return String(text).trim()
    }
  }
  return ''
}

export function buildWebhookMessage(message: WeixinMessage, accountId: string, text: string): JsonRecord {
  const from = message.from_user_id || ''
  return {
    provider: 'weixin',
    platform: 'weixin',
    text,
    sender: from || 'WeChat',
    from,
    chatId: from,
    messageId: message.message_id || generateMessageId(),
    senderId: from,
    senderName: from || 'WeChat',
    threadId: '',
    message: {
      provider: 'weixin',
      text,
      sender: from || 'WeChat',
      accountId
    }
  }
}

export const MAX_WEBHOOK_FILES_PER_REPLY = 3

export type WeixinOutboundFile = { path: string; fileName: string }

/**
 * Generated files the Claw webhook attached to its reply (already gated and
 * workspace-validated on the GUI side). Capped defensively; the webhook caps
 * extraction at the same count.
 */
export function webhookGeneratedFiles(result: JsonRecord): WeixinOutboundFile[] {
  if (!Array.isArray(result.files)) return []
  const files: WeixinOutboundFile[] = []
  for (const entry of result.files) {
    const record = asRecord(entry)
    const path = recordString(record, 'path')
    if (!path) continue
    files.push({
      path,
      fileName: recordString(record, 'fileName') || path.split(/[\\/]/).pop() || 'attachment'
    })
    if (files.length >= MAX_WEBHOOK_FILES_PER_REPLY) break
  }
  return files
}

export type SendWeixinMediaFile = (params: {
  filePath: string
  to: string
  text: string
  opts: { baseUrl: string; token?: string; timeoutMs?: number; contextToken?: string }
  cdnBaseUrl: string
}) => Promise<{ messageId: string }>

let sendWeixinMediaFilePromise: Promise<SendWeixinMediaFile> | null = null

/**
 * The CDN upload + media message protocol lives in the bundled WeChat plugin.
 * Loaded lazily so a broken install degrades to a text notice instead of
 * failing this whole module at startup.
 */
export function loadSendWeixinMediaFile(): Promise<SendWeixinMediaFile> {
  sendWeixinMediaFilePromise ??= import('@tencent-weixin/openclaw-weixin/dist/src/messaging/send-media.js')
    .then((mod) => mod.sendWeixinMediaFile)
    .catch((error) => {
      sendWeixinMediaFilePromise = null
      throw error
    })
  return sendWeixinMediaFilePromise
}

/**
 * Upload each generated file to the WeChat C2C CDN and deliver it as an
 * image / video / file message (routed by MIME). A failed file degrades to a
 * text notice instead of failing the whole reply.
 */
export async function sendGeneratedFilesWeixin(
  account: WeixinAccount,
  to: string,
  files: readonly WeixinOutboundFile[],
  contextToken: string | undefined,
  signal?: AbortSignal
): Promise<void> {
  for (const file of files) {
    if (signal?.aborted) return
    try {
      const sendWeixinMediaFile = await loadSendWeixinMediaFile()
      await sendWeixinMediaFile({
        filePath: file.path,
        to,
        text: '',
        opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
        cdnBaseUrl: account.cdnBaseUrl
      })
    } catch (error) {
      logWarn('weixin-bridge', 'Failed to send generated file to WeChat.', {
        accountId: account.accountId,
        filePath: file.path,
        message: error instanceof Error ? error.message : String(error)
      })
      await sendMessageWeixin({
        account,
        to,
        text: `文件 ${file.fileName} 发送失败，请稍后再试。`,
        contextToken,
        ...(signal ? { signal } : {})
      }).catch(() => undefined)
    }
  }
}

export async function postToDeepSeekGuiWebhook(
  message: WeixinMessage,
  accountId: string,
  signal?: AbortSignal
): Promise<JsonRecord> {
  const settings = await resolveRuntimeContext()
  const text = textFromItemList(message.item_list)
  if (!text) return { reply: 'Only text messages are supported right now.' }
  const body = {
    ...buildWebhookMessage(message, accountId, text),
    channelId: settings.channelId || undefined
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (settings.webhookSecret) {
    headers.authorization = `Bearer ${settings.webhookSecret}`
    // 同时带新旧两个 secret 头:接收端可能还是只认旧头的老版本。
    headers['x-kun-secret'] = settings.webhookSecret
    headers['x-deepseek-gui-secret'] = settings.webhookSecret
  }
  const res = await fetch(settings.webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: requestSignal(650_000, signal)
  })
  const data = await readJsonResponse(res)
  const reply = recordString(data, 'reply') || recordString(data, 'text')
  if (reply) return data
  if (!res.ok || data.ok === false) {
    throw new Error(recordString(data, 'message') || `Kun webhook HTTP ${res.status}`)
  }
  return data
}

export async function monitorWeixinAccount(accountId: string, signal: AbortSignal): Promise<void> {
  const account = await resolveWeixinAccount(accountId)
  if (!account.configured || !account.token?.trim()) {
    throw new Error(`WeChat account is not configured: ${accountId}`)
  }
  await restoreContextTokens(account.accountId)
  try {
    await notifyStart(account)
  } catch {
    /* best-effort */
  }

  let getUpdatesBuf = await loadSyncBuf(account.accountId)
  let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS
  let consecutiveFailures = 0
  // Per-sender dispatch chains. A single agent turn can run for minutes;
  // awaiting it inside the long-poll loop froze the whole channel for
  // every chat until that turn finished (or hit the webhook timeout).
  // Chaining per sender keeps one conversation ordered while other chats
  // and the poll loop keep moving.
  const senderChains = new Map<string, Promise<void>>()
  const dispatchToSender = (message: WeixinMessage, to: string, contextToken: string | undefined): void => {
    const task = async (): Promise<void> => {
      if (signal.aborted) return
      const result = await postToDeepSeekGuiWebhook(message, account.accountId, signal)
      if (signal.aborted) return
      const reply = recordString(result, 'reply') || recordString(result, 'text')
      if (reply) {
        await sendMessageWeixin({
          account,
          to,
          text: reply,
          contextToken,
          signal
        })
      }
      // Generated media files arrive alongside the text reply and go out as
      // native image / file messages.
      await sendGeneratedFilesWeixin(account, to, webhookGeneratedFiles(result), contextToken, signal)
    }
    const chained = (senderChains.get(to) ?? Promise.resolve())
      .then(task)
      .catch((error) => {
        if (signal.aborted) return
        logWarn('weixin-bridge', 'WeChat message dispatch failed.', {
          accountId: account.accountId,
          message: error instanceof Error ? error.message : String(error)
        })
      })
    senderChains.set(to, chained)
    void chained.finally(() => {
      if (senderChains.get(to) === chained) senderChains.delete(to)
    })
  }
  while (!signal.aborted) {
    try {
      const resp = await getUpdates(account, getUpdatesBuf, nextTimeoutMs, signal)
      if (signal.aborted) break
      if (typeof resp.longpolling_timeout_ms === 'number' && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms
      }
      const ret = Number(resp.ret ?? 0)
      const errcode = Number(resp.errcode ?? 0)
      if (ret !== 0 || errcode !== 0) {
        consecutiveFailures += 1
        await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS, signal)
        if (consecutiveFailures >= 3) consecutiveFailures = 0
        continue
      }
      consecutiveFailures = 0
      const nextBuf = typeof resp.get_updates_buf === 'string' ? resp.get_updates_buf : ''
      if (nextBuf) {
        getUpdatesBuf = nextBuf
        await saveSyncBuf(account.accountId, getUpdatesBuf)
      }
      const messages = Array.isArray(resp.msgs) ? resp.msgs as WeixinMessage[] : []
      for (const message of messages) {
        if (signal.aborted) break
        if (message.message_type === MessageType.BOT) continue
        const to = message.from_user_id || ''
        if (!to) continue
        const contextToken = message.context_token || undefined
        if (contextToken) await setContextToken(account.accountId, to, contextToken)
        dispatchToSender(message, to, contextToken)
      }
    } catch (error) {
      if (signal.aborted) break
      logWarn('weixin-bridge', 'WeChat monitor iteration failed.', {
        accountId: account.accountId,
        message: error instanceof Error ? error.message : String(error)
      })
      consecutiveFailures += 1
      await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS, signal)
      if (consecutiveFailures >= 3) consecutiveFailures = 0
    }
  }

  await Promise.allSettled([...senderChains.values()])

  try {
    await notifyStop(account)
  } catch {
    /* best-effort */
  }
}

export async function startAccountMonitor(accountId: string): Promise<void> {
  if (weixinBridgeState.runtimeStopped) return
  const normalized = normalizeAccountId(accountId)
  const existing = monitors.get(normalized)
  if (existing && !existing.controller.signal.aborted) return
  if (existing) await existing.promise
  const controller = new AbortController()
  const promise = monitorWeixinAccount(normalized, controller.signal).catch((error) => {
    if (!controller.signal.aborted) {
      logError('weixin-bridge', 'WeChat monitor stopped.', {
        accountId: normalized,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }).finally(() => {
    if (monitors.get(normalized)?.controller === controller) monitors.delete(normalized)
  })
  monitors.set(normalized, { accountId: normalized, controller, promise })
}

export async function startWeixinChannels(params: JsonRecord): Promise<JsonRecord> {
  if (weixinBridgeState.runtimeStopped) return { started: [] }
  const requestedAccountId = recordString(params, 'accountId')
  const accountIds = requestedAccountId
    ? [normalizeAccountId(requestedAccountId)]
    : await listIndexedWeixinAccountIds()
  for (const accountId of accountIds) await startAccountMonitor(accountId)
  return { started: accountIds }
}

export async function stopWeixinChannels(params: JsonRecord): Promise<JsonRecord> {
  const requestedAccountId = recordString(params, 'accountId')
  const targets = requestedAccountId ? [normalizeAccountId(requestedAccountId)] : [...monitors.keys()]
  const active = targets.flatMap((accountId) => {
    const monitor = monitors.get(accountId)
    if (!monitor) return []
    monitor.controller.abort()
    return [monitor]
  })
  await Promise.allSettled(active.map((monitor) => monitor.promise))
  for (const monitor of active) {
    if (monitors.get(monitor.accountId) === monitor) monitors.delete(monitor.accountId)
  }
  return { stopped: targets }
}
