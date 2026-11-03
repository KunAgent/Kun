import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { HarnessDefinition } from '../contracts/harness.js'
import { buildHarnessEnv } from '../harness/harness-env.js'
import { harnessExecutableEnv } from '../harness/harness-executable-env.js'
import { nativeHarnessCredentialEnv, resolveHarnessSecretEnv, type HarnessSecretRefResolver } from '../harness/harness-secret-env.js'
import { nativeAgentNetworkEnv } from '../harness/native-agent-network.js'
import { sdkProcessBaseEnv } from '../runtime/agent-sdk/sdk-process-environment.js'
import { buildScopedEnv } from '../runtime/agent-sdk/sdk-options-builder.js'
import type { ProviderQuotaProbeProfile } from './provider-subscription-quota-service.js'
import { claudeAccessToken, validClaudeToken } from './provider-subscription-quota-metrics.js'
import { codexUsesOfficialSubscriptionConfig } from './codex-subscription-config.js'
import { claudeSubscriptionKeychainAccount, readClaudeSubscriptionKeychain } from './claude-subscription-keychain.js'

type Env = Record<string, string | undefined>
export type NativeComposerQuotaDependencies = {
  definition: HarnessDefinition
  resolveSecretEnv?: HarnessSecretRefResolver
  workspaceRoot?: string
  baseEnv?: Env
  readText?: (path: string) => Promise<string>
  readClaudeKeychain?: (account: string) => Promise<string>
  platform?: NodeJS.Platform
}

