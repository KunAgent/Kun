import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile, unlink, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DEFAULT_WEIXIN_BRIDGE_RPC_URL } from '../shared/app-settings'
import {
  DEFAULT_API_TIMEOUT_MS,
  runtimeAbortController,
  WEIXIN_API_BASE_URL,
  WEIXIN_CDN_BASE_URL,
  WEIXIN_BRIDGE_STATE_DIR_NAME,
  WEIXIN_PLUGIN_ID,
  weixinBridgeState,
  type JsonRecord,
  type WeixinAccount,
  type WeixinAccountData,
  type WeixinBridgeRuntimeContext,
  type WeixinPackageInfo
} from './weixin-bridge-state'

const requireFromHere = createRequire(import.meta.url)

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function requestSignal(timeoutMs: number | undefined, signal?: AbortSignal): AbortSignal {
  const signals: AbortSignal[] = [runtimeAbortController.signal]
  if (signal) signals.push(signal)
  if (timeoutMs !== undefined) signals.push(AbortSignal.timeout(timeoutMs))
  return signals.length === 1 ? signals[0]! : AbortSignal.any(signals)
}

export function resolveRpcUrl(port = weixinBridgeState.activeBridgePort): string {
  const url = new URL(DEFAULT_WEIXIN_BRIDGE_RPC_URL)
  url.port = String(port)
  return url.toString()
}

export function configureWeixinBridgeRuntimeContextProvider(
  provider: (() => Promise<WeixinBridgeRuntimeContext>) | null
): void {
  weixinBridgeState.runtimeContextProvider = provider
}

export async function resolveRuntimeContext(): Promise<WeixinBridgeRuntimeContext> {
  return weixinBridgeState.runtimeContextProvider
    ? weixinBridgeState.runtimeContextProvider()
    : {
        webhookUrl: 'http://127.0.0.1:18787/claw/im',
        webhookSecret: '',
        channelId: ''
      }
}

export function resolvePackagePath(packageName: string, subpath: string): string | null {
  try {
    return requireFromHere.resolve(`${packageName}/${subpath}`)
  } catch {
    return null
  }
}

export function resolveWeixinPluginRoot(): string | null {
  const packageJson = resolvePackagePath('@tencent-weixin/openclaw-weixin', 'package.json')
  return packageJson ? dirname(packageJson) : null
}

export function readWeixinPackageInfo(): WeixinPackageInfo {
  if (weixinBridgeState.packageInfoCache) return weixinBridgeState.packageInfoCache
  const packageJson = resolvePackagePath('@tencent-weixin/openclaw-weixin', 'package.json')
  if (!packageJson) {
    throw new Error(
      'Built-in WeChat login component is missing. Reinstall Kun or rebuild with @tencent-weixin/openclaw-weixin bundled.'
    )
  }
  const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as JsonRecord
  weixinBridgeState.packageInfoCache = {
    version: typeof parsed.version === 'string' ? parsed.version : '0.0.0',
    appId: typeof parsed.ilink_appid === 'string' ? parsed.ilink_appid : 'bot'
  }
  return weixinBridgeState.packageInfoCache
}

export function buildClientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => Number.isFinite(part) ? part : 0)
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

export function buildBaseInfo(): JsonRecord {
  const info = readWeixinPackageInfo()
  return {
    channel_version: info.version,
    bot_agent: `Kun/${app.getVersion() || '0.0.0'}`
  }
}

export function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf8').toString('base64')
}

export function buildCommonHeaders(): Record<string, string> {
  const info = readWeixinPackageInfo()
  return {
    'iLink-App-Id': info.appId,
    'iLink-App-ClientVersion': String(buildClientVersion(info.version))
  }
}

export function buildHeaders(token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders(),
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {})
  }
}

export async function readJsonResponse(res: Response): Promise<JsonRecord> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) as JsonRecord : {}
  } catch {
    return { message: text.trim() || res.statusText }
  }
}

export async function apiGet(
  baseUrl: string,
  endpoint: string,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal
): Promise<JsonRecord> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: buildCommonHeaders(),
    signal: requestSignal(timeoutMs, signal)
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    throw new Error(`${label} ${res.status}: ${recordString(data, 'message') || JSON.stringify(data)}`)
  }
  return data
}

