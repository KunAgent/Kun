import { afterEach, describe, expect, it, vi } from 'vitest'
import { pastedTextAttachmentName, uploadRuntimePastedText } from './runtime-attachment'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runtime pasted text attachment', () => {
  it('uses the desktop bridge and keeps full text out of the composer reference', async () => {
    const text = '\n  first useful line  \n' + 'x'.repeat(10_100)
    const uploadRuntimeDocumentAttachment = vi.fn(async () => ({
      ok: true as const,
      attachment: {
        id: 'att_text',
        name: 'pasted-text-20260908-123456.txt',
        kind: 'document' as const,
        mimeType: 'text/plain',
        byteSize: text.length,
        hash: 'hash',
        documentFormat: 'text' as const,
        truncated: true,
        createdAt: 't0',
        updatedAt: 't0'
      }
    }))
    vi.stubGlobal('window', { kunGui: { uploadRuntimeDocumentAttachment } })

    const reference = await uploadRuntimePastedText({
      text,
      threadId: 'thr_1',
      workspace: '/workspace',
      now: new Date('2026-09-08T12:34:56.000Z')
    })

    expect(uploadRuntimeDocumentAttachment).toHaveBeenCalledWith({
      temporaryText: text,
      name: 'pasted-text-20260908-123456.txt',
      threadId: 'thr_1',
      workspace: '/workspace'
    })
    expect(reference).toMatchObject({
      id: 'att_text',
      kind: 'document',
      documentFormat: 'text',
      textPreview: 'first useful line',
      truncated: true
    })
    expect(reference).not.toHaveProperty('documentText')
  })

  it('creates a stable ASCII timestamp name', () => {
    expect(pastedTextAttachmentName(new Date('2026-01-02T03:04:05.000Z')))
      .toBe('pasted-text-20260102-030405.txt')
  })
})
