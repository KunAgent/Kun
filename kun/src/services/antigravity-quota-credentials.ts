import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { jwtClaims, protobufLengthFields, readSqliteValue } from './provider-subscription-quota-opencode-cookie.js'
import { isBase64, optionalRecord, requireRecord, stringValue } from './provider-subscription-quota-support.js'
import type { GoogleCredential, ProbeContext } from './provider-subscription-quota-service.js'

const execFileAsync = promisify(execFile)
const MAX_TOKEN_FILE_BYTES = 65_536
const MAX_JS_BUNDLE_BYTES = 32 * 1024 * 1024
const MAX_BINARY_SCAN_BYTES = 400 * 1024 * 1024
const STREAM_CHUNK_BYTES = 1024 * 1024
const STREAM_OVERLAP_BYTES = 256
const EXPIRY_SKEW_MS = 60_000
const OAUTH_REFRESH_TIMEOUT_MS = 12_000
const PERSONAL_CLIENT_PREFIX = '1071006060591-'
const JS_MARKER = 'vs/platform/cloudCode/common/oauthClient.js'
const GO_KEYRING_B64_PREFIX = 'go-keyring-base64:'
const CLIENT_ID_PATTERN = '[0-9]{10,}-[A-Za-z0-9_-]{24,}\\.apps\\.googleusercontent\\.com'
const CLIENT_SECRET_PATTERN = 'GOCSPX-[A-Za-z0-9_-]{28}'
const JS_CLIENT_ID_PATTERN = '[0-9]+-[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.com'

/**
 * Scanner patterns for `discoverAntigravityOAuthClients`. Callers only override them in tests, so
 * fixtures can use synthetic tokens instead of strings shaped like real Google OAuth credentials.
 */
export type AntigravityOAuthPatterns = {
  clientId: string
  clientSecret: string
}

export type AntigravityOAuthClient = {
  clientId: string
  clientSecret: string
}

export type StoredAntigravityOAuthCredentials = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountEmail?: string
  isBusiness?: boolean
}

export type AntigravityCredentialDeps = {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  readKeychain?: () => Promise<string | undefined>
  readSqliteValue?: (dbPath: string, key: string) => Promise<string | undefined>
  discoverClients?: () => Promise<AntigravityOAuthClient[]>
  jsPaths?: string[]
  binaryPaths?: string[]
}

export const antigravityQuotaCredentialCache = new Map<string, StoredAntigravityOAuthCredentials>()
let cachedOAuthClients: AntigravityOAuthClient[] | undefined

export function clearAntigravityQuotaCredentialCache(): void {
  antigravityQuotaCredentialCache.clear()
}

export function clearAntigravityOAuthClientCache(): void {
  cachedOAuthClients = undefined
}

export function decodeGoKeyringSecret(raw: string): string {
  let value = raw.trim()
  if (!value) return ''
  if (value.length >= 4 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/u.test(value)) {
    const hexDecoded = Buffer.from(value, 'hex').toString('utf8')
    if (hexDecoded.startsWith(GO_KEYRING_B64_PREFIX) || hexDecoded.startsWith('{')) {
      value = hexDecoded
    }
  }
  if (value.startsWith(GO_KEYRING_B64_PREFIX)) {
    return Buffer.from(value.slice(GO_KEYRING_B64_PREFIX.length), 'base64').toString('utf8')
  }
  return value
}

