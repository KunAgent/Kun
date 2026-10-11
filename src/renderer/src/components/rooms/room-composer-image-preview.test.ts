import { afterEach, describe, expect, it, vi } from 'vitest'
import { roomComposerImagePreview } from './room-composer-image-preview'

afterEach(() => vi.unstubAllGlobals())

describe('roomComposerImagePreview', () => {
  it('stores only a bounded thumbnail and closes the decoded image', async () => {
    const close = vi.fn()
    const drawImage = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 400, close })))
    vi.stubGlobal('document', { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: () => 'data:image/webp;base64,YQ=='
    }) })
    const preview = await roomComposerImagePreview({ name: 'diagram.png', type: 'image/png' } as File)
    expect(preview).toEqual({ url: 'data:image/webp;base64,YQ==', transient: false })
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 112, 56)
    expect(close).toHaveBeenCalledOnce()
  })

  it('uses a temporary object URL if browser thumbnail encoding is unavailable', async () => {
    const createObjectURL = vi.fn(() => 'blob:preview')
    vi.stubGlobal('createImageBitmap', undefined)
    vi.stubGlobal('URL', { createObjectURL })
    expect(await roomComposerImagePreview({ name: 'diagram.png', type: 'image/png' } as File))
      .toEqual({ url: 'blob:preview', transient: true })
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(await roomComposerImagePreview({ name: 'notes.pdf', type: 'application/pdf' } as File)).toBeUndefined()
  })
})
