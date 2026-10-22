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

import { codexModelCatalogResponse, isCodexModelCatalogRequest } from './image-gen-codex-catalog.fixture.js'

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

it('omits input_fidelity for the routed gpt-image-2-codex model name', async () => {
    const requests: Array<Record<string, any>> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (isCodexModelCatalogRequest(url)) return codexModelCatalogResponse()
      requests.push(JSON.parse(String(init?.body)) as Record<string, any>)
      return new Response([
        `data: ${JSON.stringify({
          type: 'response.output_item.done',
          item: { type: 'image_generation_call', result: png(8, 8).toString('base64') }
        })}`,
        'data: [DONE]'
      ].join('\n\n'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }))
    const client = new CodexResponsesImageClient('https://chatgpt.com/backend-api/codex', 'codex-access')

    await client.edit({
      prompt: 'edit the reference',
      model: 'gpt-image-2-codex',
      images: [{ name: 'reference.png', mimeType: 'image/png', data: png(16, 16) }],
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(requests).toHaveLength(1)
    expect(requests[0].tools[0]).toMatchObject({ action: 'edit', model: 'gpt-image-2-codex' })
    expect(requests[0].tools[0]).not.toHaveProperty('input_fidelity')
    expect(requests[0].input[0].content[1]).toMatchObject({ type: 'input_image', detail: 'high' })
  })

it('retries a Codex image edit once without input_fidelity when the model rejects it', async () => {
    const requests: Array<Record<string, any>> = []
    const resultBase64 = png(8, 8).toString('base64')
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (isCodexModelCatalogRequest(url)) return codexModelCatalogResponse()
      requests.push(JSON.parse(String(init?.body)) as Record<string, any>)
      if (requests.length === 1) {
        return new Response(JSON.stringify({
          error: {
            message: 'The model gpt-image-next-codex does not support input_fidelity.',
            type: 'invalid_request_error',
            code: 'invalid_input_fidelity_model'
          }
        }), { status: 400, headers: { 'content-type': 'application/json' } })
      }
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
      prompt: 'preserve the composition and change the shoes',
      model: 'gpt-image-next',
      images: [{ name: 'reference.png', mimeType: 'image/png', data: png(16, 16) }],
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(requests).toHaveLength(2)
    expect(requests[0].tools[0]).toMatchObject({
      type: 'image_generation',
      action: 'edit',
      model: 'gpt-image-next',
      input_fidelity: 'high'
    })
    expect(requests[1].tools[0]).toMatchObject({
      type: 'image_generation',
      action: 'edit',
      model: 'gpt-image-next'
    })
    expect(requests[1].tools[0]).not.toHaveProperty('input_fidelity')
    for (const body of requests) {
      expect(body.tool_choice).toMatchObject({ type: 'allowed_tools' })
      expect(body.input[0].content).toEqual([
        { type: 'input_text', text: 'preserve the composition and change the shoes' },
        {
          type: 'input_image',
          image_url: expect.stringMatching(/^data:image\/png;base64,/),
          detail: 'high'
        }
      ])
    }
  })

it('does not retry unrelated Codex image edit errors without input_fidelity', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (isCodexModelCatalogRequest(url)) return codexModelCatalogResponse()
      requests.push(String(init?.body))
      return new Response(JSON.stringify({
        error: { code: 'content_policy_violation', message: 'Request blocked by content policy.' }
      }), { status: 400, headers: { 'content-type': 'application/json' } })
    }))
    const client = new CodexResponsesImageClient('https://chatgpt.com/backend-api/codex', 'codex-access')

    await expect(client.edit({
      prompt: 'edit the reference',
      model: 'gpt-image-next',
      images: [{ name: 'reference.png', mimeType: 'image/png', data: png(16, 16) }],
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })).rejects.toThrow(/content_policy_violation/)

    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]).tools[0]).toHaveProperty('input_fidelity', 'high')
  })

