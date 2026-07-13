import { describe, expect, it } from 'vitest'
import {
  ManagedChildProcessRegistry,
  ManagedChildProcessRegistryError
} from './managed-child-process-registry'

const record = (id: string, ownerId = 'turn_1') => ({
  id,
  ownerKind: 'shell',
  ownerId,
  pid: 1234,
  startedAt: '2026-07-14T00:00:00.000Z',
  detached: false,
  cleanupPolicy: 'terminate-tree' as const
})

describe('ManagedChildProcessRegistry', () => {
  it('registers, filters, updates, and returns defensive snapshots', () => {
    const registry = new ManagedChildProcessRegistry()
    registry.register(record('child_1'))
    registry.register({ ...record('child_2', 'turn_2'), ownerKind: 'lsp' })

    expect(registry.list({ ownerKind: 'shell' }).map((item) => item.id)).toEqual(['child_1'])
    const updated = registry.update('child_1', { detached: true, cleanupPolicy: 'preserve' })
    expect(updated.detached).toBe(true)
    expect(Object.isFrozen(updated)).toBe(true)
    expect(registry.get('child_1')?.detached).toBe(true)
  })

  it('rejects duplicate IDs and missing updates', () => {
    const registry = new ManagedChildProcessRegistry()
    registry.register(record('child_1'))
    expect(() => registry.register(record('child_1'))).toThrowError(
      new ManagedChildProcessRegistryError('DUPLICATE', 'Managed child process is already registered: child_1')
    )
    expect(() => registry.update('missing', { detached: true })).toThrowError(
      new ManagedChildProcessRegistryError('NOT_FOUND', 'Managed child process was not found: missing')
    )
  })

  it('makes remove and drain idempotent and returns cleanup snapshots', () => {
    const registry = new ManagedChildProcessRegistry()
    registry.register(record('child_1'))
    registry.register(record('child_2'))

    expect(registry.remove('missing')).toBe(false)
    expect(registry.remove('child_1')).toBe(true)
    expect(registry.remove('child_1')).toBe(false)
    expect(registry.drain().map((item) => item.id)).toEqual(['child_2'])
    expect(registry.drain()).toEqual([])
    expect(registry.size()).toBe(0)
  })

  it('validates records before registration and does not leak invalid state', () => {
    const registry = new ManagedChildProcessRegistry()
    expect(() => registry.register({ ...record('child_1'), pid: 0 })).toThrow()
    expect(registry.size()).toBe(0)
  })
})
