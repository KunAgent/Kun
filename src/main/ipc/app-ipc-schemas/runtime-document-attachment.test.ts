import { describe, expect, it } from 'vitest'
import { runtimeDocumentAttachmentUploadPayloadSchema } from './runtime-document-attachment'

describe('runtimeDocumentAttachmentUploadPayloadSchema', () => {
  it('accepts absolute local document paths with metadata', () => {
    const windowsPayload = runtimeDocumentAttachmentUploadPayloadSchema.parse({
      path: 'C:\\Users\\tester\\Desktop\\spec.pdf',
      name: 'spec.pdf',
      mimeType: 'application/pdf',
      documentText: 'PDF body',
      documentFormat: 'pdf',
      pageCount: 3,
      threadId: 'thr_1',
      workspace: 'D:\\kun'
    })
    expect(windowsPayload).toMatchObject({ path: 'C:\\Users\\tester\\Desktop\\spec.pdf' })
    expect(runtimeDocumentAttachmentUploadPayloadSchema.parse({
      path: '/Users/tester/spec.pdf'
    })).toMatchObject({ path: '/Users/tester/spec.pdf' })
  })

  it('accepts temporary text but rejects ambiguous source input', () => {
    expect(runtimeDocumentAttachmentUploadPayloadSchema.parse({
      temporaryText: 'pasted body'
    })).toMatchObject({ temporaryText: 'pasted body' })
    expect(() => runtimeDocumentAttachmentUploadPayloadSchema.parse({
      path: '/tmp/paste.txt',
      temporaryText: 'pasted body'
    })).toThrow()
  })

  it('rejects relative paths and unexpected keys', () => {
    expect(() => runtimeDocumentAttachmentUploadPayloadSchema.parse({ path: 'docs/spec.pdf' }))
      .toThrow(/absolute/)
    expect(() => runtimeDocumentAttachmentUploadPayloadSchema.parse({
      path: 'C:\\spec.pdf',
      dataBase64: 'JVBERi0='
    })).toThrow()
  })

  it('bounds document text and visual preview payloads', () => {
    expect(() => runtimeDocumentAttachmentUploadPayloadSchema.parse({
      path: 'C:\\spec.pdf',
      documentText: 'x'.repeat(2_000_001)
    })).toThrow()
    expect(runtimeDocumentAttachmentUploadPayloadSchema.parse({
      path: 'C:\\spec.pdf',
      visualPreview: { dataBase64: 'AQID', mimeType: 'image/webp', byteSize: 3 }
    }).visualPreview?.byteSize).toBe(3)
  })
})
