import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'

import { existsSync } from 'node:fs'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CapabilityRegistry } from '../../src/adapters/tool/capability-registry.js'

import { LocalToolHost } from '../../src/adapters/tool/local-tool-host.js'

import {
  buildImageGenToolProviders,
  CodexResponsesImageClient,
  codexResponsesImageUrl,
  createImageGenClient,
  mapImageSize,
  GrokImagineImageClient,
  MiniMaxImageClient,
  minimaxImageDimensionFields,
  OpenAiCompatImageClient,
  openAiCompatImageUrl,
  protocolSupportsImageEdit,
  VolcengineArkImageClient,
  volcengineArkImageUrl,
  type ImageGenClient
} from '../../src/adapters/tool/image-gen-tool-provider.js'

import { FileAttachmentStore } from '../../src/attachments/attachment-store.js'

import {
  buildRuntimeCapabilityManifest,
  KunCapabilitiesConfig
} from '../../src/contracts/capabilities.js'

import { modelCapabilitiesForModel } from '../../src/loop/model-context-profile.js'

import type { ToolHostContext } from '../../src/ports/tool-host.js'

let workspace: string

function buildContext(): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace,
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function imageGenConfig(overrides: Record<string, unknown> = {}) {
  return KunCapabilitiesConfig.parse({
    imageGen: {
      enabled: true,
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'sk-test',
      model: 'test-image-model',
      ...overrides
    }
  }).imageGen
}

function fakeClient(image = png(1024, 576)): ImageGenClient & { generateCalls: unknown[]; editCalls: unknown[] } {
  const calls = { generateCalls: [] as unknown[], editCalls: [] as unknown[] }
  return {
    id: 'fake',
    ...calls,
    async generate(request) {
      calls.generateCalls.push(request)
      return { data: image, mimeType: 'image/png' }
    },
    async edit(request) {
      calls.editCalls.push(request)
      return { data: image, mimeType: 'image/png' }
    }
  }
}

function attachmentStore(rootDir: string, overrides: Record<string, unknown> = {}) {
  return new FileAttachmentStore({
    rootDir,
    config: KunCapabilitiesConfig.parse({ attachments: { enabled: true, ...overrides } }).attachments,
    nowIso: () => '2026-06-10T00:00:00.000Z'
  })
}

function hostFor(client: ImageGenClient, store?: FileAttachmentStore) {
  return new LocalToolHost({
    registry: new CapabilityRegistry(
      buildImageGenToolProviders(imageGenConfig(), {
        client,
        attachmentStore: store,
        nowIso: () => '2026-06-10T00:00:00.000Z'
      }).providers
    )
  })
}

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  buffer[0] = 0x89
  buffer[1] = 0x50
  buffer[2] = 0x4e
  buffer[3] = 0x47
  buffer[4] = 0x0d
  buffer[5] = 0x0a
  buffer[6] = 0x1a
  buffer[7] = 0x0a
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

describe('Image gen tool provider', () => {

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-imagegen-'))
  })

afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(workspace, { recursive: true, force: true })
  })

it('does not build providers when image generation is disabled', () => {
    const config = KunCapabilitiesConfig.parse({})
    const built = buildImageGenToolProviders(config.imageGen)
    expect(built.providers).toEqual([])
    expect(built.diagnostics).toEqual([])
    expect(built.available).toBe(false)
  })

it('reports an unavailable provider without tools when configuration is incomplete', async () => {
    const config = KunCapabilitiesConfig.parse({
      imageGen: { enabled: true, baseUrl: 'https://images.example.test/v1', model: 'test-image-model' }
    })
    const built = buildImageGenToolProviders(config.imageGen)
    expect(built.available).toBe(false)
    expect(built.providers).toHaveLength(1)
    expect(built.providers[0]).toMatchObject({ id: 'imageGen', enabled: true, available: false })
    expect(built.providers[0].reason).toMatch(/missing apiKey/)
    expect(built.providers[0].tools).toHaveLength(0)
    expect(built.diagnostics[0]).toMatchObject({ enabled: true, available: false })
  })

