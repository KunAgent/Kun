// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadWorkerLocalAttachment } from './worker-local-attachment'

afterEach(() => {
  Object.defineProperty(window, 'kunGui', { configurable: true, value: undefined })
})

describe('uploadWorkerLocalAttachment', () => {
  it('uses the image bridge with the worker thread and local file path', async () => {
    const uploadRuntimeImageAttachment = vi.fn(async () => ({
      ok: true,
      attachment: { id: 'image-a', name: 'image.png', mimeType: 'image/png' },
      preview: { mimeType: 'image/png', dataBase64: 'AAAA' }
    }))
    Object.defineProperty(window, 'kunGui', { configurable: true, value: {
      getPathForFile: () => '/tmp/image.png', uploadRuntimeImageAttachment
    } })
    const reference = await uploadWorkerLocalAttachment(new File(['png'], 'image.png', { type: 'image/png' }), 'worker-a')
    expect(uploadRuntimeImageAttachment).toHaveBeenCalledWith({
      source: { kind: 'localPath', path: '/tmp/image.png' },
      name: 'image.png', threadId: 'worker-a'
    })
    expect(reference).toMatchObject({ id: 'image-a', kind: 'image' })
  })

  it('uses the document bridge with the same worker scope', async () => {
    const uploadRuntimeDocumentAttachment = vi.fn(async () => ({
      ok: true,
      attachment: { id: 'document-a', name: 'brief.pdf', mimeType: 'application/pdf', byteSize: 4 }
    }))
    Object.defineProperty(window, 'kunGui', { configurable: true, value: {
      getPathForFile: () => '/tmp/brief.pdf', uploadRuntimeDocumentAttachment
    } })
    const reference = await uploadWorkerLocalAttachment(new File(['pdf'], 'brief.pdf', { type: 'application/pdf' }), 'worker-b')
    expect(uploadRuntimeDocumentAttachment).toHaveBeenCalledWith({
      path: '/tmp/brief.pdf', name: 'brief.pdf', mimeType: 'application/pdf', threadId: 'worker-b'
    })
    expect(reference).toMatchObject({ id: 'document-a', kind: 'document' })
  })

  it('refuses an unsupported file before uploading', async () => {
    const uploadRuntimeDocumentAttachment = vi.fn()
    Object.defineProperty(window, 'kunGui', { configurable: true, value: {
      getPathForFile: () => '/tmp/unsupported.zip', uploadRuntimeDocumentAttachment
    } })
    await expect(uploadWorkerLocalAttachment(new File(['zip'], 'unsupported.zip'), 'worker-a'))
      .rejects.toThrow('not supported')
    expect(uploadRuntimeDocumentAttachment).not.toHaveBeenCalled()
  })
})
