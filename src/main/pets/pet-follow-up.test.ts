import { describe, expect, it, vi } from 'vitest'
import { PET_IPC } from '../../shared/pets'
import { askPetChat, askPetFollowUp, parseFollowUpResult, settlePetFollowUp } from './pet-follow-up'

describe('pet follow-up delivery', () => {
  it('requests a fresh conversation and waits for workbench acceptance', async () => {
    const send = vi.fn()
    const result = askPetChat({ webContents: { send } }, 'Hello')
    const [channel, payload] = send.mock.calls[0]
    expect(channel).toBe(PET_IPC.chatRequested)
    expect(payload).toMatchObject({ prompt: 'Hello', requestId: expect.any(String) })
    expect(payload.threadId).toBeUndefined()
    settlePetFollowUp(payload.requestId, { ok: true })
    await expect(result).resolves.toEqual({ ok: true })
  })
  it('resolves when the workbench reports the send result', async () => {
    const sent: unknown[] = []
    const pending = askPetFollowUp({
      webContents: { send: (channel, payload) => sent.push({ channel, payload }) }
    }, { threadId: 'thr', prompt: '继续' })
    const message = sent[0] as { channel: string; payload: { requestId: string } }
    expect(message.channel).toBe(PET_IPC.followUpRequested)
    settlePetFollowUp(message.payload.requestId, { ok: true })
    await expect(pending).resolves.toEqual({ ok: true })
    expect(parseFollowUpResult({ requestId: 'id', result: { ok: false, code: 'rejected', message: '发送失败，请按回车重试' } })?.result.ok).toBe(false)
    expect(parseFollowUpResult({ requestId: 'id', result: { ok: false, code: 'other', message: 'x' } })).toBeNull()
  })
})