it('does not retry input_fidelity errors returned with a non-400 status', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (isCodexModelCatalogRequest(url)) return codexModelCatalogResponse()
      requests.push(String(init?.body))
      return new Response(JSON.stringify({
        error: {
          code: 'invalid_input_fidelity_model',
          message: 'The routed model does not support input_fidelity.'
        }
      }), { status: 422, headers: { 'content-type': 'application/json' } })
    }))
    const client = new CodexResponsesImageClient('https://chatgpt.com/backend-api/codex', 'codex-access')

    await expect(client.edit({
      prompt: 'edit the reference',
      model: 'gpt-image-next',
      images: [{ name: 'reference.png', mimeType: 'image/png', data: png(16, 16) }],
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })).rejects.toThrow(/invalid_input_fidelity_model/)

    expect(requests).toHaveLength(1)
  })

it('keeps input_fidelity omitted after its retry enters tool_choice fallback', async () => {
    const requests: Array<Record<string, any>> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (isCodexModelCatalogRequest(url)) return codexModelCatalogResponse()
      requests.push(JSON.parse(String(init?.body)) as Record<string, any>)
      if (requests.length === 1) {
        return new Response(JSON.stringify({
          error: { code: 'invalid_input_fidelity_model', message: 'input_fidelity is unsupported' }
        }), { status: 400 })
      }
      if (requests.length === 2) {
        return new Response('Tool choice allowed_tools not found in tools parameter.', { status: 400 })
      }
      return new Response([
        `data: ${JSON.stringify({
          type: 'response.output_item.done',
          item: { type: 'image_generation_call', result: png(8, 8).toString('base64') }
        })}`,
        'data: [DONE]'
      ].join('\n\n'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }))
    const client = new CodexResponsesImageClient('https://chatgpt.com/backend-api/codex', 'codex-access')

    const image = await client.edit({
      prompt: 'edit the reference',
      model: 'gpt-image-next',
      images: [{ name: 'reference.png', mimeType: 'image/png', data: png(16, 16) }],
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(requests).toHaveLength(3)
    expect(requests[0].tools[0]).toHaveProperty('input_fidelity', 'high')
    expect(requests[1].tools[0]).not.toHaveProperty('input_fidelity')
    expect(requests[1].tool_choice).toMatchObject({ type: 'allowed_tools' })
    expect(requests[2].tools[0]).not.toHaveProperty('input_fidelity')
    expect(requests[2].tool_choice).toBe('required')
  })

it('uses the latest Codex partial image when the final image item is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => isCodexModelCatalogRequest(url)
      ? codexModelCatalogResponse()
      : new Response([
      `data: ${JSON.stringify({
        type: 'response.image_generation_call.partial_image',
        partial_image_b64: png(8, 8).toString('base64')
      })}`,
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: { status: 'completed', output: [] }
      })}`,
      'data: [DONE]'
    ].join('\n\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })))
    const client = new CodexResponsesImageClient('https://chatgpt.com/backend-api/codex', 'codex-access')

    const image = await client.generate({
      prompt: 'tiny square',
      model: 'gpt-image-2',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(image).toMatchObject({ mimeType: 'image/png' })
    expect(image.data.byteLength).toBeGreaterThan(0)
  })

it('retries Codex image requests when a deployment rejects preferred tool_choice shapes', async () => {
    const requests: string[] = []
    const resultBase64 = png(8, 8).toString('base64')
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (isCodexModelCatalogRequest(url)) return codexModelCatalogResponse()
      requests.push(String(init?.body))
      if (requests.length === 1) {
        return new Response('Tool choice allowed_tools not found in tools parameter.', { status: 400 })
      }
      if (requests.length === 2) {
        return new Response([
          `data: ${JSON.stringify({
            type: 'response.completed',
            response: { status: 'completed', output: [{ type: 'message', content: [] }] }
          })}`,
          'data: [DONE]'
        ].join('\n\n'), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      }
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

    const image = await client.generate({
      prompt: 'tiny square',
      model: 'gpt-image-2',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(image.data.byteLength).toBeGreaterThan(0)
    expect(requests).toHaveLength(3)
    expect(JSON.parse(requests[0]).tool_choice).toMatchObject({ type: 'allowed_tools' })
    expect(JSON.parse(requests[1]).tool_choice).toBe('required')
    expect(JSON.parse(requests[2]).tool_choice).toBeUndefined()
  })

it('summarizes Codex responses that complete without image data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => isCodexModelCatalogRequest(url)
      ? codexModelCatalogResponse()
      : new Response([
      `data: ${JSON.stringify({
        type: 'response.output_text.delta',
        delta: 'I can help with that.'
      })}`,
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: 'I can help with that.' }]
          }]
        }
      })}`,
      'data: [DONE]'
    ].join('\n\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })))
    const client = new CodexResponsesImageClient('https://chatgpt.com/backend-api/codex', 'codex-access')

    await expect(client.generate({
      prompt: 'tiny square',
      model: 'gpt-image-2',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })).rejects.toThrow(/events: response\.output_text\.delta, response\.completed; output: message; text: I can help with that/)
  })