export function parseStoredAntigravityToken(raw: string): StoredAntigravityOAuthCredentials | undefined {
  const decoded = decodeGoKeyringSecret(raw)
  if (!decoded) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(decoded)
  } catch {
    return undefined
  }
  const obj = optionalRecord(parsed)
  if (!obj) return undefined
  const nested = optionalRecord(obj.token)
  const accessToken =
    stringValue(obj.access_token) ||
    stringValue(obj.accessToken) ||
    stringValue(nested?.access_token) ||
    stringValue(nested?.accessToken)
  const refreshToken =
    stringValue(obj.refresh_token) ||
    stringValue(obj.refreshToken) ||
    stringValue(nested?.refresh_token) ||
    stringValue(nested?.refreshToken)
  if (!accessToken && !refreshToken) return undefined
  const expiresAt = parseTokenExpiry(
    obj.expiry ?? obj.expires_at ?? obj.expiry_date ??
    nested?.expiry ?? nested?.expires_at ?? nested?.expiry_date
  )
  const idToken =
    stringValue(obj.id_token) ||
    stringValue(obj.idToken) ||
    stringValue(nested?.id_token) ||
    stringValue(nested?.idToken)
  const accountEmail =
    stringValue(obj.id_token_email) ||
    stringValue(obj.email) ||
    stringValue(nested?.id_token_email) ||
    stringValue(nested?.email) ||
    (idToken ? stringValue(jwtClaims(idToken)?.email) : '')
  const authMethod = stringValue(obj.auth_method) || stringValue(nested?.auth_method)
  const isBusiness = Boolean(
    obj.is_business ||
    obj.enable_business_login ||
    nested?.is_business ||
    nested?.enable_business_login ||
    /business/i.test(authMethod)
  )
  return {
    accessToken,
    refreshToken,
    expiresAt,
    ...(accountEmail ? { accountEmail } : {}),
    ...(isBusiness ? { isBusiness } : {})
  }
}

function parseTokenExpiry(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 100_000_000_000 ? value * 1_000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

export function antigravityStateDbPaths(options: {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
} = {}): string[] {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home || env.HOME || env.USERPROFILE || homedir()
  const apps = ['Antigravity', 'Antigravity IDE'] as const
  if (platform === 'darwin') {
    return apps.map((app) => join(home, 'Library', 'Application Support', app, 'User', 'globalStorage', 'state.vscdb'))
  }
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || join(home, 'AppData', 'Roaming')
    return apps.map((app) => join(appData, app, 'User', 'globalStorage', 'state.vscdb'))
  }
  if (platform === 'linux') {
    const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, '.config')
    return apps.map((app) => join(configHome, app, 'User', 'globalStorage', 'state.vscdb'))
  }
  return []
}

export function decodeAntigravityUnifiedOAuth(value: string | undefined): {
  accessToken?: string
  refreshToken?: string
} | undefined {
  if (!value || !isBase64(value)) return undefined
  const outerFields = protobufLengthFields(Buffer.from(value, 'base64'))
  for (const entry of outerFields.filter((field) => field.number === 1)) {
    const entryFields = protobufLengthFields(entry.value)
    const key = entryFields.find((field) => field.number === 1)?.value.toString('utf8')
    if (key !== 'oauthTokenInfoSentinelKey') continue
    const wrapper = entryFields.find((field) => field.number === 2)?.value
    const encoded = wrapper
      ? protobufLengthFields(wrapper).find((field) => field.number === 1)?.value.toString('utf8')
      : undefined
    if (!encoded || !isBase64(encoded)) return undefined
    const tokenFields = protobufLengthFields(Buffer.from(encoded, 'base64'))
    const accessToken = tokenFields.find((field) => field.number === 1)?.value.toString('utf8').trim()
    const refreshToken = tokenFields.find((field) => field.number === 3)?.value.toString('utf8').trim()
    if (!accessToken && !refreshToken) return undefined
    return {
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {})
    }
  }
  return undefined
}

async function readNativeTokenFile(home: string): Promise<StoredAntigravityOAuthCredentials | undefined> {
  const tokenPath = join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(tokenPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_TOKEN_FILE_BYTES) return undefined
    const buf = Buffer.alloc(MAX_TOKEN_FILE_BYTES + 1)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    if (bytesRead > MAX_TOKEN_FILE_BYTES) return undefined
    return parseStoredAntigravityToken(buf.subarray(0, bytesRead).toString('utf8'))
  } catch {
    return undefined
  } finally {
    await handle?.close()
  }
}

async function readNativeKeychainToken(
  home: string,
  deps: AntigravityCredentialDeps
): Promise<StoredAntigravityOAuthCredentials | undefined> {
  const platform = deps.platform ?? process.platform
  if (platform !== 'darwin') return undefined
  if (!deps.readKeychain && resolve(home) !== resolve(deps.home ?? homedir())) return undefined
  try {
    const raw = deps.readKeychain
      ? await deps.readKeychain()
      : (await execFileAsync('/usr/bin/security', [
          'find-generic-password', '-s', 'gemini', '-a', 'antigravity', '-w'
        ], { encoding: 'utf8', timeout: 8_000, maxBuffer: 256 * 1024, env: deps.env })).stdout
    return raw ? parseStoredAntigravityToken(raw) : undefined
  } catch {
    return undefined
  }
}

