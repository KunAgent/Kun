import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexResponsesImageClient } from '../../src/adapters/tool/image-gen-tool-provider.js'

import {
  CODEX_MODEL_CATALOG_URL,
  codexModelCatalogResponse
} from './image-gen-codex-catalog.fixture.js'

const OFFICIAL_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const IMAGE_MODEL = 'gpt-image-2'

afterEach(() => {
  vi.unstubAllGlobals()
})

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  buffer[0] = 0x89
  buffer[1] = 0x50
  buffer[2] = 0x4e
  buffer[3] = 0x47
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function imageStream(): Response {
  return new Response([
    `data: ${JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'image_generation_call', result: png(8, 8).toString('base64') }
    })}`,
    'data: [DONE]'
  ].join('\n\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** The exact rejection reported by Codex with a ChatGPT account. */
function outerModelRejection(model: string, status = 400): Response {
  return new Response(JSON.stringify({
    error: {
      message: `The '${model}' model is not supported when using Codex with a ChatGPT account.`,
      type: 'invalid_request_error',
      code: 'model_not_supported'
    }
  }), { status, headers: { 'content-type': 'application/json' } })
}

function sseFailure(message: string): Response {
  return new Response([
    `data: ${JSON.stringify({ type: 'response.failed', error: { message } })}`,
    'data: [DONE]'
  ].join('\n\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function client(baseUrl = OFFICIAL_BASE_URL) {
  return new CodexResponsesImageClient(baseUrl, 'codex-access', { 'ChatGPT-Account-Id': 'acct_1' })
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'tiny square',
    model: IMAGE_MODEL,
    timeoutMs: 1_000,
    signal: new AbortController().signal,
    ...overrides
  }
}

type StubReply = Response | ((body: Record<string, unknown>) => Response)

/**
 * Records image POSTs only. The catalog request is answered separately so an
 * assertion about "no request was sent" never counts catalog discovery.
 */
function stubCodex(
  catalog: Response | string[],
  replies: StubReply[]
): { bodies: Record<string, any>[]; catalogRequests: string[] } {
  const bodies: Record<string, any>[] = []
  const catalogRequests: string[] = []
  const planned = [...replies]
  let fallback: StubReply | undefined
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith(CODEX_MODEL_CATALOG_URL)) {
      catalogRequests.push(String(url))
      return Array.isArray(catalog) ? codexModelCatalogResponse(catalog) : catalog
    }
    const body = JSON.parse(String(init?.body)) as Record<string, any>
    bodies.push(body)
    const reply = planned.shift() ?? fallback
    if (!reply) throw new Error(`unexpected image request ${bodies.length}`)
    if (typeof reply === 'function') fallback = reply
    return typeof reply === 'function' ? reply(body) : reply
  }))
  return { bodies, catalogRequests }
}

