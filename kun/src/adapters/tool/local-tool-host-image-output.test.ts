import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Jimp } from 'jimp'
import { describe, expect, it, vi } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { TurnItem } from '../../contracts/items.js'
import { InMemoryArtifactStore } from '../../artifacts/artifact-store.js'
import { projectCompatMessages } from '../model/compat-message-projector.js'
import { capToolResultImages, extractToolResultImages, prepareBrowserUseToolResultForPersistence } from '../../loop/tool-result-image.js'
import { LocalToolHost } from './local-tool-host.js'
import { createReadLocalTool } from './builtin-read-tool.js'
import { DEFAULT_IMAGE_MAX_BASE64_BYTES } from './builtin-tool-types.js'
import { offloadLargeToolOutput } from './local-tool-host-runtime.js'

function context(workspace = '/tmp'): ToolHostContext {
  return {
    workspace, threadId: 'thread_image', turnId: 'turn_image', approvalPolicy: 'auto',
    sandboxMode: 'workspace-write', abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow', artifactStore: new InMemoryArtifactStore()
  }
}

function project(item: TurnItem, supportsImages = true) {
  const call: TurnItem = {
    id: 'call_item', role: 'assistant', status: 'completed', threadId: item.threadId, turnId: item.turnId, createdAt: item.createdAt,
    kind: 'tool_call', toolKind: 'tool_call', toolName: 'read', callId: item.kind === 'tool_result' ? item.callId : 'call_image', arguments: {}
  }
  return projectCompatMessages({
    threadId: item.threadId, turnId: item.turnId, model: 'vision', systemPrompt: '',
    prefix: [], history: [call, item], tools: [], abortSignal: new AbortController().signal
  }, { thinkingMode: false, supportsImages })
}

async function png(size: number): Promise<Buffer> {
  const image = new Jimp({ width: size, height: size })
  let seed = 42
  for (let i = 0; i < image.bitmap.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      image.bitmap.data[i + channel] = seed >>> 24
    }
    image.bitmap.data[i + 3] = 255
  }
  return image.getBuffer('image/png')
}

const imageOutput = (data = Buffer.alloc(110 * 1024, 42).toString('base64')) => ({
  kind: 'image', mime_type: 'image/png', data_base64: data
})

