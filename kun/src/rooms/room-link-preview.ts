import { isIP } from 'node:net'
import { classifyBrokerAddress, createSafeNetworkFetch, normalizedBrokerHostname } from '../extensions/safe-network-fetch.js'
import type { RoomLinkPreview, RoomPreviewImage } from '../contracts/room-content.js'
import { roomPreviewImage } from './room-preview-image.js'
export { firstRoomBodyUrl } from '../contracts/room-content-text.js'

export function assertRoomPreviewUrl(value: string): URL {
  const url = new URL(value)
  const host = normalizedBrokerHostname(url)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 4096 ||
    url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new Error('blocked_url')
  }
  if (isIP(host) && !classifyBrokerAddress(host).publicUnicast) throw new Error('blocked_url')
  return url
}
function plain(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]
    const code = entity[2]?.toLowerCase() === 'x' ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  }).replace(/\s+/g, ' ').trim()
}
export function parseRoomLinkMetadata(html: string, finalUrl: string) {
  const meta = new Map<string, string>()
  for (const tag of html.matchAll(/<meta\b([^>]{0,4096})>/gi)) {
    const attrs = new Map<string, string>()
    for (const attribute of tag[1].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '')
    }
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase()
    if (key && attrs.has('content') && !meta.has(key)) meta.set(key, attrs.get('content')!)
  }
  let imageUrl: string | undefined
  try {
    const candidate = meta.get('og:image') ?? meta.get('twitter:image')
    if (candidate) imageUrl = assertRoomPreviewUrl(new URL(plain(candidate), finalUrl).href).href
  } catch { /* A blocked optional image never invalidates plain metadata. */ }
  return { title: plain(meta.get('og:title') ?? /<title\b[^>]*>([\s\S]{0,4096}?)<\/title>/i.exec(html)?.[1] ?? new URL(finalUrl).hostname).slice(0, 300),
    description: plain(meta.get('og:description') ?? meta.get('description') ?? '').slice(0, 500),
    siteName: plain(meta.get('og:site_name') ?? new URL(finalUrl).hostname).slice(0, 120), imageUrl }
}

function withSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}
async function readBounded(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel(); throw new Error('preview_too_large')
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await withSignal(reader.read(), signal)
      if (next.done) break
      bytes += next.value.length
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('preview_too_large') }
      chunks.push(next.value)
    }
    return Buffer.concat(chunks, bytes)
  } catch (error) { void reader.cancel().catch(() => undefined); throw error }
  finally { reader.releaseLock() }
}

/** No ambient proxy, credentials, cookies or automatic redirect following. */
export class RoomLinkPreviewService {
  private readonly cache = new Map<string, { expires: number; result: RoomLinkPreview; imageUrl?: string; image?: RoomPreviewImage }>()
  private readonly inflight = new Map<string, Promise<RoomLinkPreview>>()
  private active = 0
  private readonly waiting: Array<() => void> = []
  constructor(private readonly safeFetch: typeof fetch = createSafeNetworkFetch({ publicHttp: true }), private readonly timeoutMs = 6000) {}

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 2) {
      if (this.waiting.length >= 24) throw new Error('preview_busy')
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    } else this.active += 1
    try { return await operation() } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active -= 1
    }
  }
  private async read(url: string, image: boolean): Promise<{ bytes: Buffer; url: string }> {
    const signal = AbortSignal.timeout(this.timeoutMs)
    let target = assertRoomPreviewUrl(url)
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await withSignal(this.safeFetch(target.href, { method: 'GET', redirect: 'manual', credentials: 'omit', signal,
        headers: { accept: image ? 'image/png,image/jpeg' : 'text/html,application/xhtml+xml', 'user-agent': 'Kun-LinkPreview/1.0' } }), signal)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location || redirects === 3) throw new Error('preview_redirect_limit')
        target = assertRoomPreviewUrl(new URL(location, target).href)
        continue
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error('preview_fetch_failed') }
      const mime = response.headers.get('content-type')?.split(';')[0].trim() ?? ''
      if (image ? !['image/png', 'image/jpeg'].includes(mime) : !['text/html', 'application/xhtml+xml'].includes(mime)) {
        await response.body?.cancel(); throw new Error('unsupported_preview_type')
      }
      return { bytes: await readBounded(response, image ? 512 * 1024 : 256 * 1024, signal), url: target.href }
    }
    throw new Error('preview_redirect_limit')
  }
  async preview(url: string): Promise<RoomLinkPreview> {
    const previous = this.cache.get(url)
    if (previous && previous.expires > Date.now()) return previous.result
    const pending = this.inflight.get(url)
    if (pending) return pending
    const request = this.run(async () => {
      try {
        const page = await this.read(url, false)
        const { imageUrl, ...metadata } = parseRoomLinkMetadata(page.bytes.toString('utf8'), page.url)
        const result: RoomLinkPreview = { state: 'available', url: page.url, ...metadata, hasImage: Boolean(imageUrl) }
        if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!)
        this.cache.set(url, { result, imageUrl, expires: Date.now() + 10 * 60 * 1000 })
        return result
      } catch {
        const result: RoomLinkPreview = { state: 'unavailable', url, reason: 'preview_unavailable' }
        if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!)
        this.cache.set(url, { result, expires: Date.now() + 60 * 1000 })
        return result
      }
    }).finally(() => this.inflight.delete(url))
    this.inflight.set(url, request)
    return request
  }
  async image(url: string): Promise<RoomPreviewImage | undefined> {
    await this.preview(url)
    const entry = this.cache.get(url)
    if (!entry?.imageUrl) return undefined
    if (!entry.image) entry.image = await this.run(async () => roomPreviewImage((await this.read(entry.imageUrl!, true)).bytes))
    return entry.image
  }
}
