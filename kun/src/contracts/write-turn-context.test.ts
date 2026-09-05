import { describe, expect, it } from 'vitest'
import { WriteTurnContextSchema } from './write-turn-context.js'

describe('WriteTurnContextSchema', () => {
  it('parses a document-bound context', () => {
    const parsed = WriteTurnContextSchema.parse({
      workspaceRoot: '/workspace/deepseek-gui',
      documentPath: '/workspace/deepseek-gui/draft.md',
      documentEpoch: 4,
      contentRevision: 2,
      whiteboardId: 'wb_1',
      whiteboardRevision: 3,
      expectedSha256: 'a'.repeat(64)
    })
    expect(parsed).toEqual({
      workspaceRoot: '/workspace/deepseek-gui',
      documentPath: '/workspace/deepseek-gui/draft.md',
      documentEpoch: 4,
      contentRevision: 2,
      whiteboardId: 'wb_1',
      whiteboardRevision: 3,
      expectedSha256: 'a'.repeat(64)
    })
  })

  it('accepts a whiteboard-only context with a null document path', () => {
    const parsed = WriteTurnContextSchema.parse({
      workspaceRoot: '/workspace/deepseek-gui',
      documentPath: null,
      whiteboardId: 'wb_1',
      whiteboardRevision: 3
    })
    expect(parsed.documentPath).toBeNull()
  })

  it('rejects an empty workspace root', () => {
    expect(() =>
      WriteTurnContextSchema.parse({ workspaceRoot: '  ', documentPath: null })
    ).toThrow()
  })

  it('rejects a non-hex expectedSha256', () => {
    expect(() =>
      WriteTurnContextSchema.parse({
        workspaceRoot: '/workspace',
        documentPath: null,
        expectedSha256: 'not-a-sha'
      })
    ).toThrow()
  })

  it('rejects unknown keys', () => {
    expect(() =>
      WriteTurnContextSchema.parse({
        workspaceRoot: '/workspace',
        documentPath: null,
        threadId: 'thr_1'
      })
    ).toThrow()
  })
})
