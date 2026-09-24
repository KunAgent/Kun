import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AppSettingsV1, ModelEndpointFormat, ModelProviderProfileV1 } from '../shared/app-settings'
import { defaultModelRequestRetrySettings, getModelProviderSettings } from '../shared/app-settings'
import { normalizeCatalogBaseUrl } from './models-dev-catalog'
import { MODEL_PROVIDER_PRESETS } from '../shared/model-provider-preset-catalog'

/**
 * External provider import (plan §6.12): read-only scans of other tools'
 * config. Credentials are extracted only inside this main-process module —
 * scan results carry a `hasKey` flag and a masked hint, never the key —
 * and the commit step re-reads the source file itself.
 */
export type ExternalProviderSource = 'cc-switch' | 'claude-code' | 'codex' | 'opencode'

export type ExternalProviderDraft = {
  source: ExternalProviderSource
  /** Opaque locator used by the commit step to re-read the entry. */
  ref: string
  name: string
  suggestedId: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  models: string[]
  hasKey: boolean
  keyHint?: string
  /** Key lives in an env var (Codex) — user must supply it after import. */
  needsKey: boolean
  status: 'new' | 'exists' | 'conflict-renamed' | 'mergeable'
  mergeTargetId?: string
  presetId?: string
  skipped?: string
}

type RawEntry = {
  ref: string
  name: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  models: string[]
  apiKey: string
  needsKey: boolean
}

const MAX_ENTRIES = 200
const MAX_MODELS = 200
const MAX_NAME = 80

function safeId(raw: string, taken: ReadonlySet<string>): { id: string; renamed: boolean } {
  const base = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'imported'
  let id = base.slice(0, 96)
  if (!taken.has(id)) return { id, renamed: false }
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${id}-${n}`
    if (!taken.has(candidate)) return { id: candidate, renamed: true }
  }
  return { id: `${id}-${Date.now().toString(36)}`, renamed: true }
}

function maskKey(key: string): string | undefined {
  const trimmed = key.trim()
  if (!trimmed) return undefined
  return trimmed.length <= 8
    ? `${trimmed.slice(0, 2)}…`
    : `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

function isKunGatewayUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      (port === 18899 || port === 18788)
  } catch {
    return false
  }
}

function presetIdForBaseUrl(baseUrl: string): string | undefined {
  const normalized = normalizeCatalogBaseUrl(baseUrl)
  if (!normalized) return undefined
  for (const preset of MODEL_PROVIDER_PRESETS) {
    if (preset.baseUrl && normalizeCatalogBaseUrl(preset.baseUrl) === normalized) {
      return preset.id
    }
    if (preset.tokenPlan?.baseUrl && normalizeCatalogBaseUrl(preset.tokenPlan.baseUrl) === normalized) {
      return preset.id
    }
  }
  return undefined
}

function toDraft(
  source: ExternalProviderSource,
  entry: RawEntry,
  existing: readonly { id: string; baseUrl: string; apiKey: string }[]
): ExternalProviderDraft {
  const takenIds = new Set(existing.map((provider) => provider.id.toLowerCase()))
  const sameHost = existing.filter((provider) =>
    normalizeCatalogBaseUrl(provider.baseUrl) === normalizeCatalogBaseUrl(entry.baseUrl))
  const exact = sameHost.find((provider) =>
    provider.apiKey.trim() && provider.apiKey.trim() === entry.apiKey.trim())
  const mergeTarget = sameHost.find((provider) => provider !== exact)
  const { id, renamed } = safeId(entry.name, takenIds)
  const status: ExternalProviderDraft['status'] = exact
    ? 'exists'
    : renamed
      ? 'conflict-renamed'
      : mergeTarget && entry.apiKey.trim()
        ? 'mergeable'
        : 'new'
  return {
    source,
    ref: entry.ref,
    name: entry.name.slice(0, MAX_NAME),
    suggestedId: id,
    baseUrl: entry.baseUrl,
    endpointFormat: entry.endpointFormat,
    models: entry.models.slice(0, MAX_MODELS),
    hasKey: Boolean(entry.apiKey.trim()),
    ...(maskKey(entry.apiKey) ? { keyHint: maskKey(entry.apiKey) } : {}),
    needsKey: entry.needsKey && !entry.apiKey.trim(),
    status,
    ...(mergeTarget && !exact ? { mergeTargetId: mergeTarget.id } : {}),
    ...(presetIdForBaseUrl(entry.baseUrl)
      ? { presetId: presetIdForBaseUrl(entry.baseUrl) }
      : {}),
    ...(isKunGatewayUrl(entry.baseUrl)
      ? { skipped: 'Points at the Kun local gateway — skipped to avoid a routing loop.' }
      : {})
  }
}