describe('tool-output artifact guard preserves bounded vision payloads', () => {
  it.each([160, 200])('reads a valid %i px PNG through the host into model image parts', async (size) => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-image-output-'))
    try {
      const bytes = await png(size)
      expect((await Jimp.read(bytes)).width).toBe(size)
      await writeFile(join(workspace, 'noise.png'), bytes)
      const ctx = context(workspace)
      const store = vi.spyOn(ctx.artifactStore!, 'put')
      const result = await new LocalToolHost({ tools: [createReadLocalTool()] }).execute(
        { toolName: 'read', callId: 'call_image', arguments: { path: 'noise.png' } }, ctx
      )
      expect(result.item.kind).toBe('tool_result')
      if (result.item.kind !== 'tool_result') throw new Error('expected result')
      const rawBytes = Buffer.byteLength(JSON.stringify(imageOutput(bytes.toString('base64'))))
      expect(rawBytes > 128 * 1024).toBe(size === 200)
      expect(result.item.isError).toBe(false)
      expect(extractToolResultImages(result.item.output)).toEqual([
        { mimeType: 'image/png', dataBase64: bytes.toString('base64'), width: size, height: size }
      ])
      expect(store).not.toHaveBeenCalled()
      expect(JSON.stringify(project(result.item)).includes(`data:image/png;base64,${bytes.toString('base64')}`)).toBe(true)
      expect(JSON.stringify(project(result.item, false))).not.toContain(bytes.toString('base64'))
      const evicted = capToolResultImages([result.item], 0)[0]
      expect(JSON.stringify(project(evicted))).not.toContain(bytes.toString('base64'))
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  it.each(['image', 'computer_screenshot', 'browser_screenshot'])('offloads large text independently of %s images', async (kind) => {
    const ctx = context()
    const original = { ...imageOutput(), kind, text: 'x'.repeat(140 * 1024) }
    const output = await offloadLargeToolOutput(original, 'read', ctx) as Record<string, unknown>
    expect(output).toMatchObject({ kind, artifactId: expect.any(String), truncated: true })
    expect(extractToolResultImages(output)).toHaveLength(1)
    const stored = await ctx.artifactStore!.get(String(output.artifactId))
    expect(stored).toContain(original.text)
    expect(stored).not.toContain(original.data_base64)
    expect(output.preview).not.toContain(original.data_base64.slice(0, 80))
    expect(original.data_base64).toBeTruthy()
  })

  it('keeps the ordinary text threshold and artifact retrieval unchanged', async () => {
    const ctx = context()
    const exact = 'x'.repeat(128 * 1024)
    expect(await offloadLargeToolOutput(exact, 'echo', ctx)).toBe(exact)
    const larger = exact + 'x'
    const output = await offloadLargeToolOutput(larger, 'echo', ctx) as Record<string, unknown>
    expect(output).toMatchObject({ artifactId: expect.any(String), truncated: true })
    expect(await ctx.artifactStore!.get(String(output.artifactId))).toBe(larger)
  })

  it('does not duplicate a top-level image already in images or bypass bounds through MIME metadata', async () => {
    const original = imageOutput()
    const output = await offloadLargeToolOutput({ ...original, images: [original] }, 'read', context())
    expect(extractToolResultImages(output)).toHaveLength(1)
    const unsupported = await offloadLargeToolOutput({ ...original, mime_type: 'image/' + 'x'.repeat(140 * 1024) }, 'read', context())
    expect(extractToolResultImages(unsupported)).toHaveLength(0)
    expect(unsupported).toMatchObject({ artifactId: expect.any(String), images_omitted: 1 })
  })

  it('bounds aggregate bytes and count, and explicitly reports omissions', async () => {
    const data = 'A'.repeat(DEFAULT_IMAGE_MAX_BASE64_BYTES / 2)
    const output = await offloadLargeToolOutput({ kind: 'computer_screenshot', images: [
      { mime_type: 'image/png', data_base64: data },
      { mime_type: 'image/png', data_base64: data },
      { mime_type: 'image/png', data_base64: data }
    ] }, 'computer_use', context())
    expect(extractToolResultImages(output)).toHaveLength(2)
    expect(output).toMatchObject({ images_omitted: 1, image_note: expect.stringContaining('limit') })
    const many = await offloadLargeToolOutput({ kind: 'computer_screenshot', images:
      Array.from({ length: 9 }, () => ({ mime_type: 'image/png', data_base64: 'AAAA' }))
    }, 'computer_use', context())
    expect(extractToolResultImages(many)).toHaveLength(8)
    expect(many).toMatchObject({ images_omitted: 1 })
  })

  it('does not exempt oversized individual images, even without an artifact store', async () => {
    const ctx = { ...context(), artifactStore: undefined }
    const output = await offloadLargeToolOutput(imageOutput('A'.repeat(DEFAULT_IMAGE_MAX_BASE64_BYTES + 4)), 'read', ctx)
    expect(extractToolResultImages(output)).toHaveLength(0)
    expect(output).toMatchObject({ images_omitted: 1 })
  })

  it('keeps bounded images on artifact failure and leaves unrelated base64 outputs on the text path', async () => {
    const ctx = context()
    vi.spyOn(ctx.artifactStore!, 'put').mockRejectedValue(new Error('disk full'))
    expect(extractToolResultImages(await offloadLargeToolOutput({ ...imageOutput(), text: 'x'.repeat(140 * 1024) }, 'read', ctx))).toHaveLength(1)
    const output = await offloadLargeToolOutput({ ...imageOutput(), kind: 'generated_image' }, 'generate_image', context())
    expect(output).toMatchObject({ artifactId: expect.any(String) })
    expect(extractToolResultImages(output)).toHaveLength(0)
  })

  it('replays the bounded vision result from the operation journal without executing again', async () => {
    const execute = vi.fn(async () => ({ output: imageOutput() }))
    const host = new LocalToolHost({ tools: [LocalToolHost.defineTool({
      name: 'read', description: 'image fixture', inputSchema: { type: 'object' }, policy: 'auto', execute
    })] })
    const ctx = context()
    const call = { callId: 'call_image', toolName: 'read', arguments: {} }
    const first = await host.execute(call, ctx)
    const replay = await host.execute(call, ctx)
    expect(execute).toHaveBeenCalledTimes(1)
    if (first.item.kind !== 'tool_result' || replay.item.kind !== 'tool_result') throw new Error('expected results')
    expect(replay.item.output).toEqual(first.item.output)
    expect(JSON.stringify(project(replay.item)).includes(imageOutput().data_base64)).toBe(true)
  })

  it('normalizes top-level browser bytes into the privacy-redacted images array', async () => {
    const output = await offloadLargeToolOutput({ ...imageOutput(), kind: 'browser_screenshot' }, 'browser_use', context())
    const item: TurnItem = {
      id: 'browser_result', role: 'tool', status: 'completed', threadId: 'thread_image', turnId: 'turn_image', createdAt: '',
      kind: 'tool_result', toolKind: 'tool_call', toolName: 'browser_use', callId: 'browser', isError: false, output
    }
    const persisted = prepareBrowserUseToolResultForPersistence(item)
    expect(JSON.stringify(persisted)).not.toContain(imageOutput().data_base64)
  })
})
