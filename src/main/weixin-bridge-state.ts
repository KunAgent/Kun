import type { Server as HttpServer } from 'node:http'

export const WEIXIN_BRIDGE_PORT = 18790
export const WEIXIN_BRIDGE_MAX_PORT_ATTEMPTS = 20
export const WEIXIN_BRIDGE_HEALTH_TIMEOUT_MS = 3_000
export const WEIXIN_BRIDGE_STATE_DIR_NAME = 'weixin-bridge'
export const WEIXIN_PLUGIN_ID = 'openclaw-weixin'
export const WEIXIN_API_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const WEIXIN_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
export const WEIXIN_DEFAULT_BOT_TYPE = '3'
export const LOGIN_TTL_MS = 5 * 60_000
export const QR_LONG_POLL_TIMEOUT_MS = 35_000
export const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
export const DEFAULT_API_TIMEOUT_MS = 15_000
export const RETRY_DELAY_MS = 2_000
export const BACKOFF_DELAY_MS = 30_000
export const MessageType = {
  BOT: 2
} as const
export const MessageItemType = {
  TEXT: 1,
  VOICE: 3
} as const
export const MessageState = {
  FINISH: 2
} as const

export type JsonRecord = Record<string, unknown>

export type WeixinBridgeRuntimeContext = {
  webhookUrl: string
  webhookSecret: string
  channelId: string
  resolveLocalSendTarget?: (
    channelId: string,
    conversationId: string
  ) =>
    | { ok: true; accountId: string; to: string }
    | { ok: false; code: 'channel_not_found' | 'conversation_not_found' | 'channel_not_configured'; message: string }
}

export type WeixinPackageInfo = {
  version: string
  appId: string
}

export type WeixinLoginSession = {
  sessionKey: string
  qrcode: string
  qrcodeUrl: string
  startedAt: number
  currentApiBaseUrl?: string
}

export type WeixinAccountData = {
  token?: string
  baseUrl?: string
  userId?: string
}

export type WeixinAccount = {
  accountId: string
  baseUrl: string
  cdnBaseUrl: string
  token?: string
  configured: boolean
  userId?: string
}

export type WeixinMessageItem = {
  type?: number
  text_item?: { text?: unknown }
  voice_item?: { text?: unknown }
}

export type WeixinMessage = {
  message_id?: string
  message_type?: number
  from_user_id?: string
  create_time_ms?: number
  context_token?: string
  item_list?: WeixinMessageItem[]
}

export type WeixinMonitor = {
  accountId: string
  controller: AbortController
  promise: Promise<void>
}

export type WeixinBridgeSendResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string }

export const weixinBridgeState = {
  server: null as HttpServer | null,
  startPromise: null as Promise<string> | null,
  runtimeContextProvider: null as (() => Promise<WeixinBridgeRuntimeContext>) | null,
  activeBridgePort: WEIXIN_BRIDGE_PORT,
  packageInfoCache: null as WeixinPackageInfo | null,
  runtimeStopped: false
}
export const activeLogins = new Map<string, WeixinLoginSession>()
export const contextTokenStore = new Map<string, string>()
export const monitors = new Map<string, WeixinMonitor>()
export const runtimeAbortController = new AbortController()
