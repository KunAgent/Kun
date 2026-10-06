import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'

type Env = Record<string, string | undefined>
type ObjectValue = Record<string, unknown>
type CredentialDatabase = { prepare(sql: string): { all(): unknown[] }; close(): void }
const LIMIT = 64 * 1024
const require = createRequire(import.meta.url)
const envName = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const home = (env: Env): string => env.HOME || env.USERPROFILE || homedir()

const MODEL_KEYS = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN', 'OPENROUTER_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY'
] as const
const HERMES_KEYS = [
  ...MODEL_KEYS.filter((key) => key !== 'ANTHROPIC_OAUTH_TOKEN'), 'ANTHROPIC_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'NVIDIA_API_KEY',
  'STEPFUN_API_KEY', 'MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY', 'DEEPINFRA_API_KEY', 'AI_GATEWAY_API_KEY',
  'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'KIMI_API_KEY', 'GLM_API_KEY', 'ZAI_API_KEY', 'Z_AI_API_KEY',
  'KIMI_CODING_API_KEY', 'KIMI_CN_API_KEY', 'DASHSCOPE_API_KEY', 'ALIBABA_CODING_PLAN_API_KEY',
  'ARCEEAI_API_KEY', 'GMI_API_KEY', 'ACTUAL_API_KEY', 'OPENCODE_ZEN_API_KEY', 'OPENCODE_GO_API_KEY',
  'KILOCODE_API_KEY', 'HF_TOKEN', 'XIAOMI_API_KEY', 'TOKENHUB_API_KEY', 'TOKENPLAN_API_KEY',
  'OLLAMA_API_KEY', 'AZURE_FOUNDRY_API_KEY'
] as const
const HERMES_OAUTH_PROVIDERS = new Set(['nous', 'openai-codex', 'xai-oauth', 'qwen-oauth', 'minimax-oauth'])
const HERMES_MODEL_PROVIDERS = new Set([
  ...HERMES_OAUTH_PROVIDERS, 'openrouter', 'openai-api', 'lmstudio', 'copilot', 'gemini', 'zai',
  'kimi-coding', 'kimi-coding-cn', 'stepfun', 'arcee', 'gmi', 'actual', 'minimax', 'anthropic',
  'alibaba', 'alibaba-coding-plan', 'minimax-cn', 'deepseek', 'xai', 'nvidia', 'ai-gateway',
  'opencode-zen', 'opencode-go', 'kilocode', 'huggingface', 'xiaomi', 'tencent-tokenhub',
  'tencent-tokenplan', 'ollama-cloud', 'bedrock', 'vertex', 'azure-foundry'
])
const CONTROL_ENV: Record<string, string[]> = {
  mimocode: ['MIMOCODE_HOME', 'MIMOCODE_CONFIG_DIR', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME'],
  fx: ['FX_PROVIDER', 'FX_DISABLE_KEYCHAIN'],
  omp: ['OMP_PROFILE', 'PI_PROFILE', 'PI_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'XDG_DATA_HOME'],
  hermes: ['HERMES_HOME'],
  grok: ['GROK_HOME', 'GROK_AUTH_PATH']
}

function regular(path: string): boolean {
  try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink() } catch { return false }
}
/** No following links, shell evaluation, refreshes, or unbounded credential reads. */
function textFile(path: string): string {
  let fd: number | undefined
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) return ''
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.size > LIMIT || opened.ino !== stat.ino || opened.dev !== stat.dev) return ''
    const bytes = Buffer.alloc(LIMIT + 1)
    const length = readSync(fd, bytes, 0, bytes.length, 0)
    return length <= LIMIT ? bytes.subarray(0, length).toString('utf8') : ''
  } catch { return '' } finally { if (fd !== undefined) closeSync(fd) }
}
function jsonText(text: string): ObjectValue { try { return object(JSON.parse(text)) } catch { return {} } }
function json(path: string): ObjectValue { return jsonText(textFile(path)) }
function yaml(path: string): ObjectValue {
  try { return object(parseYaml(textFile(path), { maxAliasCount: 0 })) } catch { return {} }
}

