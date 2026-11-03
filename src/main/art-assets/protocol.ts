import type { Protocol } from 'electron'
type Reader = (url: string) => Promise<Uint8Array>
let reader: Reader | undefined
export function bindArtResourceReader(next: Reader): void { reader = next }
/** Install before creating the first window: Chromium snapshots custom protocol handlers. */
export function registerArtProtocol(protocol: Pick<Protocol, 'handle'>): void {
  protocol.handle('kun-asset', async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    if (!reader) return new Response(null, { status: 503 })
    try {
      const bytes = await reader(request.url)
      return new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': 'image/webp', 'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff'
      } })
    } catch { return new Response(null, { status: 404 }) }
  })
}
