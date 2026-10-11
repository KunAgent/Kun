import { describe, expect, it, vi } from 'vitest'
import { authenticatedArtFetch, type ArtAccountAccess } from './account-access'
const url = 'https://api-kun-server.com/art/releases/test.json'
const account = (tokens: (string | null)[] = ['token']) => ({ accessToken: vi.fn(async () => tokens.shift() ?? null), expire: vi.fn(async () => {}) }) as unknown as ArtAccountAccess

describe('authenticated art transport', () => {
  it('refuses anonymous downloads and never sends a request', async () => {
    const fetcher = vi.fn(), auth = account([null])
    await expect(authenticatedArtFetch(auth, fetcher, () => true)(url)).rejects.toThrow('login_required')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('attaches a main-only token and bypasses old public browser caches', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => Response.json({ ok: true }))
    await authenticatedArtFetch(account(), fetcher, () => true)(url)
    const options = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer token')
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
  })
  it('rotates a refused token once and expires the account if still refused', async () => {
    const auth = account(['one','two']), fetcher = vi.fn(async () => new Response(null, { status: 401 }))
    await expect(authenticatedArtFetch(auth, fetcher, () => true)(url)).rejects.toThrow('login_required')
    expect(auth.accessToken).toHaveBeenNthCalledWith(2, true)
    expect(auth.expire).toHaveBeenCalledOnce()
  })
  it('never forwards credentials to another origin or after sign-out', async () => {
    const fetcher = vi.fn(), auth = account()
    await expect(authenticatedArtFetch(auth, fetcher, () => true)('https://evil.test/art/file')).rejects.toThrow('untrusted_art_origin')
    await expect(authenticatedArtFetch(auth, fetcher, () => false)(url)).rejects.toThrow('login_required')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