function jsonc(path: string): ObjectValue {
  const text = textFile(path)
  let clean = '', quoted = false, escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      clean += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') quoted = false
      continue
    }
    if (ch === '"') { quoted = true; clean += ch; continue }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      clean += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      if (i >= text.length) return {}
      i++
      clean += ' '
    } else clean += ch
  }
  let normalized = ''
  quoted = false; escaped = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!
    if (!quoted && ch === ',' && /^[\s]*[}\]]/.test(clean.slice(i + 1))) continue
    normalized += ch
    if (escaped) escaped = false
    else if (quoted && ch === '\\') escaped = true
    else if (ch === '"') quoted = !quoted
  }
  return jsonText(normalized)
}

function mimoRoots(env: Env): { data: string; config: string } | undefined {
  if (env.MIMOCODE_HOME) return isAbsolute(env.MIMOCODE_HOME)
    ? { data: join(env.MIMOCODE_HOME, 'data'), config: join(env.MIMOCODE_HOME, 'config') } : undefined
  // Official shared/global.ts uses xdg-basedir, including on macOS.
  return {
    data: join(env.XDG_DATA_HOME || join(home(env), '.local', 'share'), 'mimocode'),
    config: env.MIMOCODE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home(env), '.config'), 'mimocode')
  }
}

function ompRoots(env: Env): { agent: string; database: string } | undefined {
  const selected = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE
  const profile = selected?.trim() && selected.trim() !== 'default' ? selected.trim() : undefined
  if (profile && (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(profile) || profile === '.' || profile === '..' ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(profile))) return undefined
  const root = join(home(env), env.PI_CONFIG_DIR || '.omp')
  const base = profile ? join(root, 'profiles', profile) : root
  const agent = !profile && env.PI_CODING_AGENT_DIR ? env.PI_CODING_AGENT_DIR : join(base, 'agent')
  if (!isAbsolute(agent)) return undefined
  const migrated = env.XDG_DATA_HOME && (!env.PI_CODING_AGENT_DIR || profile)
    ? join(env.XDG_DATA_HOME, 'omp', ...(profile ? ['profiles', profile] : [])) : undefined
  const data = process.platform !== 'win32' && migrated && existsSync(migrated) ? migrated : agent
  return { agent, database: join(data, 'agent.db') }
}

/** Includes only native paths and config files needed to resolve credential references. */
export function additionalNativeCredentialFiles(id: string, env: Env = process.env): string[] {
  switch (id) {
    // Browser login storage is not documented; use the official prompt-free `agent status` probe.
    case 'cursor-cli': return []
    case 'mimocode': {
      const roots = mimoRoots(env)
      return roots ? [join(roots.data, 'auth.json'), join(roots.config, 'mimocode.json'), join(roots.config, 'mimocode.jsonc')] : []
    }
    case 'fx': return ['settings.json', 'auth.json', 'chatgpt-auth.json', 'grok-auth.json', 'api-key'].map((name) => join(home(env), '.fx', name))
    case 'omp': {
      const roots = ompRoots(env)
      return roots ? [roots.database, `${roots.database}-wal`, join(roots.agent, 'auth.json'), join(roots.agent, 'models.yml')] : []
    }
    case 'hermes': return ['.env', 'auth.json', 'config.yaml'].map((name) => join(env.HERMES_HOME || join(home(env), '.hermes'), name))
    case 'grok': {
      if (env.GROK_AUTH_PATH && !isAbsolute(env.GROK_AUTH_PATH)) return []
      const root = env.GROK_HOME || join(home(env), '.grok')
      return [env.GROK_AUTH_PATH || join(root, 'auth.json'), join(root, 'config.toml')]
    }
    default: return []
  }
}