/* ---------- Claude Code: ~/.claude/settings.json env ---------- */

function readClaudeCodeEntries(): RawEntry[] {
  const path = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(path)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  const env = (parsed as { env?: unknown })?.env
  if (!env || typeof env !== 'object') return []
  const record = env as Record<string, unknown>
  const baseUrl = typeof record.ANTHROPIC_BASE_URL === 'string' ? record.ANTHROPIC_BASE_URL.trim() : ''
  const apiKey = (
    typeof record.ANTHROPIC_AUTH_TOKEN === 'string' ? record.ANTHROPIC_AUTH_TOKEN :
      typeof record.ANTHROPIC_API_KEY === 'string' ? record.ANTHROPIC_API_KEY : ''
  ).trim()
  if (!baseUrl) return []
  // Only third-party endpoints are worth importing; the default Anthropic
  // endpoint is already covered by the built-in preset.
  if (normalizeCatalogBaseUrl(baseUrl) === 'https://api.anthropic.com') return []
  const models = [
    typeof record.ANTHROPIC_MODEL === 'string' ? record.ANTHROPIC_MODEL : '',
    typeof record.ANTHROPIC_DEFAULT_OPUS_MODEL === 'string' ? record.ANTHROPIC_DEFAULT_OPUS_MODEL : '',
    typeof record.ANTHROPIC_DEFAULT_SONNET_MODEL === 'string' ? record.ANTHROPIC_DEFAULT_SONNET_MODEL : '',
    typeof record.ANTHROPIC_SMALL_FAST_MODEL === 'string' ? record.ANTHROPIC_SMALL_FAST_MODEL : ''
  ].map((model) => model.trim()).filter(Boolean)
  return [{
    ref: 'claude-code:settings',
    name: 'Claude Code Relay',
    baseUrl,
    endpointFormat: 'messages',
    models: [...new Set(models)],
    apiKey,
    needsKey: false
  }]
}

/* ---------- Codex: ~/.codex/config.toml [model_providers.*] ---------- */

function readCodexEntries(): RawEntry[] {
  const path = join(homedir(), '.codex', 'config.toml')
  if (!existsSync(path)) return []
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  // Narrow TOML subset: scan `[model_providers.<name>]` tables for the
  // `base_url` / `wire_api` / `env_key` / `name` string fields only.
  const entries: RawEntry[] = []
  let current: { name: string; fields: Record<string, string> } | null = null
  const flush = (): void => {
    if (!current) return
    const baseUrl = current.fields.base_url?.trim() ?? ''
    if (!baseUrl) { current = null; return }
    const wireApi = current.fields.wire_api?.trim().toLowerCase() ?? ''
    const endpointFormat: ModelEndpointFormat =
      wireApi === 'responses' ? 'responses' : 'chat_completions'
    const envKey = current.fields.env_key?.trim() ?? ''
    entries.push({
      ref: `codex:${current.name}`,
      name: current.fields.name?.trim() || current.name,
      baseUrl,
      endpointFormat,
      models: [],
      apiKey: '',
      needsKey: Boolean(envKey)
    })
    current = null
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const table = /^\[model_providers\.([^\]]+)\]/u.exec(line)
    if (table) {
      flush()
      current = { name: table[1]!.trim().replace(/^"|"$/g, ''), fields: {} }
      continue
    }
    if (/^\[/u.test(line)) {
      flush()
      continue
    }
    if (!current) continue
    const field = /^([A-Za-z_]+)\s*=\s*"([^"]*)"/u.exec(line)
    if (field) current.fields[field[1]!] = field[2]!
  }
  flush()
  return entries.slice(0, MAX_ENTRIES)
}

/* ---------- OpenCode: ~/.config/opencode/opencode.json(c) ---------- */

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

