import { describe, expect, it } from 'vitest'
import { ToolAuditRecord } from './tool-audit.js'

const valid = {
  id: 'audit-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  toolName: 'read_file',
  risk: 'medium',
  approvalSource: 'policy',
  outcome: 'succeeded',
  attempt: 1,
  replayed: false,
  startedAt: '2026-07-14T00:00:00.000Z',
  finishedAt: '2026-07-14T00:00:01.000Z',
  workspaceRootDigest: 'a'.repeat(64),
  pathDigest: 'b'.repeat(64),
  networkHost: 'api.example.com:443',
  summary: 'read completed'
}

describe('ToolAuditRecord', () => {
  it('accepts bounded lifecycle data and defaults attempt/replayed', () => {
    const result = ToolAuditRecord.parse({
      ...valid,
      attempt: undefined,
      replayed: undefined
    })
    expect(result.attempt).toBe(1)
    expect(result.replayed).toBe(false)
  })

  it('rejects raw arguments, output, and credential fields', () => {
    expect(() => ToolAuditRecord.parse({ ...valid, arguments: { path: 'secret.txt' } })).toThrow()
    expect(() => ToolAuditRecord.parse({ ...valid, output: 'full tool output' })).toThrow()
    expect(() => ToolAuditRecord.parse({ ...valid, apiKey: 'secret' })).toThrow()
  })

  it('rejects invalid digests, hosts, identifiers, and control characters', () => {
    expect(() => ToolAuditRecord.parse({ ...valid, pathDigest: 'A'.repeat(64) })).toThrow()
    expect(() => ToolAuditRecord.parse({ ...valid, networkHost: 'https://api.example.com' })).toThrow()
    expect(() => ToolAuditRecord.parse({ ...valid, toolName: 'read\nfile' })).toThrow()
    expect(() => ToolAuditRecord.parse({ ...valid, toolName: ' read_file' })).toThrow()
    expect(() => ToolAuditRecord.parse({ ...valid, summary: 'bad\u0000' })).toThrow()
  })

  it('rejects inconsistent lifecycle state and invalid attempt count', () => {
    expect(() => ToolAuditRecord.parse({ ...valid, finishedAt: '2026-07-13T23:59:59.000Z' })).toThrow()
    expect(() => ToolAuditRecord.parse({ ...valid, outcome: 'started' })).toThrow()
    expect(() => ToolAuditRecord.parse({ ...valid, attempt: 0 })).toThrow()
    expect(() => ToolAuditRecord.parse({ ...valid, attempt: 100 })).toThrow()
  })

  it('allows a started record without a finish time', () => {
    const result = ToolAuditRecord.parse({
      ...valid,
      outcome: 'started',
      finishedAt: undefined
    })
    expect(result.outcome).toBe('started')
  })
})
