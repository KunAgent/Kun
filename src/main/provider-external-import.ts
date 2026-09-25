import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { AppSettingsV1, ModelEndpointFormat, ModelProviderEndpointsV1, ModelProviderProfileV1 } from '../shared/app-settings'
import { defaultModelRequestRetrySettings, getModelProviderSettings } from '../shared/app-settings'
import type { RuntimeRequestResult } from '../shared/kun-gui-api'
import { normalizeCatalogBaseUrl } from './models-dev-catalog'
import { MODEL_PROVIDER_PRESETS } from '../shared/model-provider-preset-catalog'
import { readCcSwitchEntries } from './provider-external-import-cc-switch'
import {
  MAX_ENTRIES,
  MAX_MODELS,
  sha256Key,
  type RawEntry,
  type SourceRead
} from './provider-external-import-types'

/**
 * External provider import: read-only scans of other tools'
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
  endpoints?: ModelProviderEndpointsV1
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

type ExistingProvider = { id: string; baseUrl: string }

function toDraft(
  source: ExternalProviderSource,
  entry: RawEntry,
  existing: readonly ExistingProvider[],
  credentialFingerprints: Readonly<Record<string, string>>
): ExternalProviderDraft {
  const takenIds = new Set(existing.map((provider) => provider.id.toLowerCase()))
  const sameHost = existing.filter((provider) =>
    normalizeCatalogBaseUrl(provider.baseUrl) === normalizeCatalogBaseUrl(entry.baseUrl))
  // Settings profiles are credential-free: the real key only exists in the
  // Registry's protected store, so dedup compares sha256 fingerprints.
  const entryFingerprint = sha256Key(entry.apiKey)
  const exact = entryFingerprint
    ? sameHost.find((provider) => credentialFingerprints[provider.id] === entryFingerprint)
    : undefined
  const mergeTarget = sameHost.find((provider) => provider !== exact)
  const { id, renamed } = safeId(entry.name, takenIds)
  const status: ExternalProviderDraft['status'] = exact
    ? 'exists'
    : mergeTarget && entry.apiKey.trim()
      ? 'mergeable'
      : renamed
        ? 'conflict-renamed'
        : 'new'
  return {
    source,
    ref: entry.ref,
    name: entry.name.slice(0, MAX_NAME),
    suggestedId: id,
    baseUrl: entry.baseUrl,
    endpointFormat: entry.endpointFormat,
    ...(entry.endpoints ? { endpoints: entry.endpoints } : {}),
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

function readClaudeCodeEntries(homeDir: string): SourceRead {
  const path = join(homeDir, '.claude', 'settings.json')
  if (!existsSync(path)) return { entries: [], skipped: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { entries: [], skipped: [] }
  }
  const env = (parsed as { env?: unknown })?.env
  if (!env || typeof env !== 'object') return { entries: [], skipped: [] }
  // Base URL and key are read from the same env record so a relay's
  // credential can never be paired with another provider's endpoint.
  const record = env as Record<string, unknown>
  const baseUrl = typeof record.ANTHROPIC_BASE_URL === 'string' ? record.ANTHROPIC_BASE_URL.trim() : ''
  const apiKey = (
    typeof record.ANTHROPIC_AUTH_TOKEN === 'string' ? record.ANTHROPIC_AUTH_TOKEN :
      typeof record.ANTHROPIC_API_KEY === 'string' ? record.ANTHROPIC_API_KEY : ''
  ).trim()
  if (!baseUrl) return { entries: [], skipped: [] }
  // Only third-party endpoints are worth importing; the default Anthropic
  // endpoint is already covered by the built-in preset.
  if (normalizeCatalogBaseUrl(baseUrl) === 'https://api.anthropic.com') {
    return { entries: [], skipped: [] }
  }
  const models = [
    typeof record.ANTHROPIC_MODEL === 'string' ? record.ANTHROPIC_MODEL : '',
    typeof record.ANTHROPIC_DEFAULT_OPUS_MODEL === 'string' ? record.ANTHROPIC_DEFAULT_OPUS_MODEL : '',
    typeof record.ANTHROPIC_DEFAULT_SONNET_MODEL === 'string' ? record.ANTHROPIC_DEFAULT_SONNET_MODEL : '',
    typeof record.ANTHROPIC_SMALL_FAST_MODEL === 'string' ? record.ANTHROPIC_SMALL_FAST_MODEL : ''
  ].map((model) => model.trim()).filter(Boolean)
  return {
    entries: [{
      ref: 'claude-code:settings',
      name: 'Claude Code Relay',
      baseUrl,
      endpointFormat: 'messages',
      models: [...new Set(models)],
      apiKey,
      needsKey: false
    }],
    skipped: []
  }
}

/* ---------- Codex: ~/.codex/config.toml [model_providers.*] ---------- */

function readCodexEntries(homeDir: string): SourceRead {
  const path = join(homeDir, '.codex', 'config.toml')
  if (!existsSync(path)) return { entries: [], skipped: [] }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { entries: [], skipped: [] }
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
  return { entries: entries.slice(0, MAX_ENTRIES), skipped: [] }
}

