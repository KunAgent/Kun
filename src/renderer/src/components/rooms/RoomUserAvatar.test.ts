import { createElement, Fragment } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RoomAvatar } from './RoomAvatar'
import { acceptRoomUserProfile, useRoomUserProfile } from './room-user-profile'
vi.mock('./room-uploaded-avatar', () => ({ useRoomUploadedAvatar: (id?: string) => id === 'good' ? 'data:image/jpeg;base64,good' : undefined }))
let renderer: ReactTestRenderer
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); useRoomUserProfile.setState({ profile: { avatar: null }, revision: null }) })
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
it('uses the bundled Kun for the user, replaces it everywhere and rejects older updates', () => {
  act(() => { renderer = create(createElement(Fragment, null, createElement(RoomAvatar, { id: 'user', label: 'You' }), createElement(RoomAvatar, { id: 'user', label: 'Old message' }))) })
  expect(renderer.root.findAllByType('img')).toHaveLength(2)
  expect(renderer.root.findAllByType('img')[0].props.src).toContain('kun_greet.png')
  act(() => acceptRoomUserProfile({ profile: { avatar: { kind: 'builtin', id: 'explorer' } }, revision: 1 }))
  expect(renderer.root.findAllByProps({ 'data-avatar-id': 'explorer' })).toHaveLength(2)
  act(() => acceptRoomUserProfile({ profile: { avatar: null }, revision: 0 }))
  expect(renderer.root.findAllByProps({ 'data-avatar-id': 'explorer' })).toHaveLength(2)
  act(() => acceptRoomUserProfile({ profile: { avatar: null }, revision: 2 }))
  expect(renderer.root.findAllByType('img')[0].props.src).toContain('kun_greet.png')
})
it('shows a selected preview independently and falls back to Kun when an uploaded image is missing', () => {
  act(() => { renderer = create(createElement(RoomAvatar, { id: 'preview', user: true, avatar: { kind: 'uploaded', attachmentId: 'missing' }, label: 'Preview' })) })
  expect(renderer.root.findByType('img').props.src).toContain('kun_greet.png')
  act(() => renderer.update(createElement(RoomAvatar, { id: 'preview', user: true, avatar: { kind: 'builtin', id: 'designer' }, label: 'Preview' })))
  expect(renderer.root.findByProps({ 'data-avatar-id': 'designer' })).toBeTruthy()
  expect(useRoomUserProfile.getState().profile.avatar).toBeNull()
})
