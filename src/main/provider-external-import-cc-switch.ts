import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { ModelEndpointFormat, ModelProviderEndpointsV1 } from '../shared/app-settings'
import { normalizeCatalogBaseUrl } from './models-dev-catalog'
import {
  MAX_ENTRIES,
  isSkippedEntry,
  sha256Key,
  type RawEntry,
  type SkippedEntry,
  type SourceRead
} from './provider-external-import-types'

/* ---------- CC Switch: db + legacy json ---------- */

type CcSwitchRecord = {
  app: string
  id: string
  name: string
  config: unknown
}

function envString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function ccSwitchClaudeEntry(record: CcSwitchRecord): RawEntry | SkippedEntry {
  const env = record.config && typeof record.config === 'object'
    ? (record.config as { env?: unknown }).env
    : null
  if (!env || typeof env !== 'object') {
    return { ref: `cc-switch:${record.app}:${record.id}`, name: record.name, reason: 'settings_config has no env section' }
  }
  const record_ = env as Record<string, unknown>
  const baseUrl = envString(record_, 'ANTHROPIC_BASE_URL')
  if (!baseUrl) {
    return { ref: `cc-switch:${record.app}:${record.id}`, name: record.name, reason: 'env.ANTHROPIC_BASE_URL is missing' }
  }
  const apiKey = envString(record_, 'ANTHROPIC_AUTH_TOKEN') || envString(record_, 'ANTHROPIC_API_KEY')
  const models = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL'
  ].map((key) => envString(record_, key)).filter(Boolean)
  return {
    ref: `cc-switch:${record.app}:${record.id}`,
    name: record.name,
    baseUrl,
    endpointFormat: 'messages',
    endpoints: { messages: baseUrl },
    models: [...new Set(models)],
    apiKey,
    needsKey: false
  }
}

/** Narrow TOML scan: `key = "value"` pairs per `[table]` section. */
function scanToml(text: string): { root: Record<string, string>; tables: Map<string, Record<string, string>> } {
  const root: Record<string, string> = {}
  const tables = new Map<string, Record<string, string>>()
  let current: Record<string, string> | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const table = /^\[([^\]]+)\]/u.exec(line)
    if (table) {
      const name = table[1]!.trim()
      current = tables.get(name) ?? {}
      tables.set(name, current)
      continue
    }
    const field = /^([A-Za-z_]+)\s*=\s*"([^"]*)"/u.exec(line)
    if (field) (current ?? root)[field[1]!] = field[2]!
  }
  return { root, tables }
}

function ccSwitchCodexEntry(record: CcSwitchRecord): RawEntry | SkippedEntry {
  const config = record.config && typeof record.config === 'object'
    ? record.config as Record<string, unknown>
    : null
  const tomlText = config && typeof config.config === 'string' ? config.config : ''
  if (!tomlText) {
    return { ref: `cc-switch:${record.app}:${record.id}`, name: record.name, reason: 'settings_config has no config TOML' }
  }
  const toml = scanToml(tomlText)
  const providerName = toml.root.model_provider?.trim() ?? ''
  const providerTable = providerName
    ? (toml.tables.get(`model_providers.${providerName}`) ?? toml.tables.get(`model_providers."${providerName}"`))
    : undefined
  const baseUrl = providerTable?.base_url?.trim() ?? ''
  if (!baseUrl) {
    return { ref: `cc-switch:${record.app}:${record.id}`, name: record.name, reason: `model_provider "${providerName}" has no base_url` }
  }
  const wireApi = providerTable?.wire_api?.trim().toLowerCase() ?? ''
  const endpointFormat: ModelEndpointFormat = wireApi === 'responses' ? 'responses' : 'chat_completions'
  const auth = config?.auth && typeof config.auth === 'object'
    ? config.auth as Record<string, unknown>
    : null
  const apiKey = auth ? envString(auth, 'OPENAI_API_KEY') : ''
  const model = toml.root.model?.trim() ?? ''
  return {
    ref: `cc-switch:${record.app}:${record.id}`,
    name: record.name,
    baseUrl,
    endpointFormat,
    endpoints: { [endpointFormat]: baseUrl } as ModelProviderEndpointsV1,
    models: model ? [model] : [],
    apiKey,
    needsKey: !apiKey
  }
}

function ccSwitchRecordToEntry(record: CcSwitchRecord): RawEntry | SkippedEntry {
  const app = record.app.trim().toLowerCase()
  if (app === 'claude' || app === 'claude-desktop' || app === 'claude_code') {
    return ccSwitchClaudeEntry(record)
  }
  if (app === 'codex') return ccSwitchCodexEntry(record)
  return {
    ref: `cc-switch:${record.app}:${record.id}`,
    name: record.name,
    reason: `CC Switch app "${record.app}" is not supported for import`
  }
}

/**
 * A relay configured for several apps carries the same endpoint and key in
 * each record. Collapse those into one provider whose `endpoints` keeps the
 * per-protocol URLs, so importing one entry wires every observed protocol.
 */
