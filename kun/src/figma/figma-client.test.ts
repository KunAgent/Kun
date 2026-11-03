import { describe, expect, it, vi } from 'vitest'
import { FigmaRestClient } from './figma-client.js'
import { assertFigmaDestination, FigmaRestTransport } from './figma-transport.js'

const KEY = 'AbCdEf123456'
const TOKEN = 'figd_private_personal_access_token'

function client(fetchImpl: typeof fetch, maxBytes?: number): FigmaRestClient {
  return new FigmaRestClient(new FigmaRestTransport({ fetchImpl, maxBytes, timeoutMs: 1_000 }))
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('Figma REST request shape', () => {
  it('sends the token only in the header to the fixed endpoint with redirects disabled', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ name: 'Spec', document: { children: [] } }))
    await client(request).getFile(KEY, { token: TOKEN, depth: 2 })
    expect(request).toHaveBeenCalledOnce()
    const [url, init] = request.mock.calls[0]!
    expect(String(url)).toBe(`https://api.figma.com/v1/files/${KEY}?depth=2`)
    expect(String(url)).not.toContain('figd_')
    expect(init?.method).toBe('GET')
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.headers).toMatchObject({ 'X-Figma-Token': TOKEN })
  })

  it('batches node ids into one bounded node request', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ nodes: {} }))
    await client(request).getNodes(KEY, { token: TOKEN, nodeIds: ['1:2', '3:4'] })
    expect(request).toHaveBeenCalledOnce()
    const url = new URL(String(request.mock.calls[0]![0]))
    expect(url.pathname).toBe(`/v1/files/${KEY}/nodes`)
    expect(url.searchParams.get('ids')).toBe('1:2,3:4')
    expect(url.searchParams.has('depth')).toBe(false)
  })

  it('never requests an arbitrary host or a non-read path', () => {
    expect(assertFigmaDestination(`https://api.figma.com/v1/files/${KEY}`).pathname).toBe(`/v1/files/${KEY}`)
    expect(assertFigmaDestination(`https://api.figma.com/v1/images/${KEY}`).pathname).toBe(`/v1/images/${KEY}`)
    for (const url of [
      `https://evil.example/v1/files/${KEY}`,
      `http://api.figma.com/v1/files/${KEY}`,
      `https://api.figma.com/v1/projects/${KEY}`,
      `https://api.figma.com/v1/files/${KEY}/comments`,
      `https://api.figma.com/v1/files/${KEY}#fragment`,
      `https://api.figma.com/v1/files/short`
    ]) {
      expect(() => assertFigmaDestination(url)).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
    }
  })
})

describe('Figma REST failure mapping', () => {
  for (const [status, code] of [
    [400, 'invalid_input'],
    [403, 'access_denied'],
    [404, 'not_found'],
    [500, 'upstream_unavailable'],
    [503, 'upstream_unavailable']
  ] as const) {
    it(`maps HTTP ${status} to ${code} without echoing the token`, async () => {
      const request = vi.fn<typeof fetch>(async () => new Response('denied', { status }))
      const failure = await client(request).getFile(KEY, { token: TOKEN }).catch((error: unknown) => error as Error)
      expect(failure).toMatchObject({ code })
      expect(String((failure as Error).message) + JSON.stringify(failure)).not.toContain(TOKEN)
    })
  }

  it('reports the retry window for 429 and caps a hostile Retry-After', async () => {
    const limited = await client(vi.fn<typeof fetch>(async () =>
      new Response('', { status: 429, headers: { 'retry-after': '3' } })))
      .getFile(KEY, { token: TOKEN }).catch((error: unknown) => error)
    expect(limited).toMatchObject({ code: 'rate_limited', retryAfterMs: 3_000 })

    const capped = await client(vi.fn<typeof fetch>(async () =>
      new Response('', { status: 429, headers: { 'retry-after': '86400' } })))
      .getFile(KEY, { token: TOKEN }).catch((error: unknown) => error)
    expect(capped).toMatchObject({ code: 'rate_limited', retryAfterMs: 60_000 })

    const bare = await client(vi.fn<typeof fetch>(async () => new Response('', { status: 429 })))
      .getFile(KEY, { token: TOKEN }).catch((error: unknown) => error)
    expect(bare).toMatchObject({ code: 'rate_limited', retryAfterMs: undefined })
  })

  it('treats an unreachable or throwing transport as upstream failure without leaking details', async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error(`connect ECONNREFUSED with ${TOKEN}`)
    })
    const failure = await client(request).getFile(KEY, { token: TOKEN }).catch((error: unknown) => error as Error)
    expect(failure).toMatchObject({ code: 'upstream_unavailable' })
    expect(String((failure as Error).message) + JSON.stringify(failure)).not.toContain(TOKEN)
  })

  it('rejects malformed, empty, null, and array bodies as invalid responses', async () => {
    for (const body of ['not json', '', 'null', '[]']) {
      const request = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }))
      await expect(client(request).getFile(KEY, { token: TOKEN }))
        .rejects.toMatchObject({ code: 'invalid_response' })
    }
    const empty = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }))
    await expect(client(empty).getFile(KEY, { token: TOKEN })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('stops reading a response that exceeds the byte budget', async () => {
    const oversized = vi.fn<typeof fetch>(async () =>
      json({ document: { children: [{ id: '1:2', name: 'x'.repeat(4_096) }] } }))
    await expect(client(oversized, 512).getFile(KEY, { token: TOKEN }))
      .rejects.toMatchObject({ code: 'response_too_large' })

    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      }
    })
    const declared = vi.fn<typeof fetch>(async () =>
      new Response(streamed, { status: 200, headers: { 'content-length': '999999' } }))
    await expect(client(declared, 512).getFile(KEY, { token: TOKEN }))
      .rejects.toMatchObject({ code: 'response_too_large' })
  })
})

describe('Figma credential fence', () => {
  for (const [label, token, code] of [
    ['a missing token', '', 'credential_missing'],
    ['a whitespace token', '   ', 'credential_missing'],
    ['a token with a header split', 'figd_ok\r\nHost: evil.example', 'credential_invalid'],
    ['an oversized token', 'a'.repeat(513), 'credential_invalid']
  ] as const) {
    it(`refuses ${label} without contacting Figma`, async () => {
      const request = vi.fn<typeof fetch>(async () => json({}))
      await expect(client(request).getFile(KEY, { token })).rejects.toMatchObject({ code })
      expect(request).not.toHaveBeenCalled()
    })
  }

  it('refuses an implausible file key before the wire', async () => {
    const request = vi.fn<typeof fetch>(async () => json({}))
    await expect(client(request).getFile('../etc/passwd', { token: TOKEN }))
      .rejects.toMatchObject({ code: 'invalid_link' })
    expect(request).not.toHaveBeenCalled()
  })
})