export async function apiPost(
  baseUrl: string,
  endpoint: string,
  body: JsonRecord,
  options: {
    token?: string
    timeoutMs?: number
    label: string
    signal?: AbortSignal
    /** Endpoint-aware business validation. HTTP 200 alone must not mean success. */
    validate?: (data: JsonRecord) => string | null
  }
): Promise<JsonRecord> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: buildHeaders(options.token),
    body: JSON.stringify(body),
    signal: requestSignal(options.timeoutMs, options.signal)
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    throw new Error(`${options.label} ${res.status}: ${recordString(data, 'message') || JSON.stringify(data)}`)
  }
  if (options.validate) {
    const businessError = options.validate(data)
    if (businessError) {
      // HTTP 200 with a business error body is a failed send; surface it instead
      // of reporting a fake success.
      throw new Error(`${options.label} ${businessError}: ${recordString(data, 'message') || JSON.stringify(data)}`)
    }
  }
  return data
}

/**
 * Shared business-level validator for message send endpoints. The WeChat bot
 * API returns HTTP 200 with `ret`/`errcode` set for failed operations, so a
 * status-code check alone would swallow errors (the "200 fake success" bug).
 */
export function validateWeixinBusinessOk(data: JsonRecord): string | null {
  const ret = data.ret ?? data.errcode ?? data.code
  if (ret !== undefined && ret !== null && Number(ret) !== 0) {
    return `business error ret=${String(ret)}`
  }
  if (data.ok === false) return 'business error ok=false'
  return null
}

export function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function recordString(record: JsonRecord, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function stateRoot(): string {
  return join(app.getPath('userData'), WEIXIN_BRIDGE_STATE_DIR_NAME)
}

export function weixinStateDir(): string {
  return join(stateRoot(), WEIXIN_PLUGIN_ID)
}

export function accountsIndexPath(): string {
  return join(weixinStateDir(), 'accounts.json')
}

export function accountsDir(): string {
  return join(weixinStateDir(), 'accounts')
}

export function accountPath(accountId: string): string {
  return join(accountsDir(), `${accountId}.json`)
}

export function syncBufPath(accountId: string): string {
  return join(accountsDir(), `${accountId}.sync.json`)
}

export function contextTokensPath(accountId: string): string {
  return join(accountsDir(), `${accountId}.context-tokens.json`)
}

export function configPath(): string {
  return join(stateRoot(), 'weixin-bridge.json')
}

export function legacyOpenClawConfigPath(): string {
  return join(stateRoot(), 'openclaw.json')
}

export function isBlockedObjectKey(value: string): boolean {
  return value === '__proto__' || value === 'prototype' || value === 'constructor'
}

export function normalizeAccountId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'default'
  const lowered = trimmed.toLowerCase()
  const normalized = /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(trimmed)
    ? lowered
    : lowered
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '')
        .slice(0, 64)
  return normalized && !isBlockedObjectKey(normalized) ? normalized : 'default'
}

export function deriveRawAccountId(normalizedId: string): string | undefined {
  if (normalizedId.endsWith('-im-bot')) return `${normalizedId.slice(0, -7)}@im.bot`
  if (normalizedId.endsWith('-im-wechat')) return `${normalizedId.slice(0, -10)}@im.wechat`
  return undefined
}

export async function ensureStateDirs(): Promise<void> {
  await mkdir(accountsDir(), { recursive: true })
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw) as unknown
}

