/** Raster types a profile photo may use; SVG is left out on purpose. */
const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export const ACCOUNT_PHOTO_MAX_BYTES = 2 * 1024 * 1024

type PhotoFetch = (url: string, options: RequestInit) => Promise<Response>

/**
 * Reads the account's profile photo in main and hands it to the renderer as a data URL, since the
 * renderer CSP allows no remote images. One URL is kept; a failed read is retried on the next call.
 */
export function createAccountPhotoReader(fetcher: PhotoFetch): (url: string | null) => Promise<string | null> {
  let cached: { url: string; data: Promise<string | null> } | undefined
  async function read(url: string): Promise<string | null> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    const response = await fetcher(parsed.href, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return null
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!PHOTO_TYPES.has(type)) return null
    if (Number(response.headers.get('content-length') ?? 0) > ACCOUNT_PHOTO_MAX_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > ACCOUNT_PHOTO_MAX_BYTES) return null
    return `data:${type};base64,${bytes.toString('base64')}`
  }
  return (url) => {
    if (!url) return Promise.resolve(null)
    if (cached?.url === url) return cached.data
    const entry = { url, data: read(url).catch(() => null) }
    cached = entry
    void entry.data.then((data) => { if (data === null && cached === entry) cached = undefined })
    return entry.data
  }
}
