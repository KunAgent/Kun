import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KUN_AVATAR_PRESETS } from '@shared/rooms-api'
import { RoomAvatarStage } from './RoomAvatarStage'

const mocks = vi.hoisted(() => ({ composed: vi.fn(() => 'blob:stage') }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./room-avatar-composed', () => ({ useRoomComposedAvatar: mocks.composed }))
vi.mock('./RoomAvatarItemArt', () => ({ RoomAvatarItemArt: () => null }))
vi.mock('./RoomAvatar', () => ({ RoomAvatar: () => null }))
let renderer: ReactTestRenderer | undefined
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals() })

describe('wardrobe stage art', () => {
  it('renders a legacy builtin with stage effects without changing the persisted avatar', () => {
    const preset = KUN_AVATAR_PRESETS.find(({ id }) => id === 'magician')!
    const avatar = { kind: 'builtin' as const, id: preset.id }
    act(() => { renderer = create(createElement(RoomAvatarStage, {
      id: 'agent', label: 'Agent', user: false, avatar, parts: preset.parts, trying: null, active: true,
      notice: '', disabled: false, language: 'en', onSlot: vi.fn(), onRemove: vi.fn(), onRandom: vi.fn()
    })) })
    expect(mocks.composed).toHaveBeenCalledWith({ kind: 'composed', version: 1, parts: preset.parts }, 208, true)
    expect(renderer!.root.findByType('img').props.src).toBe('blob:stage')
    expect(avatar).toEqual({ kind: 'builtin', id: 'magician' })
  })
})
