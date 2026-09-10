import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, afterEach } from 'vitest'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { retrieveMemoryRecords } from './memory-retrieval.js'
import { loadSemanticMemoryV2EvaluationDataset } from './semantic-memory-evaluation-v2-dataset.js'
import { HybridMemoryStore } from '../adapters/hybrid/hybrid-memory-store.js'

const policy: MemoryCapabilityConfig = {
  enabled: true,
  scopes: ['user', 'workspace', 'project'],
  maxInjectedRecords: 8,
  distillation: { enabled: false }
}
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Memory lexical abstention hybrid parity', () => {
  it('reproduces q033-q036 selections and bounded lexical features in SQLite FTS5', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()
    const root = await mkdtemp(join(tmpdir(), 'kun-memory-lexical-abstention-'))
    roots.push(root)
    const store = new HybridMemoryStore({
      dataDir: root,
      config: policy,
      nowIso: () => dataset.manifest.evaluationNow
    })

    try {
      await store.ready()
      for (const record of dataset.records) {
        await store.createWithId(record.id, {
          content: record.content,
          scope: record.scope,
          workspace: record.workspace,
          project: record.project,
          tags: record.tags,
          confidence: record.confidence,
          type: record.type,
          importance: record.importance,
          observedAt: record.observedAt,
          validFrom: record.validFrom,
          validTo: record.validTo,
          expiresAt: record.expiresAt,
          disabled: Boolean(record.disabledAt),
          supersedes: record.supersedes,
          sources: record.sources
        })
        if (record.deletedAt) {
          await store.delete(record.id, { workspace: record.workspace, project: record.project })
        }
      }
      await store.waitForBackfill()

      for (const queryId of [
        'p2a_v2_q033_database_credential',
        'p2a_v2_q034_customer_names',
        'p2a_v2_q035_salary_data',
        'p2a_v2_q036_execute_injection'
      ]) {
        const query = dataset.queries.find((item) => item.id === queryId)!
        const request = {
          query: query.query,
          workspace: query.workspace,
          project: query.project,
          limit: dataset.manifest.defaultK,
          promptCharacterBudget: dataset.manifest.promptCharacterBudget
        }
        const filesystem = retrieveMemoryRecords({
          records: dataset.records,
          request,
          policy,
          mode: 'filesystem-fallback',
          nowIso: dataset.manifest.evaluationNow
        })
        const indexed = await store.retrieve(request)
        const diagnostics = await store.diagnostics()
        const trace = diagnostics.lastRetrieval!

        expect(indexed.map((record) => record.id)).toEqual(filesystem.records.map((record) => record.id))
        expect(trace.mode).toBe('sqlite-fts5')
        expect(trace.selectedIds).toEqual(indexed.map((record) => record.id))
        expect(trace.rankings.every((ranking) =>
          ranking.features.lexical >= 0 && ranking.features.lexical <= 1
        )).toBe(true)
        if (queryId === 'p2a_v2_q033_database_credential' || queryId === 'p2a_v2_q034_customer_names') {
          expect(trace.filtered.irrelevant).toBeGreaterThan(0)
          expect(filesystem.records).toEqual([])
          expect(indexed).toEqual([])
        } else {
          expect(indexed).toEqual([])
        }
      }
    } finally {
      await store.shutdown()
    }
  })
})
