import {
  describe,
  expect,
  it
} from 'vitest'
import {
  CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS
} from '../../shared/conversation-export'
import {
  clawImInstallPollPayloadSchema,
  conversationExportPayloadSchema,
  isSafeOpenExternalUrl,
  shellOpenExternalUrlSchema,
  sseAckPayloadSchema,
  sseStartPayloadSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  workspaceImageBytesSavePayloadSchema,
  workspaceImagePickPayloadSchema,
  writeExportPayloadSchema,
  writeRichClipboardPayloadSchema,
  writeInlineCompletionPayloadSchema
} from './app-ipc-schemas'

describe('app-ipc-schemas workspace and system', () => {
  it('allows only safe external URL protocols', () => {
    expect(isSafeOpenExternalUrl('https://deepseek.com')).toBe(true)
    expect(isSafeOpenExternalUrl('http://127.0.0.1:5173')).toBe(true)
    expect(isSafeOpenExternalUrl('mailto:zhongxingyuemail@gmail.com')).toBe(true)
    expect(isSafeOpenExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeOpenExternalUrl('file:///tmp/test')).toBe(false)
    expect(() => shellOpenExternalUrlSchema.parse('javascript:alert(1)')).toThrow(
      /Only http, https, and mailto URLs are allowed/
    )
  })

  it('rejects invalid SSE payloads', () => {
    expect(() =>
      sseStartPayloadSchema.parse({
        threadId: 'thread-1',
        sinceSeq: -1
      })
    ).toThrow()
    expect(sseStartPayloadSchema.parse({
      threadId: 'thread-1',
      sinceSeq: 0,
      acknowledgedBatches: true
    }).acknowledgedBatches).toBe(true)
    expect(sseAckPayloadSchema.parse({ streamId: 'stream-1', batchId: 'batch-1' })).toEqual({
      streamId: 'stream-1',
      batchId: 'batch-1'
    })
    expect(() => sseAckPayloadSchema.parse({ streamId: 'stream-1', batchId: '' })).toThrow()
  })

  it('accepts long Feishu install device codes', () => {
    const deviceCode = 'x'.repeat(2_048)
    const payload = clawImInstallPollPayloadSchema.parse({
      provider: 'feishu',
      deviceCode
    })

    expect(payload.deviceCode).toBe(deviceCode)
  })

  it('accepts workspace directory payloads without a child path', () => {
    const payload = workspaceDirectoryTargetPayloadSchema.parse({
      workspaceRoot: '/tmp/workspace'
    })

    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.path).toBeUndefined()
  })

  it('accepts workspace directory create payloads', () => {
    const payload = workspaceDirectoryCreatePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: 'notes'
    })

    expect(payload.path).toBe('notes')
  })

  it('accepts workspace rename payloads', () => {
    const payload = workspaceEntryRenamePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: '/tmp/workspace/draft.md',
      newName: 'final.md'
    })

    expect(payload.newName).toBe('final.md')
  })

  it('accepts workspace delete payloads', () => {
    const payload = workspaceEntryDeletePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: '/tmp/workspace/draft.md'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
  })

  it('accepts structured inline completion payloads', () => {
    const payload = writeInlineCompletionPayloadSchema.parse({
      prefix: '## Heading\n\nSome intro',
      suffix: '',
      mode: 'edit',
      workspaceRoot: '/tmp/workspace',
      currentFilePath: '/tmp/workspace/notes.md',
      cursor: {
        line: 3,
        column: 10
      },
      context: {
        language: 'markdown',
        currentLinePrefix: 'Some intro',
        currentLineSuffix: '',
        previousLine: '',
        previousNonEmptyLine: '## Heading',
        nextLine: '',
        indentation: '',
        signals: {
          list: false,
          quote: false,
          heading: false,
          table: false,
          atLineEnd: true,
          endsWithSentencePunctuation: false,
          previousLineEndsWithSentencePunctuation: false,
          prefersNewLineCompletion: false,
          paragraphBreakOpportunity: false
        }
      },
      policy: {
        name: 'precision-inline-v2',
        instruction: 'Return only the inserted text.',
        acceptanceCriteria: ['Keep it short.'],
        rejectionCriteria: ['Do not ramble.']
      },
      preview: {
        local: 'Some intro',
        documentTail: '## Heading Some intro'
      },
      editCandidate: {
        kind: 'paragraph',
        from: 12,
        to: 22,
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 10,
        original: 'Some intro',
        selectedText: 'Some'
      },
      recentEdits: [{
        source: 'user',
        ageMs: 1_200,
        filePath: '/tmp/workspace/notes.md',
        from: 12,
        to: 16,
        deletedText: 'Old',
        insertedText: 'Some',
        beforeContext: '',
        afterContext: ' intro'
      }],
      model: 'deepseek-v4-pro'
    })

    expect(payload.model).toBe('deepseek-v4-pro')
    expect(payload.mode).toBe('edit')
    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.cursor.line).toBe(3)
    expect(payload.editCandidate?.kind).toBe('paragraph')
    expect(payload.recentEdits?.[0].insertedText).toBe('Some')
  })

  it('accepts write export payloads', () => {
    const payload = writeExportPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      format: 'docx',
      content: '# Draft'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
    expect(payload.format).toBe('docx')
    expect(payload.content).toBe('# Draft')
  })

  it('accepts content-only export payloads', () => {
    const payload = writeExportPayloadSchema.parse({
      title: 'Kun answer',
      workspaceRoot: '/tmp/workspace',
      format: 'png',
      content: '# Answer'
    })

    expect(payload.title).toBe('Kun answer')
    expect(payload.format).toBe('png')
  })

  it('validates conversation export payloads and rejects oversized transcripts', () => {
    const payload = conversationExportPayloadSchema.parse({
      title: 'Thread',
      format: 'pdf',
      markdown: '# Thread',
      defaultFileName: 'Thread-2026-07-19'
    })

    expect(payload.format).toBe('pdf')
    expect(payload.markdown).toBe('# Thread')
    expect(() => conversationExportPayloadSchema.parse({
      ...payload,
      markdown: 'x'.repeat(CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS + 1)
    })).toThrow()
    expect(() => conversationExportPayloadSchema.parse({
      ...payload,
      unexpected: true
    })).toThrow()
  })

  it('accepts write rich clipboard payloads', () => {
    const payload = writeRichClipboardPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      content: '# Draft'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
    expect(payload.content).toBe('# Draft')
  })

  it('accepts workspace image pick payloads and rejects extra fields', () => {
    const payload = workspaceImagePickPayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      currentFilePath: '/tmp/workspace/.kun-design/abc/v1.html',
      imageDirectory: 'img'
    })
    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.currentFilePath).toBe('/tmp/workspace/.kun-design/abc/v1.html')
    expect(payload.imageDirectory).toBe('img')
    expect(
      workspaceImagePickPayloadSchema.parse({
        workspaceRoot: '/tmp/workspace',
        imageDirectory: 'img'
      })
    ).toEqual({
      workspaceRoot: '/tmp/workspace',
      imageDirectory: 'img'
    })
    // .strict() must reject unknown keys so settings sync can't be poisoned.
    expect(() =>
      workspaceImagePickPayloadSchema.parse({
        workspaceRoot: '/tmp/workspace',
        currentFilePath: '/tmp/workspace/v1.html',
        somethingExtra: 'nope'
      })
    ).toThrow()
  })

  it('accepts an exact filename for workspace image bytes', () => {
    expect(workspaceImageBytesSavePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      dataBase64: 'aW1hZ2U=',
      mimeType: 'image/png',
      imageDirectory: '.kun/images',
      fileName: 'architecture-a1b2c3.png'
    })).toMatchObject({
      fileName: 'architecture-a1b2c3.png'
    })
  })
})
