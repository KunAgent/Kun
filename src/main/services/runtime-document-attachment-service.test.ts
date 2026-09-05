import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadRuntimeDocumentAttachment } from './runtime-document-attachment-service'
import { MAX_RUNTIME_DOCUMENT_SOURCE_BYTES } from '../ipc/app-ipc-schemas/runtime-document-attachment'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('runtime document attachment service', () => {
  it('reads local document bytes and uploads them directly to Kun', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-doc-'))
    tempRoots.push(root)
    const filePath = join(root, 'spec.pdf')
    const bytes = Buffer.from('%PDF-1.7 fake payload')
    await writeFile(filePath, bytes)
    const seenUploads: Array<Record<string, unknown>> = []
    const runtimeRequest = vi.fn(async (path: string, method?: string, body?: string) => {
      expect(path).toBe('/v1/attachments')
      expect(method).toBe('POST')
      const upload = JSON.parse(body ?? '{}') as Record<string, unknown>
      seenUploads.push(upload)
      return {
        ok: true,
        status: 201,
        body: JSON.stringify({
          attachment: {
            id: 'att_doc',
            name: String(upload.name ?? 'document'),
            kind: 'document',
            mimeType: String(upload.mimeType),
            byteSize: Buffer.from(String(upload.dataBase64), 'base64').byteLength,
            hash: 'hash',
            documentText: upload.documentText,
            documentFormat: upload.documentFormat,
            pageCount: upload.pageCount,
            localFilePath: upload.localFilePath,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        })
      }
    })

    const result = await uploadRuntimeDocumentAttachment({
      path: filePath,
      name: 'spec.pdf',
      mimeType: 'application/pdf',
      documentText: 'PDF body',
      documentFormat: 'pdf',
      pageCount: 2,
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    }, { runtimeRequest })

    expect(result).toMatchObject({
      ok: true,
      attachment: { id: 'att_doc', name: 'spec.pdf', localFilePath: filePath }
    })
    const upload = seenUploads[0]!
    expect(upload.dataBase64).toBe(bytes.toString('base64'))
    expect(upload.localFilePath).toBe(filePath)
    expect(upload.documentText).toBe('PDF body')
    expect(upload.pageCount).toBe(2)
    expect(runtimeRequest.mock.calls.every((call) => call[0] !== 'runtime:request')).toBe(true)
  })

  it('rejects missing, non-file, and empty document sources with bounded errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-doc-'))
    tempRoots.push(root)
    const emptyPath = join(root, 'empty.pdf')
    await writeFile(emptyPath, Buffer.alloc(0))
    const runtimeRequest = vi.fn()

    await expect(uploadRuntimeDocumentAttachment({
      path: join(root, 'missing.pdf')
    }, { runtimeRequest })).resolves.toMatchObject({ ok: false })
    await expect(uploadRuntimeDocumentAttachment({ path: root }, { runtimeRequest }))
      .resolves.toMatchObject({ ok: false, message: expect.stringMatching(/not a file/) })
    await expect(uploadRuntimeDocumentAttachment({ path: emptyPath }, { runtimeRequest }))
      .resolves.toMatchObject({ ok: false, message: expect.stringMatching(/empty/) })
    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(MAX_RUNTIME_DOCUMENT_SOURCE_BYTES).toBe(10 * 1024 * 1024)
  })

  it('uploads documents larger than the generic IPC body limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-doc-'))
    tempRoots.push(root)
    const filePath = join(root, 'large.pdf')
    const bytes = Buffer.alloc(3 * 1024 * 1024, 65)
    await writeFile(filePath, bytes)
    const runtimeRequest = vi.fn(async (_path: string, _method?: string, body?: string) => {
      const upload = JSON.parse(body!)
      expect(Buffer.from(upload.dataBase64, 'base64').equals(bytes)).toBe(true)
      return { ok: true, status: 201, body: JSON.stringify({ attachment: {
        id: 'att_large', name: 'large.pdf', kind: 'document', mimeType: 'application/pdf',
        byteSize: bytes.length, hash: 'hash', createdAt: 't0', updatedAt: 't0'
      } }) }
    })
    await expect(uploadRuntimeDocumentAttachment({ path: filePath }, { runtimeRequest }))
      .resolves.toMatchObject({ ok: true, attachment: { id: 'att_large' } })
    expect(runtimeRequest).toHaveBeenCalledOnce()
  })

  it('rejects oversized files before uploading any bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-doc-'))
    tempRoots.push(root)
    const filePath = join(root, 'oversized.pdf')
    await writeFile(filePath, '')
    await truncate(filePath, MAX_RUNTIME_DOCUMENT_SOURCE_BYTES + 1)
    const runtimeRequest = vi.fn()
    await expect(uploadRuntimeDocumentAttachment({ path: filePath }, { runtimeRequest }))
      .resolves.toMatchObject({ ok: false, message: expect.stringMatching(/exceeds/) })
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('surfaces runtime failures as bounded messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-doc-'))
    tempRoots.push(root)
    const filePath = join(root, 'spec.pdf')
    await writeFile(filePath, Buffer.from('%PDF-1.7'))
    const runtimeRequest = vi.fn(async () => ({
      ok: false,
      status: 413,
      body: JSON.stringify({ message: 'attachment data exceeds limit' })
    }))

    await expect(uploadRuntimeDocumentAttachment({ path: filePath }, { runtimeRequest }))
      .resolves.toMatchObject({ ok: false, message: 'attachment data exceeds limit' })
  })
})
