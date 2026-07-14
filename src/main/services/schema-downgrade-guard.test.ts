import { describe, expect, it } from 'vitest'
import { assessSchemaGuard } from './schema-downgrade-guard'

describe('assessSchemaGuard', () => {
  it('allows writes only when stored and supported versions match', () => {
    expect(assessSchemaGuard({ storedVersion: 3, supportedVersion: 3 })).toEqual({
      mode: 'read-write',
      canWrite: true,
      canExport: true,
      reason: 'compatible'
    })
  })

  it('opens newer data read-only and keeps export available', () => {
    expect(assessSchemaGuard({ storedVersion: 4, supportedVersion: 3 })).toEqual({
      mode: 'read-only',
      canWrite: false,
      canExport: true,
      reason: 'newer-data-requires-upgrade'
    })
  })

  it('requires migration for older data and fails closed for invalid versions', () => {
    expect(assessSchemaGuard({ storedVersion: 2, supportedVersion: 3 })).toEqual({
      mode: 'migration-required',
      canWrite: false,
      canExport: true,
      reason: 'older-data-requires-migration'
    })
    expect(assessSchemaGuard({ storedVersion: -1, supportedVersion: 3 })).toEqual({
      mode: 'read-only',
      canWrite: false,
      canExport: true,
      reason: 'invalid-version'
    })
    expect(assessSchemaGuard({ storedVersion: 1.5, supportedVersion: 3 })).toEqual({
      mode: 'read-only',
      canWrite: false,
      canExport: true,
      reason: 'invalid-version'
    })
    expect(assessSchemaGuard(null as never)).toEqual({
      mode: 'read-only',
      canWrite: false,
      canExport: true,
      reason: 'invalid-version'
    })
    expect(assessSchemaGuard({ storedVersion: 3, supportedVersion: 3, extra: true } as never)).toEqual({
      mode: 'read-only',
      canWrite: false,
      canExport: true,
      reason: 'invalid-version'
    })
  })
})