describe('Codex subscription image outer model selection', () => {
  it('never sends an outer model the account catalog does not list', async () => {
    const { bodies } = stubCodex(['gpt-5.4', 'gpt-5.4-mini'], [imageStream()])

    const image = await client().generate(request())

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].model).toBe('gpt-5.4')
    expect(bodies[0].tools[0]).toMatchObject({ type: 'image_generation', model: IMAGE_MODEL })
  })

  it('falls back to the next catalog model when the first one is rejected', async () => {
    const { bodies } = stubCodex(['gpt-5.5', 'gpt-5.4'], [
      outerModelRejection('gpt-5.5'),
      imageStream()
    ])

    const image = await client().generate(request())

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(bodies.map((body) => body.model)).toEqual(['gpt-5.5', 'gpt-5.4'])
    for (const body of bodies) expect(body.tools[0].model).toBe(IMAGE_MODEL)
  })

  it('switches on a model rejection delivered inside a streaming response', async () => {
    const { bodies } = stubCodex(['gpt-5.5', 'gpt-5.4'], [
      sseFailure('The \'gpt-5.5\' model is not supported when using Codex with a ChatGPT account.'),
      imageStream()
    ])

    const image = await client().generate(request())

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(bodies.map((body) => body.model)).toEqual(['gpt-5.5', 'gpt-5.4'])
  })

  it('reports every rejected outer model while keeping the image model', async () => {
    const { bodies } = stubCodex(['gpt-5.5', 'gpt-5.4'], [
      outerModelRejection('gpt-5.5'),
      outerModelRejection('gpt-5.4')
    ])

    await expect(client().generate(request())).rejects.toThrow(
      /tried gpt-5\.5, gpt-5\.4; image model gpt-image-2 was kept/
    )
    expect(bodies).toHaveLength(2)
  })

  it('continues with a catalog model the maintained list does not name', async () => {
    // The observed account: its catalog still lists gpt-5.5 but rejects it, and
    // the image-capable choice has moved to a newer model name.
    const { bodies } = stubCodex(['gpt-6.1-sol', 'gpt-5.6-sol', 'gpt-5.5'], [
      outerModelRejection('gpt-5.5'),
      imageStream()
    ])

    const image = await client().generate(request())

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(bodies.map((body) => body.model)).toEqual(['gpt-5.5', 'gpt-6.1-sol'])
    for (const body of bodies) expect(body.tools[0].model).toBe(IMAGE_MODEL)
  })

  it('stops after a bounded number of outer-model attempts', async () => {
    const catalog = ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4']
    const { bodies } = stubCodex(catalog, [
      (body) => outerModelRejection(String(body.model))
    ])

    await expect(client().generate(request())).rejects.toThrow(/image model gpt-image-2 was kept/)
    expect(bodies).toHaveLength(4)
  })

  it('fails clearly when the account catalog cannot be read', async () => {
    const { bodies } = stubCodex(new Response('nope', { status: 503 }), [imageStream()])

    await expect(client().generate(request())).rejects.toThrow(
      /could not read the ChatGPT account model catalog/
    )
    expect(bodies).toHaveLength(0)
  })

  it('fails clearly when the catalog lists nothing to try', async () => {
    const { bodies } = stubCodex([], [imageStream()])

    await expect(client().generate(request())).rejects.toThrow(
      /found no usable outer model/
    )
    expect(bodies).toHaveLength(0)
  })

  it('advances when the provider says the model cannot host image generation', async () => {
    const { bodies } = stubCodex(['gpt-5.5', 'gpt-5.4'], [
      new Response(JSON.stringify({
        error: { message: 'image_generation is not supported for this model.', code: 'unsupported_tool' }
      }), { status: 400, headers: { 'content-type': 'application/json' } }),
      imageStream()
    ])

    const image = await client().generate(request())

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(bodies.map((body) => body.model)).toEqual(['gpt-5.5', 'gpt-5.4'])
  })

  it('does not advance on an unrelated 400 such as a content policy block', async () => {
    const { bodies } = stubCodex(['gpt-5.5', 'gpt-5.4'], [
      new Response(JSON.stringify({
        error: { code: 'content_policy_violation', message: 'Request blocked by content policy.' }
      }), { status: 400, headers: { 'content-type': 'application/json' } }),
      imageStream()
    ])

    await expect(client().generate(request())).rejects.toThrow(/content_policy_violation/)
    expect(bodies).toHaveLength(1)
  })

  it('keeps one attempt when the image model is the rejected model', async () => {
    const { bodies } = stubCodex(['gpt-5.5', 'gpt-5.4'], [
      outerModelRejection(IMAGE_MODEL)
    ])

    await expect(client().generate(request())).rejects.toThrow(/gpt-image-2/)
    expect(bodies).toHaveLength(1)
  })

  it('never switches after image data has started streaming', async () => {
    const partial = new Response([
      `data: ${JSON.stringify({
        type: 'response.image_generation_call.partial_image',
        partial_image_b64: png(8, 8).toString('base64')
      })}`,
      `data: ${JSON.stringify({
        type: 'response.failed',
        error: { message: 'The \'gpt-5.5\' model is not supported when using Codex with a ChatGPT account.' }
      })}`,
      'data: [DONE]'
    ].join('\n\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const { bodies } = stubCodex(['gpt-5.5', 'gpt-5.4'], [partial, imageStream()])

    await expect(client().generate(request())).rejects.toThrow(/gpt-5\.5/)
    expect(bodies).toHaveLength(1)
  })

  it.each([401, 429, 500])('does not switch outer models on HTTP %i', async (status) => {
    const { bodies } = stubCodex(['gpt-5.5', 'gpt-5.4'], [
      new Response(JSON.stringify({ error: { message: 'upstream unavailable' } }), { status }),
      imageStream()
    ])

    await expect(client().generate(request())).rejects.toThrow()
    expect(bodies).toHaveLength(1)
  })

  it('keeps the maintained order and never contacts chatgpt.com with a plain relay key', async () => {
    const requests: string[] = []
    const bodies: Record<string, any>[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push(String(url))
      if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, any>)
      return imageStream()
    }))
    const relay = new CodexResponsesImageClient('https://relay.example.test/codex', 'relay-key')

    const image = await relay.generate(request())

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(requests).toEqual(['https://relay.example.test/codex/responses'])
    expect(bodies[0].model).toBe('gpt-5.5')
    expect(requests.some((url) => url.includes('chatgpt.com'))).toBe(false)
  })

  it('reads the account catalog through a relay that carries the ChatGPT credential', async () => {
    // The observed configuration: providerId=codex (ChatGPT OAuth) with a relay
    // baseUrl. The credential issuer still owns the catalog of usable models.
    const { bodies, catalogRequests } = stubCodex(['gpt-6.1-sol', 'gpt-5.5'], [
      outerModelRejection('gpt-5.5'),
      imageStream()
    ])
    const relay = new CodexResponsesImageClient(
      'https://zenmux.example.test/api/v1',
      'codex-access',
      { 'ChatGPT-Account-Id': 'acct_1' }
    )

    const image = await relay.generate(request())

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(catalogRequests).toHaveLength(1)
    expect(bodies.map((body) => body.model)).toEqual(['gpt-5.5', 'gpt-6.1-sol'])
  })
})