it('generates an image, saves it to the workspace, and scopes the attachment', async () => {
    const client = fakeClient()
    const store = attachmentStore(join(workspace, 'attachments'))
    const host = hostFor(client, store)

    const tools = await host.listTools(buildContext())
    expect(tools.map((tool) => tool.name)).toEqual(['generate_image'])

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'generate_image',
      arguments: { prompt: 'a sunset over the sea', aspect_ratio: '16:9', image_size: '1K' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind !== 'tool_result') return
    const output = result.item.output as {
      files: Array<{ relativePath: string; absolutePath: string; mimeType: string; width: number; height: number }>
      attachments: Array<{ id: string; mimeType: string }>
      model: string
      size: string
      endpoint: string
      quality: string
      warnings: string[]
    }
    expect(output.endpoint).toBe('generations')
    expect(output.model).toBe('test-image-model')
    expect(output.size).toBe('1024x576')
    expect(output.quality).toBe('auto')
    expect(output.warnings).toEqual([])
    expect(output.files[0]).toMatchObject({ mimeType: 'image/png', width: 1024, height: 576 })
    expect(output.files[0].relativePath.startsWith('.kun/images/')).toBe(true)
    expect(existsSync(output.files[0].absolutePath)).toBe(true)
    expect(JSON.stringify(output)).not.toMatch(/base64|b64_json/)
    expect(client.generateCalls[0]).toMatchObject({
      prompt: 'a sunset over the sea',
      quality: 'auto',
      size: '1024x576'
    })

    expect(output.attachments).toHaveLength(1)
    const id = output.attachments[0].id
    await expect(store.resolveContent(id, { threadId: 'thr_1' })).resolves.toMatchObject({ mimeType: 'image/png' })
    await expect(store.resolveContent(id, { threadId: 'thr_other' })).rejects.toThrow(/not authorized/)
  })

it('uses the configured default resolution unless the user explicitly overrides it', async () => {
    const client = fakeClient()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(
        buildImageGenToolProviders(imageGenConfig({ defaultResolution: '2K' }), {
          client,
          nowIso: () => '2026-06-10T00:00:00.000Z'
        }).providers
      )
    })

    await host.execute({
      callId: 'call_default_resolution',
      toolName: 'generate_image',
      arguments: { prompt: 'wide landscape', aspect_ratio: '16:9' }
    }, buildContext())
    await host.execute({
      callId: 'call_explicit_resolution',
      toolName: 'generate_image',
      arguments: { prompt: 'smaller wide landscape', aspect_ratio: '16:9', image_size: '1K' }
    }, buildContext())

    expect(client.generateCalls[0]).toMatchObject({ size: '2048x1152' })
    expect(client.generateCalls[1]).toMatchObject({ size: '1024x576' })
  })

