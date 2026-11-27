import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PetCursorSample, PetOverlayBootstrap, PetSummary } from '@shared/pets'
import { defaultPetInteractions, emptyPetPresence, type PetPresenceSnapshot } from '@shared/pets-interactions'
import { updatePetTyping } from '@shared/pets-typing'
import { DESK_MOUSE_HOLD_MS, DESK_TYPING_HOLD_MS, usePetPresence } from './use-pet-presence'

afterEach(() => vi.useRealTimers())

describe('overlay presence lifecycle', () => {
  it('keeps model context without making a permanent companion and expires input feedback', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000)
    let deliver!: (snapshot: PetPresenceSnapshot) => void
    const unsubscribe = vi.fn()
    const bridge = { onPresenceChanged: (handler: typeof deliver) => { deliver = handler; return unsubscribe } }
    const pets = ['gpt', 'claude'].map((name) => ({
      id: `kun:${name}-girl`, sourceId: `${name}-girl`, source: 'kun-builtin', displayName: name,
      available: true, spritesheetUrl: 'kun-pet://asset/test', interactions: { ...defaultPetInteractions(), modelAliases: [name] }
    })) as PetSummary[]
    let result!: ReturnType<typeof usePetPresence>
    function View({ boot }: { boot: PetOverlayBootstrap }) { result = usePetPresence(bridge, boot); return null }
    const boot = { ensemblePets: pets, presence: emptyPetPresence(), reactionsEnabled: true } as PetOverlayBootstrap
    let view!: ReturnType<typeof create>
    await act(async () => { view = create(createElement(View, { boot })) })
    await act(async () => deliver({ revision: 2, input: null, model: { model: 'gpt-5', provider: '' }, modelChangedAt: 10000 }))
    expect(result.presence.model?.model).toBe('gpt-5')
    expect(result.active).toBe(false)
    await act(async () => deliver({ revision: 3, input: null, model: { model: 'claude-sonnet', provider: '' }, modelChangedAt: 10000 }))
    expect(result.presence.model?.model).toBe('claude-sonnet')
    await act(async () => view.update(createElement(View, { boot: { ...boot, presence: { ...emptyPetPresence(), revision: 1 } } })))
    expect(result.presence.model?.model).toBe('claude-sonnet')
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(result.active).toBe(false)
    await act(async () => deliver({ revision: 4, model: null, modelChangedAt: 0,
      input: { kind: 'typing', level: 0, expiresAt: Date.now() + 1800 } }))
    expect(result.input?.kind).toBe('typing')
    await act(async () => { vi.advanceTimersByTime(1801) })
    expect(result.active).toBe(false)
    await act(async () => deliver({ revision: 5, model: null, modelChangedAt: 0,
      input: { kind: 'speaking', level: .5, expiresAt: Date.now() + 1800 } }))
    await act(async () => view.update(createElement(View, { boot: { ...boot, reactionsEnabled: false } })))
    expect(result.active).toBe(false)
    await act(async () => view.unmount())
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds the joint typing desk across long thinking pauses and focusout, keeps mouse desk open across UI suppression, and yields on head-pat', async () => {
    vi.useFakeTimers(); vi.setSystemTime(20_000)
    let deliver!: (snapshot: PetPresenceSnapshot) => void
    let deliverCursor!: (sample: PetCursorSample) => void
    const bridge = {
      onPresenceChanged: (handler: typeof deliver) => { deliver = handler; return () => undefined },
      onCursorChanged: (handler: typeof deliverCursor) => { deliverCursor = handler; return () => undefined }
    }
    let result!: ReturnType<typeof usePetPresence>
    function View({ boot, suppress = false, patting = false }: { boot: PetOverlayBootstrap; suppress?: boolean; patting?: boolean }) {
      result = usePetPresence(bridge, boot, suppress, patting)
      return null
    }
    const boot = {
      petId: 'kun:xiao-kun',
      presence: emptyPetPresence(),
      reactionsEnabled: true,
      interactions: {
        ...defaultPetInteractions(),
        joint: {
          version: 1, row: 0, blink: [0, 1, 2, 3, 4, 5], ground: 0.91, head: [0.5, 0.64],
          arms: [
            { shoulder: [0.29, 0.55], hand: [0.15, 0.69], radius: 0.1 },
            { shoulder: [0.72, 0.56], hand: [0.84, 0.69], radius: 0.1 }
          ],
          feet: [[0.35, 0.88], [0.66, 0.89]]
        }
      }
    } as PetOverlayBootstrap
    let view!: ReturnType<typeof create>
    await act(async () => { view = create(createElement(View, { boot })) })

    // Typing burst starts at 20_000 with 1.8s server TTL; joint desk latches for 30s so keyboard never flickers away.
    const typing = updatePetTyping(undefined, 1, 1, 20_000, { col: 1, row: 1 })
    await act(async () => deliver({
      revision: 1, model: null, modelChangedAt: 0,
      input: { kind: 'typing', level: 0.5, expiresAt: 21_800, typing }
    }))
    expect(result.input?.kind).toBe('typing')
    expect(result.deskExpiresAt).toBe(20_000 + DESK_TYPING_HOLD_MS)

    // Focusout clears server input immediately; desk stays calm with held paws released (held === 0).
    await act(async () => { vi.advanceTimersByTime(400) })
    await act(async () => deliver({ revision: 2, model: null, modelChangedAt: 0, input: null }))
    expect(result.input?.kind).toBe('typing')
    expect(result.typing?.held).toBe(0)
    expect(result.typing?.left.struckAt).toBe(20_000)

    // Still open 15s later (no flicker during thinking pauses), then tucks away cleanly after 30s.
    await act(async () => { vi.advanceTimersByTime(15_000) })
    expect(result.active).toBe(true)
    await act(async () => { vi.advanceTimersByTime(14_605) })
    expect(result.active).toBe(false)

    // Mouse desk opens on click/movement and does NOT collapse when suppressMouseDesk toggles true mid-hold.
    const mouseTime = Date.now()
    await act(async () => deliverCursor({
      nx: 0.4, ny: 0.5, gx: -0.2, gy: 0.1, buttons: 0, wheelSeq: 0, wheelDir: 0,
      deskActiveAt: mouseTime, active: true, overMascot: false
    }))
    expect(result.active).toBe(true)
    expect(result.deskExpiresAt).toBe(mouseTime + DESK_MOUSE_HOLD_MS)
    await act(async () => view.update(createElement(View, { boot, suppress: true })))
    expect(result.active).toBe(true)
    await act(async () => view.update(createElement(View, { boot, suppress: false })))
    await act(async () => { vi.advanceTimersByTime(DESK_MOUSE_HOLD_MS + 5) })
    expect(result.active).toBe(false)

    // Head-pat immediately yields a latched desk when no key is held.
    const burst2 = updatePetTyping(undefined, 0, 2, Date.now(), { col: 4, row: 1 })
    await act(async () => deliver({
      revision: 3, model: null, modelChangedAt: 0,
      input: { kind: 'typing', level: 0.5, expiresAt: Date.now() + 1_800, typing: burst2 }
    }))
    expect(result.active).toBe(true)
    await act(async () => view.update(createElement(View, { boot, patting: true })))
    expect(result.active).toBe(false)

    await act(async () => view.unmount())
    expect(vi.getTimerCount()).toBe(0)
  })
})