it('maps aspect ratio and size tier to provider sizes', () => {
    expect(mapImageSize(undefined, undefined, undefined, '1K')).toBe('1024x1024')
    expect(mapImageSize(undefined, undefined, undefined, '2K')).toBe('2048x2048')
    expect(mapImageSize('16:9', undefined, undefined, '3K')).toBe('3072x1728')
    expect(mapImageSize('9:16', undefined, undefined, '4K')).toBe('2304x4096')
    expect(mapImageSize(undefined, undefined, undefined, 'auto')).toBe('auto')
    expect(mapImageSize('16:9', undefined, undefined, 'auto')).toBe('1024x576')
    expect(mapImageSize(undefined, undefined, '1536x1024', '2K')).toBe('1536x1024')
    expect(mapImageSize('3:2', undefined, '1536x1024', '2K')).toBe('1536x1024')
    expect(mapImageSize(undefined, undefined, 'auto', '2K')).toBe('auto')
    expect(mapImageSize('16:9', undefined, 'auto', '2K')).toBe('2048x1152')
    expect(mapImageSize('1:1', undefined, undefined, '1K')).toBe('1024x1024')
    expect(mapImageSize('1:1', '2K', undefined, '1K')).toBe('2048x2048')
    expect(mapImageSize('16:9', '1K', undefined, '2K')).toBe('1024x576')
    expect(mapImageSize('9:16', '2K', undefined, '1K')).toBe('1152x2048')
    expect(mapImageSize('21:9', '1K', undefined, '2K')).toBe('1024x448')
    expect(mapImageSize('3:2', '1K', undefined, '2K')).toBe('1024x704')
    // An explicit tool override wins over both configured size fields.
    expect(mapImageSize('16:9', '2K', '1536x1024', '1K')).toBe('2048x1152')
    // Unknown ratios fall back to a square at the requested tier.
    expect(mapImageSize('7:5', '2K', undefined, '1K')).toBe('2048x2048')
    expect(mapImageSize(undefined, '2K', undefined, '1K')).toBe('2048x2048')
  })

it('defaults image resolution to 1K and validates configured tiers', () => {
    expect(imageGenConfig().defaultResolution).toBe('1K')
    expect(imageGenConfig({ defaultResolution: 'auto' }).defaultResolution).toBe('auto')
    expect(imageGenConfig({ defaultResolution: '2K' }).defaultResolution).toBe('2K')
    expect(imageGenConfig({ defaultResolution: '3K' }).defaultResolution).toBe('3K')
    expect(imageGenConfig({ defaultResolution: '4K' }).defaultResolution).toBe('4K')
    expect(() => imageGenConfig({ defaultResolution: '8K' })).toThrow()
  })

it('advertises settings-backed quality and resolution semantics without dynamic values', () => {
    const oneKTool = buildImageGenToolProviders(imageGenConfig({
      defaultResolution: '1K',
      quality: 'low'
    }), { client: fakeClient() }).providers[0].tools[0]
    const twoKTool = buildImageGenToolProviders(imageGenConfig({
      defaultResolution: '2K',
      quality: 'high'
    }), { client: fakeClient() }).providers[0].tools[0]

    expect(oneKTool.description).toContain('Image quality is applied automatically from Settings')
    const properties = oneKTool.inputSchema.properties as Record<string, { description?: string }>
    expect(properties.aspect_ratio.description).toContain('preserving the selected or default resolution')
    expect(properties.image_size.description).toContain('only when the user explicitly requests 1K or 2K')
    expect(properties.image_size.description).toContain('Settings default resolution')
    expect(properties.image_size.description).toContain('independent of image quality')
    expect(properties.image_size.description).not.toContain('defaults to 1K')
    expect(twoKTool.description).toBe(oneKTool.description)
    expect(twoKTool.inputSchema).toEqual(oneKTool.inputSchema)
  })

it('advertises the verified Grok aspect ratios and both resolution tiers', () => {
    const tool = buildImageGenToolProviders(imageGenConfig({
      protocol: 'grok-imagine-image'
    }), { client: fakeClient() }).providers[0].tools[0]
    const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>

    expect(properties.aspect_ratio.enum).toEqual([
      '1:1',
      '16:9',
      '9:16',
      '4:3',
      '3:4',
      '3:2',
      '2:3',
      '2:1',
      '1:2',
      '19.5:9',
      '9:19.5',
      '20:9',
      '9:20'
    ])
    expect(properties.image_size.enum).toEqual(['1K', '2K'])
  })