async function readDesktopStateDbToken(
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string },
  readValue: (dbPath: string, key: string) => Promise<string | undefined>
): Promise<StoredAntigravityOAuthCredentials | undefined> {
  for (const dbPath of antigravityStateDbPaths(options)) {
    const [authStatusValue, unifiedTokenValue] = await Promise.all([
      readValue(dbPath, 'antigravityAuthStatus'),
      readValue(dbPath, 'antigravityUnifiedStateSync.oauthToken')
    ])
    if (!authStatusValue && !unifiedTokenValue) continue
    let accountEmail = ''
    let fallbackAccessToken = ''
    try {
      const record = requireRecord(JSON.parse(authStatusValue ?? ''), 'Invalid Antigravity login state.')
      fallbackAccessToken = stringValue(record.apiKey)
      accountEmail = stringValue(record.email)
    } catch {
      // Unified OAuth entry may still provide usable tokens.
    }
    const unified = decodeAntigravityUnifiedOAuth(unifiedTokenValue)
    const accessToken = unified?.accessToken || fallbackAccessToken
    const refreshToken = unified?.refreshToken || ''
    if (accessToken || refreshToken) {
      return { accessToken, refreshToken, expiresAt: 0, ...(accountEmail ? { accountEmail } : {}) }
    }
  }
  return undefined
}

function oauthCandidatePaths(deps: {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
} = {}): { jsPaths: string[]; binaryPaths: string[] } {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  const home = deps.home || env.HOME || env.USERPROFILE || homedir()
  const pathDirs = (env.PATH ?? '').split(delimiter).map((dir) => dir.trim()).filter(Boolean)
  const agyName = platform === 'win32' ? 'agy.exe' : 'agy'
  const pathAgy = pathDirs.map((dir) => join(dir, agyName))
  if (platform === 'darwin') {
    return {
      jsPaths: [
        join('/Applications', 'Antigravity IDE.app', 'Contents', 'Resources', 'app', 'out', 'main.js'),
        join(home, 'Applications', 'Antigravity IDE.app', 'Contents', 'Resources', 'app', 'out', 'main.js')
      ],
      binaryPaths: dedupePaths([
        join('/Applications', 'Antigravity.app', 'Contents', 'Resources', 'bin', 'language_server'),
        join(home, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'bin', 'language_server'),
        join(home, '.local', 'bin', 'agy'),
        '/opt/homebrew/bin/agy',
        '/usr/local/bin/agy',
        ...pathAgy
      ])
    }
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local')
    return {
      jsPaths: [join(localAppData, 'Programs', 'Antigravity IDE', 'resources', 'app', 'out', 'main.js')],
      binaryPaths: dedupePaths([
        join(localAppData, 'Programs', 'Antigravity', 'resources', 'bin', 'language_server.exe'),
        join(home, '.local', 'bin', 'agy.exe'),
        ...pathAgy
      ])
    }
  }
  if (platform === 'linux') {
    return {
      jsPaths: [
        '/usr/share/antigravity-ide/resources/app/out/main.js',
        '/opt/Antigravity IDE/resources/app/out/main.js'
      ],
      binaryPaths: dedupePaths([
        '/opt/Antigravity/resources/bin/language_server',
        '/usr/share/antigravity/resources/bin/language_server',
        join(home, '.local', 'bin', 'agy'),
        '/usr/local/bin/agy',
        ...pathAgy
      ])
    }
  }
  return { jsPaths: [], binaryPaths: [] }
}

function dedupePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.filter(Boolean))]
}

async function scanJsOAuthClients(
  filePath: string,
  patterns: AntigravityOAuthPatterns
): Promise<AntigravityOAuthClient[]> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, constants.O_RDONLY)
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_JS_BUNDLE_BYTES) return []
    const content = await readFile(handle, 'utf8')
    const start = Math.max(0, content.indexOf(JS_MARKER))
    const scope = content.slice(start, start + 4_000)
    const clientId = scope.match(new RegExp(patterns.clientId, 'u'))?.[0]
    const clientSecret = scope.match(new RegExp(patterns.clientSecret, 'u'))?.[0]
    return clientId && clientSecret ? [{ clientId, clientSecret }] : []
  } catch {
    return []
  } finally {
    await handle?.close()
  }
}

