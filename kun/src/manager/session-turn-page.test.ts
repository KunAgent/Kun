import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { makeToolCallItem, makeToolResultItem, makeUserItem } from '../domain/item.js'
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

it('preserves exact call scope through Manager and rejects an unbound call filter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-manager-call-'))
  roots.push(root)
  const shared = await ManagerSharedDataStore.create(root)
  const threadId = 'thread'
  try {
    for (const turnId of ['old', 'new']) {
      await shared.executeSession('appendItem', { threadId, item: makeToolCallItem({ id: turnId + '-call', threadId, turnId, callId: 'same-call', toolName: 'bash', arguments: { command: turnId } }) })
      await shared.executeSession('appendItem', { threadId, item: makeToolResultItem({ id: turnId + '-result', threadId, turnId, callId: 'same-call', toolName: 'bash', output: turnId }) })
    }
    bridge.call.mockImplementation(async (_manager, entity, operation, value) => {
      expect(entity).toBe('session')
      return shared.executeSession(operation, value)
    })
    const remote = new ManagerRemoteSessionStore({} as ServiceManagerConnection)
    const result = await remote.loadItemPage(threadId, { turnId: 'old', callId: 'same-call', maxItems: 4, maxBytes: 4096 })
    expect(result.items.map((item) => item.id)).toEqual(['old-call', 'old-result'])
    await expect(remote.loadItemPage(threadId, { callId: 'same-call', maxItems: 4, maxBytes: 4096 })).rejects.toThrow('turnId')
    expect((await remote.loadItemPage(threadId, { turnId: 'old', callId: 'wrong-call', itemId: 'old-result', maxItems: 1, maxBytes: 4096 })).content).toBeUndefined()
  } finally { await shared.close() }
})
