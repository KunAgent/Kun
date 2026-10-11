import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAvatarComposition } from './room-avatar-composition-canvas'

const background = { pixels: 96, canvas: 1024, bg: '#f7f5ef' }
let bitmaps: Array<{ width: number; height: number; close: ReturnType<typeof vi.fn> }>
let context: { drawImage: ReturnType<typeof vi.fn>; fillRect: ReturnType<typeof vi.fn>; fillStyle: string }
let offscreen: { width: number; height: number } | undefined

beforeEach(() => {
  bitmaps = []
  context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' }
  offscreen = undefined
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['test']) })))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    const bitmap = { width: 256, height: 256, close: vi.fn() }
    bitmaps.push(bitmap)
    return bitmap
  }))
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) { offscreen = this }
    getContext() { return context }
    async convertToBlob() { return new Blob(['composed']) }
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:composed')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('avatar composition canvas', () => {
  it('draws ordered transparent layers over the chosen background and releases decoded resources', async () => {
    const result = await renderAvatarComposition(['body.webp', 'face.webp'], background)
    expect(context.fillStyle).toBe('#f7f5ef')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 96, 96)
    expect(context.drawImage.mock.calls).toEqual(bitmaps.map((bitmap) => [bitmap, 0, 0, 256, 256, 0, 0, 96, 96]))
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledOnce()
    expect(offscreen).toMatchObject({ width: 1, height: 1 })
    expect(result.url).toBe('blob:composed')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    result.dispose()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composed')
  })

  it('applies the same face crop to every layer and preserves transparent backgrounds', async () => {
    await renderAvatarComposition(['body.webp', 'face.webp'], {
      ...background, bg: 'transparent', crop: [232, 300, 792, 860]
    })
    expect(context.fillRect).not.toHaveBeenCalled()
    expect(context.drawImage.mock.calls).toEqual(bitmaps.map((bitmap) => [bitmap, 58, 75, 140, 140, 0, 0, 96, 96]))
  })

  it('releases other decoded layers if one fetch fails, even when they finish later', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === 'missing.webp') return { ok: false, status: 404 } as Response
      await Promise.resolve()
      return { ok: true, blob: async () => new Blob(['test']) } as Response
    })
    await expect(renderAvatarComposition(['missing.webp', 'body.webp'], background)).rejects.toThrow('404')
    expect(bitmaps).toHaveLength(1)
    expect(bitmaps[0].close).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('falls back to DOM canvas and HTML images on browsers without offscreen rendering', async () => {
    vi.stubGlobal('OffscreenCanvas', class { constructor() { throw new Error('Unsupported 2D canvas') } })
    vi.stubGlobal('createImageBitmap', undefined)
    const imageCleanup = vi.fn()
    vi.stubGlobal('Image', class {
      naturalWidth = 128
      naturalHeight = 128
      onload?: () => void
      set src(_url: string) { queueMicrotask(() => this.onload?.()) }
      removeAttribute = imageCleanup
    })
    const canvas = {
      width: 0, height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['fallback']))
    }
    const createElement = vi.fn(() => canvas)
    vi.stubGlobal('document', { createElement })
    const result = await renderAvatarComposition(['body.webp'], background)
    expect(result.url).toBe('blob:composed')
    expect(createElement).toHaveBeenCalledWith('canvas')
    expect(context.drawImage).toHaveBeenCalledOnce()
    expect(imageCleanup).toHaveBeenCalledWith('src')
    expect(canvas).toMatchObject({ width: 1, height: 1 })
  })
})
