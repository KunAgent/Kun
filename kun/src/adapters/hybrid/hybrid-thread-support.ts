import { mkdir, open, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import { emptyUsageSnapshot, UsageSnapshotSchema, type UsageSnapshot } from '../../contracts/usage.js'
import { diffUsage, hasUsage } from '../../domain/usage.js'
import type { SessionLatestUsageSnapshot, SessionUsageRecord } from '../../ports/session-store.js'

export type UsageRuntimeEvent = Extract<RuntimeEvent, { kind: 'usage' }>

export type UsageRow = {
  thread_id: string
  seq: number
  timestamp: string
  turn_id: string | null
  model: string | null
  provider_id: string | null
  usage_json: string
}


export function previewFromItems(items: TurnItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!item) continue
    if (item.kind === 'user_message' || item.kind === 'assistant_text') {
      return item.text.slice(0, 500)
    }
    if (item.kind === 'error') return item.message.slice(0, 500)
    if (item.kind === 'tool_call') return (item.summary ?? item.toolName).slice(0, 500)
  }
  return ''
}

export function usageRowFromEvent(event: RuntimeEvent & { kind: 'usage' }): UsageRow {
  return {
    thread_id: event.threadId,
    seq: event.seq,
    timestamp: event.timestamp,
    turn_id: event.turnId ?? null,
    model: event.model ?? null,
    provider_id: event.providerId ?? null,
    usage_json: JSON.stringify(event.usage)
  }
}

export function usageRecordsFromRows(rows: UsageRow[]): SessionUsageRecord[] {
  const previousByThread = new Map<string, UsageSnapshot>()
  const records: SessionUsageRecord[] = []
  for (const row of rows) {
    const usage = parseUsageSnapshot(row.usage_json)
    if (!usage) continue
    const previous = previousByThread.get(row.thread_id) ?? emptyUsageSnapshot()
    const delta = diffUsage(usage, previous)
    previousByThread.set(row.thread_id, usage)
    if (!hasUsage(delta)) continue
    records.push({
      threadId: row.thread_id,
      ...(row.turn_id ? { turnId: row.turn_id } : {}),
      ...(row.model ? { model: row.model } : {}),
      ...(row.provider_id ? { providerId: row.provider_id } : {}),
      completedAt: row.timestamp,
      usage: delta
    })
  }
  return records
}

export function latestUsageSnapshotsFromRows(rows: UsageRow[]): SessionLatestUsageSnapshot[] {
  return rows.flatMap((row) => {
    const usage = parseUsageSnapshot(row.usage_json)
    if (!usage) return []
    return [{
      threadId: row.thread_id,
      seq: row.seq,
      usage
    }]
  })
}

function parseUsageSnapshot(raw: string): UsageSnapshot | null {
  try {
    const parsed = UsageSnapshotSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function addColumnIfMissing(db: BetterSqliteDatabase, table: string, columnSql: string): void {
  const column = columnSql.trim().split(/\s+/)[0]
  if (!column) return
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (rows.some((row) => row.name === column)) return
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`)
  } catch (error) {
    warnSqlite(`add column ${column}`, error)
  }
}

export const METADATA_COMPACT_MIN_BYTES = 1_000_000

export async function appendJsonlLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a')
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * Classifies the common better-sqlite3 failure — a prebuilt `.node` binary
 * compiled for a different Node/Electron ABI — so operators see the exact
 * compiled vs current ABI instead of a generic "JSONL fallback" line.
 */
export function describeSqliteAbiMismatch(message: string): string | null {
  const compiled = /NODE_MODULE_VERSION (\d+)/.exec(message)?.[1]
  if (!compiled) return null
  return `abi: compiled=${compiled} current=${process.versions.modules ?? 'unknown'} ` +
    `(node ${process.version}, ${process.platform}/${process.arch})`
}

export function warnSqlite(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const abi = describeSqliteAbiMismatch(message)
  const hint = abi
    ? ' Run `npm rebuild better-sqlite3` (or `npm ci`) with the same Node/Electron runtime that launches Kun.'
    : ' Run `npm rebuild better-sqlite3` if the module is missing or stale.'
  console.warn(
    `[kun] hybrid sqlite ${action} failed; using JSONL fallback: ${message}` +
      `${abi ? ` [${abi}]` : ''}${hint}`
  )
}
