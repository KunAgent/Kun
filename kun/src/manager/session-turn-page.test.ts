import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { makeUserItem } from '../domain/item.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { ManagerRemoteSessionStore } from './remote-data-stores.js'
import type { ServiceManagerConnection } from './manager-client.js'

const bridge = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('./remote-data-store-request.js', () => ({ callManagerStore: bridge.call }))
const roots: string[] = []
afterEach(async () => { bridge.call.mockReset(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('preserves exact turn and item content across Manager request and remote response validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-manager-turn-'))
  roots.push(root)
  const shared = await ManagerSharedDataStore.create(root)
  const threadId = 'thread', text = 'large message '.repeat(1500)
  for (const id of ['old', 'new']) {
    await shared.executeSession('appendItem', { threadId, item: makeUserItem({ id, threadId, turnId: id, text }) })
  }
  bridge.call.mockImplementation(async (_manager, entity, operation, value) => {
    expect(entity).toBe('session')
    return shared.executeSession(operation, value)
  })
  const remote = new ManagerRemoteSessionStore({} as ServiceManagerConnection)
  const page = await remote.loadItemPage(threadId, { turnId: 'old', maxItems: 1, maxBytes: 4096 })
  expect(page.items.map((item) => item.id)).toEqual(['old'])
  const content = await remote.loadItemPage(threadId, {
    turnId: 'old', itemId: 'old', contentOffset: 1024, maxItems: 1, maxBytes: 4096
  })
  expect(content.content).toMatchObject({ itemId: 'old', field: 'text', offset: 1024, nextOffset: 5120, text: text.slice(1024, 5120) })
  await expect(remote.loadItemPage(threadId, { itemId: 'old', maxItems: 1, maxBytes: 4096 })).rejects.toThrow()
  await expect(remote.loadItemPage(threadId, { turnId: 'old', itemId: 'old', contentOffset: -1, maxItems: 1, maxBytes: 4096 })).rejects.toThrow()
  await shared.close()
})
