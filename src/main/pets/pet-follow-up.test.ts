import { describe, expect, it } from 'vitest'
import { PET_IPC } from '../../shared/pets'
import { askPetFollowUp, parseFollowUpResult, settlePetFollowUp } from './pet-follow-up'

describe('pet follow-up delivery', () => {
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