function token(value: unknown): value is string {
  return nonempty(value) && !/^(?:changeme|your[_-].*(?:key|token).*|\*+|<[^>]+>)$/i.test(value.trim())
}
function oauth(value: unknown): boolean {
  const entry = object(value)
  return token(entry.access) && token(entry.refresh) && typeof entry.expires === 'number' && Number.isFinite(entry.expires)
}
function literalOrEnv(value: unknown, env: Env, references: Set<string>, plainName = false): boolean {
  if (!nonempty(value) || value.startsWith('!')) return false
  const name = /^\{env:([A-Z][A-Z0-9_]{0,63})\}$/.exec(value)?.[1] ?? (plainName && envName(value) ? value : undefined)
  if (name) { references.add(name); return token(env[name]) }
  return token(value) && !value.includes('${')
}

function mimoEvidence(env: Env, references: Set<string>): boolean {
  // https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/auth/index.ts
  const files = additionalNativeCredentialFiles('mimocode', env)
  if (!files.length) return false
  const injected = env.MIMOCODE_AUTH_CONTENT
  if (injected && Buffer.byteLength(injected) > LIMIT) return false
  const auth = injected ? jsonText(injected) : json(files[0]!)
  const configured = Object.values(auth).some((raw) => {
    const value = object(raw)
    return value.type === 'oauth' ? oauth(value) : value.type === 'api' ?
      token(value.key) && value.key !== 'mimocode-oauth-dummy-key'
      : value.type === 'wellknown' && envName(value.key) && token(value.token)
  })
  let byKey = false
  for (const path of files.slice(1)) {
    for (const provider of Object.values(object(jsonc(path).provider))) {
      byKey = literalOrEnv(object(object(provider).options).apiKey, env, references) || byKey
    }
  }
  return configured || byKey
}

function fxEvidence(env: Env, references: Set<string>): boolean {
  // https://fx.sh/docs/getting-started/authentication
  // https://fx.sh/docs/configure-fx/custom-model-connections
  const files = additionalNativeCredentialFiles('fx', env)
  const config = json(files[0]!)
  const provider = env.FX_PROVIDER || (nonempty(config.provider) ? config.provider : 'gateway')
  const session = (index: number) => {
    const value = json(files[index]!)
    return value.version === 1 && token(value.access_token) && token(value.refresh_token) &&
      Number.isSafeInteger(value.expires_at_ms) && token(value.account_id) && !/[\r\n\0]/.test(value.account_id)
  }
  if (provider === 'codex') return session(2)
  if (provider === 'grok') return session(3)
  if (provider !== 'gateway') {
    const auth = object(object(object(config.providers)[provider]).auth)
    if (auth.type !== 'bearer' || !envName(auth.env)) return false
    references.add(auth.env)
    return token(env[auth.env])
  }
  const selected = config.credential_source
  const vercel = () => {
    const value = json(files[1]!)
    return value.version === 1 && value.issuer === 'https://vercel.com' && token(value.client_id) &&
      token(value.access_token) && token(value.refresh_token) && token(value.scope) && token(value.token_type) &&
      Number.isSafeInteger(value.expires_at_ms)
  }
  const source = (name: string) => name === 'vercel_oidc_token' ? token(env.VERCEL_OIDC_TOKEN)
    : name === 'ai_gateway_api_key' ? token(env.AI_GATEWAY_API_KEY)
      : name === 'fx_login' ? vercel() : name === 'stored_key' && token(textFile(files[4]!))
  if (nonempty(selected)) return source(selected)
  return token(env.VERCEL_OIDC_TOKEN) || token(env.AI_GATEWAY_API_KEY) || vercel() || token(textFile(files[4]!))
}

