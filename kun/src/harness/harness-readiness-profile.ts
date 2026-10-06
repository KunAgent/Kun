import { harnessGatewayBindingKey } from '../contracts/harness-gateway-binding.js'
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HarnessEnabledProfile } from '../config/kun-config-harnesses.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'
import type { HarnessDefinition, HarnessRoute } from '../contracts/harness.js'
import type { KunServeRuntimeOptions } from '../server/runtime-factory-types.js'
import { deepSeekHarnessProfileFingerprint, hasDeepSeekHarnessNativeKey } from './deepseek-harness-profile.js'
import { nativeHarnessCredentialEnv } from './harness-secret-env.js'
import { nativeAgentNetworkStatus } from './native-agent-network.js'
import { openCode2CredentialEvidence } from './opencode2-credentials.js'
import { nativeAgentCredentialFiles, nativeAgentCredentialsConfigured } from './native-agent-credentials.js'

export type ReadinessOptions = Partial<Pick<KunServeRuntimeOptions,
  'providers' | 'routePools' | 'harnesses' | 'apiKey' | 'baseUrl' | 'model' | 'credentialSourceId' | 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'>>

export function harnessProfile(route: Pick<HarnessRoute, 'harnessId' | 'credentialMode' | 'providerId' | 'gatewayBinding'>): HarnessEnabledProfile {
  if (route.gatewayBinding) return { harnessId: route.harnessId, credentialMode: route.credentialMode, gatewayBinding: route.gatewayBinding }
  return { harnessId: route.harnessId, credentialMode: route.credentialMode,
    ...(route.credentialMode !== 'native-login' ? { providerId: route.providerId?.trim() || 'default' } :
      route.providerId?.trim() && route.providerId.trim() !== 'default' ? { providerId: route.providerId.trim() } : {}) }
}
export function harnessProfileKey(route: Pick<HarnessRoute, 'harnessId' | 'credentialMode' | 'providerId' | 'gatewayBinding'>): string {
  const profile = harnessProfile(route)
  if (profile.gatewayBinding) return JSON.stringify([profile.harnessId, profile.credentialMode, 'alias', harnessGatewayBindingKey(profile.gatewayBinding)])
  return JSON.stringify([profile.harnessId, profile.credentialMode, profile.providerId ?? ''])
}
export function readinessProvider(options: ReadinessOptions, route: HarnessRoute): ServeProviderConfig | undefined {
  if (route.gatewayBinding) return undefined
  const id = route.providerId?.trim() || 'default'
  if (options.providers?.[id]) return options.providers[id]
  if (id !== 'default') return undefined
  const nativeKind = process.env.KUN_RUNTIME_PROVIDER_KIND
  const kind = nativeKind === 'agent-sdk' || nativeKind === 'cursor-sdk' || nativeKind === 'antigravity-cli' ? nativeKind : 'http'
  return { kind, apiKey: options.apiKey ?? '', baseUrl: options.baseUrl,
    credentialSourceId: options.credentialSourceId, selectedModel: options.model }
}

function file(path: string): string {
  let fd: number | undefined
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return 'unreadable'
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.size > 64 * 1024) return 'unreadable'
    const buffer = Buffer.alloc(64 * 1024 + 1)
    const count = readSync(fd, buffer, 0, buffer.length, 0)
    return count <= 64 * 1024 ? buffer.subarray(0, count).toString('utf8') : 'unreadable'
  } catch { return '' } finally { if (fd !== undefined) closeSync(fd) }
}

