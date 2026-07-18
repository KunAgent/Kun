import { describe, expect, it, vi } from 'vitest'
import type { AttachmentContent, AttachmentStore } from '../attachments/attachment-store.js'
import {
  TurnAttachmentService,
  imageGenerationReferenceInstructions
} from './turn-attachment-service.js'

function imageAttachment(overrides: Partial<AttachmentContent> = {}): AttachmentContent {
  return {
    id: 'att_0123456789abcdef01234567',
    name: 'image.png',
    kind: 'image',
    mimeType: 'image/png',
    byteSize: 5,
    hash: 'hash',
    threadIds: ['thread_1'],
    workspaces: ['/workspace'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: Buffer.from('image'),
    ...overrides
  }
}

function store(content: AttachmentContent): AttachmentStore {
  return {
    resolveContent: vi.fn(async () => content),
    textFallbackPolicy: () => ({
      textFallbackMaxBase64Bytes: 1_024,
      textFallbackMaxImageDimension: 1_024,
      textFallbackPreferredMimeType: 'image/jpeg'
    })
  } as unknown as AttachmentStore
}

describe('TurnAttachmentService', () => {
  it('materializes image bytes only for image-capable models', async () => {
    const service = new TurnAttachmentService(store(imageAttachment()))
    const resolved = await service.resolveTurnAttachments({
      attachmentIds: ['att_0123456789abcdef01234567'],
      threadId: 'thread_1',
      workspace: '/workspace',
      modelCapabilities: {
        id: 'vision', inputModalities: ['image'], outputModalities: ['text'],
        supportsToolCalling: true, messageParts: ['image_url']
      }
    })

    expect(resolved).toEqual({
      imageAttachments: [expect.objectContaining({ dataBase64: Buffer.from('image').toString('base64') })],
      textFallbacks: [],
      documents: []
    })
  })

  it('uses a text fallback when a text-only model receives a new image attachment', async () => {
    const content = imageAttachment()
    const service = new TurnAttachmentService(store(content))

    const resolved = await service.resolveTurnAttachments({
      attachmentIds: [content.id],
      threadId: 'thread_1',
      workspace: '/workspace',
      modelCapabilities: {
        id: 'text', inputModalities: ['text'], outputModalities: ['text'],
        supportsToolCalling: true, messageParts: ['text']
      }
    })

    expect(resolved).toEqual({
      imageAttachments: [],
      textFallbacks: [expect.objectContaining({
        id: content.id,
        dataBase64: content.data.toString('base64'),
        wasCompressed: false
      })],
      documents: []
    })
  })

  it('uses the authorized attachment before a recorded file fallback', async () => {
    const content = imageAttachment({ data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
    const attachmentStore = store(content)
    const service = new TurnAttachmentService(attachmentStore)

    await expect(service.resolveGeneratedImageForForward({
      attachments: [{ id: content.id }],
      files: [{ absolutePath: '/does/not/exist.png' }]
    }, 'thread_1', '/workspace')).resolves.toMatchObject({
      mimeType: 'image/png', dataBase64: content.data.toString('base64')
    })
    expect(attachmentStore.resolveContent).toHaveBeenCalledWith(content.id, {
      threadId: 'thread_1', workspace: '/workspace'
    })
  })

  it('reads the live attachment store after runtime replacement', async () => {
    let currentStore: AttachmentStore | undefined
    const service = new TurnAttachmentService(() => currentStore)
    const first = imageAttachment({ data: Buffer.from('first') })
    const second = imageAttachment({ data: Buffer.from('second') })

    currentStore = store(first)
    await expect(service.resolveTurnAttachments({
      attachmentIds: [first.id],
      threadId: 'thread_1',
      workspace: '/workspace',
      modelCapabilities: {
        id: 'vision', inputModalities: ['image'], outputModalities: ['text'],
        supportsToolCalling: true, messageParts: ['image_url']
      }
    })).resolves.toMatchObject({
      imageAttachments: [{ dataBase64: first.data.toString('base64') }]
    })

    currentStore = store(second)
    await expect(service.resolveTurnAttachments({
      attachmentIds: [second.id],
      threadId: 'thread_1',
      workspace: '/workspace',
      modelCapabilities: {
        id: 'vision', inputModalities: ['image'], outputModalities: ['text'],
        supportsToolCalling: true, messageParts: ['image_url']
      }
    })).resolves.toMatchObject({
      imageAttachments: [{ dataBase64: second.data.toString('base64') }]
    })
  })

  it('only supplies workspace-local image references to generate_image', () => {
    expect(imageGenerationReferenceInstructions({
      imageAttachments: [{
        id: 'att', name: 'ref.png', mimeType: 'image/png', dataBase64: 'aW1hZ2U=', localFilePath: '/workspace/ref.png'
      }],
      textFallbacks: [],
      workspace: '/workspace',
      tools: [{ name: 'generate_image' }]
    })).toEqual([expect.stringContaining('ref.png: ref.png')])
  })
})