/** Official SQLite schema; inspect at most 64 enabled rows and return booleans, never token bytes. */
function ompDatabaseConfigured(path: string): boolean {
  // https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/auth/sqlite-credential-store.ts
  if (!regular(path)) return false
  let database: CredentialDatabase | undefined
  try {
    const wal = `${path}-wal`, shm = `${path}-shm`
    const activeWal = existsSync(wal)
    if (activeWal && (!regular(wal) || !regular(shm))) return false
    const uri = pathToFileURL(path)
    uri.searchParams.set('mode', 'ro') // Existing file only; never SQLITE_OPEN_CREATE.
    if (!activeWal) uri.searchParams.set('immutable', '1') // Do not create WAL/SHM coordination files.
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string, options: { readOnly: boolean }) => CredentialDatabase
    }
    database = new DatabaseSync(uri.href, { readOnly: true })
    // octet_length reads the byte count from SQLite metadata; nested CASE prevents
    // loading oversized JSON through json_valid before the byte limit is checked.
    const rows = database.prepare(`SELECT CASE WHEN octet_length(data) <= 65536 THEN
      CASE WHEN json_valid(data) THEN CASE WHEN credential_type = 'api_key' THEN
        json_type(data, '$.key') = 'text' AND length(trim(json_extract(data, '$.key'))) > 0
      WHEN credential_type = 'oauth' THEN
        json_type(data, '$.access') = 'text' AND length(trim(json_extract(data, '$.access'))) > 0 AND
        json_type(data, '$.refresh') = 'text' AND length(trim(json_extract(data, '$.refresh'))) > 0 AND
        json_type(data, '$.expires') IN ('integer', 'real')
      ELSE 0 END ELSE 0 END ELSE 0 END AS configured FROM auth_credentials
      WHERE disabled_cause IS NULL AND length(trim(provider)) > 0
        AND provider NOT LIKE 'mcp_oauth:%' ORDER BY id LIMIT 64`).all() as Array<{ configured: number | null }>
    return rows.some((row) => row.configured === 1)
  } catch { return false } finally { database?.close() }
}

function ompEvidence(env: Env, references: Set<string>): boolean {
  const files = additionalNativeCredentialFiles('omp', env)
  if (!files.length) return false
  let configured = false
  for (const raw of Object.values(object(yaml(files[3]!).providers))) {
    configured = literalOrEnv(object(raw).apiKey, env, references, true) || configured
  }
  if (configured) return true
  if (existsSync(files[0]!)) return ompDatabaseConfigured(files[0]!)
  return Object.values(json(files[2]!)).flatMap((value) => Array.isArray(value) ? value : [value]).some((raw) => {
    const value = object(raw)
    return value.type === 'oauth' ? oauth(value) : value.type === 'api_key' && token(value.key)
  })
}

function dotenv(path: string, env: Env, references: Set<string>): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const line of textFile(path).split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{0,63})\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    let value = match[2]!
    if (/^".*"$/.test(value)) { try { value = JSON.parse(value) } catch { continue } }
    else if (/^'.*'$/.test(value)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').trim()
    const reference = /^\$\{([A-Z][A-Z0-9_]{0,63})\}$/.exec(value)?.[1]
    if (reference) { references.add(reference); value = entries[reference] || env[reference] || '' }
    if (!value.includes('${') && token(value)) entries[match[1]!] = value
  }
  return entries
}

function hermesEvidence(env: Env, references: Set<string>): boolean {
  // https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/auth.py
  const files = additionalNativeCredentialFiles('hermes', env)
  const local = dotenv(files[0]!, env, references)
  const model = object(yaml(files[2]!).model)
  const key = model.key_env || model.api_key_env
  if (envName(key)) {
    references.add(key)
    if (token(local[key] || env[key])) return true
  }
  if (HERMES_KEYS.some((name) => token(local[name]) || token(env[name]))) return true
  const auth = json(files[1]!)
  if (auth.version !== 1) return false
  const pair = (value: unknown) => token(object(value).access_token) && token(object(value).refresh_token)
  if (Object.entries(object(auth.providers)).some(([provider, value]) => HERMES_OAUTH_PROVIDERS.has(provider) &&
    (pair(object(value).tokens) || pair(value)))) return true
  return Object.entries(object(auth.credential_pool)).some(([provider, entries]) => HERMES_MODEL_PROVIDERS.has(provider) &&
    Array.isArray(entries) && entries.some((raw) => {
    const entry = object(raw)
    return entry.auth_type === 'api_key' ? token(entry.access_token) : entry.auth_type === 'oauth' && pair(entry)
    }))
}

