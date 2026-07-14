import { describe, expect, it } from 'vitest'
import { WorkflowNodeMigrationRegistry, type WorkflowNodeMigration } from './workflow-node-migration'

const migration = (fromVersion: number, toVersion: number, nodeType = 'http-request'): WorkflowNodeMigration => ({
  nodeType,
  fromVersion,
  toVersion,
  migrate: (config) => config
})

describe('WorkflowNodeMigrationRegistry', () => {
  it('registers a migration and resolves a direct path', () => {
    const registry = new WorkflowNodeMigrationRegistry()
    const step = migration(1, 2)
    registry.register(step)

    expect(registry.findPath('http-request', 1, 2)).toEqual([step])
  })

  it('resolves the shortest deterministic forward chain', () => {
    const registry = new WorkflowNodeMigrationRegistry()
    const direct = migration(1, 3)
    const first = migration(1, 2)
    const second = migration(2, 3)
    registry.register(second)
    registry.register(first)
    registry.register(direct)

    expect(registry.findPath('http-request', 1, 3)).toEqual([direct])
  })

  it('returns a chained path when no direct migration exists', () => {
    const registry = new WorkflowNodeMigrationRegistry()
    const first = migration(1, 2)
    const second = migration(2, 3)
    registry.register(second)
    registry.register(first)

    expect(registry.findPath('http-request', 1, 3)).toEqual([first, second])
  })

  it('returns an empty path for an already current version and null when unreachable', () => {
    const registry = new WorkflowNodeMigrationRegistry()
    expect(registry.findPath('http-request', 2, 2)).toEqual([])
    expect(registry.findPath('http-request', 1, 3)).toBeNull()
    expect(registry.findPath('http-request', 3, 1)).toBeNull()
    expect(registry.findPath('condition', 1, 2)).toBeNull()
  })

  it('rejects duplicate and backward migrations', () => {
    const registry = new WorkflowNodeMigrationRegistry()
    registry.register(migration(1, 2))
    expect(() => registry.register(migration(1, 2))).toThrow('already registered')
    expect(() => registry.register(migration(2, 1))).toThrow('move forward')
  })

  it.each([
    migration(0, 1, ''),
    migration(0, 1, 'node\n'),
    { nodeType: 'custom', fromVersion: -1, toVersion: 1, migrate: () => ({}) },
    { nodeType: 'custom', fromVersion: 1, toVersion: Number.POSITIVE_INFINITY, migrate: () => ({}) },
    { nodeType: 'custom', fromVersion: 1, toVersion: 2, migrate: undefined }
  ])('rejects malformed migration definitions: %j', (value) => {
    const registry = new WorkflowNodeMigrationRegistry()
    expect(() => registry.register(value as WorkflowNodeMigration)).toThrow()
  })

  it('normalizes node type whitespace without mutating the input', () => {
    const registry = new WorkflowNodeMigrationRegistry()
    const input = migration(1, 2, '  custom  ')
    registry.register(input)
    expect(registry.findPath('custom', 1, 2)).toHaveLength(1)
    expect(input.nodeType).toBe('  custom  ')
  })
})
