import { expect, it, vi } from 'vitest'
import type { Protocol } from 'electron'
import { bindArtResourceReader, registerArtProtocol } from './protocol'
it('installs the protocol before the service and binds a validated reader later', async () => {
  const handle = vi.fn()
  registerArtProtocol({ handle } as unknown as Pick<Protocol, 'handle'>)
  const handler = handle.mock.calls[0][1]
  expect(handle.mock.calls[0][0]).toBe('kun-asset')
  expect((await handler(new Request('kun-asset://release/path'))).status).toBe(503)
  bindArtResourceReader(async url => { if (url.endsWith('/invalid')) throw new Error('denied'); return new Uint8Array([1,2,3]) })
  const response = await handler(new Request('kun-asset://release/path'))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/webp')
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1,2,3])
  expect((await handler(new Request('kun-asset://release/invalid'))).status).toBe(404)
  expect((await handler(new Request('kun-asset://release/path', { method: 'POST' }))).status).toBe(405)
})
