import { createElement, Fragment } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKunWardrobe, type KunWardrobeDrop } from '@shared/rooms-api'
import { useFocusModeStore } from '../../store/focus-mode-store'

const mocks = vi.hoisted(() => ({ request: vi.fn(), sync: vi.fn(), open: vi.fn(), stash: vi.fn(), settings: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./RoomWardrobeBottle', () => ({ WardrobeBottleIcon: () => null }))
vi.mock('./RoomUserAvatarEditor', () => ({ RoomUserAvatarEditor: () => null }))
vi.mock('./room-wardrobe-wear', () => ({ wearDropOnMe: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'request-id' }))

import { RoomWardrobeDropCard } from './RoomWardrobeDropCard'
import { publishRoomEvent } from './room-event-listeners'
import { acceptWardrobe, useWardrobe, type WardrobeDropScope, type WardrobeSnapshot } from './room-wardrobe'

let renderer: ReactTestRenderer | undefined
let detail: Parameters<typeof acceptWardrobe>[0]
let observed: WardrobeSnapshot
const bottle = (scope: WardrobeDropScope): KunWardrobeDrop => ({
  id: 'drop-1', kind: 'item', rarity: 'common', item: { category: 'prop', id: 'leaf' },
  duplicate: false, feathers: 0, source: scope.roomId ? 'room' : 'code', runId: 'run-1',
  createdAt: new Date().toISOString(), ...scope
})
function SnapshotProbe() { observed = useWardrobe(false); return null }
async function render(scope: WardrobeDropScope) {
  await act(async () => {
    renderer = create(createElement(Fragment, null,
      createElement(RoomWardrobeDropCard, scope), createElement(SnapshotProbe)))
  })
}
const focus = async (enabled: boolean) => { await act(async () => { useFocusModeStore.getState().setEnabled(enabled) }) }

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { kunGui: { kunAccount: { wardrobe: mocks } } })
  useFocusModeStore.getState().setEnabled(false)
  detail = { wardrobe: createKunWardrobe(1), revision: 1, mode: 'account' }
  acceptWardrobe(detail)
  mocks.request.mockImplementation(async () => detail)
  mocks.sync.mockResolvedValue(undefined)
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  useFocusModeStore.getState().setEnabled(false)
  vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('focus mode wardrobe drops', () => {
  it.each<WardrobeDropScope>([{ roomId: 'room-1' }, { threadId: 'thread-1' }])(
    'hides existing drop cards immediately without changing bottles or settings: %o', async (scope) => {
      detail.wardrobe.pending = [bottle(scope)]
      acceptWardrobe(detail)
      await render(scope)
      expect(renderer!.root.findByProps({ 'data-wardrobe-drop': 'drop-1' })).toBeDefined()
      await focus(true)
      expect(renderer!.toJSON()).toBeNull()
      expect(observed.wardrobe).toEqual(detail.wardrobe)
      expect(mocks.stash).not.toHaveBeenCalled()
      expect(mocks.open).not.toHaveBeenCalled()
      expect(mocks.settings).not.toHaveBeenCalled()
      await focus(false)
      expect(renderer!.root.findByProps({ 'data-wardrobe-drop': 'drop-1' })).toBeDefined()
    })

  it.each<WardrobeDropScope>([{ roomId: 'room-1' }, { threadId: 'thread-1' }])(
    'keeps account sync and newly recorded drops while starting in focus mode: %o', async (scope) => {
      await focus(true)
      await render(scope)
      expect(renderer!.toJSON()).toBeNull()
      detail = { ...detail, revision: 2, wardrobe: { ...detail.wardrobe, pending: [bottle(scope)] } }
      await act(async () => {
        publishRoomEvent({ seq: 1, roomId: 'agent-directory', kind: 'wardrobe.activity' })
        await vi.advanceTimersByTimeAsync(150)
      })
      expect(mocks.sync).toHaveBeenCalled()
      expect(mocks.request).toHaveBeenCalledWith('/v1/rooms/wardrobe')
      expect(observed.revision).toBe(2)
      expect(observed.wardrobe?.pending).toEqual(detail.wardrobe.pending)
      expect(observed.wardrobe?.pending[0].stashedAt).toBeUndefined()
      expect(renderer!.toJSON()).toBeNull()
      expect(mocks.stash).not.toHaveBeenCalled()
      expect(mocks.open).not.toHaveBeenCalled()
      expect(mocks.settings).not.toHaveBeenCalled()
      await focus(false)
      expect(renderer!.root.findByProps({ 'data-wardrobe-drop': 'drop-1' })).toBeDefined()
    })

  it.each<WardrobeDropScope>([{ roomId: 'room-1' }, { threadId: 'thread-1' }])(
    'also suppresses guest drop invitations: %o', async (scope) => {
      detail = { ...detail, mode: 'guest', guestHints: [{ id: 'hint-1', createdAt: new Date().toISOString(), ...scope }] }
      acceptWardrobe(detail)
      await focus(true)
      await render(scope)
      expect(observed.guestHints).toEqual(detail.guestHints)
      expect(renderer!.toJSON()).toBeNull()
      await focus(false)
      expect(renderer!.root.findByProps({ 'data-wardrobe-guest-drop': 'hint-1' })).toBeDefined()
      await focus(true)
      expect(renderer!.toJSON()).toBeNull()
    })

  it('preserves the quiet notice preference when focus mode is turned off', async () => {
    detail.wardrobe = { ...detail.wardrobe, pending: [bottle({ threadId: 'thread-1' })],
      settings: { drops: true, code: true, notice: 'quiet' } }
    acceptWardrobe(detail)
    await focus(true)
    await render({ threadId: 'thread-1' })
    expect(renderer!.toJSON()).toBeNull()
    await focus(false)
    expect(renderer!.toJSON()).toBeNull()
    expect(observed.wardrobe?.settings.notice).toBe('quiet')
    expect(mocks.settings).not.toHaveBeenCalled()
  })
})
