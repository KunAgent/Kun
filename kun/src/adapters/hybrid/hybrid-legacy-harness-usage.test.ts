import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { scanEventsForUsageBackfill } from './hybrid-thread-usage-scan.js'
import { usageRecordsFromRows, usageRowFromEvent } from './hybrid-thread-support.js'
import { buildModelUsageResponse, buildThreadUsageResponse } from '../../services/usage-service-responses.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

const capabilities = { nativeResume: true, structuredStreaming: true, kunTools: true, externalApproval: true,
  liveSteering: false, nativeContextTelemetry: false, fork: false }
let seq = 0
const at = () => new Date(Date.UTC(2026, 9, 6, 5, 55, seq)).toISOString()
const delegated = (turnId: string) => ({ seq: ++seq, timestamp: at(), threadId: 'thread', turnId, kind: 'delegated_runtime',
  providerKind: 'acp', providerId: 'devin', harnessId: 'devin', phase: 'resumed', capabilities })
const usage = (turnId: string | undefined, prompt: number, completion: number, cached = 0, turns = 0) => ({
  seq: ++seq, timestamp: at(), threadId: 'thread', ...(turnId ? { turnId } : {}), kind: 'usage', model: 'swe-2-high',
  usage: { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion, cacheHitRate: null, turns,
    ...(cached ? { cachedTokens: cached, cacheHitTokens: cached } : {}) } })

it('accounts pre-ledger Devin usage per turn instead of as shrinking thread totals', async () => {
  seq = 0
  // The real pattern recorded by Devin 3000.11.3 before the ledger fix:
  // context-occupancy updates (twice each) then one prompt-result report.
  const events = [
    delegated('turn-1'),
    usage('turn-1', 15_627, 0), usage('turn-1', 15_627, 0), usage('turn-1', 22_493, 0),
    usage('turn-1', 22_301, 192, 22_001),
    delegated('turn-2'),
    usage('turn-2', 17_078, 0), usage('turn-2', 25_914, 0), usage('turn-2', 25_914, 0),
    usage('turn-2', 24_589, 1_325, 18_524),
    // A later native Kun turn continues from the raw value the live counter was seeded with.
    usage('turn-3', 24_589 + 1_000, 1_325 + 50, 18_524, 1)
  ]
  const dir = await mkdtemp(join(tmpdir(), 'kun-legacy-usage-')); dirs.push(dir)
  const path = join(dir, 'events.jsonl')
  await writeFile(path, events.map((event) => JSON.stringify(event)).join('\n') + '\n')
  const scan = await scanEventsForUsageBackfill(path)
  expect(scan.usage.filter((event) => event.legacyHarness)).toHaveLength(8)
  const rows = scan.usage.map(usageRowFromEvent)
  expect(rows.filter((row) => row.source === 'harness-legacy').every((row) => row.harness_id === 'devin')).toBe(true)
  const records = usageRecordsFromRows(rows)
  expect(records.map((record) => [record.turnId, record.usage.promptTokens, record.usage.completionTokens])).toEqual([
    ['turn-1', 22_301, 192], ['turn-2', 24_589, 1_325], ['turn-3', 1_000, 50]
  ])
  expect(records[0]).toMatchObject({ source: 'harness-reported', harnessId: 'devin' })
  const bucket = buildThreadUsageResponse(records).buckets[0]!
  expect(bucket.input_tokens).toBe(22_301 + 24_589 + 1_000)
  expect(bucket.cached_tokens).toBeLessThan(bucket.input_tokens)
  expect(bucket.turns).toBe(3)
  const models = buildModelUsageResponse(records, { groupBy: 'model', scope: 'all', from: '2026-10-06', to: '2026-10-06', timezone: 'UTC' })
  expect(models.buckets[0]).toMatchObject({ model: 'swe-2-high', harness_ids: ['devin'] })
})

it('leaves native-only threads and ledger-era rows untouched', async () => {
  seq = 0
  const events = [usage('turn-1', 1_000, 10, 0, 1), usage('turn-2', 1_500, 30, 0, 2),
    { ...usage('turn-3', 2_000, 40, 0, 3), source: 'harness-reported', harnessId: 'devin' }]
  const dir = await mkdtemp(join(tmpdir(), 'kun-legacy-usage-')); dirs.push(dir)
  const path = join(dir, 'events.jsonl')
  await writeFile(path, events.map((event) => JSON.stringify(event)).join('\n') + '\n')
  const scan = await scanEventsForUsageBackfill(path)
  expect(scan.usage.some((event) => event.legacyHarness)).toBe(false)
  expect(usageRecordsFromRows(scan.usage.map(usageRowFromEvent)).map((record) => record.usage.promptTokens))
    .toEqual([1_000, 500, 500])
})

it('reopens the usage backfill exactly once to tag legacy rows', async () => {
  const sqlite = await import('better-sqlite3')
  const { migrateHybridThreadStore, HYBRID_LEGACY_HARNESS_USAGE_VERSION } = await import('./hybrid-thread-store-migrations.js')
  const db = new sqlite.default(':memory:')
  try {
    migrateHybridThreadStore(db)
    expect(db.pragma('user_version', { simple: true })).toBe(HYBRID_LEGACY_HARNESS_USAGE_VERSION)
    db.pragma('user_version = 0')
    db.prepare(`INSERT INTO threads (id, title, workspace, model, mode, status, approval_policy, sandbox_mode, relation,
      created_at, updated_at, created_at_ms, updated_at_ms, metadata_path, messages_path, events_path, search_text,
      usage_backfilled, usage_backfill_high_water)
      VALUES ('thread', 't', '/w', 'm', 'agent', 'idle', 'auto', 'workspace-write', 'primary', 'x', 'x', 0, 0,
        '/m', '/msg', '/e', '', 1, 42)`).run()
    migrateHybridThreadStore(db)
    expect(db.prepare('SELECT usage_backfilled, usage_backfill_high_water FROM threads').get()).toEqual({ usage_backfilled: 0, usage_backfill_high_water: 0 })
    db.prepare('UPDATE threads SET usage_backfilled = 1, usage_backfill_high_water = 42').run()
    migrateHybridThreadStore(db)
    expect(db.prepare('SELECT usage_backfilled FROM threads').get()).toEqual({ usage_backfilled: 1 })
  } finally { db.close() }
})
