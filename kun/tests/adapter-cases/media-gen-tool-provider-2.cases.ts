import { existsSync } from 'node:fs'

import { mkdtemp, readFile, rm } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CapabilityRegistry } from '../../src/adapters/tool/capability-registry.js'

import { LocalToolHost } from '../../src/adapters/tool/local-tool-host.js'

import {
  buildMusicGenToolProviders,
  buildSpeechGenToolProviders,
  buildVideoGenToolProviders,
  createVideoGenClient,
  GrokImagineVideoClient,
  MimoSpeechClient,
  MiniMaxMusicClient,
  MiniMaxSpeechClient,
  MiniMaxVideoClient,
  VolcengineArkVideoClient,
  volcengineArkVideoTasksUrl,
  type MusicGenClient,
  type SpeechGenClient,
  type VideoGenClient
} from '../../src/adapters/tool/media-gen-tool-provider.js'

import { KunCapabilitiesConfig } from '../../src/contracts/capabilities.js'

import type { ToolExecutionUpdate, ToolHostContext } from '../../src/ports/tool-host.js'

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

function fixedNow() {
  return '2026-06-10T00:00:00.000Z'
}

function outputFor(item: unknown): {
  files: Array<{ relativePath: string; absolutePath: string; mimeType: string; byteSize: number }>
  model: string
  voice?: string
  format?: string
  duration?: number
  resolution?: string
} {
  expect(item).toMatchObject({ kind: 'tool_result', isError: false })
  const output = (item as { output: unknown }).output
  expect(output).toMatchObject({ files: expect.any(Array) })
  return output as {
    files: Array<{ relativePath: string; absolutePath: string; mimeType: string; byteSize: number }>
    model: string
    voice?: string
    format?: string
    duration?: number
    resolution?: string
  }
}

async function expectFile(
  output: { files: Array<{ relativePath: string; absolutePath: string; mimeType: string; byteSize: number }> },
  prefix: string,
  mimeType: string,
  contents: string
) {
  expect(output.files).toHaveLength(1)
  const file = output.files[0]
  expect(file.relativePath.startsWith(prefix)).toBe(true)
  expect(file.mimeType).toBe(mimeType)
  expect(file.byteSize).toBe(Buffer.byteLength(contents))
  expect(existsSync(file.absolutePath)).toBe(true)
  await expect(readFile(file.absolutePath, 'utf8')).resolves.toBe(contents)
}

describe('Media gen tool provider', () => {

beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-mediagen-'))
  })

afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(workspace, { recursive: true, force: true })
  })

it('surfaces Seedance task failure details and obeys its timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'seedance-failed' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response(JSON.stringify({
        id: 'seedance-failed',
        status: 'failed',
        error: { code: 'ContentRisk', message: 'prompt rejected' }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const client = new VolcengineArkVideoClient(
      'https://ark.cn-beijing.volces.com/api/v3',
      'ark-key'
    )
    const baseRequest = {
      prompt: 'test',
      model: 'doubao-seedance-2-0-260128',
      duration: 6,
      resolution: '720P',
      pollIntervalMs: 1,
      signal: new AbortController().signal
    }

    await expect(client.generate({
      ...baseRequest,
      timeoutMs: 1_000
    })).rejects.toThrow(
      /Volcano Ark video generation failed \(task_id=seedance-failed\): prompt rejected/
    )

    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'seedance-running' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response(JSON.stringify({
        id: 'seedance-running',
        status: 'running'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const timeoutClient = new VolcengineArkVideoClient(
      'https://ark.cn-beijing.volces.com/api/v3',
      'ark-key'
    )
    await expect(timeoutClient.generate({
      ...baseRequest,
      timeoutMs: 20
    })).rejects.toThrow(
      /timed out after 20ms \(last status: running\)/
    )
  })

it('rejects a successful Seedance task without an output URL and stops on caller abort', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'seedance-no-url' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response(JSON.stringify({
        id: 'seedance-no-url',
        status: 'succeeded',
        content: {}
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const client = new VolcengineArkVideoClient(
      'https://ark.cn-beijing.volces.com/api/v3',
      'ark-key'
    )
    const request = {
      prompt: 'test',
      model: 'doubao-seedance-2-0-260128',
      duration: 6,
      resolution: '720P',
      timeoutMs: 1_000,
      pollIntervalMs: 1
    }

    await expect(client.generate({
      ...request,
      signal: new AbortController().signal
    })).rejects.toThrow(
      /finished without content\.video_url/
    )

    let fetchCount = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCount += 1
      return new Response(JSON.stringify({ id: 'seedance-aborted' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const controller = new AbortController()
    const abortClient = new VolcengineArkVideoClient(
      'https://ark.cn-beijing.volces.com/api/v3',
      'ark-key'
    )
    const generation = abortClient.generate({
      ...request,
      pollIntervalMs: 1_000,
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 5)

    await expect(generation).rejects.toThrow(/Aborted/)
    expect(fetchCount).toBe(1)
  })

it('polls Grok Imagine video generation and downloads the finished file', async () => {
    expect(createVideoGenClient({
      protocol: 'grok-imagine-video',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: 'grok-access'
    }).id).toBe('grok-imagine-video')

    const requests: Array<{
      url: string
      method?: string
      headers: Headers
      body?: Record<string, unknown>
    }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      requests.push({
        url: href,
        method: init?.method,
        headers: new Headers(init?.headers),
        ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {})
      })
      if (href.endsWith('/videos/generations')) {
        return new Response(JSON.stringify({ request_id: 'video-request-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (href.endsWith('/videos/video-request-1')) {
        return new Response(JSON.stringify({
          status: 'done',
          video: { url: 'https://cdn.example.test/grok-video.mp4' }
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      expect(href).toBe('https://cdn.example.test/grok-video.mp4')
      return new Response(new Uint8Array(Buffer.from('grok-video')), {
        status: 200,
        headers: { 'content-type': 'video/mp4' }
      })
    }))
    const updates: ToolExecutionUpdate[] = []
    const client = new GrokImagineVideoClient('https://api.x.ai/v1', 'grok-access', {
      'x-grok-client-version': '0.2.112',
      'x-grok-client-identifier': 'grok-shell'
    })

    const media = await client.generate({
      prompt: 'Animate the clouds',
      model: 'grok-imagine-video-1.5-preview',
      duration: 6,
      resolution: '720P',
      firstFrameImage: { mimeType: 'image/png', data: Buffer.from('source-image') },
      timeoutMs: 1_000,
      pollIntervalMs: 1,
      signal: new AbortController().signal,
      onUpdate: (update) => {
        updates.push(update)
      }
    })

    expect(media.data.toString('utf8')).toBe('grok-video')
    expect(requests[0].url).toBe('https://api.x.ai/v1/videos/generations')
    expect(requests[0].headers.get('authorization')).toBe('Bearer grok-access')
    expect(requests[0].headers.get('x-grok-client-identifier')).toBe('grok-shell')
    expect(requests[0].body).toEqual({
      model: 'grok-imagine-video-1.5-preview',
      prompt: 'Animate the clouds',
      duration: 6,
      resolution: '720p',
      image: { url: `data:image/png;base64,${Buffer.from('source-image').toString('base64')}` },
      reference_images: []
    })
    expect(requests[1].url).toBe('https://api.x.ai/v1/videos/video-request-1')
    expect(requests[2].headers.get('authorization')).toBeNull()
    expect(updates).toEqual([
      { output: { status: 'submitted', taskId: 'video-request-1', provider: 'grok-imagine-video' } },
      { output: { status: 'done', taskId: 'video-request-1', provider: 'grok-imagine-video' } }
    ])
  })

})
