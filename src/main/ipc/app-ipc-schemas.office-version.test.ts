import { describe, expect, it } from 'vitest'
import {
  officeVersionReadPayloadSchema,
  officeVersionRecordPayloadSchema,
  officeVersionRestorePayloadSchema
} from './app-ipc-schemas'

const sha = 'a'.repeat(64)
const target = { path: 'presentations/paper.pptx', workspaceRoot: '/repo' }

describe('office version IPC schemas', () => {
  it('accepts a snapshot record', () => {
    expect(officeVersionRecordPayloadSchema.safeParse({
      ...target, dataBase64: 'AAEC', sha256: sha, replacedBySha256: sha, label: 'Make the bars wider', threadId: 'thread-1'
    }).success).toBe(true)
  })

  it('rejects malformed hashes, ids and unknown fields', () => {
    expect(officeVersionRecordPayloadSchema.safeParse({ ...target, dataBase64: 'AA', sha256: 'nope', label: '' }).success).toBe(false)
    expect(officeVersionReadPayloadSchema.safeParse({ ...target, id: '../index' }).success).toBe(false)
    expect(officeVersionRestorePayloadSchema.safeParse({ ...target, id: 'abc-123', expectedSha256: sha, force: true }).success).toBe(false)
    expect(officeVersionRestorePayloadSchema.safeParse({ ...target, id: 'abc-123', expectedSha256: sha }).success).toBe(true)
  })
})