it('advertises only the native Seedream resolution tiers', () => {
    const tool = buildImageGenToolProviders(imageGenConfig({
      protocol: 'volcengine-ark-image',
      defaultResolution: '3K'
    }), { client: fakeClient() }).providers[0].tools[0]
    const properties = tool.inputSchema.properties as Record<string, { enum?: string[]; description?: string }>

    expect(properties.image_size.enum).toEqual(['2K', '3K', '4K'])
    expect(properties.image_size.description).toContain('2K, 3K, or 4K')
    expect(properties.reference_image_paths).toBeDefined()
  })

it('keeps explicit width/height for MiniMax image-01 only', () => {
    expect(minimaxImageDimensionFields('image-01', '768x1024')).toEqual({ width: 768, height: 1024 })
    expect(minimaxImageDimensionFields(' image-01 ', '1024x576')).toEqual({ width: 1024, height: 576 })
  })

it('maps sizes to the nearest aspect_ratio for other MiniMax models', () => {
    // image-01-live rejects width/height with status 2013.
    expect(minimaxImageDimensionFields('image-01-live', '768x1024')).toEqual({ aspect_ratio: '3:4' })
    expect(minimaxImageDimensionFields('image-01-live', '1024x1024')).toEqual({ aspect_ratio: '1:1' })
    expect(minimaxImageDimensionFields('image-01-live', '1024x576')).toEqual({ aspect_ratio: '16:9' })
    // mapImageSize rounds edges to multiples of 64, so snap to the nearest ratio.
    expect(minimaxImageDimensionFields('image-01-live', '1024x704')).toEqual({ aspect_ratio: '3:2' })
    expect(minimaxImageDimensionFields('image-01-live', '1152x2048')).toEqual({ aspect_ratio: '9:16' })
    // 21:9 is image-01 only; ultra-wide degrades to the closest supported ratio.
    expect(minimaxImageDimensionFields('image-01-live', '1024x448')).toEqual({ aspect_ratio: '16:9' })
  })

it('omits MiniMax dimension fields for non-WxH sizes', () => {
    expect(minimaxImageDimensionFields('image-01-live', undefined)).toEqual({})
    expect(minimaxImageDimensionFields('image-01-live', 'auto')).toEqual({})
    expect(minimaxImageDimensionFields('image-01', '0x0')).toEqual({})
  })

