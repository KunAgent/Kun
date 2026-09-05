import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { MemoryCapabilityConfig } from '../../contracts/capabilities.js'
import { MemoryRecord, type MemoryRecord as MemoryRecordValue } from '../../contracts/memory.js'
import type { MemoryListFilter } from '../../memory/memory-store.js'
import type { MemoryRetrieveRequest } from '../../memory/memory-retrieval.js'
import { memoryTypeHints, normalizeMemoryScopePath, type RankedMemory } from '../../memory/memory-ranking.js'
import {
  ftsQueryFromTokens,
  lexicalTokenCoverage,
  memoryRecordSearchTokens,
  type MemorySearchTokenResult
} from '../../memory/memory-search-tokens.js'

type MemoryRow = {
  id: string
  canonical_hash: string
  updated_at: string
  search_tokens: string
  record_json: string
  rank?: number
}

export type IndexedMemoryCandidates = {
  records: MemoryRecordValue[]
  lexicalScores: Map<string, number>
  channels: Map<string, RankedMemory['channel']>
  filtered: { scope: number; lifecycle: number }
}

export class HybridMemoryIndex {
  constructor(private readonly db: BetterSqliteDatabase) {}

  integrityCheck(): void {
    const row = this.db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
    if (row?.quick_check !== 'ok') throw new Error('SQLite memory index integrity check failed')
    this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts_probe USING fts5(body); DROP TABLE memory_fts_probe;')
  }