async function scanBinaryOAuthClients(
  filePath: string,
  patterns: AntigravityOAuthPatterns
): Promise<AntigravityOAuthClient[]> {
  const clientIdRe = new RegExp(`(?:^|[^0-9])(${patterns.clientId})`, 'g')
  const clientSecretRe = new RegExp(patterns.clientSecret, 'g')
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, constants.O_RDONLY)
    const info = await handle.stat()
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BINARY_SCAN_BYTES) return []
    const buffer = Buffer.alloc(STREAM_CHUNK_BYTES)
    const seenIds = new Set<string>()
    const seenSecrets = new Set<string>()
    const clientIds: string[] = []
    const clientSecrets: string[] = []
    let tail = ''
    let position = 0
    while (position < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, STREAM_CHUNK_BYTES, position)
      if (bytesRead <= 0) break
      position += bytesRead
      const windowText = tail + buffer.subarray(0, bytesRead).toString('latin1')
      for (const match of windowText.matchAll(clientIdRe)) {
        const id = match[1]
        if (id && !seenIds.has(id)) {
          seenIds.add(id)
          clientIds.push(id)
        }
      }
      for (const match of windowText.matchAll(clientSecretRe)) {
        const secret = match[0]
        if (secret && !seenSecrets.has(secret)) {
          seenSecrets.add(secret)
          clientSecrets.push(secret)
        }
      }
      tail = windowText.slice(Math.max(0, windowText.length - STREAM_OVERLAP_BYTES))
    }
    const count = Math.min(clientIds.length, clientSecrets.length)
    const clients: AntigravityOAuthClient[] = []
    for (let index = 0; index < count; index += 1) {
      clients.push({ clientId: clientIds[index]!, clientSecret: clientSecrets[index]! })
    }
    return clients
  } catch {
    return []
  } finally {
    await handle?.close()
  }
}

export async function discoverAntigravityOAuthClients(deps: {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  jsPaths?: string[]
  binaryPaths?: string[]
  oauthPatterns?: Partial<AntigravityOAuthPatterns>
} = {}): Promise<AntigravityOAuthClient[]> {
  const canCache = !deps.platform && !deps.env && !deps.home && !deps.jsPaths &&
    !deps.binaryPaths && !deps.oauthPatterns
  if (canCache && cachedOAuthClients?.length) return cachedOAuthClients
  const defaults = oauthCandidatePaths(deps)
  const jsPaths = deps.jsPaths ?? defaults.jsPaths
  const binaryPaths = deps.binaryPaths ?? defaults.binaryPaths
  const jsPatterns: AntigravityOAuthPatterns = {
    clientId: JS_CLIENT_ID_PATTERN,
    clientSecret: CLIENT_SECRET_PATTERN,
    ...deps.oauthPatterns
  }
  const binaryPatterns: AntigravityOAuthPatterns = {
    clientId: CLIENT_ID_PATTERN,
    clientSecret: CLIENT_SECRET_PATTERN,
    ...deps.oauthPatterns
  }
  for (const jsPath of jsPaths) {
    const clients = await scanJsOAuthClients(jsPath, jsPatterns)
    if (clients.length > 0) {
      if (canCache) cachedOAuthClients = clients
      return clients
    }
  }
  for (const binPath of binaryPaths) {
    const clients = await scanBinaryOAuthClients(binPath, binaryPatterns)
    if (clients.length > 0) {
      if (canCache) cachedOAuthClients = clients
      return clients
    }
  }
  return []
}

async function requestRefreshedAntigravityToken(
  refreshToken: string,
  client: AntigravityOAuthClient,
  context: ProbeContext
): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await context.fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString(),
    signal: AbortSignal.timeout(OAUTH_REFRESH_TIMEOUT_MS)
  }, context.proxyUrl)
  if (!response.ok) throw new Error('Antigravity OAuth refresh was rejected.')
  const payload = optionalRecord(await response.json().catch(() => undefined))
  const accessToken = stringValue(payload?.access_token)
  if (!accessToken) throw new Error('Antigravity OAuth refresh returned no access token.')
  const expiresIn = typeof payload?.expires_in === 'number' && Number.isFinite(payload.expires_in) && payload.expires_in > 0
    ? payload.expires_in
    : 3_600
  return { accessToken, expiresAt: Date.now() + expiresIn * 1_000 }
}

