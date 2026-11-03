import { afterEach, expect, it, vi } from 'vitest'
import { loadPosterImage } from './share-poster-render'

afterEach(() => vi.unstubAllGlobals())

it('requests hot-updated artwork with CORS before starting the image load', async () => {
  const requests: { url: string; crossOrigin: string | null }[] = []
  class ImageStub {
    decoding = ''
    crossOrigin: string | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(url: string) {
      // Chromium chooses the fetch mode when src is set; changing it after the
      // image loads cannot repair an already tainted canvas.
      requests.push({ url, crossOrigin: this.crossOrigin })
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('Image', ImageStub)
  const url = 'kun-asset://release/512/base/sky.webp'
  await loadPosterImage(url)
  expect(requests).toEqual([{ url, crossOrigin: 'anonymous' }])
})

it.each(['/assets/sky.webp', 'file:///app/assets/sky.webp', 'blob:http://localhost/qr'])('keeps existing local image loading for %s', async (url) => {
  class ImageStub {
    decoding = ''
    crossOrigin: string | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_url: string) { queueMicrotask(() => this.onload?.()) }
  }
  vi.stubGlobal('Image', ImageStub)
  const image = await loadPosterImage(url)
  expect(image.crossOrigin).toBeNull()
})