function readOpenCodeEntries(): RawEntry[] {
  const dir = join(homedir(), '.config', 'opencode')
  const path = ['opencode.json', 'opencode.jsonc']
    .map((name) => join(dir, name))
    .find((candidate) => existsSync(candidate))
  if (!path) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(path, 'utf8')))
  } catch {
    return []
  }
  const providers = (parsed as { provider?: unknown })?.provider
  if (!providers || typeof providers !== 'object') return []
  const entries: RawEntry[] = []
  for (const [key, raw] of Object.entries(providers as Record<string, unknown>)) {
    if (entries.length >= MAX_ENTRIES) break
    if (!raw || typeof raw !== 'object') continue
    const provider = raw as {
      name?: unknown
      options?: { baseURL?: unknown; apiKey?: unknown }
      models?: unknown
    }
    const baseUrl = typeof provider.options?.baseURL === 'string'
      ? provider.options.baseURL.trim()
      : ''
    if (!baseUrl) continue
    const models = provider.models && typeof provider.models === 'object'
      ? Object.keys(provider.models as Record<string, unknown>)
      : []
    entries.push({
      ref: `opencode:${key}`,
      name: (typeof provider.name === 'string' && provider.name.trim()) || key,
      baseUrl,
      endpointFormat: 'chat_completions',
      models: models.slice(0, MAX_MODELS),
      apiKey: typeof provider.options?.apiKey === 'string' ? provider.options.apiKey : '',
      needsKey: false
    })
  }
  return entries
}

/* ---------- CC Switch: db + legacy json ---------- */

function stringsDeep(value: unknown, keys: readonly string[]): string {
  if (!value || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = stringsDeep(item, keys)
      if (found) return found
    }
    return ''
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(key.toLowerCase()) && typeof raw === 'string' && raw.trim()) {
      return raw.trim()
    }
  }
  for (const raw of Object.values(value as Record<string, unknown>)) {
    if (raw && typeof raw === 'object') {
      const found = stringsDeep(raw, keys)
      if (found) return found
    }
  }
  return ''
}

const CCSWITCH_BASE_URL_KEYS = ['base_url', 'baseurl', 'anthropic_base_url', 'api_base_url', 'api_base'] as const
const CCSWITCH_KEY_KEYS = ['api_key', 'apikey', 'auth_token', 'anthropic_auth_token', 'token'] as const
const CCSWITCH_MODEL_KEYS = ['model', 'anthropic_model'] as const

function readCcSwitchJson(path: string): RawEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  const entries: RawEntry[] = []
  const visit = (scope: string, value: unknown): void => {
    if (entries.length >= MAX_ENTRIES || !value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(scope, item)
      return
    }
    const record = value as Record<string, unknown>
    const baseUrl = stringsDeep(record, CCSWITCH_BASE_URL_KEYS)
    if (baseUrl && /^https?:\/\//u.test(baseUrl)) {
      const name = typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : `${scope} entry`
      const model = stringsDeep(record, CCSWITCH_MODEL_KEYS)
      entries.push({
        ref: `cc-switch:${scope}:${name}`,
        name,
        baseUrl,
        endpointFormat: 'messages',
        models: model ? [model] : [],
        apiKey: stringsDeep(record, CCSWITCH_KEY_KEYS),
        needsKey: false
      })
      return
    }
    for (const [key, nested] of Object.entries(record)) {
      if (typeof nested === 'object' && nested !== null) visit(`${scope}.${key}`, nested)
    }
  }
  visit('root', parsed)
  return entries
}

const requireFromHere = createRequire(import.meta.url)

function readCcSwitchDb(path: string): RawEntry[] {
  let DatabaseCtor: typeof import('better-sqlite3') | null = null
  try {
    DatabaseCtor = requireFromHere('better-sqlite3') as typeof import('better-sqlite3')
  } catch {
    return []
  }
  let db: InstanceType<NonNullable<typeof DatabaseCtor>> | null = null
  try {
    db = new DatabaseCtor!(path, { readonly: true, fileMustExist: true })
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%provider%'"
    ).all() as { name: string }[]
    const entries: RawEntry[] = []
    for (const table of tables.slice(0, 8)) {
      const rows = db.prepare(`SELECT * FROM "${table.name.replace(/"/g, '""')}" LIMIT 500`).all() as Record<string, unknown>[]
      for (const row of rows) {
        if (entries.length >= MAX_ENTRIES) break
        const baseUrl = stringsDeep(row, CCSWITCH_BASE_URL_KEYS)
        if (!baseUrl || !/^https?:\/\//u.test(baseUrl)) continue
        const name = typeof row.name === 'string' && row.name.trim()
          ? row.name.trim()
          : `cc-switch ${table.name}`
        const model = stringsDeep(row, CCSWITCH_MODEL_KEYS)
        entries.push({
          ref: `cc-switch:db:${table.name}:${name}`,
          name,
          baseUrl,
          endpointFormat: 'messages',
          models: model ? [model] : [],
          apiKey: stringsDeep(row, CCSWITCH_KEY_KEYS),
          needsKey: false
        })
      }
    }
    return entries
  } catch {
    return []
  } finally {
    try { db?.close() } catch { /* readonly close is best-effort */ }
  }
}