function grokEvidence(env: Env, references: Set<string>): boolean {
  // https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-login/src/model.rs
  const files = additionalNativeCredentialFiles('grok', env)
  if (!files.length) return false
  let modelTable = false, modelKey = false
  for (const line of textFile(files[1]!).split('\n')) {
    const header = /^\s*\[([^\]]+)\]/.exec(line)
    if (header) { modelTable = /^model\./.test(header[1]!); continue }
    if (!modelTable) continue
    const field = /^\s*(api_key|env_key)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line)
    if (!field) continue
    let value: string
    try { value = field[2]!.startsWith('"') ? JSON.parse(field[2]!) : field[2]!.slice(1, -1) } catch { continue }
    if (field[1] === 'env_key' && envName(value)) { references.add(value); modelKey = token(env[value]) || modelKey }
    if (field[1] === 'api_key') modelKey = token(value) || modelKey
  }
  if (modelKey || token(env.XAI_API_KEY)) return true
  return Object.values(json(files[0]!)).some((raw) => {
    const value = object(raw)
    return ['api_key', 'oidc', 'external'].includes(String(value.auth_mode)) && token(value.key) &&
      typeof value.user_id === 'string' && nonempty(value.create_time) && Number.isFinite(Date.parse(value.create_time))
  })
}

/** Only configuration evidence: validity, expiry, entitlement and login remain the CLI's responsibility. */
export function additionalNativeCredentialsConfigured(id: string, env: Env): boolean {
  const references = new Set<string>()
  switch (id) {
    case 'cursor-cli': return token(env.CURSOR_API_KEY) || token(env.CURSOR_AUTH_TOKEN)
    case 'mimocode': return mimoEvidence(env, references)
    case 'fx': return fxEvidence(env, references)
    case 'omp': return MODEL_KEYS.some((key) => token(env[key])) || ompEvidence(env, references)
    case 'hermes': return hermesEvidence(env, references)
    case 'grok': return grokEvidence(env, references)
    default: return false
  }
}

/** Every referenced environment variable participates in both process launch and readiness identity. */
export function additionalNativeCredentialEnv(id: string, env: Env): Record<string, string> {
  const references = new Set<string>(CONTROL_ENV[id] ?? [])
  switch (id) {
    case 'cursor-cli': references.add('CURSOR_API_KEY'); references.add('CURSOR_AUTH_TOKEN'); break
    case 'mimocode': references.add('MIMOCODE_AUTH_CONTENT'); mimoEvidence(env, references); break
    case 'fx': references.add('AI_GATEWAY_API_KEY'); references.add('VERCEL_OIDC_TOKEN'); fxEvidence(env, references); break
    case 'omp': MODEL_KEYS.forEach((key) => references.add(key)); ompEvidence(env, references); break
    case 'hermes': HERMES_KEYS.forEach((key) => references.add(key)); hermesEvidence(env, references); break
    case 'grok': references.add('XAI_API_KEY'); grokEvidence(env, references); break
    default: return {}
  }
  // An explicit empty OMP_PROFILE shadows PI_PROFILE. Preserve present values,
  // including empty credential refs, so launch semantics and identity agree.
  return Object.fromEntries([...references].flatMap((key) => typeof env[key] === 'string' &&
    Buffer.byteLength(env[key]!) <= LIMIT ? [[key, env[key]!]] : []))
}
