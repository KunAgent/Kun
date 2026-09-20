import { describe, expect, it, vi } from 'vitest'
import { createPinnedLookup, createSafeNetworkFetch, resolveBrokeredNetworkTarget } from '../extensions/safe-network-fetch.js'
import { firstRoomBodyUrl, RoomLinkPreviewService } from './room-link-preview.js'

const html = '<title>Plain title</title><meta property="og:title" content="A &amp; B"><meta name="description" content="Readable summary">'
describe('room link preview boundary', () => {
  it('uses the first ordinary URL and ignores fenced and inline code', () => {
    expect(firstRoomBodyUrl('```js\nhttps://code.test/x\n```\n`https://inline.test` [Source](https://public.test/page). https://second.test'))
      .toBe('https://public.test/page')
    expect(firstRoomBodyUrl('```\nhttps://code.test')).toBeUndefined()
    expect(firstRoomBodyUrl('````md\n```\nhttps://example-in-code.test\n```\n````\nhttps://real.test')).toBe('https://real.test')
  })
  it('rejects credential, private and non-web URLs before making any request', async () => {
    const network = vi.fn<typeof fetch>()
    const service = new RoomLinkPreviewService(network)
    for (const url of ['http://127.0.0.1', 'https://name:secret@example.com', 'file:///tmp/file']) {
      expect((await service.preview(url)).state).toBe('unavailable')
    }
    expect(network).not.toHaveBeenCalled()
  })
  it('permits public HTTP only in preview mode and pins the validated DNS answer', async () => {
    const addresses = [{ address: '93.184.216.34', family: 4 as const }]
    const resolver = vi.fn(async () => addresses)
    await expect(resolveBrokeredNetworkTarget(new URL('http://public.test'), resolver)).rejects.toThrow('HTTPS')
    const target = await resolveBrokeredNetworkTarget(new URL('http://public.test'), resolver, true)
    expect(target).toMatchObject({ hostname: 'public.test', mode: 'remote-http', addresses })
    const lookup = createPinnedLookup(target.hostname, target.addresses)
    addresses[0].address = '127.0.0.1'
    const resolved = await new Promise((resolve, reject) => lookup('public.test', { family: 4 }, (error, address) => error ? reject(error) : resolve(address)))
    expect(resolved).toBe('93.184.216.34')
    await expect(resolveBrokeredNetworkTarget(new URL('http://127.0.0.1'), resolver, true)).rejects.toThrow('blocked')
  })
  it('accepts public HTTP pages and applies the same policy to HTTP/S redirects', async () => {
    const network = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://public.test/final' } }))
      .mockResolvedValueOnce(new Response(html, { headers: { 'content-type': 'text/html' } }))
    const preview = await new RoomLinkPreviewService(network).preview('http://public.test/start')
    expect(preview).toMatchObject({ state: 'available', url: 'https://public.test/final', title: 'A & B' })
    expect(network.mock.calls.map(([url]) => url)).toEqual(['http://public.test/start', 'https://public.test/final'])
  })
  it('uses public DNS policy for IPv4, IPv6 and every DNS result', async () => {
    const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }, { address: '127.0.0.1', family: 4 as const }])
    const service = new RoomLinkPreviewService(createSafeNetworkFetch({ resolve }))
    for (const url of ['https://127.0.0.1', 'https://[::1]', 'https://10.0.0.4', 'https://[::ffff:127.0.0.1]', 'https://public-looking.test']) {
      expect((await service.preview(url)).state).toBe('unavailable')
    }
    expect(resolve).toHaveBeenCalledWith('public-looking.test')
  })
  it('does not follow a redirect into loopback or forward credentials', async () => {
    const network = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }))
    const service = new RoomLinkPreviewService(network)
    expect((await service.preview('https://public.test')).state).toBe('unavailable')
    expect(network).toHaveBeenCalledTimes(1)
    expect(network.mock.calls[0][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' })
    expect(new Headers(network.mock.calls[0][1]?.headers).has('authorization')).toBe(false)
    expect(new Headers(network.mock.calls[0][1]?.headers).has('cookie')).toBe(false)
  })
  it('bounds HTML bytes, caches metadata and coalesces concurrent reads', async () => {
    const network = vi.fn<typeof fetch>(async () => new Response(html, { headers: { 'content-type': 'text/html' } }))
    const service = new RoomLinkPreviewService(network)
    const values = await Promise.all(Array.from({ length: 10 }, () => service.preview('https://public.test')))
    expect(values[0]).toMatchObject({ state: 'available', title: 'A & B', description: 'Readable summary', siteName: 'public.test' })
    expect(network).toHaveBeenCalledTimes(1)
    await service.preview('https://public.test')
    expect(network).toHaveBeenCalledTimes(1)
    const large = new RoomLinkPreviewService(async () => new Response('x'.repeat(300 * 1024), { headers: { 'content-type': 'text/html' } }))
    expect((await large.preview('https://large.test')).state).toBe('unavailable')
  })
  it('enforces the timeout even when DNS/transport does not implement AbortSignal', async () => {
    const service = new RoomLinkPreviewService(() => new Promise(() => {}), 20)
    await expect(service.preview('https://stalled.test')).resolves.toMatchObject({ state: 'unavailable' })
  })
})