export async function writeJsonIfChanged(filePath: string, value: unknown): Promise<void> {
  const next = `${JSON.stringify(value, null, 2)}\n`
  try {
    const current = await readFile(filePath, 'utf8')
    if (current === next) return
  } catch {
    /* create the file below */
  }
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temporaryPath, next, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temporaryPath, filePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export async function listIndexedWeixinAccountIds(): Promise<string[]> {
  try {
    const parsed = await readJsonFile(accountsIndexPath())
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : []
  } catch {
    return []
  }
}

export async function registerWeixinAccountId(accountId: string): Promise<void> {
  await ensureStateDirs()
  const existing = await listIndexedWeixinAccountIds()
  if (existing.includes(accountId)) return
  await writeJsonIfChanged(accountsIndexPath(), [...existing, accountId])
}

export async function unregisterWeixinAccountId(accountId: string): Promise<void> {
  const existing = await listIndexedWeixinAccountIds()
  const next = existing.filter((id) => id !== accountId)
  if (next.length !== existing.length) await writeJsonIfChanged(accountsIndexPath(), next)
}

export async function readAccountFile(filePath: string): Promise<WeixinAccountData | null> {
  try {
    const parsed = await readJsonFile(filePath)
    return asRecord(parsed) as WeixinAccountData
  } catch {
    return null
  }
}

export async function loadLegacyToken(): Promise<string | undefined> {
  try {
    const parsed = await readJsonFile(join(stateRoot(), 'credentials', WEIXIN_PLUGIN_ID, 'credentials.json'))
    const token = asRecord(parsed).token
    return typeof token === 'string' && token.trim() ? token.trim() : undefined
  } catch {
    return undefined
  }
}

export async function loadWeixinAccountData(accountId: string): Promise<WeixinAccountData | null> {
  const primary = await readAccountFile(accountPath(accountId))
  if (primary) return primary
  const rawId = deriveRawAccountId(accountId)
  if (rawId) {
    const compat = await readAccountFile(accountPath(rawId))
    if (compat) return compat
  }
  const legacyToken = await loadLegacyToken()
  return legacyToken ? { token: legacyToken } : null
}

export async function saveWeixinAccount(accountId: string, update: WeixinAccountData): Promise<void> {
  await ensureStateDirs()
  const existing = await loadWeixinAccountData(accountId) ?? {}
  const token = update.token?.trim() || existing.token?.trim()
  const baseUrl = update.baseUrl?.trim() || existing.baseUrl?.trim()
  const userId = update.userId !== undefined
    ? update.userId.trim() || undefined
    : existing.userId?.trim() || undefined
  await writeJsonIfChanged(accountPath(accountId), {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(userId ? { userId } : {})
  })
  await registerWeixinAccountId(accountId)
}

export async function clearWeixinAccount(accountId: string): Promise<void> {
  for (const filePath of [accountPath(accountId), syncBufPath(accountId), contextTokensPath(accountId)]) {
    try {
      await unlink(filePath)
    } catch {
      /* ignore */
    }
  }
  await unregisterWeixinAccountId(accountId)
}

export async function clearStaleAccountsForUserId(currentAccountId: string, userId: string): Promise<void> {
  if (!userId.trim()) return
  for (const id of await listIndexedWeixinAccountIds()) {
    if (id === currentAccountId) continue
    const data = await loadWeixinAccountData(id)
    if (data?.userId?.trim() === userId) await clearWeixinAccount(id)
  }
}

export async function resolveWeixinAccount(accountId: string): Promise<WeixinAccount> {
  const id = normalizeAccountId(accountId)
  const data = await loadWeixinAccountData(id)
  const token = data?.token?.trim()
  return {
    accountId: id,
    baseUrl: data?.baseUrl?.trim() || WEIXIN_API_BASE_URL,
    cdnBaseUrl: WEIXIN_CDN_BASE_URL,
    token,
    configured: Boolean(token),
    userId: data?.userId?.trim() || undefined
  }
}

export async function readBridgeConfig(): Promise<JsonRecord> {
  try {
    const parsed = await readJsonFile(configPath())
    return asRecord(parsed)
  } catch {
    try {
      const parsed = await readJsonFile(legacyOpenClawConfigPath())
      return asRecord(parsed)
    } catch {
      return {}
    }
  }
}

export async function prepareBridgeState(port: number): Promise<void> {
  if (!resolveWeixinPluginRoot()) {
    throw new Error(
      'Built-in WeChat login component is missing. Reinstall Kun or rebuild with @tencent-weixin/openclaw-weixin bundled.'
    )
  }
  await ensureStateDirs()
  await writeJsonIfChanged(configPath(), {
    gateway: {
      mode: 'local',
      bind: 'loopback',
      port,
      auth: { mode: 'none' }
    },
    channels: {
      [WEIXIN_PLUGIN_ID]: {
        enabled: true
      }
    }
  })
}