function object(path: string): Record<string, unknown> {
  try { const value: unknown = JSON.parse(file(path)); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} } catch { return {} }
}
function fileFingerprint(path: string): unknown {
  try {
    const stat = lstatSync(path, { bigint: true })
    return [stat.dev.toString(), stat.ino.toString(), stat.mode.toString(), stat.size.toString(),
      stat.mtimeNs.toString(), stat.ctimeNs.toString(), file(path)]
  } catch { return null }
}
export function nativeCredentialFiles(definition: HarnessDefinition, overrideEnv: Record<string, string> = {}): string[] {
  const env = { ...process.env, ...definition.launch?.env, ...overrideEnv }
  const home = env.HOME || env.USERPROFILE || homedir()
  switch (definition.id) {
    case 'claude-code': return [join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), '.credentials.json')]
    case 'codex': return [join(env.CODEX_HOME || join(home, '.codex'), 'auth.json')]
    case 'opencode': return [join(env.XDG_DATA_HOME || join(home, '.local/share'), 'opencode/auth.json')]
    case 'devin': return [join(process.platform === 'win32'
      ? env.APPDATA || join(home, 'AppData/Roaming')
      : env.XDG_DATA_HOME || join(home, '.local/share'), 'devin/credentials.toml')]
    case 'pi': return [join(env.PI_CODING_AGENT_DIR || join(home, '.pi/agent'), 'auth.json')]
    case 'antigravity': return [env.GOOGLE_APPLICATION_CREDENTIALS || join(env.CLOUDSDK_CONFIG || join(home, '.config/gcloud'), 'application_default_credentials.json')]
    default: return nativeAgentCredentialFiles(definition.id, env)
  }
}
function nativeProfileFiles(definition: HarnessDefinition, overrides: Record<string, string>): string[] {
  const env = { ...process.env, ...definition.launch?.env, ...overrides }
  const home = env.HOME || env.USERPROFILE || homedir()
  const credentials = nativeCredentialFiles(definition, overrides)
  const configs = definition.id === 'codex' ? [join(env.CODEX_HOME || join(home, '.codex'), 'config.toml')]
    : definition.id === 'claude-code' ? [join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json')]
    : definition.id === 'pi' ? ['settings.json', 'models.json'].map((name) => join(env.PI_CODING_AGENT_DIR || join(home, '.pi/agent'), name))
    : definition.id === 'antigravity' ? [join(home, '.gemini', 'antigravity-cli', 'settings.json')]
    : definition.id === 'opencode' || definition.id === 'opencode2'
      ? [env.OPENCODE_CONFIG || join(env.OPENCODE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode'), 'opencode.json'),
        join(env.OPENCODE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode'), 'opencode.jsonc')] : []
  return [...credentials, ...configs]
}
const NATIVE_KEYS: Record<string, readonly string[]> = {
  'deepseek-harness': ['DEEPSEEK_API_KEY'], devin: ['WINDSURF_API_KEY'],
  antigravity: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'],
  codex: ['OPENAI_API_KEY'], cursor: ['CURSOR_API_KEY'],
  'claude-code': ['CLAUDE_CODE_OAUTH_TOKEN']
}
/** Only the selected engine's deliberately supported variables cross into its probe. */
export function nativeProfileEnv(definition: HarnessDefinition): Record<string, string> {
  return nativeHarnessCredentialEnv(definition, { ...process.env, ...definition.launch?.env })
}
export function nativeHasKey(definition: HarnessDefinition, env: Record<string, string>): boolean {
  const nativeBase = Object.fromEntries(Object.entries({ ...process.env, ...definition.launch?.env, ...env })
    .filter(([key]) => !/^(?:KUN_|DS_GUI_|DEEPSEEK_GUI_|ELECTRON_|NODE_)/i.test(key)))
  if (nativeAgentCredentialsConfigured(definition.id, nativeBase)) return true
  if (definition.id === 'opencode2') return openCode2CredentialEvidence({ ...process.env, ...definition.launch?.env, ...env }).configured
  if (definition.id === 'deepseek-harness') return hasDeepSeekHarnessNativeKey({ ...process.env, ...definition.launch?.env, ...env })
  const keys = NATIVE_KEYS[definition.id] ?? []
  if (keys.some((key) => key !== 'CLAUDE_CODE_OAUTH_TOKEN' && key !== 'GOOGLE_APPLICATION_CREDENTIALS' && Boolean(env[key]?.trim()))) return true
  if (definition.id === 'antigravity') {
    const paths = env.GOOGLE_APPLICATION_CREDENTIALS ? [env.GOOGLE_APPLICATION_CREDENTIALS] : nativeCredentialFiles(definition, env)
    return paths.some((path) => {
      const value = object(path)
      return (value.type === 'service_account' && typeof value.private_key === 'string' && typeof value.client_email === 'string') ||
        (value.type === 'authorized_user' && typeof value.refresh_token === 'string' && typeof value.client_id === 'string')
    })
  }
  if (definition.id === 'codex') return nativeCredentialFiles(definition, env).some((path) => {
    const value = object(path); return typeof value.OPENAI_API_KEY === 'string' && value.OPENAI_API_KEY.trim().length > 0
  })
  if (definition.id === 'pi' || definition.id === 'opencode') {
    return nativeCredentialFiles(definition, env).some((path) => Object.values(object(path)).some((value) => {
      if (!value || typeof value !== 'object') return false
      const entry = value as Record<string, unknown>
      if (['api', 'api_key'].includes(String(entry.type))) return typeof entry.key === 'string' && entry.key.trim().length > 0
      // Both engines own refresh and authentication. A complete OAuth record is
      // configured evidence, just like an API key; it is never verified login.
      return entry.type === 'oauth' && typeof entry.access === 'string' && entry.access.trim().length > 0 &&
        typeof entry.refresh === 'string' && entry.refresh.trim().length > 0 &&
        typeof entry.expires === 'number' && Number.isFinite(entry.expires) && entry.expires > 0
    }))
  }
  return false
}
/** Secret values only enter this digest, never wire responses, logs, or persistent proof. */
export function readinessFingerprint(input: {
  options: ReadinessOptions; definition: HarnessDefinition; route: HarnessRoute;
  secretEnv: Record<string, string>; command?: string
}): string {
  const { options, definition, route } = input
  let binary: unknown
  try { const s = statSync(input.command || options.harnesses?.binaryPaths?.[definition.id] || definition.detect?.command || '');
    binary = [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs] } catch { binary = null }
  return createHash('sha256').update(JSON.stringify({
    definition, route, network: nativeAgentNetworkStatus(definition).networkFingerprint,
    binaryPath: options.harnesses?.binaryPaths?.[definition.id], binary,
    runtimeBinaryEnv: [process.env.KUN_CLAUDE_BINARY, process.env.KUN_ANTIGRAVITY_BINARY, process.env.KUN_CODEX_BINARY, process.env.KUN_RUNTIME_PROVIDER_KIND],
    defaults: options.harnesses?.defaults?.[definition.id],
    permissionPolicy: [options.approvalPolicy, options.sandboxMode, options.approvalReviewer],
    dsh: definition.id === 'deepseek-harness' ? deepSeekHarnessProfileFingerprint({ ...process.env, ...definition.launch?.env, ...input.secretEnv }) : undefined,
    opencode2: definition.id === 'opencode2' ? openCode2CredentialEvidence({ ...process.env, ...definition.launch?.env, ...input.secretEnv }).fingerprint : undefined,
    provider: readinessProvider(options, route), secretEnv: input.secretEnv,
    ...(route.gatewayBinding ? { aliasRouting: {
      pools: options.routePools?.filter((pool) => pool.id === route.gatewayBinding!.main.routeId || pool.id === route.gatewayBinding!.small?.routeId),
      providers: Object.fromEntries([...new Set([...route.gatewayBinding.main.allowedConnectionIds, ...(route.gatewayBinding.small?.allowedConnectionIds ?? [])])]
        .map((id) => [id, options.providers?.[id]]))
    } } : {}),
    env: route.gatewayBinding ? {} : nativeProfileEnv(definition), files: route.gatewayBinding ? [] : nativeProfileFiles(definition, input.secretEnv).map((path) => [path, fileFingerprint(path)])
  })).digest('hex')
}