it('enables MiniMax prompt optimization for image requests', async () => {
    const requests: Array<{ url: string; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body) })
      return new Response(JSON.stringify({
        data: { image_base64: [png(8, 8).toString('base64')] },
        base_resp: { status_code: 0 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const client = new MiniMaxImageClient('https://api.minimaxi.com', 'sk-test')

    await client.generate({
      prompt: 'short prompt',
      model: 'image-01',
      size: '1024x768',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(requests[0].url).toBe('https://api.minimaxi.com/v1/image_generation')
    expect(JSON.parse(requests[0].body)).toMatchObject({
      model: 'image-01',
      prompt: 'short prompt',
      width: 1024,
      height: 768,
      prompt_optimizer: true,
      response_format: 'base64',
      n: 1
    })
  })

it('inserts /v1 into unversioned OpenAI-compat image base urls like the chat client', () => {
    // ZenMux-style API root without a version segment.
    expect(openAiCompatImageUrl('https://zenmux.ai/api', 'generations'))
      .toBe('https://zenmux.ai/api/v1/images/generations')
    expect(openAiCompatImageUrl('https://zenmux.ai/api/', 'edits'))
      .toBe('https://zenmux.ai/api/v1/images/edits')
    expect(openAiCompatImageUrl('https://example.test', 'generations'))
      .toBe('https://example.test/v1/images/generations')
  })

it('keeps versioned and fully-qualified OpenAI-compat image base urls', () => {
    expect(openAiCompatImageUrl('https://api.openai.com/v1', 'generations'))
      .toBe('https://api.openai.com/v1/images/generations')
    expect(openAiCompatImageUrl('https://ark.example.test/api/v3', 'edits'))
      .toBe('https://ark.example.test/api/v3/images/edits')
    expect(openAiCompatImageUrl('https://x.test/v1/images/generations', 'generations'))
      .toBe('https://x.test/v1/images/generations')
    // A fully-qualified generations URL still routes the edits call.
    expect(openAiCompatImageUrl('https://x.test/v1/images/generations', 'edits'))
      .toBe('https://x.test/v1/images/edits')
  })

it('builds Volcano Ark image endpoints from API and Agent Plan roots', () => {
    expect(volcengineArkImageUrl('https://ark.cn-beijing.volces.com/api/v3'))
      .toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(volcengineArkImageUrl('https://ark.cn-beijing.volces.com/api/plan/v3/'))
      .toBe('https://ark.cn-beijing.volces.com/api/plan/v3/images/generations')
    expect(volcengineArkImageUrl(
      'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations'
    )).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/images/generations')
    expect(createImageGenClient({
      protocol: 'volcengine-ark-image',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'ark-access'
    }).id).toBe('volcengine-ark-image')
  })

it('posts native Seedream generation and reference-image requests', async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
    const generated = png(8, 8)
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      })
      return new Response(JSON.stringify({
        data: [{ b64_json: generated.toString('base64') }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new VolcengineArkImageClient(
      'https://ark.cn-beijing.volces.com/api/plan/v3',
      'agent-plan-key'
    )
    const signal = new AbortController().signal

    const generatedImage = await client.generate({
      prompt: '一只站在山顶的雪豹',
      model: 'doubao-seedream-5.0-lite',
      size: '3072x1728',
      timeoutMs: 1_000,
      signal
    })
    const editedImage = await client.edit({
      prompt: '把天空改成日落',
      model: 'doubao-seedream-5.0-lite',
      images: [
        { name: 'first.png', mimeType: 'image/png', data: Buffer.from('first') },
        { name: 'second.webp', mimeType: 'image/webp', data: Buffer.from('second') }
      ],
      timeoutMs: 1_000,
      signal
    })

    expect(generatedImage.data).toEqual(generated)
    expect(editedImage.data).toEqual(generated)
    expect(requests).toHaveLength(2)
    expect(requests[0].url).toBe(
      'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations'
    )
    expect(requests[0].headers.get('authorization')).toBe('Bearer agent-plan-key')
    expect(requests[0].body).toEqual({
      model: 'doubao-seedream-5.0-lite',
      prompt: '一只站在山顶的雪豹',
      size: '3072x1728',
      output_format: 'png',
      response_format: 'b64_json',
      sequential_image_generation: 'disabled',
      stream: false,
      watermark: false
    })
    expect(requests[1].body).toMatchObject({
      model: 'doubao-seedream-5.0-lite',
      prompt: '把天空改成日落',
      size: '2K',
      image: [
        `data:image/png;base64,${Buffer.from('first').toString('base64')}`,
        `data:image/webp;base64,${Buffer.from('second').toString('base64')}`
      ]
    })
  })

it('downloads a URL result from Seedream and surfaces provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      if (String(url).endsWith('/images/generations')) {
        return new Response(JSON.stringify({
          data: [{ url: 'https://cdn.example.test/seedream.png' }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(new Uint8Array(Buffer.from('seedream-image')), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      })
    }))
    const client = new VolcengineArkImageClient(
      'https://ark.cn-beijing.volces.com/api/v3',
      'ark-key'
    )
    const request = {
      prompt: 'a paper sculpture',
      model: 'doubao-seedream-5-0-lite-260128',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    }

    await expect(client.generate(request)).resolves.toMatchObject({
      data: Buffer.from('seedream-image'),
      mimeType: 'image/png'
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'InvalidParameter', message: 'unsupported size' }
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const errorClient = new VolcengineArkImageClient(
      'https://ark.cn-beijing.volces.com/api/v3',
      'ark-key'
    )
    await expect(errorClient.generate(request)).rejects.toThrow(
      /Volcano Ark image provider returned no image data: unsupported size/
    )
  })

it('posts Codex subscription image requests through responses image_generation SSE', async () => {
    expect(codexResponsesImageUrl('https://chatgpt.com/backend-api/codex'))
      .toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(codexResponsesImageUrl('https://chatgpt.com/backend-api/codex/responses'))
      .toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(createImageGenClient({
      protocol: 'codex-responses-image',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: 'codex-access'
    }).id).toBe('codex-responses-image')

    const requests: Array<{ url: string; headers: Record<string, string>; body: string }> = []
    const resultBase64 = png(8, 8).toString('base64')
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body)
      })
      return new Response([
        `data: ${JSON.stringify({
          type: 'response.output_item.done',
          item: { type: 'image_generation_call', result: resultBase64 }
        })}`,
        'data: [DONE]'
      ].join('\n\n'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }))
    const client = new CodexResponsesImageClient('https://chatgpt.com/backend-api/codex', 'codex-access', {
      'ChatGPT-Account-Id': 'acct_123',
      originator: 'codex_cli_rs'
    })

    const image = await client.generate({
      prompt: 'tiny square',
      model: 'gpt-image-2',
      size: '1024x1024',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(image).toMatchObject({ mimeType: 'image/png' })
    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(requests[0].headers).toMatchObject({
      Authorization: 'Bearer codex-access',
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'ChatGPT-Account-Id': 'acct_123',
      originator: 'codex_cli_rs'
    })
    const generationBody = JSON.parse(requests[0].body)
    expect(generationBody).toMatchObject({
      model: 'gpt-5.5',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'tiny square' }] }],
      instructions: 'You must fulfill image generation requests by using the image_generation tool.',
      tools: [{
        type: 'image_generation',
        action: 'generate',
        model: 'gpt-image-2',
        quality: 'auto',
        output_format: 'png',
        background: 'opaque',
        partial_images: 1,
        size: '1024x1024'
      }],
      tool_choice: {
        type: 'allowed_tools',
        mode: 'required',
        tools: [{ type: 'image_generation' }]
      },
      stream: true,
      store: false
    })
    expect(generationBody.tools[0]).not.toHaveProperty('input_fidelity')
  })