/** No CLI spawn, login, helper execution or credential mutation is performed. */
export async function nativeComposerSubscriptionProfile(options: NativeComposerQuotaDependencies): Promise<ProviderQuotaProbeProfile | undefined> {
  const { definition } = options
  if (!['codex', 'claude-code'].includes(definition.id)) return undefined
  const base = options.baseEnv ?? process.env
  const read = options.readText ?? readBoundedText
  let env: Env
  if (definition.id === 'claude-code' && definition.transport === 'agent-sdk') {
    // This is the SDK's actual ambient launch path. Its shell allowlist does
    // not inherit CLAUDE_CONFIG_DIR or launch.secretEnv; do not consult a
    // different account just because the unused definition contains one.
    env = buildScopedEnv({ ...sdkProcessBaseEnv(base), ...nativeAgentNetworkEnv(definition, base) })
  } else {
    const secrets = await resolveHarnessSecretEnv(definition, options.resolveSecretEnv)
    const explicit = { ...definition.launch?.env, ...secrets }
    const credentials = nativeHarnessCredentialEnv(definition, { ...base, ...explicit })
    env = buildHarnessEnv({ base: harnessExecutableEnv(base),
      strip: Object.keys(credentials).length ? definition.gateway?.stripEnv : undefined,
      add: { ...nativeAgentNetworkEnv(definition, base, explicit), ...explicit, ...credentials } })
  }
  const home = env.HOME || env.USERPROFILE || homedir()
  const proxyUrl = env.HTTPS_PROXY ?? env.https_proxy ?? env.ALL_PROXY ?? env.all_proxy ?? ''
  const workspace = options.workspaceRoot && isAbsolute(options.workspaceRoot) ? options.workspaceRoot : undefined
  if (options.workspaceRoot && !workspace) return undefined
  if (definition.id === 'codex') {
    if (nonempty(env.OPENAI_API_KEY) || nonempty(env.CODEX_API_KEY) ||
      (nonempty(env.OPENAI_BASE_URL) && !officialUrl(env.OPENAI_BASE_URL, 'api.openai.com'))) return undefined
    const dir = env.CODEX_HOME || join(home, '.codex')
    if (!isAbsolute(dir)) return undefined
    const configs = [join(dir, 'config.toml'), ...(workspace ? [join(workspace, '.codex', 'config.toml')] : [])]
    if (!codexUsesOfficialSubscriptionConfig(await Promise.all(configs.map(read)), definition.launch?.args)) return undefined
    const auth = json(await read(join(dir, 'auth.json')))
    if (!auth || nonempty(auth.OPENAI_API_KEY) || (auth.auth_mode && !['chatgpt', 'chatgptAuthTokens'].includes(String(auth.auth_mode)))) return undefined
    const tokens = record(auth.tokens)
    const accessToken = text(tokens.access_token ?? tokens.accessToken)
    const accountId = text(tokens.account_id ?? tokens.accountId)
    if (!accessToken || !accountId) return undefined
    return { id: 'native:codex', name: 'Codex', presetId: 'codex', kind: 'http', authType: 'oauth',
      baseUrl: 'https://chatgpt.com/backend-api/codex', apiKey: accessToken, headers: { 'chatgpt-account-id': accountId }, proxyUrl, configured: true }
  }
  const dir = env.CLAUDE_CONFIG_DIR || join(home, '.claude')
  if (!isAbsolute(dir)) return undefined
  if (claudeOverride(env)) return undefined
  const settings = [join(dir, 'settings.json'), join(dir, 'settings.local.json'),
    ...(workspace ? [join(workspace, '.claude', 'settings.json'), join(workspace, '.claude', 'settings.local.json')] : [])]
  // Embedded SDK passes settingSources: []; these files cannot redirect its
  // provider. CLI transports do load them and require the additional check.
  for (const path of definition.transport === 'agent-sdk' ? [] : settings) {
    const raw = await read(path)
    if (!raw) continue
    const config = json(raw)
    if (!config || nonempty(config.apiKeyHelper) || claudeOverride(record(config.env)) || nonempty(record(config.env).CLAUDE_CODE_OAUTH_TOKEN)) return undefined
  }
  let token = text(env.CLAUDE_CODE_OAUTH_TOKEN)
  if (token && !validClaudeToken(token)) return undefined
  if (!token && (options.platform ?? process.platform) === 'darwin' && home === homedir() && dir === join(home, '.claude')) {
    const keychain = await (options.readClaudeKeychain ?? readClaudeSubscriptionKeychain)(
      claudeSubscriptionKeychainAccount(env, options.platform ?? process.platform))
    if (keychain) {
      // The SDK's keychain projection wins even when an old file still exists.
      // Invalid/expired keychain data must not switch us to that other account.
      token = currentClaudeToken(json(keychain))
      if (!token) return undefined
    }
  }
  token ??= currentClaudeToken(json(await read(join(dir, '.credentials.json'))))
  return token ? { id: 'native:claude-code', name: 'Claude Code', presetId: 'claude-subscription',
    kind: 'agent-sdk', authType: 'subscription', apiKey: token, proxyUrl, configured: true } : undefined
}

function claudeOverride(env: Record<string, unknown>): boolean {
  if (nonempty(env.ANTHROPIC_API_KEY) || nonempty(env.ANTHROPIC_AUTH_TOKEN)) return true
  if (nonempty(env.ANTHROPIC_BASE_URL) && !officialUrl(env.ANTHROPIC_BASE_URL, 'api.anthropic.com')) return true
  return ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_ANTHROPIC_AWS']
    .some((key) => env[key] === true || (nonempty(env[key]) && !/^(0|false)$/i.test(String(env[key]).trim())))
}
async function readBoundedText(path: string): Promise<string> {
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle) return ''
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Native login file is unavailable')
    const buffer = Buffer.alloc(1024 * 1024 + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 1024 * 1024) throw new Error('Native login file is unavailable')
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally { await handle.close() }
}
function currentClaudeToken(value: unknown): string | undefined {
  const expiry = record(record(value).claudeAiOauth).expiresAt
  if (typeof expiry === 'number' && Number.isFinite(expiry) && expiry <= Date.now()) return undefined
  return claudeAccessToken(value)
}
function officialUrl(value: string, host: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && url.host === host && !url.username && !url.password } catch { return false }
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function json(value: string): Record<string, unknown> | undefined {
  if (!value) return undefined
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined } catch { return undefined }
}
function text(value: unknown): string | undefined { return nonempty(value) ? value.trim() : undefined }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
