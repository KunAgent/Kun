import { createElement, useState, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KUN_AVATAR_DEFAULT_PARTS, KUN_AVATAR_PRESETS, getKunAvatarConflicts,
  type RoomAvatarReference
} from '@shared/rooms-api'
import { RoomAvatarComposer, editableKunAvatarParts } from './RoomAvatarComposer'
import { RoomAvatarPicker } from './RoomAvatarPicker'
import { RoomUserAvatarEditor } from './RoomUserAvatarEditor'

const mocks = vi.hoisted(() => ({ request: vi.fn(), accept: vi.fn(), cache: vi.fn(), profile: {
  revision: 7, profile: { avatar: { kind: 'builtin', id: 'coder' } }
} }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' },
  t: (key: string, values?: { parts?: string }) => values?.parts ? `${key}: ${values.parts}` : key }) }))
vi.mock('./RoomAvatar', () => ({ RoomAvatar: (props: { avatar?: RoomAvatarReference; label: string }) =>
  createElement('span', { 'data-avatar': props.avatar, 'aria-label': props.label }) }))
vi.mock('./RoomModal', () => ({ RoomModal: ({ children }: { children: ReactNode }) => createElement('div', { role: 'dialog' }, children) }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'save-avatar-id' }))
vi.mock('./room-uploaded-avatar', () => ({ cacheRoomAvatar: mocks.cache }))
vi.mock('./room-user-profile', () => ({ acceptRoomUserProfile: mocks.accept }))
vi.mock('./agent-client', () => ({ useAgentResource: () => ({ data: mocks.profile }) }))

let renderer: ReactTestRenderer
const button = (label: string) => renderer.root.findAllByType('button').find((node) =>
  node.props['aria-label'] === label || node.children.includes(label))!
const preview = () => renderer.root.findByType(RoomAvatarComposer).props.avatar as RoomAvatarReference | null | undefined
const changeCategory = (category: string) => act(() => renderer.root.findByType('select').props.onChange({ target: { value: category } }))
const click = (label: string) => act(() => button(label).props.onClick())
async function mount(node: ReactElement) { await act(async () => { renderer = create(node) }) }

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function ComposerHarness({ initial }: { initial: RoomAvatarReference }) {
  const [avatar, setAvatar] = useState<RoomAvatarReference | null>(initial)
  return createElement(RoomAvatarComposer, { id: 'agent', label: 'Agent', avatar, onChange: setAvatar, onUpload: vi.fn() })
}