  upsert(record: MemoryRecordValue, canonicalHash: string): void {
    const search = memoryRecordSearchTokens(record)
    const sourceSummaries = record.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      locator: source.locator?.slice(0, 256),
      trust: source.trust
    }))
    const lifecycle = staticLifecycle(record)
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO memory_records (
          id, scope, workspace, project, lifecycle, type, confidence, importance,
          observed_at, valid_from, valid_to, expires_at, updated_at, canonical_hash,
          search_tokens, source_summaries_json, record_json
        ) VALUES (
          @id, @scope, @workspace, @project, @lifecycle, @type, @confidence, @importance,
          @observedAt, @validFrom, @validTo, @expiresAt, @updatedAt, @canonicalHash,
          @searchTokens, @sourceSummariesJson, @recordJson
        ) ON CONFLICT(id) DO UPDATE SET
          scope=excluded.scope, workspace=excluded.workspace, project=excluded.project,
          lifecycle=excluded.lifecycle, type=excluded.type, confidence=excluded.confidence,
          importance=excluded.importance, observed_at=excluded.observed_at,
          valid_from=excluded.valid_from, valid_to=excluded.valid_to, expires_at=excluded.expires_at,
          updated_at=excluded.updated_at, canonical_hash=excluded.canonical_hash,
          search_tokens=excluded.search_tokens, source_summaries_json=excluded.source_summaries_json,
          record_json=excluded.record_json
      `).run({
        id: record.id,
        scope: record.scope,
        workspace: record.workspace ?? null,
        project: record.project ?? null,
        lifecycle,
        type: record.type,
        confidence: record.confidence,
        importance: record.importance,
        observedAt: record.observedAt,
        validFrom: record.validFrom ?? null,
        validTo: record.validTo ?? null,
        expiresAt: record.expiresAt ?? null,
        updatedAt: record.updatedAt,
        canonicalHash,
        searchTokens: search.tokens.join(' '),
        sourceSummariesJson: JSON.stringify(sourceSummaries),
        recordJson: JSON.stringify(record)
      })
      this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(record.id)
      if (lifecycle === 'active') {
        this.db.prepare('INSERT INTO memory_fts(memory_id, search_tokens) VALUES (?, ?)')
          .run(record.id, search.tokens.join(' '))
      }
      this.db.prepare('DELETE FROM memory_sources WHERE memory_id = ?').run(record.id)
      const insertSource = this.db.prepare(`
        INSERT INTO memory_sources(memory_id, source_id, kind, locator, trust)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const source of sourceSummaries) {
        insertSource.run(record.id, source.id, source.kind, source.locator ?? null, source.trust)
      }
    })()
  }

  remove(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id)
      this.db.prepare('DELETE FROM memory_records WHERE id = ?').run(id)
    })()
  }

  list(filter: MemoryListFilter = {}): MemoryRecordValue[] {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (!filter.includeDeleted) where.push("lifecycle != 'deleted'")
    if (!filter.all) addScopeWhere(where, params, filter, ['user', 'workspace', 'project'])
    const rows = this.db.prepare(`
      SELECT record_json FROM memory_records
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, id ASC
    `).all(params) as Array<{ record_json: string }>
    return rows.map((row) => MemoryRecord.parse(JSON.parse(row.record_json)))
  }

  candidates(
    request: MemoryRetrieveRequest,
    policy: MemoryCapabilityConfig,
    queryTokens: MemorySearchTokenResult,
    nowIso: string
  ): IndexedMemoryCandidates {
    const where: string[] = [
      "r.lifecycle = 'active'",
      '(r.valid_from IS NULL OR r.valid_from <= @nowIso)',
      '(r.valid_to IS NULL OR r.valid_to > @nowIso)',
      '(r.expires_at IS NULL OR r.expires_at > @nowIso)'
    ]
    const params: Record<string, unknown> = { nowIso }
    addScopeWhere(where, params, request, policy.scopes, 'r')
    const candidateLimit = Math.max(16, Math.min(256, Math.max(request.limit, policy.maxInjectedRecords) * 16))
    params.candidateLimit = candidateLimit
    const rows = new Map<string, MemoryRow>()
    const lexicalScores = new Map<string, number>()
    const channels = new Map<string, RankedMemory['channel']>()
    const ftsQuery = ftsQueryFromTokens(queryTokens.tokens)
    if (ftsQuery) {
      params.ftsQuery = ftsQuery
      const ftsRows = this.db.prepare(`
        SELECT r.id, r.canonical_hash, r.updated_at, r.search_tokens, r.record_json,
               bm25(memory_fts) AS rank
        FROM memory_fts
        JOIN memory_records r ON r.id = memory_fts.memory_id
        WHERE ${where.join(' AND ')} AND memory_fts MATCH @ftsQuery
        ORDER BY rank ASC, r.updated_at DESC, r.id ASC
        LIMIT @candidateLimit
      `).all(params) as MemoryRow[]
      for (const row of ftsRows) {
        rows.set(row.id, row)
        const coverage = lexicalTokenCoverage(queryTokens.tokens, row.search_tokens.split(' '))
        lexicalScores.set(row.id, Math.max(coverage, normalizeBm25(row.rank)))
        channels.set(row.id, 'fts5')
      }
    }
    const typeHints = memoryTypeHints(request.query)
    if (typeHints.length > 0) {
      const typeParams = { ...params }
      const placeholders = typeHints.map((type, index) => {
        typeParams[`type${index}`] = type
        return `@type${index}`
      })
      const typeRows = this.db.prepare(`
        SELECT r.id, r.canonical_hash, r.updated_at, r.search_tokens, r.record_json
        FROM memory_records r
        WHERE ${where.join(' AND ')} AND r.type IN (${placeholders.join(', ')})
        ORDER BY r.updated_at DESC, r.id ASC
        LIMIT @candidateLimit
      `).all(typeParams) as MemoryRow[]
      for (const row of typeRows) {
        if (!rows.has(row.id)) rows.set(row.id, row)
        channels.set(row.id, channels.get(row.id) ?? 'type-affinity')
      }
    }
    return {
      records: [...rows.values()].map((row) => MemoryRecord.parse(JSON.parse(row.record_json))),
      lexicalScores,
      channels,
      filtered: this.filteredCounts(request, policy, nowIso)
    }
  }

  indexedRows(): Array<{ id: string; canonicalHash: string; updatedAt: string }> {
    const rows = this.db.prepare('SELECT id, canonical_hash, updated_at FROM memory_records').all() as MemoryRow[]
    return rows.map((row) => ({ id: row.id, canonicalHash: row.canonical_hash, updatedAt: row.updated_at }))
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM memory_records').get() as { count: number }).count
  }

  noteBackfillState(state: { running: boolean; scanned: number; remaining: number }): void {
    this.db.prepare(`
      INSERT INTO memory_reconciliation(key, value) VALUES('backfill_state', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(JSON.stringify(state))
  }

  private filteredCounts(
    request: MemoryRetrieveRequest,
    policy: MemoryCapabilityConfig,
    nowIso: string
  ) {
    const allActive = (this.db.prepare("SELECT COUNT(*) AS count FROM memory_records WHERE lifecycle = 'active'")
      .get() as { count: number }).count
    const scopeWhere: string[] = []
    const params: Record<string, unknown> = {}
    addScopeWhere(scopeWhere, params, request, policy.scopes)
    const authorizedStaticActive = (this.db.prepare(`
      SELECT COUNT(*) AS count FROM memory_records
      WHERE lifecycle = 'active' AND ${scopeWhere.join(' AND ')}
    `).get(params) as { count: number }).count
    const activeParams = { ...params, nowIso }
    const authorizedActive = (this.db.prepare(`
      SELECT COUNT(*) AS count FROM memory_records
      WHERE lifecycle = 'active' AND ${scopeWhere.join(' AND ')}
        AND (valid_from IS NULL OR valid_from <= @nowIso)
        AND (valid_to IS NULL OR valid_to > @nowIso)
        AND (expires_at IS NULL OR expires_at > @nowIso)
    `).get(activeParams) as { count: number }).count
    const authorizedAll = (this.db.prepare(`
      SELECT COUNT(*) AS count FROM memory_records WHERE ${scopeWhere.join(' AND ')}
    `).get(params) as { count: number }).count
    return {
      scope: Math.max(0, allActive - authorizedActive),
      lifecycle: Math.max(0, authorizedAll - authorizedStaticActive) +
        Math.max(0, authorizedStaticActive - authorizedActive)
    }
  }
}

function addScopeWhere(
  where: string[],
  params: Record<string, unknown>,
  access: { workspace?: string; project?: string },
  allowedScopes: readonly string[],
  alias = ''
): void {
  const prefix = alias ? `${alias}.` : ''
  const clauses: string[] = []
  if (allowedScopes.includes('user')) clauses.push(`${prefix}scope = 'user'`)
  const workspace = normalizeMemoryScopePath(access.workspace)
  if (workspace && allowedScopes.includes('workspace')) {
    clauses.push(`(${prefix}scope = 'workspace' AND ${prefix}workspace = @scopeWorkspace)`)
    params.scopeWorkspace = workspace
  }
  const project = normalizeMemoryScopePath(access.project ?? access.workspace)
  if (project && allowedScopes.includes('project')) {
    clauses.push(`(${prefix}scope = 'project' AND ${prefix}project = @scopeProject)`)
    params.scopeProject = project
  }
  where.push(clauses.length ? `(${clauses.join(' OR ')})` : '0 = 1')
}

function staticLifecycle(record: MemoryRecordValue): string {
  if (record.deletedAt) return 'deleted'
  if (record.disabledAt) return 'disabled'
  if (record.supersededAt) return 'superseded'
  return 'active'
}

function normalizeBm25(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  const magnitude = Math.max(0, -(value ?? 0))
  return Math.min(1, magnitude / (1 + magnitude))
}