function readCcSwitchEntries(): RawEntry[] {
  const dir = join(homedir(), '.cc-switch')
  const entries: RawEntry[] = []
  const dbPath = join(dir, 'cc-switch.db')
  if (existsSync(dbPath)) entries.push(...readCcSwitchDb(dbPath))
  const jsonPath = join(dir, 'config.json')
  if (existsSync(jsonPath)) entries.push(...readCcSwitchJson(jsonPath))
  return entries
}

/* ---------- public API ---------- */

function rawEntriesForSource(source: ExternalProviderSource): RawEntry[] {
  switch (source) {
    case 'claude-code': return readClaudeCodeEntries()
    case 'codex': return readCodexEntries()
    case 'opencode': return readOpenCodeEntries()
    case 'cc-switch': return readCcSwitchEntries()
  }
}

export function scanExternalProviders(settings: AppSettingsV1): ExternalProviderDraft[] {
  const existing = getModelProviderSettings(settings).providers.map((provider) => ({
    id: provider.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey
  }))
  const drafts: ExternalProviderDraft[] = []
  const seenRefs = new Set<string>()
  const sources: ExternalProviderSource[] = ['cc-switch', 'claude-code', 'codex', 'opencode']
  for (const source of sources) {
    for (const entry of rawEntriesForSource(source)) {
      if (seenRefs.has(entry.ref)) continue
      seenRefs.add(entry.ref)
      drafts.push(toDraft(source, entry, existing))
    }
  }
  return drafts
}

/**
 * Re-reads the source file and returns the full entry including the
 * credential. Only called from the IPC commit handler; the credential must
 * go straight into the settings profile (the existing credential migration
 * moves it into the protected account store) and never to the renderer.
 */
export function readExternalProviderEntry(
  source: ExternalProviderSource,
  ref: string
): RawEntry | null {
  return rawEntriesForSource(source).find((entry) => entry.ref === ref) ?? null
}

/**
 * Commits one scanned entry into the settings store: appends a provider
 * profile carrying the freshly re-read credential. The normal
 * settings→registry sync then connects it to Kun, and the credential
 * migration moves the key into the protected store. Returns the created
 * profile id so the renderer can select it.
 */
export type ExternalProviderImportResult =
  | { ok: true; providerId: string; profile: ModelProviderProfileV1 }
  | { ok: false; message: string }

export function importExternalProvider(
  settings: AppSettingsV1,
  input: { source: ExternalProviderSource; ref: string; name?: string }
): ExternalProviderImportResult {
  const entry = readExternalProviderEntry(input.source, input.ref)
  if (!entry) return { ok: false, message: 'The selected external entry is no longer available.' }
  if (isKunGatewayUrl(entry.baseUrl)) {
    return { ok: false, message: 'Skipped: the entry points at the Kun local gateway.' }
  }
  const providerSettings = getModelProviderSettings(settings)
  const taken = new Set(providerSettings.providers.map((provider) => provider.id.toLowerCase()))
  const { id } = safeId(entry.name, taken)
  const name = (input.name?.trim() || entry.name).slice(0, MAX_NAME)
  const presetId = presetIdForBaseUrl(entry.baseUrl)
  const profile: ModelProviderProfileV1 = {
    id,
    name,
    ...(presetId ? { presetSource: { presetId, mode: 'api' as const } } : {}),
    apiKey: entry.apiKey.trim(),
    baseUrl: entry.baseUrl,
    endpointFormat: entry.endpointFormat,
    useProxy: false,
    retry: defaultModelRequestRetrySettings(),
    models: entry.models.slice(0, MAX_MODELS),
    modelProfiles: {}
  }
  return { ok: true, providerId: id, profile }
}

export type { RawEntry as ExternalProviderRawEntry }
