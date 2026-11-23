import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATTACHMENT_PREVIEW_LIMITS, validateAttachmentPreview } from '@kun/remote-protocol'
import { previewAttachment } from './attachment-preview'
import type { LinkDependencies } from './service-dependencies'

const native = vi.hoisted(() => ({ createFromBuffer: vi.fn(), resize: vi.fn(), toPNG: vi.fn(), toJPEG: vi.fn() }))
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: native.createFromBuffer } }))
const attachmentId = 'att_' + 'a'.repeat(24)
const call = { method: 'attachment.preview', params: { attachmentId, threadId: 'thread' } }
const source = Buffer.from([1, 2, 3]), thumbnail = Buffer.from([4, 5, 6])

function fixture() {
  const request = vi.fn(), api = { request: vi.fn() }, current = vi.fn(() => true)
  const scope = { api, peer: 'phone', owner: 'account', authorizationId: 'grant', current,
    lease: async () => ({ baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'secret', request }) }
  return { scope: scope as unknown as Parameters<NonNullable<LinkDependencies['files']>>[0], request, api, current }
}
beforeEach(() => {
  native.createFromBuffer.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 900, height: 1200 }), resize: native.resize })
  native.resize.mockReturnValue({ toPNG: native.toPNG, toJPEG: native.toJPEG })
  native.toPNG.mockReturnValue(thumbnail); native.toJPEG.mockReturnValue(thumbnail)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(source, {
    headers: { 'Content-Type': 'image/png', 'X-Kun-File-Name': encodeURIComponent('图片.png') }
  })))
})
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('conversation attachment previews', () => {
  it('reads the protected thread attachment and returns a small digest-verified raster without a transfer or receipt', async () => {
    const h = fixture(), result = validateAttachmentPreview(await previewAttachment(h.scope, call))
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:18899/v1/remote/attachments/${attachmentId}?threadId=thread`, {
      headers: { Authorization: 'Bearer secret' }, signal: expect.any(AbortSignal)
    })
    expect(native.resize).toHaveBeenCalledWith({ width: 360, height: 480, quality: 'good' })
    expect(result).toEqual({ attachmentId, name: '图片.png', mimeType: 'image/png', thumbnail: {
      width: 360, height: 480, mimeType: 'image/png', size: thumbnail.length,
      sha256: createHash('sha256').update(thumbnail).digest('hex'), dataBase64: thumbnail.toString('base64')
    } })
    expect(h.request).not.toHaveBeenCalled(); expect(h.api.request).not.toHaveBeenCalled()
  })

  it('returns filenames for ordinary documents without reading their bodies or decoding an image', async () => {
    const h = fixture(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Type': 'application/pdf', 'X-Kun-File-Name': 'report.pdf' }
    })
    vi.mocked(fetch).mockResolvedValue(response)
    expect(await previewAttachment(h.scope, call)).toEqual({ attachmentId, name: 'report.pdf', mimeType: 'application/pdf', thumbnail: null })
    expect(cancel).toHaveBeenCalledTimes(1); expect(native.createFromBuffer).not.toHaveBeenCalled()
  })

  it('preserves small images and uses a bounded JPEG fallback for oversized PNG thumbnails', async () => {
    const h = fixture()
    native.createFromBuffer.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 40, height: 20 }), resize: native.resize })
    native.toPNG.mockReturnValue(Buffer.alloc(ATTACHMENT_PREVIEW_LIMITS.bytes + 1))
    const result = validateAttachmentPreview(await previewAttachment(h.scope, call))
    expect(native.resize).toHaveBeenCalledWith({ width: 40, height: 20, quality: 'good' })
    expect(result.thumbnail?.mimeType).toBe('image/jpeg'); expect(native.toJPEG).toHaveBeenCalledWith(75)
  })

  it('rejects malformed addresses before accessing the runtime and never accepts a caller URL or path', async () => {
    const h = fixture()
    for (const params of [{ attachmentId, threadId: '../private' }, { ...call.params, path: '/private/a.png' },
      { ...call.params, url: 'https://outside.test/a.png' }, { ...call.params, accountId: 'other' }])
      await expect(previewAttachment(h.scope, { ...call, params })).rejects.toThrow('INVALID_PARAMS')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cannot publish a preview after authorization changes during its source read', async () => {
    const h = fixture()
    vi.mocked(fetch).mockImplementation(async () => { h.current.mockReturnValue(false); return new Response(source, { headers: { 'Content-Type': 'image/png' } }) })
    await expect(previewAttachment(h.scope, call)).rejects.toThrow('ACCOUNT_CHANGED')
    expect(native.createFromBuffer).not.toHaveBeenCalled()
  })

  it('keeps unavailable or undecodable images as attachments', async () => {
    const h = fixture()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(previewAttachment(h.scope, call)).rejects.toThrow('FILE_NOT_ALLOWED')
    native.createFromBuffer.mockReturnValue({ isEmpty: () => true })
    expect(validateAttachmentPreview(await previewAttachment(h.scope, call)).thumbnail).toBeNull()
  })
})
