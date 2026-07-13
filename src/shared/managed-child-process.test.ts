import { describe, expect, it } from 'vitest'
import { ManagedChildProcessSchema } from './managed-child-process'

describe('ManagedChildProcessSchema', () => {
  it('defaults cleanup to terminating the process tree', () => {
    expect(ManagedChildProcessSchema.parse({
      id: 'child_1',
      ownerKind: 'shell',
      ownerId: 'turn_1',
      pid: 1234,
      startedAt: '2026-07-14T00:00:00.000Z',
      detached: false
    }).cleanupPolicy).toBe('terminate-tree')
  })

  it('accepts an explicitly preserved detached child', () => {
    expect(ManagedChildProcessSchema.parse({
      id: 'child_2',
      ownerKind: 'extension-host',
      ownerId: 'extension_1',
      pid: 1234,
      startedAt: '2026-07-14T00:00:00.000Z',
      detached: true,
      cleanupPolicy: 'preserve'
    }).detached).toBe(true)
  })

  it('rejects invalid PIDs, timestamps, cleanup policies, and extra fields', () => {
    const base = {
      id: 'child_1',
      ownerKind: 'shell',
      ownerId: 'turn_1',
      pid: 1234,
      startedAt: '2026-07-14T00:00:00.000Z',
      detached: false
    }

    expect(() => ManagedChildProcessSchema.parse({ ...base, pid: 0 })).toThrow()
    expect(() => ManagedChildProcessSchema.parse({ ...base, startedAt: 'now' })).toThrow()
    expect(() => ManagedChildProcessSchema.parse({ ...base, cleanupPolicy: 'ignore' })).toThrow()
    expect(() => ManagedChildProcessSchema.parse({ ...base, command: 'secret' })).toThrow()
  })
})
