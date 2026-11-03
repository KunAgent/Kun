import { describe, expect, it, vi } from 'vitest'
import { FigmaReadService } from './figma-service.js'
import { staticFigmaCredentialSource } from './figma-credential.js'
import { FIGMA_IMAGE_DOWNLOAD_GAP } from './ports.js'
import type { FigmaImageFormat, FigmaImageInput } from './ports.js'
import type { FigmaCredentialSource } from './figma-credential.js'

const KEY = 'AbCdEf123456'
const TOKEN = 'figd_private_personal_access_token'
const LINK = `https://www.figma.com/design/${KEY}/Checkout?node-id=12-34`

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function service(
  fetchImpl: typeof fetch,
  credentials: FigmaCredentialSource = staticFigmaCredentialSource(TOKEN)
): FigmaReadService {
  return new FigmaReadService({ credentials, fetchImpl })
}

function headerOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>
}

describe('reading a Figma file', () => {
  it('summarizes the file with its pages at the bounded default depth', async () => {
    const request = vi.fn<typeof fetch>(async () => json({
      name: 'Checkout',
      lastModified: '2026-10-01T00:00:00Z',
      version: '1234',
      role: 'owner',
      document: { children: [{ id: '0:1', name: 'Cover' }, { id: '0:2', name: 'Flow' }] }
    }))
    const summary = await service(request).readFile({ link: LINK })
    expect(summary).toEqual({
      fileKey: KEY,
      name: 'Checkout',
      lastModified: '2026-10-01T00:00:00Z',
      version: '1234',
      role: 'owner',
      depth: 2,
      pages: [{ id: '0:1', name: 'Cover' }, { id: '0:2', name: 'Flow' }]
    })
    const url = new URL(String(request.mock.calls[0]![0]))
    expect(url.pathname).toBe(`/v1/files/${KEY}`)
    expect(url.searchParams.get('depth')).toBe('2')
    expect(JSON.stringify(summary)).not.toContain(TOKEN)
  })

  it('omits pages below page depth and tolerates a document without children', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ name: 'Spec', document: {} }))
    const summary = await service(request).readFile({ link: LINK, depth: 1 })
    expect(summary.pages).toEqual([])
    expect(summary.depth).toBe(1)
    expect(summary.lastModified).toBeNull()
    expect(summary.version).toBeNull()
  })

  for (const depth of [0, 5, 1.5, Number.NaN]) {
    it(`rejects depth ${depth} before contacting Figma`, async () => {
      const request = vi.fn<typeof fetch>(async () => json({}))
      await expect(service(request).readFile({ link: LINK, depth }))
        .rejects.toMatchObject({ code: 'invalid_input' })
      expect(request).not.toHaveBeenCalled()
    })
  }
})

describe('reading Figma nodes', () => {
  it('returns node summaries and reports nodes Figma answers with null', async () => {
    const request = vi.fn<typeof fetch>(async () => json({
      nodes: {
        '12:34': { document: { id: '12:34', name: 'Header', type: 'FRAME', visible: false, children: [{}, {}] } },
        '99:1': null
      }
    }))
    const result = await service(request).readNodes({ link: LINK, nodeIds: ['12:34', '99:1'] })
    expect(result).toEqual({
      fileKey: KEY,
      nodes: [{ id: '12:34', name: 'Header', type: 'FRAME', visible: false, childCount: 2 }],
      missingNodeIds: ['99:1']
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('falls back to the node id inside the link', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ nodes: {} }))
    const result = await service(request).readNodes({ link: LINK })
    const url = new URL(String(request.mock.calls[0]![0]))
    expect(url.searchParams.get('ids')).toBe('12:34')
    expect(result.missingNodeIds).toEqual(['12:34'])
  })

  it('prefers explicit node ids over the link node and deduplicates them', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ nodes: {} }))
    await service(request).readNodes({ link: LINK, nodeIds: '5:6, 5-6, 7:8' })
    const url = new URL(String(request.mock.calls[0]![0]))
    expect(url.searchParams.get('ids')).toBe('5:6,7:8')
  })

  it('requires a node selection when the link has none', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ nodes: {} }))
    await expect(service(request).readNodes({ link: `https://www.figma.com/file/${KEY}/Spec` }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    expect(request).not.toHaveBeenCalled()
  })

  it('sends one request for fifty ids and refuses fifty-one', async () => {
    const ids = Array.from({ length: 50 }, (_, index) => `${index + 1}:1`)
    const request = vi.fn<typeof fetch>(async () => json({ nodes: {} }))
    await service(request).readNodes({ link: LINK, nodeIds: ids })
    expect(request).toHaveBeenCalledOnce()

    const over = vi.fn<typeof fetch>(async () => json({ nodes: {} }))
    await expect(service(over).readNodes({ link: LINK, nodeIds: [...ids, '77:7'] }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    expect(over).not.toHaveBeenCalled()
  })
})