function orderClientsForAccount(
  clients: readonly AntigravityOAuthClient[],
  isBusiness?: boolean
): AntigravityOAuthClient[] {
  return [...clients].sort((left, right) => {
    const leftPersonal = left.clientId.startsWith(PERSONAL_CLIENT_PREFIX) ? 0 : 1
    const rightPersonal = right.clientId.startsWith(PERSONAL_CLIENT_PREFIX) ? 0 : 1
    return isBusiness ? rightPersonal - leftPersonal : leftPersonal - rightPersonal
  })
}

function pickBestStoredToken(
  keychain: StoredAntigravityOAuthCredentials | undefined,
  file: StoredAntigravityOAuthCredentials | undefined
): StoredAntigravityOAuthCredentials | undefined {
  if (!keychain) return file
  if (!file) return keychain
  if (Boolean(file.refreshToken) !== Boolean(keychain.refreshToken)) {
    return keychain.refreshToken ? keychain : file
  }
  return file.expiresAt > keychain.expiresAt ? file : keychain
}

function rememberAntigravityCredential(entry: StoredAntigravityOAuthCredentials): void {
  if (!entry.refreshToken) return
  antigravityQuotaCredentialCache.delete(entry.refreshToken)
  antigravityQuotaCredentialCache.set(entry.refreshToken, entry)
  while (antigravityQuotaCredentialCache.size > 16) {
    const oldest = antigravityQuotaCredentialCache.keys().next().value
    if (oldest === undefined) break
    antigravityQuotaCredentialCache.delete(oldest)
  }
}

export async function resolveAntigravityQuotaCredential(
  context: ProbeContext,
  rejectedAccessToken?: string,
  deps: AntigravityCredentialDeps = {}
): Promise<GoogleCredential | undefined> {
  const env = deps.env ?? process.env
  const home = deps.home || env.HOME || env.USERPROFILE || homedir()
  const [keychainToken, fileToken] = await Promise.all([
    readNativeKeychainToken(home, deps),
    readNativeTokenFile(home)
  ])
  const nativeToken = pickBestStoredToken(keychainToken, fileToken)
  const source = nativeToken ?? await readDesktopStateDbToken(
    { platform: deps.platform, env, home },
    deps.readSqliteValue ?? readSqliteValue
  )
  if (!source) return undefined

  const cached = source.refreshToken ? antigravityQuotaCredentialCache.get(source.refreshToken) : undefined
  const active = cached &&
    cached.accessToken !== rejectedAccessToken &&
    (source.expiresAt === 0 || cached.expiresAt >= source.expiresAt)
    ? { ...source, ...cached, accountEmail: cached.accountEmail || source.accountEmail }
    : source

  const rejected = Boolean(rejectedAccessToken && active.accessToken === rejectedAccessToken)
  const expired = active.expiresAt > 0 && active.expiresAt <= Date.now() + EXPIRY_SKEW_MS
  const missingAccess = !active.accessToken

  if (!rejected && !expired && !missingAccess) {
    return {
      accessToken: active.accessToken,
      ...(active.accountEmail ? { accountEmail: active.accountEmail } : {})
    }
  }

  if (active.refreshToken) {
    const clients = await (deps.discoverClients
      ? deps.discoverClients()
      : discoverAntigravityOAuthClients({
          platform: deps.platform,
          env,
          home,
          jsPaths: deps.jsPaths,
          binaryPaths: deps.binaryPaths
        }))
    for (const client of orderClientsForAccount(clients, active.isBusiness)) {
      try {
        const refreshed = await requestRefreshedAntigravityToken(active.refreshToken, client, context)
        rememberAntigravityCredential({ ...active, ...refreshed })
        return {
          accessToken: refreshed.accessToken,
          ...(active.accountEmail ? { accountEmail: active.accountEmail } : {})
        }
      } catch {
        // Try the next discovered client pair (personal vs business).
      }
    }
  }

  if (!rejected && !expired && active.accessToken) {
    return {
      accessToken: active.accessToken,
      ...(active.accountEmail ? { accountEmail: active.accountEmail } : {})
    }
  }
  return undefined
}
