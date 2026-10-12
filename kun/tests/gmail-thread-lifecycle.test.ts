import { describe, expect, it, vi } from 'vitest'
import { bindGmailThreadDataProtection, resolveGmailThreadDataState } from '../src/gmail/thread-data-state.js'
import { makeAssistantTextItem } from '../src/domain/item.js'
import { bootstrapThread, makeHarness, makeSilentModel } from './loop-test-harness.js'

describe('Gmail copied-history lifecycle', () => {
  it('classifies real forks before their first history write and survives deleting an unrun intermediate fork', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    await h.turns.finishTurn({ threadId: h.threadId, turnId: h.turnId, status: 'completed' })
    const item = makeAssistantTextItem({ id: 'mail-derived-summary', threadId: h.threadId, turnId: h.turnId,
      text: 'A private email summary without a Gmail tool marker', status: 'completed' })
    await h.sessionStore.appendItem(h.threadId, item)
    const scopes = new Set([`thread:${h.threadId}`])
    const gmail = { hasGoogleData: async (id: string) => scopes.has(id),
      markGoogleData: async (id: string) => { scopes.add(id) },
      status: async () => ({ configured: true, connected: true, reconnectRequired: false, scopes: [], allowModelSharing: false }) }
    bindGmailThreadDataProtection(h.threadStore, gmail)
    const append = h.sessionStore.appendItem.bind(h.sessionStore)
    const writes = vi.spyOn(h.sessionStore, 'appendItem').mockImplementation(async (id, copied) => {
      expect(scopes.has(`thread:${id}`)).toBe(true)
      await append(id, copied)
    })
    const first = await h.threads.fork(h.threadId)
    const second = await h.threads.fork(first.id)
    expect(writes).toHaveBeenCalled()
    await h.threads.delete(h.threadId)
    await h.threads.delete(first.id)
    expect(await resolveGmailThreadDataState(h.threadStore, gmail, second.id))
      .toEqual({ sensitive: true, sharingAllowed: false })
  })
})