it('keeps Seedream-only resolution defaults from leaking across protocols', async () => {
    const genericClient = fakeClient()
    const seedreamClient = fakeClient()
    const genericHost = new LocalToolHost({
      registry: new CapabilityRegistry(
        buildImageGenToolProviders(imageGenConfig({
          protocol: 'openai-images',
          defaultResolution: '4K'
        }), { client: genericClient }).providers
      )
    })
    const seedreamHost = new LocalToolHost({
      registry: new CapabilityRegistry(
        buildImageGenToolProviders(imageGenConfig({
          protocol: 'volcengine-ark-image',
          defaultResolution: '1K'
        }), { client: seedreamClient }).providers
      )
    })

    await genericHost.execute({
      callId: 'call_generic_stale_4k',
      toolName: 'generate_image',
      arguments: { prompt: 'generic image' }
    }, buildContext())
    await seedreamHost.execute({
      callId: 'call_seedream_stale_1k',
      toolName: 'generate_image',
      arguments: { prompt: 'Seedream image' }
    }, buildContext())

    expect(genericClient.generateCalls[0]).toMatchObject({ size: '1024x1024' })
    expect(seedreamClient.generateCalls[0]).toMatchObject({ size: '2048x2048' })
  })

it('lets the provider choose dimensions when default resolution is auto and no ratio is requested', async () => {
    const client = fakeClient()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(
        buildImageGenToolProviders(imageGenConfig({ defaultResolution: 'auto' }), {
          client,
          nowIso: () => '2026-06-10T00:00:00.000Z'
        }).providers
      )
    })

    await host.execute({
      callId: 'call_auto_resolution',
      toolName: 'generate_image',
      arguments: { prompt: 'provider-sized image' }
    }, buildContext())

    expect(client.generateCalls[0]).not.toHaveProperty('size')
  })

it('rejects generated-image writes through an escaping workspace symlink', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'kun-imagegen-outside-'))
    try {
      await mkdir(join(workspace, '.kun'), { recursive: true })
      await symlink(outside, join(workspace, '.kun', 'images'), process.platform === 'win32' ? 'junction' : 'dir')
      const client = fakeClient()
      const host = hostFor(client)

      const result = await host.execute({
        callId: 'call_escape',
        toolName: 'generate_image',
        arguments: { prompt: 'must stay in workspace' }
      }, { ...buildContext(), sandboxMode: 'workspace-write' })

      expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
      expect(JSON.stringify(result.item)).toContain('workspace_path_escape')
      expect(client.generateCalls).toHaveLength(1)
      await expect(readdir(outside)).resolves.toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

it('does not read a reference image through an escaping workspace symlink', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'kun-imagegen-reference-outside-'))
    try {
      await mkdir(join(workspace, 'refs'))
      await writeFile(join(outside, 'secret.png'), png(8, 8))
      await symlink(join(outside, 'secret.png'), join(workspace, 'refs', 'linked.png'), 'file')
      const client = fakeClient()
      const host = hostFor(client)

      const result = await host.execute({
        callId: 'call_reference_escape',
        toolName: 'generate_image',
        arguments: { prompt: 'use reference', reference_image_paths: ['refs/linked.png'] }
      }, { ...buildContext(), sandboxMode: 'workspace-write' })

      expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
      expect(JSON.stringify(result.item)).toContain('invalid_reference_path')
      expect(client.generateCalls).toHaveLength(0)
      expect(client.editCalls).toHaveLength(0)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

it('passes configured image quality through tool execution', async () => {
    const client = fakeClient()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(
        buildImageGenToolProviders(imageGenConfig({ quality: 'high', defaultResolution: '2K' }), {
          client,
          nowIso: () => '2026-06-10T00:00:00.000Z'
        }).providers
      )
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'generate_image',
      arguments: { prompt: 'a detailed product render' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind !== 'tool_result') return
    expect(result.item.output).toMatchObject({ quality: 'high' })
    expect(client.generateCalls[0]).toMatchObject({ quality: 'high', size: '2048x2048' })
  })

})
