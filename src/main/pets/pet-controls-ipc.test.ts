import { describe, expect, it, vi } from 'vitest'
import { PET_IPC } from '../../shared/pets'
import { petIpcHandlers, type PetIpcApi } from './pet-ipc'

function fixture() {
  const api = {
    allows: (event: { senderKind: string; isMainFrame: boolean }, kinds: string[]) =>
      event.isMainFrame && kinds.includes(event.senderKind),
    startChat: vi.fn(async (_prompt: string) => ({ ok: true })),
    getVoiceInputAvailable: vi.fn(async () => true),
    setBubblesCollapsed: vi.fn(async (_collapsed: boolean) => undefined)
  }
  return { api, handlers: petIpcHandlers(api as unknown as PetIpcApi) }
}
const overlay = { senderId: 1, isMainFrame: true, senderKind: 'overlay' as const }

describe('pet quick controls IPC', () => {
  it('accepts trimmed chat drafts and rejects invalid payloads before creating a conversation', async () => {
    const { api, handlers } = fixture()
    await expect(handlers[PET_IPC.overlayChat](overlay, ' Hello ')).resolves.toEqual({ ok: true })
    expect(api.startChat).toHaveBeenCalledExactlyOnceWith('Hello')
    for (const prompt of ['', ' ', 'x'.repeat(16001), {}, null]) {
      await expect(handlers[PET_IPC.overlayChat](overlay, prompt)).resolves.toMatchObject({ ok: false })
    }
    expect(api.startChat).toHaveBeenCalledOnce()
  })

  it('limits quick chat, speech availability, and notification controls to the overlay main frame', async () => {
    const { handlers } = fixture()
    const other = { ...overlay, senderKind: 'other' as const }
    await expect(handlers[PET_IPC.overlayChat](other, 'Hello')).rejects.toThrow('pet overlay')
    expect(() => handlers[PET_IPC.overlayVoiceAvailable](other)).toThrow('pet overlay')
    await expect(handlers[PET_IPC.overlayBubblesCollapsed]({ ...overlay, isMainFrame: false }, true)).rejects.toThrow('pet overlay')
  })

  it('returns only the availability flag and persists a boolean notification preference', async () => {
    const { api, handlers } = fixture()
    await expect(handlers[PET_IPC.overlayVoiceAvailable](overlay)).resolves.toBe(true)
    await handlers[PET_IPC.overlayBubblesCollapsed](overlay, true)
    expect(api.setBubblesCollapsed).toHaveBeenCalledWith(true)
    await expect(handlers[PET_IPC.overlayBubblesCollapsed](overlay, 'true')).rejects.toThrow('invalid collapsed')
  })
})
