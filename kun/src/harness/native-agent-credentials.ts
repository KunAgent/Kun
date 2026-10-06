import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { additionalNativeCredentialEnv, additionalNativeCredentialFiles, additionalNativeCredentialsConfigured } from './additional-native-agent-credentials.js'

type Env = Record<string, string | undefined>
const providerKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY'] as const

/** Official native credential variables; only the selected Agent receives these. */
export const NATIVE_AGENT_CREDENTIAL_ENV_KEYS: Readonly<Record<string, readonly string[]>> = {
  'gemini-cli': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  kimi: ['KIMI_API_KEY'],
  copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_PROVIDER_API_KEY'],
  goose: providerKeys,
  droid: ['FACTORY_API_KEY'],
  qoder: ['QODER_PERSONAL_ACCESS_TOKEN'],
  'qoder-cn': ['QODERCN_PERSONAL_ACCESS_TOKEN']
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const nativeEnv = (env: Env): Env => Object.fromEntries(Object.entries(env)
  .filter(([key]) => !/^(?:KUN_|DS_GUI_|DEEPSEEK_GUI_|ELECTRON_|NODE_)/i.test(key)))

/** Bounded, read-only credential reads; symlinks and malformed files fail closed. */
function file(path: string): string {
  let fd: number | undefined
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return ''
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.size > 64 * 1024) return ''
    const buffer = Buffer.alloc(64 * 1024 + 1)
    const count = readSync(fd, buffer, 0, buffer.length, 0)
    return count <= 64 * 1024 ? buffer.subarray(0, count).toString('utf8') : ''
  } catch { return '' } finally { if (fd !== undefined) closeSync(fd) }
}
function json(path: string): Record<string, unknown> {
  try { return object(JSON.parse(file(path))) } catch { return {} }
}
function yaml(path: string): Record<string, unknown> {
  try { return object(parseYaml(file(path), { maxAliasCount: 0 })) } catch { return {} }
}

/** Known user-owned locations, never a path supplied by a workspace manifest. */
export function nativeAgentCredentialFiles(id: string, env: Env = process.env): string[] {
  const home = env.HOME || env.USERPROFILE || homedir()
  const config = env.XDG_CONFIG_HOME || join(home, '.config')
  switch (id) {
    case 'gemini-cli': return [join(home, '.gemini', 'oauth_creds.json')]
    case 'kimi': {
      const dir = kimiDir(env, home)
      return [join(dir, 'config.toml'), join(dir, 'credentials', 'kimi-code.json')]
    }
    case 'goose': return [join(process.platform === 'win32'
      ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Block', 'goose', 'config')
      : join(config, 'goose'), 'secrets.yaml')]
    case 'cline': {
      const data = env.CLINE_DATA_DIR || join(env.CLINE_DIR || join(home, '.cline'), 'data')
      return [env.CLINE_PROVIDER_SETTINGS_PATH || join(data, 'settings', 'providers.json')]
    }
    case 'minimax-code': {
      const dir = env.MINIMAX_DATA_DIR || env.MAVIS_DATA_DIR || join(home, '.minimax')
      return [join(dir, 'config.yaml'), join(dir, 'local-runtime.auth.json')]
    }
    case 'droid': return [join(env.FACTORY_HOME || join(home, '.factory'), 'auth.json')]
    // Copilot uses an OS credential store; Qoder and Droid keep private OAuth
    // dialects. Until their exact local schema is supported, inspect only their
    // documented native token variables. A config directory is not evidence.
    default: return additionalNativeCredentialFiles(id, env)
  }
}

function kimiDir(env: Env, home: string): string {
  // The supported Kimi Code CLI does not inherit retired kimi-cli credentials.
  return env.KIMI_CODE_HOME || join(home, '.kimi-code')
}