it('posts Grok subscription image requests with native ratios and 1K/2K resolutions', async () => {
    expect(createImageGenClient({
      protocol: 'grok-imagine-image',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: 'grok-access'
    }).id).toBe('grok-imagine-image')

    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      })
      return new Response(JSON.stringify({
        data: [{ b64_json: png(8, 8).toString('base64') }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new GrokImagineImageClient('https://api.x.ai/v1', 'grok-access', {
      'x-grok-client-version': '0.2.112',
      'x-grok-client-identifier': 'grok-shell'
    })

    const oneKImage = await client.generate({
      prompt: 'cinematic mountain lake',
      model: 'grok-imagine-image-quality',
      aspectRatio: '16:9',
      size: '1024x576',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })
    const twoKImage = await client.generate({
      prompt: 'ultra-wide city skyline',
      model: 'grok-imagine-image-quality',
      aspectRatio: '20:9',
      size: '2048x896',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(oneKImage.data.byteLength).toBeGreaterThan(0)
    expect(twoKImage.data.byteLength).toBeGreaterThan(0)
    expect(requests).toHaveLength(2)
    expect(requests[0].url).toBe('https://api.x.ai/v1/images/generations')
    expect(requests[0].headers.get('authorization')).toBe('Bearer grok-access')
    expect(requests[0].headers.get('x-grok-client-version')).toBe('0.2.112')
    expect(requests[0].headers.get('x-grok-client-identifier')).toBe('grok-shell')
    expect(requests[0].body).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'cinematic mountain lake',
      n: 1,
      aspect_ratio: '16:9',
      resolution: '1k',
      response_format: 'b64_json'
    })
    expect(requests[0].body).not.toHaveProperty('size')
    expect(requests[1].body).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'ultra-wide city skyline',
      n: 1,
      aspect_ratio: '20:9',
      resolution: '2k',
      response_format: 'b64_json'
    })
    expect(requests[1].body).not.toHaveProperty('size')
  })

it('posts Codex subscription image edits with input images and edit action', async () => {
    const requests: Array<{ body: string }> = []
    const resultBase64 = png(8, 8).toString('base64')
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      requests.push({ body: String(init?.body) })
      return new Response([
        `data: ${JSON.stringify({
          type: 'response.output_item.done',
          item: { type: 'image_generation_call', result: resultBase64 }
        })}`,
        'data: [DONE]'
      ].join('\n\n'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }))
    const client = new CodexResponsesImageClient('https://chatgpt.com/backend-api/codex', 'codex-access')

    const image = await client.edit({
      prompt: 'put basketball shoes on the character',
      model: 'gpt-image-2',
      images: [{ name: 'annotated.png', mimeType: 'image/png', data: png(16, 16) }],
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(image).toMatchObject({ mimeType: 'image/png' })
    expect(requests).toHaveLength(1)
    const body = JSON.parse(requests[0].body)
    expect(body.input[0].content).toEqual([
      { type: 'input_text', text: 'put basketball shoes on the character' },
      {
        type: 'input_image',
        image_url: expect.stringMatching(/^data:image\/png;base64,/),
        detail: 'high'
      }
    ])
    expect(body.tools[0]).toMatchObject({
      type: 'image_generation',
      action: 'edit',
      model: 'gpt-image-2'
    })
    expect(body.tools[0]).not.toHaveProperty('input_fidelity')
  })

})
