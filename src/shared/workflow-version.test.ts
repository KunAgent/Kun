import { describe, expect, it } from 'vitest'
import {
  CURRENT_WORKFLOW_SCHEMA_VERSION,
  createWorkflowVersionMetadata,
  inspectWorkflowVersion
} from './workflow-version'

describe('workflow version contract', () => {
  it('creates current metadata with the originating app version', () => {
    expect(createWorkflowVersionMetadata('0.2.21')).toEqual({
      schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION,
      createdAppVersion: '0.2.21',
      lastMigratedVersion: CURRENT_WORKFLOW_SCHEMA_VERSION
    })
  })

  it('accepts legacy documents without mutating them', () => {
    const document = { id: 'workflow-1', nodes: [] }
    expect(inspectWorkflowVersion(document)).toMatchObject({ kind: 'missing' })
    expect(document).toEqual({ id: 'workflow-1', nodes: [] })
  })

  it('accepts the current version and rejects future versions', () => {
    expect(inspectWorkflowVersion({
      schemaVersion: 1,
      createdAppVersion: '0.2.21',
      lastMigratedVersion: 1
    })).toEqual({
      kind: 'supported',
      metadata: { schemaVersion: 1, createdAppVersion: '0.2.21', lastMigratedVersion: 1 }
    })
    expect(inspectWorkflowVersion({ schemaVersion: 2 })).toEqual({ kind: 'future', schemaVersion: 2 })
  })

  it('rejects malformed or unsafe metadata', () => {
    expect(inspectWorkflowVersion(null)).toEqual({ kind: 'invalid' })
    expect(inspectWorkflowVersion({ schemaVersion: 0 })).toEqual({ kind: 'invalid' })
    expect(inspectWorkflowVersion({ schemaVersion: 1, createdAppVersion: '0.2.21', lastMigratedVersion: 0 })).toEqual({ kind: 'invalid' })
    expect(inspectWorkflowVersion({ schemaVersion: 1, createdAppVersion: '\u0000' })).toEqual({ kind: 'invalid' })
    expect(() => createWorkflowVersionMetadata('')).toThrow('invalid workflow app version')
  })
})
