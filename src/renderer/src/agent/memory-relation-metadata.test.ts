import { describe, expect, it } from 'vitest'
import { parseMemoryRelationMetadata } from './memory-relation-metadata'
import { applyRuntimeDisclosureMeta } from './kun-mapper-core'
import type { CoreTurnItemJson } from './kun-contract'

const annotation = { id: 'relation_' + 'a'.repeat(64), kind: 'contradicts',
  source: { id: 'mem_a', revision: 1 }, target: { id: 'mem_b', revision: 2 },
  reviewedAt: '2026-10-20T00:00:00Z' }
describe('historical relation disclosure', () => {
  it('rejects malformed entries and extra evidence and bounds history payloads', () => {
    expect(parseMemoryRelationMetadata(undefined)).toEqual([])
    expect(parseMemoryRelationMetadata([annotation, { ...annotation, evidence: 'private text' }, { id: 'invalid' }]))
      .toEqual([annotation])
    expect(parseMemoryRelationMetadata(Array(20).fill(annotation))).toHaveLength(6)
  })
  it('keeps bounded relation provenance through the standard chat mapper', () => {
    const meta: Record<string, unknown> = {}
    applyRuntimeDisclosureMeta(meta, { injectedMemoryRelations: [annotation] } as CoreTurnItemJson)
    expect(meta.injectedMemoryRelations).toEqual([annotation])
  })
})
