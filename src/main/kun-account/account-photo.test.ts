import { describe, expect, it, vi } from 'vitest'
import { ACCOUNT_PHOTO_MAX_BYTES, createAccountPhotoReader } from './account-photo'

const image = (type: string, bytes = new Uint8Array([1, 2, 3]), status = 200) =>
  new Response(bytes, { status, headers: { 'content-type': type } })

describe('account photo reader', () => {
  it('returns a raster photo as a data URL and reads each URL once', async () => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => image('image/png; charset=binary'))
    const read = createAccountPhotoReader(fetcher)
    await expect(read('https://cdn.example.test/me.png')).resolves.toBe('data:image/png;base64,AQID')
    await read('https://cdn.example.test/me.png')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
  })

  it('refuses non-https URLs, SVG, oversized bodies and failed responses', async () => {
    const fetcher = vi.fn(async () => image('image/svg+xml'))
    const read = createAccountPhotoReader(fetcher)
    await expect(read(null)).resolves.toBeNull()
    await expect(read('http://cdn.example.test/me.png')).resolves.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
    await expect(read('https://cdn.example.test/me.svg')).resolves.toBeNull()
    fetcher.mockResolvedValueOnce(image('image/jpeg', new Uint8Array(ACCOUNT_PHOTO_MAX_BYTES + 1)))
    await expect(read('https://cdn.example.test/big.jpg')).resolves.toBeNull()
    fetcher.mockResolvedValueOnce(image('image/jpeg', new Uint8Array([1]), 404))
    await expect(read('https://cdn.example.test/gone.jpg')).resolves.toBeNull()
  })

  it('tries a failed URL again on the next call', async () => {
    const fetcher = vi.fn<(url: string, options: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(image('image/webp'))
    const read = createAccountPhotoReader(fetcher)
    await expect(read('https://cdn.example.test/me.webp')).resolves.toBeNull()
    await expect(read('https://cdn.example.test/me.webp')).resolves.toBe('data:image/webp;base64,AQID')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
