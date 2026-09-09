import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  createTerminologyMapSemanticMemoryCandidate,
  DEFAULT_SEMANTIC_MEMORY_TERMINOLOGY_MAP_PATH,
  loadSemanticMemoryTerminologyMap,
  normalizeSemanticMemoryTerminologyQuery,
  parseSemanticMemoryTerminologyMap
} from './semantic-memory-terminology-candidate.js'
import type { SemanticMemoryCandidate } from './semantic-memory-evaluation.js'

describe('semantic Memory terminology-map candidate', () => {
  it('loads a frozen, deterministic, hashed terminology artifact', async () => {
    const first = await loadSemanticMemoryTerminologyMap()
    const second = await loadSemanticMemoryTerminologyMap()

    expect(first.mapId).toBe('kun-memory-semantic-evaluation-terminology-v1')
    expect(first.entries.length).toBeGreaterThanOrEqual(20)
    expect(first.artifactSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(second.artifactSha256).toBe(first.artifactSha256)
  })

  it('adds reviewed cross-language terms for matching phrases', async () => {
    const map = await loadSemanticMemoryTerminologyMap()
    const chinese = normalizeSemanticMemoryTerminologyQuery('公共接口每分钟最多允许多少次请求？', map)
    const english = normalizeSemanticMemoryTerminologyQuery('How do we rollback?', map)

    expect(chinese).toContain('api')
    expect(chinese).toContain('requests per minute')
    expect(english).toContain('回滚')
    expect(english).toContain('恢复上一版本')
  })

  it('returns an unrelated query byte-for-byte unchanged', async () => {
    const map = await loadSemanticMemoryTerminologyMap()
    const query = 'What color is the meeting room wall?'

    expect(normalizeSemanticMemoryTerminologyQuery(query, map)).toBe(query)
  })

  it('does not match short Latin terms inside longer words', async () => {
    const map = await loadSemanticMemoryTerminologyMap()
    const expanded = normalizeSemanticMemoryTerminologyQuery('How is an incident coordinated?', map)

    expect(expanded).toContain('故障')
    expect(expanded).not.toContain('continuous integration')
  })

  it('passes the expanded query through the existing lexical candidate', async () => {
    const map = await loadSemanticMemoryTerminologyMap()
    const retrieve = vi.fn<SemanticMemoryCandidate['retrieve']>(async () => [])
    const candidate = createTerminologyMapSemanticMemoryCandidate({
      terminology: map,
      lexicalCandidate: lexicalCandidate(retrieve)
    })
    const query = {
      id: 'query', split: 'development' as const, queryLanguage: 'zh' as const,
      category: 'cross-lingual', query: '备份数据怎样加密？',
      expectedIds: [], forbiddenIds: []
    }

    await candidate.retrieve({ query, records: [], limit: 5, promptCharacterBudget: 2_000, nowIso: '2026-09-09T00:00:00.000Z' })

    expect(retrieve).toHaveBeenCalledOnce()
    expect(retrieve.mock.calls[0]?.[0].query.query).toContain('encryption')
    expect(candidate.metadata).toMatchObject({
      kind: 'lexical',
      artifactSha256: map.artifactSha256,
      parameters: { mapId: map.mapId, mode: 'terminology-query-expansion' }
    })
  })

  it('preserves the original query object when no term matches', async () => {
    const map = await loadSemanticMemoryTerminologyMap()
    const retrieve = vi.fn<SemanticMemoryCandidate['retrieve']>(async () => [])
    const candidate = createTerminologyMapSemanticMemoryCandidate({
      terminology: map,
      lexicalCandidate: lexicalCandidate(retrieve)
    })
    const query = {
      id: 'query', split: 'development' as const, queryLanguage: 'en' as const,
      category: 'no-result-authority-safety', query: 'Unknown topic?',
      expectedIds: [], forbiddenIds: []
    }

    await candidate.retrieve({ query, records: [], limit: 5, promptCharacterBudget: 2_000, nowIso: '2026-09-09T00:00:00.000Z' })

    expect(retrieve.mock.calls[0]?.[0].query).toBe(query)
  })

  it('rejects unknown fields, duplicate terms, and malformed JSON', async () => {
    const source = JSON.parse(await readFile(DEFAULT_SEMANTIC_MEMORY_TERMINOLOGY_MAP_PATH, 'utf8'))
    expect(() => parseSemanticMemoryTerminologyMap(JSON.stringify({ ...source, extra: true }))).toThrow()
    source.entries[1].terms[0] = source.entries[0].terms[0]
    expect(() => parseSemanticMemoryTerminologyMap(JSON.stringify(source))).toThrow('normalized terms')
    expect(() => parseSemanticMemoryTerminologyMap('{')).toThrow('terminology map JSON')
  })

  it('rejects a non-lexical wrapped candidate', async () => {
    const map = await loadSemanticMemoryTerminologyMap()
    const candidate = lexicalCandidate(async () => [])
    candidate.metadata.kind = 'semantic'

    expect(() => createTerminologyMapSemanticMemoryCandidate({ terminology: map, lexicalCandidate: candidate }))
      .toThrow('requires a lexical')
  })
})

function lexicalCandidate(
  retrieve: SemanticMemoryCandidate['retrieve']
): SemanticMemoryCandidate {
  return {
    metadata: {
      id: 'test-lexical', kind: 'lexical', version: 'test', runtime: 'test',
      license: 'test', parameters: {}, platforms: ['test']
    },
    retrieve
  }
}
