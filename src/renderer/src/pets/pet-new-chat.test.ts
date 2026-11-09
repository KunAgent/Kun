import { describe, expect, it, vi } from 'vitest'
import { deliverPetChat } from './pet-new-chat'

function fixture() {
  const state = {
    route: 'design' as const, activeThreadId: 'existing', setRoute: vi.fn(),
    createThread: vi.fn(async () => { state.activeThreadId = 'new-conversation'; return 'new-conversation' as string | null }),
    sendMessage: vi.fn(async (_text: string, _mode?: string, _overrides?: { submissionGuard?: () => boolean }) => true)
  }
  return state
}

describe('new conversation from a desktop pet', () => {
  it('creates a separate normal conversation and guards the send against navigation', async () => {
    const state = fixture()
    await expect(deliverPetChat(' Hello ', 'request', () => state)).resolves.toEqual({ ok: true })
    expect(state.createThread).toHaveBeenCalledWith({ forceNew: true, conversation: true, agentSurface: 'code' })
    expect(state.setRoute).toHaveBeenCalledWith('chat')
    expect(state.sendMessage).toHaveBeenCalledWith('Hello', 'agent', expect.objectContaining({
      expectedThreadId: 'new-conversation', agentSurface: 'code', clientRequestId: 'request'
    }))
    const guard = state.sendMessage.mock.calls[0][2]?.submissionGuard
    expect(guard?.()).toBe(true)
    state.activeThreadId = 'another'
    expect(guard?.()).toBe(false)
  })

  it('never sends a draft into an unrelated conversation after navigation', async () => {
    const state = fixture()
    state.createThread.mockImplementation(async () => 'created-in-background')
    await expect(deliverPetChat('Hello', 'request', () => state)).resolves.toMatchObject({ ok: false, code: 'conflict' })
    expect(state.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects blank input and returns errors without losing the caller draft', async () => {
    const state = fixture()
    await expect(deliverPetChat('  ', 'request', () => state)).resolves.toMatchObject({ ok: false })
    expect(state.createThread).not.toHaveBeenCalled()
    state.sendMessage.mockRejectedValue(new Error('Offline'))
    await expect(deliverPetChat('Hello', 'request', () => state)).resolves.toMatchObject({ ok: false, message: 'Offline' })
  })
})