describe('layered avatar editor drafts', () => {
  it('keeps a builtin intact on open and discards edits when cancelled', async () => {
    const onChange = vi.fn(), initial: RoomAvatarReference = { kind: 'builtin', id: 'coder' }
    await mount(createElement(RoomAvatarPicker, { id: 'agent', label: 'Agent', avatar: initial, onChange }))
    click('roomsAvatarChoose')
    expect(preview()).toEqual(initial)
    click(KUN_AVATAR_PRESETS[0].label.en)
    expect(preview()?.kind).toBe('composed')
    expect(onChange).not.toHaveBeenCalled()
    click('roomsCancel')
    expect(onChange).not.toHaveBeenCalled()
    click('roomsAvatarChoose')
    expect(preview()).toEqual(initial)
  })

  it('applies the composed draft only when saved, with all 30 presets available', async () => {
    const onChange = vi.fn()
    await mount(createElement(RoomAvatarPicker, { id: 'agent', label: 'Agent', onChange }))
    click('roomsAvatarChoose')
    expect(renderer.root.findAllByProps({ className: 'rooms-avatar-composer-option' })).toHaveLength(30)
    click(KUN_AVATAR_PRESETS[4].label.en)
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => { button('agentsSave').props.onClick() })
    expect(onChange).toHaveBeenCalledWith({ kind: 'composed', version: 1, parts: KUN_AVATAR_PRESETS[4].parts })
    expect(mocks.request).not.toHaveBeenCalled()
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  })

  it('starts editing a legacy builtin from its matching preset and keeps its other accessories', async () => {
    const original = KUN_AVATAR_PRESETS.find((preset) => preset.id === 'coder')!.parts
    await mount(createElement(ComposerHarness, { initial: { kind: 'builtin', id: 'coder' } }))
    changeCategory('color')
    click('Mint')
    expect(preview()).toEqual({ kind: 'composed', version: 1, parts: { ...original, color: 'mint' } })
    expect(editableKunAvatarParts(null, 'user', true)).toEqual(KUN_AVATAR_DEFAULT_PARTS)
  })

  it('keeps the newly selected accessory and announces incompatible items removed', async () => {
    await mount(createElement(ComposerHarness, { initial: { kind: 'composed', version: 1,
      parts: { ...KUN_AVATAR_DEFAULT_PARTS, glasses: 'square' } } }))
    changeCategory('headwear')
    click('Space helmet')
    expect(preview()).toMatchObject({ parts: { headwear: 'astronaut-helmet' } })
    expect((preview() as { parts: object }).parts).not.toHaveProperty('glasses')
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('roomsAvatarGlasses')
    changeCategory('glasses')
    click('Square glasses')
    expect((preview() as { parts: object }).parts).not.toHaveProperty('headwear')
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('roomsAvatarHeadwear')
    click('roomsAvatarNone')
    expect((preview() as { parts: object }).parts).not.toHaveProperty('glasses')
  })

  it('randomizes to a legal draft and restores the existing default only on save', async () => {
    const onChange = vi.fn()
    vi.spyOn(Math, 'random').mockReturnValue(0.3)
    await mount(createElement(RoomAvatarPicker, { id: 'agent', label: 'Agent', onChange }))
    click('roomsAvatarChoose'); click('roomsAvatarRandom')
    const generated = preview()
    expect(generated?.kind).toBe('composed')
    if (generated?.kind === 'composed') expect(getKunAvatarConflicts(generated.parts)).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
    click('roomsAvatarReset')
    expect(preview()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => { button('agentsSave').props.onClick() })
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('supports transparent and custom backgrounds without changing accessories', async () => {
    await mount(createElement(ComposerHarness, { initial: { kind: 'composed', version: 1,
      parts: { ...KUN_AVATAR_DEFAULT_PARTS, outfit: 'red-scarf' } } }))
    changeCategory('bg'); click('roomsAvatarTransparent')
    expect(preview()).toMatchObject({ parts: { bg: 'transparent', outfit: 'red-scarf' } })
    act(() => renderer.root.findByProps({ type: 'color' }).props.onChange({ target: { value: '#ABCDEF' } }))
    expect(preview()).toMatchObject({ parts: { bg: '#abcdef', outfit: 'red-scarf' } })
  })
})

describe('user avatar editor persistence', () => {
  it('uses the same composer on the phone panel and does not save on cancel', async () => {
    const onClose = vi.fn()
    await mount(createElement(RoomUserAvatarEditor, { variant: 'panel', onClose }))
    click(KUN_AVATAR_PRESETS[1].label.en)
    click('roomsCancel')
    expect(onClose).toHaveBeenCalledOnce()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('saves the composed user avatar with the original revision and publishes the saved profile', async () => {
    const onClose = vi.fn(), preset = KUN_AVATAR_PRESETS[2]
    const saved = { ...mocks.profile, revision: 8, profile: { avatar: { kind: 'composed', version: 1, parts: preset.parts } } }
    mocks.request.mockResolvedValueOnce(saved)
    await mount(createElement(RoomUserAvatarEditor, { onClose }))
    click(preset.label.en)
    await act(async () => { button('agentsSave').props.onClick() })
    expect(mocks.request).toHaveBeenCalledWith('/v1/rooms/user-profile', 'PUT', {
      avatar: saved.profile.avatar, expectedRevision: 7, clientRequestId: 'save-avatar-id'
    })
    expect(mocks.accept).toHaveBeenCalledWith(saved)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('retains the draft and reports a version conflict without closing', async () => {
    const onClose = vi.fn()
    mocks.request.mockRejectedValueOnce(new Error('revision_conflict'))
    await mount(createElement(RoomUserAvatarEditor, { variant: 'panel', onClose }))
    click('roomsAvatarRestoreKun')
    await act(async () => { button('agentsSave').props.onClick() })
    expect(mocks.request.mock.calls[0][2].avatar).toBeNull()
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('revision_conflict')
    expect(onClose).not.toHaveBeenCalled()
    expect(button('agentsSave').props.disabled).toBe(false)
  })
})

describe('avatar photo drafts', () => {
  function mockPhoto() {
    const bitmap = { width: 400, height: 200, close: vi.fn() }
    const context = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' }
    const canvas = { width: 256, height: 256, getContext: () => context, toDataURL: () => 'data:image/jpeg;base64,cropped-photo' }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    vi.stubGlobal('document', { createElement: () => canvas })
    return { bitmap, canvas, context }
  }
  async function uploadPhoto() {
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({ target: {
      files: [{ type: 'image/png', size: 1200 }], value: 'photo.png'
    } }))
  }

  it('previews and center crops a photo locally, uploading only when the draft is saved', async () => {
    const { bitmap, context } = mockPhoto(), onChange = vi.fn()
    const result = { avatar: { kind: 'uploaded', attachmentId: 'photo-id' }, image: { dataBase64: 'saved-photo' } }
    mocks.request.mockResolvedValueOnce(result)
    await mount(createElement(RoomAvatarPicker, { id: 'agent', label: 'Agent', onChange }))
    click('roomsAvatarChoose')
    await uploadPhoto()
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 100, 0, 200, 200, 0, 0, 256, 256)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(renderer.root.findByType('img').props.src).toBe('data:image/jpeg;base64,cropped-photo')
    expect(mocks.request).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => { button('agentsSave').props.onClick() })
    expect(mocks.request).toHaveBeenCalledWith('/v1/rooms/avatars', 'POST', { dataBase64: 'cropped-photo', mimeType: 'image/jpeg' })
    expect(mocks.cache).toHaveBeenCalledWith('photo-id', result.image)
    expect(onChange).toHaveBeenCalledWith(result.avatar)
  })

  it('does not upload a discarded photo', async () => {
    mockPhoto()
    await mount(createElement(RoomAvatarPicker, { id: 'agent', label: 'Agent', onChange: vi.fn() }))
    click('roomsAvatarChoose')
    await uploadPhoto()
    click('roomsCancel')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('keeps photo crop controls working and releases the bitmap when a preset replaces it', async () => {
    const { bitmap, context, canvas } = mockPhoto()
    await act(async () => { renderer = create(createElement(RoomUserAvatarEditor, { variant: 'panel', onClose: vi.fn() }), {
      createNodeMock: (element) => element.type === 'canvas' ? canvas : null
    }) })
    await uploadPhoto()
    expect(context.drawImage).toHaveBeenLastCalledWith(bitmap, 100, 0, 200, 200, 0, 0, 256, 256)
    act(() => renderer.root.findAllByProps({ type: 'range' })[0].props.onChange({ target: { value: '100' } }))
    expect(context.drawImage).toHaveBeenLastCalledWith(bitmap, 200, 0, 200, 200, 0, 0, 256, 256)
    click(KUN_AVATAR_PRESETS[0].label.en)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByType('canvas')).toHaveLength(0)
    expect(preview()?.kind).toBe('composed')
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
