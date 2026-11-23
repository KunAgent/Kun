import { expect, it, vi } from 'vitest'
import { continueAcpPendingTools } from './acp-pending-tool-continuation.js'

function fixture() {
  let pending = [{ id: 'command-1', title: 'npm run typecheck' }]
  const sendPrompt = vi.fn(async (_text: string): Promise<unknown> => {
    pending = []
    return { stopReason: 'end_turn', usage: { inputTokens: 20 } }
  })
  const input = { enabled: true, signal: new AbortController().signal, deadlineMs: Date.now() + 5_000,
    pendingTools: () => pending, sendPrompt, onUnsettledResult: vi.fn(async (_result: unknown) => {}), settleMs: 0 }
  const initial = { stopReason: 'end_turn', usage: { inputTokens: 10 } }
  return { input, initial, finishTools: () => { pending = [] } }
}

it('continues the same native session to inspect unfinished work and accounts for the first response once', async () => {
  const f = fixture()
  const result = await continueAcpPendingTools(f.initial, f.input)
  expect(result).toEqual({ stopReason: 'end_turn', usage: { inputTokens: 20 } })
  expect(f.input.onUnsettledResult).toHaveBeenCalledExactlyOnceWith(f.initial)
  expect(f.input.sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Do not restart those commands'))
  expect(f.input.sendPrompt.mock.calls[0]?.[0]).toContain('command-1')
})

it('still inspects completed results when native tools settle just after the first prompt ends', async () => {
  const f = fixture()
  f.input.onUnsettledResult.mockImplementation(async () => { f.finishTools() })
  await continueAcpPendingTools(f.initial, f.input)
  expect(f.input.sendPrompt).toHaveBeenCalledOnce()
})

it.each(['cancelled', 'refusal', 'max_tokens', 'max_turn_requests'])('never overrides the native %s stop reason', async (stopReason) => {
  const f = fixture()
  const result = { stopReason }
  expect(await continueAcpPendingTools(result, f.input)).toBe(result)
  expect(f.input.sendPrompt).not.toHaveBeenCalled()
})

it('does no automatic work for engines that did not opt in or prompts without pending tools', async () => {
  const f = fixture()
  expect(await continueAcpPendingTools(f.initial, { ...f.input, enabled: false })).toBe(f.initial)
  f.finishTools()
  expect(await continueAcpPendingTools(f.initial, f.input)).toBe(f.initial)
  expect(f.input.onUnsettledResult).not.toHaveBeenCalled()
  expect(f.input.sendPrompt).not.toHaveBeenCalled()
})

it('bounds repeated premature completion and accounts for every response before failing as incomplete', async () => {
  const f = fixture()
  f.input.sendPrompt.mockResolvedValue(f.initial)
  await expect(continueAcpPendingTools(f.initial, f.input)).rejects.toMatchObject({ code: 'agent_error', message: expect.stringContaining('incomplete') })
  expect(f.input.sendPrompt).toHaveBeenCalledTimes(3)
  expect(f.input.onUnsettledResult).toHaveBeenCalledTimes(4)
})

it('keeps the original deadline instead of granting each continuation a new turn budget', async () => {
  const f = fixture()
  await expect(continueAcpPendingTools(f.initial, { ...f.input, deadlineMs: Date.now() - 1 }))
    .rejects.toMatchObject({ code: 'request_timeout' })
  expect(f.input.sendPrompt).not.toHaveBeenCalled()
})

it('stops immediately when the user cancels during settlement', async () => {
  const f = fixture()
  const controller = new AbortController()
  const pending = continueAcpPendingTools(f.initial, { ...f.input, signal: controller.signal, settleMs: 10_000 })
  await vi.waitFor(() => expect(f.input.onUnsettledResult).toHaveBeenCalledOnce())
  controller.abort(new Error('user cancelled'))
  await expect(pending).rejects.toThrow('user cancelled')
  expect(f.input.sendPrompt).not.toHaveBeenCalled()
})

it('returns already received usage for the caller to book when the user has just cancelled', async () => {
  const f = fixture()
  const controller = new AbortController()
  controller.abort()
  expect(await continueAcpPendingTools(f.initial, { ...f.input, signal: controller.signal })).toBe(f.initial)
  expect(f.input.sendPrompt).not.toHaveBeenCalled()
  expect(f.input.onUnsettledResult).not.toHaveBeenCalled()
})