/* ---------- OpenCode: ~/.config/opencode/opencode.json(c) ---------- */

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

function readOpenCodeEntries(homeDir: string): SourceRead {
  const dir = join(homeDir, '.config', 'opencode')
  const path = ['opencode.json', 'opencode.jsonc']
    .map((name) => join(dir, name))
    .find((candidate) => existsSync(candidate))
  if (!path) return { entries: [], skipped: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(path, 'utf8')))
  } catch {
    return { entries: [], skipped: [] }
  }
  const providers = (parsed as { provider?: unknown })?.provider
  if (!providers || typeof providers !== 'object') return { entries: [], skipped: [] }
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
  return { entries, skipped: [] }
}


/* ---------- public API ---------- */

function rawEntriesForSource(source: ExternalProviderSource, homeDir: string): SourceRead {
  switch (source) {
    case 'claude-code': return readClaudeCodeEntries(homeDir)
    case 'codex': return readCodexEntries(homeDir)
    case 'opencode': return readOpenCodeEntries(homeDir)
    case 'cc-switch': return readCcSwitchEntries(homeDir)
  }
}

export type ExternalProviderScanOptions = {
  /** Overrides `homedir()` — tests point this at a temp fixture directory. */
  homeDir?: string
  /**
   * sha256(apiKey) fingerprints of the live Registry credentials, keyed by
   * provider id. Settings profiles are secret-free, so dedup against the
   * real key must happen through these hashes.
   */
  credentialFingerprints?: Readonly<Record<string, string>>
}

export function scanExternalProviders(
  settings: AppSettingsV1,
  options: ExternalProviderScanOptions = {}
): ExternalProviderDraft[] {
  const homeDir = options.homeDir ?? homedir()
  const fingerprints = options.credentialFingerprints ?? {}
  const existing: ExistingProvider[] = getModelProviderSettings(settings).providers
    .map((provider) => ({ id: provider.id, baseUrl: provider.baseUrl }))
  const drafts: ExternalProviderDraft[] = []
  const seenRefs = new Set<string>()
  const sources: ExternalProviderSource[] = ['cc-switch', 'claude-code', 'codex', 'opencode']
  for (const source of sources) {
    const read = rawEntriesForSource(source, homeDir)
    for (const entry of read.entries) {
      if (seenRefs.has(entry.ref)) continue
      seenRefs.add(entry.ref)
      drafts.push(toDraft(source, entry, existing, fingerprints))
    }
    for (const skipped of read.skipped) {
      if (seenRefs.has(skipped.ref)) continue
      seenRefs.add(skipped.ref)
      drafts.push({
        source,
        ref: skipped.ref,
        name: skipped.name.slice(0, MAX_NAME),
        suggestedId: '',
        baseUrl: '',
        endpointFormat: 'chat_completions',
        models: [],
        hasKey: false,
        needsKey: false,
        status: 'new',
        skipped: skipped.reason
      })
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
  ref: string,
  options: { homeDir?: string } = {}
): RawEntry | null {
  return rawEntriesForSource(source, options.homeDir ?? homedir())
    .entries.find((entry) => entry.ref === ref) ?? null
}

type RuntimeRequestLike = (
  path: string,
  method?: string,
  body?: string,
  headers?: Record<string, string>
) => Promise<RuntimeRequestResult>

/**
 * Reads the Registry's sha256 credential fingerprints for import dedup.
 * Raw keys never leave the protected store — only hashes cross this bridge.
 * Degrades to an empty map when the runtime is unavailable so the scan still
 * returns entries (they just cannot be marked `exists`).
 */
export async function withRegistryCredentials<T>(
  runtimeRequest: RuntimeRequestLike | undefined,
  run: (fingerprints: Record<string, string>) => T | Promise<T>
): Promise<T> {
  let fingerprints: Record<string, string> = {}
  if (runtimeRequest) {
    try {
      const response = await runtimeRequest(
        '/v1/model-connections/credentials/fingerprints',
        'GET'
      )
      if (response.ok) {
        const parsed = JSON.parse(response.body ?? '{}') as { fingerprints?: unknown }
        if (parsed.fingerprints && typeof parsed.fingerprints === 'object') {
          fingerprints = parsed.fingerprints as Record<string, string>
        }
      }
    } catch {
      fingerprints = {}
    }
  }
  return run(fingerprints)
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
  input: { source: ExternalProviderSource; ref: string; name?: string },
  options: { homeDir?: string } = {}
): ExternalProviderImportResult {
  const entry = readExternalProviderEntry(input.source, input.ref, options)
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
    ...(entry.endpoints ? { endpoints: entry.endpoints } : {}),
    useProxy: false,
    retry: defaultModelRequestRetrySettings(),
    models: entry.models.slice(0, MAX_MODELS),
    modelProfiles: {}
  }
  return { ok: true, providerId: id, profile }
}

export type { RawEntry as ExternalProviderRawEntry }