describe('Figma image export links', () => {
  const IMAGE_RESPONSE = {
    err: null,
    images: {
      '12:34': 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/abcdef',
      '99:1': null
    }
  }

  it('returns signed image links and states the download gap instead of downloading', async () => {
    const request = vi.fn<typeof fetch>(async () => json(IMAGE_RESPONSE))
    const result = await service(request).exportImages({ link: LINK, nodeIds: ['12:34', '99:1'] })
    expect(result.images).toEqual([{
      nodeId: '12:34',
      url: 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/abcdef'
    }])
    expect(result.missingNodeIds).toEqual(['99:1'])
    expect(result.download).toEqual({ supported: false, reason: FIGMA_IMAGE_DOWNLOAD_GAP })
    expect(request).toHaveBeenCalledOnce()
    const url = new URL(String(request.mock.calls[0]![0]))
    expect(url.pathname).toBe(`/v1/images/${KEY}`)
    expect(url.searchParams.get('format')).toBe('png')
    expect(url.searchParams.get('scale')).toBe('2')
  })

  it('drops links that are not plain https URLs', async () => {
    const request = vi.fn<typeof fetch>(async () => json({
      images: { '12:34': 'http://insecure.example/x.png', '99:1': 'https://user:secret@example.com/x.png' }
    }))
    const result = await service(request).exportImages({ link: LINK, nodeIds: '12:34,99:1' })
    expect(result.images).toEqual([])
    expect(result.missingNodeIds).toEqual(['12:34', '99:1'])
  })

  it('surfaces a Figma render error as a checked input failure', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ err: 'Cannot render node 12:34' }))
    await expect(service(request).exportImages({ link: LINK }))
      .rejects.toMatchObject({ code: 'invalid_input' })
  })

  const invalidInputs: { label: string; input: FigmaImageInput }[] = [
    { label: 'an unsupported format', input: { link: LINK, format: 'gif' as FigmaImageFormat } },
    { label: 'a zero scale', input: { link: LINK, scale: 0 } },
    { label: 'an oversized scale', input: { link: LINK, scale: 4.5 } }
  ]
  for (const { label, input } of invalidInputs) {
    it(`rejects ${label} before contacting Figma`, async () => {
      const request = vi.fn<typeof fetch>(async () => json({ images: {} }))
      await expect(service(request).exportImages(input)).rejects.toMatchObject({ code: 'invalid_input' })
      expect(request).not.toHaveBeenCalled()
    })
  }
})

describe('Figma credential handling', () => {
  it('fails closed when Figma is not connected', async () => {
    const request = vi.fn<typeof fetch>(async () => json({}))
    await expect(service(request, staticFigmaCredentialSource(undefined)).readFile({ link: LINK }))
      .rejects.toMatchObject({ code: 'credential_missing' })
    expect(request).not.toHaveBeenCalled()
  })

  it('reads the token for every call so a rotation applies without rebuilding', async () => {
    const tokens = ['figd_first', 'figd_second']
    const seen: string[] = []
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      seen.push(headerOf(init)['X-Figma-Token'] ?? '')
      return json({ name: 'Spec', document: { children: [] } })
    })
    const rotating = new FigmaReadService({
      credentials: { readToken: async () => tokens.shift() },
      fetchImpl: request
    })
    await rotating.readFile({ link: LINK })
    await rotating.readFile({ link: LINK })
    expect(seen).toEqual(['figd_first', 'figd_second'])
    for (const call of request.mock.calls) expect(String(call[0])).not.toContain('figd_')
  })

  it('does not leak the token when Figma denies access', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ status: 403, err: TOKEN }, 403))
    const failure = await service(request).readNodes({ link: LINK }).catch((error: unknown) => error as Error)
    expect(failure).toMatchObject({ code: 'access_denied' })
    expect(String((failure as Error).message) + JSON.stringify(failure)).not.toContain(TOKEN)
  })
})
