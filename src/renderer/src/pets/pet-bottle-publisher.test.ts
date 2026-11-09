import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunAccountState } from '@shared/kun-account'
import type { WardrobeSnapshot } from '../components/rooms/room-wardrobe'
import { publishRoomEvent } from '../components/rooms/room-event-listeners'
import { startPetBottlePublisher } from './pet-bottle-publisher'

const fixture = vi.hoisted(() => ({
  state: null as unknown as WardrobeSnapshot, refresh: vi.fn<() => Promise<void>>(async () => undefined), focus: false,
  wardrobeListeners: new Set<() => void>(), focusListeners: new Set<(state: { enabled: boolean }) => void>()
}))
vi.mock('../components/rooms/room-wardrobe', () => ({
  refreshWardrobe: fixture.refresh, wardrobeSnapshot: () => fixture.state,
  wardrobeSettings: (wardrobe: WardrobeSnapshot['wardrobe']) => wardrobe?.settings ?? { drops: true, code: true, notice: 'card' },
  subscribeWardrobe: (listener: () => void) => { fixture.wardrobeListeners.add(listener); return () => fixture.wardrobeListeners.delete(listener) }
}))
vi.mock('../store/focus-mode-store', () => ({ useFocusModeStore: {
  getState: () => ({ enabled: fixture.focus }), subscribe: (listener: (state: { enabled: boolean }) => void) => {
    fixture.focusListeners.add(listener); return () => fixture.focusListeners.delete(listener)
  }
} }))

let stop: () => void = () => undefined
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100000)
  fixture.focus = false; fixture.refresh.mockReset(); fixture.refresh.mockResolvedValue(undefined)
  fixture.state = { loaded: true, modeKnown: true, mode: 'local', error: '', revision: 1, unlockAll: false,
    wardrobe: { pending: [], settings: { drops: true, code: true, notice: 'card' } } } as unknown as WardrobeSnapshot
  vi.stubGlobal('window', { kunGui: {} })
})
afterEach(() => { stop(); vi.unstubAllGlobals(); vi.useRealTimers(); fixture.wardrobeListeners.clear(); fixture.focusListeners.clear() })
function add(id: string, at = Date.now()) {
  fixture.state.wardrobe!.pending.push({ id, kind: 'item', rarity: 'legendary', item: { category: 'headwear', id: 'wizard-hat' },
    duplicate: false, feathers: 100, runId: `run-${id}`, createdAt: new Date(at).toISOString() })
}
function drop(id: string, at = Date.now()) {
  publishRoomEvent({ seq: 1, roomId: 'room', kind: 'wardrobe.dropped', createdAt: new Date(at).toISOString(), payload: { dropId: id, receiptId: 'receipt' } })
}

describe('confirmed live bottle drops', () => {
  it('never animates shelf hydration, coalesces live drops, and does not expose contents or rarity', async () => {
    add('old', 90000)
    const notify = vi.fn(); stop = startPetBottlePublisher({ notifyPetBottleDrop: notify })
    for (const listener of fixture.wardrobeListeners) listener()
    expect(notify).not.toHaveBeenCalled()
    add('new-a'); add('new-b'); drop('new-a'); drop('new-b'); drop('new-a')
    await vi.advanceTimersByTimeAsync(301)
    expect(fixture.refresh).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledExactlyOnceWith({ dropIds: ['new-a', 'new-b'], occurredAt: 100000 })
    expect(JSON.stringify(notify.mock.calls)).not.toMatch(/legendary|wizard-hat|feathers/)
    drop('new-a')
    await vi.advanceTimersByTimeAsync(400)
    expect(notify).toHaveBeenCalledOnce()
  })

  it('ignores replayed, unconfirmed, opened, stashed and login-hint records', async () => {
    const notify = vi.fn(); stop = startPetBottlePublisher({ notifyPetBottleDrop: notify })
    add('replay'); drop('replay', 99999)
    drop('not-in-mirror')
    add('old-reward', 1000); drop('old-reward')
    add('stashed'); fixture.state.wardrobe!.pending.at(-1)!.stashedAt = new Date().toISOString(); drop('stashed')
    publishRoomEvent({ seq: 2, roomId: 'room', kind: 'wardrobe.guest_hint', createdAt: new Date().toISOString(), payload: { id: 'hint' } })
    await vi.advanceTimersByTimeAsync(301)
    expect(notify).not.toHaveBeenCalled()
  })

  it('respects quiet wardrobe notices, guest mode and focus mode', async () => {
    const notify = vi.fn(); stop = startPetBottlePublisher({ notifyPetBottleDrop: notify })
    fixture.state.wardrobe!.settings.notice = 'quiet'
    add('quiet'); drop('quiet'); await vi.advanceTimersByTimeAsync(301)
    fixture.state.wardrobe!.settings.notice = 'card'; fixture.state.mode = 'guest'
    add('guest'); drop('guest'); await vi.advanceTimersByTimeAsync(301)
    fixture.state.mode = 'local'; fixture.focus = true
    add('focused'); drop('focused'); await vi.advanceTimersByTimeAsync(301)
    expect(notify).not.toHaveBeenCalled()
  })

  it('cancels the presentation when its bottle is opened elsewhere and cleans up its subscriptions', async () => {
    const notify = vi.fn(); stop = startPetBottlePublisher({ notifyPetBottleDrop: notify })
    add('one'); drop('one'); await vi.advanceTimersByTimeAsync(301)
    fixture.state.wardrobe!.pending = []
    fixture.refresh.mockImplementation(async () => { for (const listener of fixture.wardrobeListeners) listener() })
    publishRoomEvent({ seq: 2, roomId: 'room', kind: 'wardrobe.updated', createdAt: new Date().toISOString(), payload: {} })
    await vi.advanceTimersByTimeAsync(151)
    expect(notify.mock.lastCall?.[0]).toBeNull()
    stop(); notify.mockClear()
    add('later'); drop('later'); await vi.advanceTimersByTimeAsync(500)
    expect(notify).not.toHaveBeenCalled()
    expect(fixture.wardrobeListeners.size).toBe(0)
    expect(fixture.focusListeners.size).toBe(0)
  })

  it('drops a pending response when the signed-in account changes', async () => {
    fixture.state.mode = 'account'
    const user = (id: string): KunAccountState => ({ status: 'authenticated', user: { id, name: id, email: '', avatarUrl: null }, error: null })
    let accountChanged!: (state: KunAccountState) => void
    vi.stubGlobal('window', { kunGui: { kunAccount: { getState: async () => user('a'), onState: (callback: typeof accountChanged) => {
      accountChanged = callback; return () => undefined
    } } } })
    const notify = vi.fn(); stop = startPetBottlePublisher({ notifyPetBottleDrop: notify })
    await Promise.resolve(); notify.mockClear()
    let release!: () => void
    fixture.refresh.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    add('old-account'); drop('old-account'); await vi.advanceTimersByTimeAsync(301)
    accountChanged(user('b')); release(); await Promise.resolve(); await Promise.resolve()
    expect(notify.mock.calls.every(([value]) => value === null)).toBe(true)
  })
})