function mergeCcSwitchRelayEntries(reads: (RawEntry | SkippedEntry)[]): {
  entries: RawEntry[]
  skipped: SkippedEntry[]
} {
  const entries = reads.filter((read): read is RawEntry => !isSkippedEntry(read))
  const skipped = reads.filter(isSkippedEntry)
  const groups = new Map<string, RawEntry[]>()
  for (const entry of entries) {
    const key = `${normalizeCatalogBaseUrl(entry.baseUrl)}|${sha256Key(entry.apiKey) ?? ''}`
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  const merged: RawEntry[] = []
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]!); continue }
    const endpoints: Record<string, string> = {}
    for (const entry of group) {
      for (const [format, url] of Object.entries(entry.endpoints ?? { [entry.endpointFormat]: entry.baseUrl })) {
        if (url && !endpoints[format]) endpoints[format] = url
      }
    }
    const formats = ['chat_completions', 'messages', 'responses'] as const
    const primary = formats.find((format) => endpoints[format]) ?? group[0]!.endpointFormat
    merged.push({
      ref: group[0]!.ref,
      name: group[0]!.name,
      baseUrl: group[0]!.baseUrl,
      endpointFormat: primary,
      endpoints: endpoints as ModelProviderEndpointsV1,
      models: [...new Set(group.flatMap((entry) => entry.models))],
      apiKey: group[0]!.apiKey,
      needsKey: group.every((entry) => entry.needsKey)
    })
  }
  return { entries: merged, skipped }
}

function parseCcSwitchJsonRecords(parsed: unknown): CcSwitchRecord[] {
  const records: CcSwitchRecord[] = []
  if (!parsed || typeof parsed !== 'object') return records
  for (const [app, appValue] of Object.entries(parsed as Record<string, unknown>)) {
    const providers = appValue && typeof appValue === 'object'
      ? (appValue as { providers?: unknown }).providers
      : null
    if (!providers || typeof providers !== 'object') continue
    for (const [id, raw] of Object.entries(providers as Record<string, unknown>)) {
      if (records.length >= MAX_ENTRIES) return records
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as { name?: unknown; settingsConfig?: unknown; settings_config?: unknown }
      records.push({
        app,
        id,
        name: (typeof entry.name === 'string' && entry.name.trim()) || id,
        config: entry.settingsConfig ?? entry.settings_config
      })
    }
  }
  return records
}

function readCcSwitchJson(path: string): (RawEntry | SkippedEntry)[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  return parseCcSwitchJsonRecords(parsed).map(ccSwitchRecordToEntry)
}

const requireFromHere = createRequire(import.meta.url)

type SqliteDb = {
  prepare(sql: string): { all(): unknown[]; get(): unknown }
  close(): void
}

/**
 * `node:sqlite` covers dev and test environments; the packaged app keeps the
 * Electron-rebuilt better-sqlite3 as the fallback. Either may be missing —
 * an unavailable backend only loses the sqlite source, never crashes.
 */
function openSqliteDb(path: string): SqliteDb | null {
  try {
    const sqlite = requireFromHere('node:sqlite') as typeof import('node:sqlite')
    const db = new sqlite.DatabaseSync(path, { readOnly: true })
    db.prepare('SELECT 1').get()
    return db
  } catch {
    // node:sqlite unavailable — try the bundled driver below.
  }
  try {
    const DatabaseCtor = requireFromHere('better-sqlite3') as typeof import('better-sqlite3')
    return new DatabaseCtor(path, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
}

function readCcSwitchDb(path: string): (RawEntry | SkippedEntry)[] {
  const db = openSqliteDb(path)
  if (!db) return []
  try {
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'providers'"
    ).get() as { name: string } | undefined
    if (!table) return []
    const rows = db.prepare(
      'SELECT id, app_type, name, settings_config, website_url FROM providers LIMIT 500'
    ).all() as Record<string, unknown>[]
    return rows.slice(0, MAX_ENTRIES).map((row, index) => {
      let config: unknown = null
      try {
        config = typeof row.settings_config === 'string' ? JSON.parse(row.settings_config) : null
      } catch {
        config = null
      }
      return ccSwitchRecordToEntry({
        app: typeof row.app_type === 'string' ? row.app_type : '',
        id: typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : `row-${index}`,
        name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : `cc-switch ${index + 1}`,
        config
      })
    })
  } catch {
    return []
  } finally {
    try { db?.close() } catch { /* readonly close is best-effort */ }
  }
}

export function readCcSwitchEntries(homeDir: string): SourceRead {
  const dir = join(homeDir, '.cc-switch')
  const reads: (RawEntry | SkippedEntry)[] = []
  const dbPath = join(dir, 'cc-switch.db')
  if (existsSync(dbPath)) reads.push(...readCcSwitchDb(dbPath))
  const jsonPath = join(dir, 'config.json')
  if (existsSync(jsonPath)) reads.push(...readCcSwitchJson(jsonPath))
  return mergeCcSwitchRelayEntries(reads)
}
