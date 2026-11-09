import { describe, expect, it, vi } from 'vitest'
import { PET_IPC } from '../../shared/pets'
import { normalizeSavedPetEnsemble, defaultPetEnsemble } from '../../shared/pets-ensemble'
import { defaultPetVisits, parsePetVisitPreferences } from '../../shared/pets-visits'
import { petIpcHandlers, type PetIpcApi } from './pet-ipc'

describe('visit preferences and requests', () => {
  it('starts automatically without configuring friends and disables legacy persistent parties', () => {
    expect(defaultPetVisits()).toEqual({ enabled: true, frequency: 'balanced' })
    expect(normalizeSavedPetEnsemble({ ...defaultPetEnsemble(), enabled: true, autoplay: true, paused: true }))
      .toMatchObject({ enabled: false, autoplay: false, paused: false })
    for (const value of [null, {}, { enabled: 'yes', frequency: 'quiet' }, { enabled: true, frequency: { toString: 'quiet' } }]) {
      expect(parsePetVisitPreferences(value)).toBeNull()
    }
  })

  it('accepts one-off visits from owned windows and rejects invalid scenes or foreign/subframe callers', async () => {
    const api = { requestPetVisit: vi.fn(async () => undefined), dismissPetVisit: vi.fn(async () => undefined),
      setPetVisitPreferences: vi.fn(async () => ({})), acknowledgeVisitRequest: vi.fn(),
      allows: (event: { isMainFrame: boolean; senderKind: string }, kinds: string[]) => event.isMainFrame && kinds.includes(event.senderKind) }
    const handlers = petIpcHandlers(api as unknown as PetIpcApi)
    const main = { senderId: 1, isMainFrame: true, senderKind: 'main' as const }
    await handlers[PET_IPC.requestPetVisit](main)
    await handlers[PET_IPC.requestPetVisit]({ ...main, senderKind: 'overlay' }, 'tea')
    expect(api.requestPetVisit.mock.calls).toEqual([[undefined], ['tea']])
    await expect(handlers[PET_IPC.requestPetVisit](main, 'execute')).rejects.toThrow('invalid visit scene')
    await expect(handlers[PET_IPC.requestPetVisit]({ ...main, isMainFrame: false })).rejects.toThrow('limited')
    await expect(handlers[PET_IPC.dismissPetVisit]({ ...main, senderKind: 'other' })).rejects.toThrow('limited')
    expect(() => handlers[PET_IPC.acknowledgeVisitRequest](main, 'id')).toThrow('pet overlay')
    handlers[PET_IPC.acknowledgeVisitRequest]({ ...main, senderKind: 'overlay' }, 'id')
    expect(api.acknowledgeVisitRequest).toHaveBeenCalledWith('id')
  })
})
