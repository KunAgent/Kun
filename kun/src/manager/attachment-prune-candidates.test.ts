import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Jimp } from 'jimp'
import { afterEach, expect, it } from 'vitest'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import { recordRoomAvatarAsset } from '../rooms/room-avatar-service.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const config = DEFAULT_KUN_CAPABILITIES_CONFIG.attachments

it('lists exactly the attachments an unreferenced prune would delete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-attachment-prune-candidates-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const store = await ManagerSharedDataStore.create(root)
  cleanup.push(() => store.close())
  const call = (operation: Parameters<typeof store.executeAttachment>[0], value: unknown) =>
    store.executeAttachment(operation, { config, value })
  const text = async (name: string, leaseId?: string) => call('create', {
    name: `${name}.txt`, mimeType: 'text/plain', dataBase64: Buffer.from(name).toString('base64'), documentText: name,
    ...(leaseId ? { leaseId } : {})
  }) as Promise<AttachmentMetadata>

  const leased = await text('leased-upload', 'composer-lease')
  await text('plain-upload')
  const image = await new Jimp({ width: 128, height: 128, color: 0x3388ffff }).getBuffer('image/jpeg')
  const avatar = await call('create', { name: 'avatar.jpg', mimeType: 'image/jpeg',
    dataBase64: image.toString('base64'), leaseId: 'avatar-lease' }) as AttachmentMetadata
  await recordRoomAvatarAsset(store.roomStore, avatar)

  // Leases created after the cutoff still protect their uploads.
  expect(await call('expiredLeaseCandidates', { expiresBeforeIso: '2000-01-01T00:00:00.000Z' })).toEqual([])
  const future = '2999-01-01T00:00:00.000Z'
  expect(await call('expiredLeaseCandidates', { expiresBeforeIso: future })).toEqual([leased.id])
  expect(await call('pruneExpiredLeases', { referencedIds: [], expiresBeforeIso: future })).toMatchObject({ deleted: 1 })
  expect(await call('expiredLeaseCandidates', { expiresBeforeIso: future })).toEqual([])
  expect(await call('get', { id: avatar.id })).toMatchObject({ id: avatar.id })
})