/** Include Kimi's explicitly named key variable in both launch and identity. */
export function nativeAgentCredentialEnv(id: string, env: Env): Record<string, string> {
  env = nativeEnv(env)
  const keys = new Set(NATIVE_AGENT_CREDENTIAL_ENV_KEYS[id] ?? [])
  if (id === 'kimi') {
    const config = file(nativeAgentCredentialFiles(id, env)[0]!)
    for (const field of kimiProviderFields(config)) {
      if (field.name === 'api_key_env' && /^[A-Z][A-Z0-9_]{0,63}$/.test(field.value)) keys.add(field.value)
    }
  }
  return { ...additionalNativeCredentialEnv(id, env), ...Object.fromEntries([...keys].flatMap((key) => nonempty(env[key]) ? [[key, env[key]!]] : [])) }
}

function oauth(value: Record<string, unknown>): boolean {
  return nonempty(value.access_token) && nonempty(value.refresh_token)
}

/**
 * Configuration evidence only. The CLI owns token refresh and account/quota
 * validation. No initialize result, model name or credential presence proves
 * authentication. Rules below are deliberately specific to native formats.
 */
export function nativeAgentCredentialsConfigured(id: string, env: Env): boolean {
  env = nativeEnv(env)
  // Kimi 2 does not consume ambient KIMI_API_KEY unless a provider declares it.
  // https://moonshotai.github.io/kimi-code/en/configuration/env-vars.html
  if (id !== 'kimi' && (NATIVE_AGENT_CREDENTIAL_ENV_KEYS[id] ?? []).some((key) => nonempty(env[key]))) return true
  const files = nativeAgentCredentialFiles(id, env)
  switch (id) {
    case 'gemini-cli': return oauth(json(files[0]!))
    case 'droid': return oauth(json(files[0]!))
    case 'kimi': return kimiProviderKey(file(files[0]!), env) || oauth(json(files[1]!))
    case 'goose': {
      // Official file-based key storage; config.yaml configured=true is not a key.
      // https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/config-files.md
      const secrets = yaml(files[0]!)
      return providerKeys.some((key) => nonempty(secrets[key]))
    }
    case 'cline': {
      const config = json(files[0]!)
      const providers = object(config.providers)
      const selected = nonempty(config.lastUsedProvider) ? object(providers[config.lastUsedProvider]) : {}
      return nonempty(object(selected.settings).apiKey)
    }
    case 'minimax-code': {
      // Official BYOK schema and native auth projection; directories and
      // provider model catalogs alone never count as configured credentials.
      // https://github.com/MiniMax-AI/minimax-code/blob/main/packages/config/src/config.ts
      const config = yaml(files[0]!)
      if (nonempty(object(config.minimax_api).apiKey)) return true
      const custom = object(config.custom_provider)
      const selected = nonempty(config.defaultModel) ? config.defaultModel.split('/')[0] : ''
      const id = selected.startsWith('custom_provider:') ? selected.slice('custom_provider:'.length) : ''
      const provider = object(custom[id])
      if (provider.enabled !== false && nonempty(object(provider.options).apiKey)) return true
      const auth = json(files[1]!)
      return auth.version === 1 && nonempty(object(auth.auth).accessToken)
    }
    default: return additionalNativeCredentialsConfigured(id, env)
  }
}

/** Read only quoted key fields in provider tables; unfamiliar TOML stays unknown. */
function kimiProviderKey(config: string, env: Env): boolean {
  return kimiProviderFields(config).some((field) => field.name === 'api_key'
    ? nonempty(field.value) : nonempty(env[field.value]))
}
function kimiProviderFields(config: string): Array<{ name: string; value: string }> {
  let inProvider = false
  const fields: Array<{ name: string; value: string }> = []
  for (const line of config.split('\n')) {
    const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line)
    if (header) { inProvider = /^providers\./.test(header[1]!.trim()); continue }
    if (!inProvider) continue
    const field = /^\s*(api_key|api_key_env)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line)
    if (!field) continue
    let value: string
    try { value = field[2]!.startsWith('"') ? JSON.parse(field[2]!) : field[2]!.slice(1, -1) } catch { continue }
    fields.push({ name: field[1]!, value })
  }
  return fields
}
