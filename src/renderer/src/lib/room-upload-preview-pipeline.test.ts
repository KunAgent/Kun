import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { FileAttachmentStore } from '../../../../kun/src/attachments/attachment-store'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../../../../kun/src/contracts/capabilities'
import { resolveRoomContent } from '../../../../kun/src/rooms/room-content-service'
import { roomUploadedPreviewImage, uploadedWebpDimensions } from '../../../../kun/src/rooms/room-uploaded-preview'
import type { ServerRuntime } from '../../../../kun/src/server/routes/server-runtime'
import type { Room } from '../../../../kun/src/contracts/rooms'
import { uploadRuntimeImageAttachment } from '../../../main/services/runtime-image-attachment-service'
import { uploadRuntimeAttachment } from './runtime-attachment'
import { KunRuntimeProvider } from '../agent/kun-runtime'

const roots: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('carries the real desktop upload-time WebP preview into Rooms without fetching original history bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-real-upload-preview-'))
  roots.push(root)
  const config = DEFAULT_KUN_CAPABILITIES_CONFIG.attachments
  expect(config.textFallbackPreferredMimeType).toBe('image/webp')
  const store = new FileAttachmentStore({ rootDir: root, config })
  const runtimeRequest = vi.fn(async (path: string, _method?: string, body?: string) => {
    if (path === '/v1/runtime/info') return { ok: true, status: 200, body: JSON.stringify({ capabilities: { attachments: config } }) }
    expect(path).toBe('/v1/attachments')
    const { dataBase64, ...input } = JSON.parse(body!)
    const attachment = await store.create({ ...input, data: Buffer.from(dataBase64, 'base64') })
    return { ok: true, status: 201, body: JSON.stringify({ attachment }) }
  })
  const bridge = vi.fn((request: Parameters<typeof uploadRuntimeImageAttachment>[0]) => uploadRuntimeImageAttachment(request, { runtimeRequest }))
  vi.stubGlobal('window', { kunGui: { uploadRuntimeImageAttachment: bridge } })
  const source = await sharp({ create: { width: 640, height: 480, channels: 4, background: '#336699aa' } }).png().toBuffer()
  const uploaded = await uploadRuntimeAttachment({ name: 'room-image.png', mimeType: 'image/png', dataBase64: source.toString('base64') }, new KunRuntimeProvider())
  expect(bridge).toHaveBeenCalledTimes(1)
  const metadata = (await store.get(uploaded.id))!
  expect(metadata.textFallback?.mimeType).toBe('image/webp')
  const originalReads = vi.spyOn(store, 'resolveContent')
  const room = { id: 'room', repositories: [] } as unknown as Room
  const runtime = { attachmentStore: store, rooms: { deps: { store: { get: async () => ({ roomId: room.id, value: { attachmentIds: [uploaded.id] } }) } } } } as unknown as ServerRuntime
  const reference = { kind: 'attachment', attachmentId: uploaded.id } as const
  const summary = await resolveRoomContent(runtime, room, reference, 'summary', 'message')
  expect(summary.state).toBe('available')
  const thumbnail = await resolveRoomContent(runtime, room, reference, 'thumbnail', 'message')
  expect(thumbnail.state).toBe('available')
  expect(thumbnail.thumbnail).toMatchObject({ mimeType: 'image/webp', width: 640, height: 480 })
  expect(uploadedWebpDimensions(Buffer.from(thumbnail.thumbnail!.dataBase64, 'base64'))).toEqual({ width: 640, height: 480 })
  expect(originalReads).not.toHaveBeenCalled()
  const full = await resolveRoomContent(runtime, room, reference, 'preview', 'message')
  expect(full.preview?.type).toBe('image')
  expect(originalReads).toHaveBeenCalledTimes(1)
})

it('validates lossless WebP dimensions and refuses oversized or forged display headers', async () => {
  const lossless = await sharp({ create: { width: 64, height: 42, channels: 4, background: '#ffeeaa88' } }).webp({ lossless: true }).toBuffer()
  expect(uploadedWebpDimensions(lossless)).toEqual({ width: 64, height: 42 })
  await expect(roomUploadedPreviewImage({ mimeType: 'image/jpeg', dataBase64: lossless.toString('base64'), byteSize: lossless.length }))
    .rejects.toThrow('invalid display preview')
  expect(() => uploadedWebpDimensions(Buffer.from('<svg><script>alert(1)</script></svg>'))).toThrow()
  const large = await sharp({ create: { width: 1281, height: 8, channels: 3, background: '#336699' } }).webp().toBuffer()
  expect(() => uploadedWebpDimensions(large)).toThrow('invalid display preview')
})
