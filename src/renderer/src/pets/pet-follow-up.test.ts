import { describe, expect, it, vi } from 'vitest'
import type { ChatState } from '../store/chat-store-types'
import { deliverPetFollowUp } from './pet-follow-up'

function fixture() {
  const state: { activeThreadId: string | null } = { activeThreadId: 'A' }
  const sendMessage = vi.fn<ChatState['sendMessage']>(async () => true)
  const input = {
    threadId: 'A', requestId: 'original-request', prompt: ' Continue ',
    knownThreadIds: new Set(['A', 'B']),
    selectThread: vi.fn(async (_threadId: string) => undefined),
    getActiveThreadId: () => state.activeThreadId,
    sendMessage
  }
  return { state, input, sendMessage }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('pet follow-up submission identity', () => {
  it('sends the trimmed prompt to the original thread with the original request identity', async () => {
    const { state, input, sendMessage } = fixture()
    await expect(deliverPetFollowUp(input)).resolves.toEqual({ ok: true })
    expect(input.selectThread).toHaveBeenCalledExactlyOnceWith('A')
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith('Continue', 'agent', {
      expectedThreadId: 'A', clientRequestId: 'original-request', submissionGuard: expect.any(Function)
    })
    const guard = sendMessage.mock.calls[0][2]!.submissionGuard!
    expect(guard()).toBe(true)
    state.activeThreadId = 'B'
    expect(guard()).toBe(false)
    state.activeThreadId = null
    expect(guard()).toBe(false)
  })

  it('rejects when the user switches to B while selection of A is settling', async () => {
    const { state, input, sendMessage } = fixture()
    const selection = deferred()
    input.selectThread.mockImplementation(async () => { await selection.promise })
    const sending = deliverPetFollowUp(input)
    state.activeThreadId = 'B'
    selection.resolve()
    await expect(sending).resolves.toMatchObject({ ok: false, code: 'conflict' })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBe('B')
  })

  it('keeps the submission fence live across asynchronous send preparation', async () => {
    const { state, input, sendMessage } = fixture()
    const preparation = deferred()
    const enteredSend = deferred()
    const delivered: string[] = []
    sendMessage.mockImplementation(async (_prompt, _mode, overrides) => {
      enteredSend.resolve()
      await preparation.promise
      if (!overrides?.submissionGuard?.() || overrides.expectedThreadId !== state.activeThreadId) return false
      delivered.push(state.activeThreadId!)
      return true
    })
    const sending = deliverPetFollowUp(input)
    await enteredSend.promise
    state.activeThreadId = 'B'
    preparation.resolve()
    await expect(sending).resolves.toMatchObject({ ok: false, code: 'conflict' })
    expect(delivered).toEqual([])
    expect(sendMessage.mock.calls[0][2]?.expectedThreadId).toBe('A')
  })

  it('reuses the request identity on retry after a rejected send', async () => {
    const { input, sendMessage } = fixture()
    sendMessage.mockResolvedValueOnce(false)
    await expect(deliverPetFollowUp(input)).resolves.toMatchObject({ ok: false, code: 'rejected' })
    await expect(deliverPetFollowUp(input)).resolves.toEqual({ ok: true })
    expect(sendMessage.mock.calls.map((call) => call[2]?.clientRequestId)).toEqual([
      'original-request', 'original-request'
    ])
  })

  it.each(['', '   ', 'x'.repeat(16_001)])('rejects an invalid prompt before selecting or sending', async (prompt) => {
    const { input, sendMessage } = fixture()
    await expect(deliverPetFollowUp({ ...input, prompt })).resolves.toMatchObject({ ok: false, code: 'rejected' })
    expect(input.selectThread).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('accepts the maximum prompt length', async () => {
    const { input } = fixture()
    await expect(deliverPetFollowUp({ ...input, prompt: 'x'.repeat(16_000) })).resolves.toEqual({ ok: true })
  })

  it('rejects an unknown target before selecting or sending', async () => {
    const { input, sendMessage } = fixture()
    await expect(deliverPetFollowUp({ ...input, threadId: 'missing' })).resolves.toMatchObject({ ok: false })
    expect(input.selectThread).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
