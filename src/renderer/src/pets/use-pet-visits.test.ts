// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PetOverlayBootstrap, PetSummary } from '@shared/pets'
import { emptyPetPresence } from '@shared/pets-interactions'
import { defaultPetEnsemble } from '@shared/pets-ensemble'
import type { PetVisitRequest } from '@shared/pets-visits'
import { usePetVisits } from './use-pet-visits'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('visit delivery lifecycle', () => {
  it('waits for the right visible resident, acknowledges once, returns to solo and never replays a stale bootstrap', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000); vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    let deliver!: (request: PetVisitRequest) => void
    const stop = vi.fn(), ack = vi.fn()
    const bridge = { onVisitRequested: (handler: typeof deliver) => { deliver = handler; return stop }, acknowledgeVisitRequest: ack }
    const guest = { id: 'kun:whale-girl', sourceId: 'whale-girl', source: 'kun-builtin', available: true, spritesheetUrl: 'kun-pet://ds' } as PetSummary
    const request: PetVisitRequest = { id: 'one', kind: 'invite', createdAt: 100000, primaryId: 'kun:xiao-kun' }
    const boot = { petId: 'kun:xiao-kun', spritesheetUrl: 'kun-pet://kun', isOpen: false, ensemblePets: [guest], visitRequest: request,
      ensemble: { ...defaultPetEnsemble(), enabled: true, autoplay: true } } as PetOverlayBootstrap
    let result!: ReturnType<typeof usePetVisits>
    function View({ bootstrap }: { bootstrap: PetOverlayBootstrap }) {
      result = usePetVisits({ bridge, bootstrap, presence: emptyPetPresence(), work: null, blocked: false }); return null
    }
    let view!: ReturnType<typeof create>
    await act(async () => { view = create(createElement(View, { bootstrap: boot })) })
    expect(result).toBeNull(); expect(ack).not.toHaveBeenCalled()
    await act(async () => { view.update(createElement(View, { bootstrap: { ...boot, isOpen: true, petId: 'kun:ikun' } })) })
    expect(result).toBeNull(); expect(ack).not.toHaveBeenCalled()
    await act(async () => { view.update(createElement(View, { bootstrap: { ...boot, isOpen: true } })) })
    expect(result?.guestIds).toEqual(['kun:whale-girl'])
    expect(ack).toHaveBeenCalledExactlyOnceWith('one')
    await act(async () => { deliver(request) })
    expect(ack).toHaveBeenCalledOnce()
    await act(async () => { vi.advanceTimersByTime(result!.endsAt - Date.now() + 250) })
    expect(result).toBeNull()
    await act(async () => { view.update(createElement(View, { bootstrap: { ...boot, isOpen: true, mascotWidthPx: 128 } })) })
    expect(result).toBeNull(); expect(ack).toHaveBeenCalledOnce()
    await act(async () => { view.unmount() })
    expect(stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
})
