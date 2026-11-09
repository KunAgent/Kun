import { describe, expect, it, vi } from 'vitest'
import { parsePetBottleDrop } from '../../shared/pets-bottle'
import { PET_IPC } from '../../shared/pets'
import { PetBottleGate } from './pet-bottle-gate'
import { petIpcHandlers, type PetIpcApi } from './pet-ipc'

describe('bottle drop presentation contract', () => {
  it('validates fresh bounded IDs, strips rewards and rejects replayed or malformed data', () => {
    const input = { dropIds: ['bottle-a'], occurredAt: 100000, rarity: 'legendary', item: 'private-reward' }
    expect(parsePetBottleDrop(input, 100001)).toEqual({ dropIds: ['bottle-a'], occurredAt: 100000 })
    for (const patch of [{ dropIds: [] }, { dropIds: ['a', 'a'] }, { dropIds: [''] }, { dropIds: ['x'.repeat(129)] },
      { dropIds: Array.from({ length: 21 }, (_, i) => String(i)) }, { occurredAt: NaN }, { occurredAt: 102000 }, { occurredAt: 80000 }]) {
      expect(parsePetBottleDrop({ ...input, ...patch }, 100000)).toBeNull()
    }
    const gate = new PetBottleGate()
    expect(gate.accept(input, 100001)).toEqual({ count: 1, occurredAt: 100000 })
    expect(gate.accept(input, 100002)).toBeNull()
    expect(gate.accept({ dropIds: ['bottle-a', 'bottle-b'], occurredAt: 100003 }, 100004)?.count).toBe(1)
  })

  it('accepts only the trusted workbench main frame, never the overlay or an iframe', () => {
    const api = { notifyBottleDrop: vi.fn(), allows: (event: { isMainFrame: boolean; senderKind: string }, kinds: string[]) =>
      event.isMainFrame && kinds.includes(event.senderKind) }
    const handler = petIpcHandlers(api as unknown as PetIpcApi)[PET_IPC.notifyPetBottleDrop]
    const main = { senderId: 1, isMainFrame: true, senderKind: 'main' as const }
    const signal = { dropIds: ['new'], occurredAt: Date.now() }
    handler({ ...main, senderKind: 'overlay' }, signal)
    handler({ ...main, senderKind: 'other' }, signal)
    handler({ ...main, isMainFrame: false }, signal)
    handler(main, { ...signal, dropIds: [] })
    expect(api.notifyBottleDrop).not.toHaveBeenCalled()
    handler(main, signal); handler(main, null)
    expect(api.notifyBottleDrop.mock.calls).toEqual([[signal], [null]])
  })
})
