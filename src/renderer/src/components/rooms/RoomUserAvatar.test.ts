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
it('preserves custom builtins and recovers from a broken uploaded portrait', () => {
  const props = { id: 'developer', label: 'My Agent' }
  act(() => { renderer = create(createElement(RoomAvatar, { ...props, avatar: { kind: 'builtin', id: 'scientist' } })) })
  expect(renderer.root.findByProps({ 'data-avatar-id': 'scientist' })).toBeTruthy()
  act(() => renderer.update(createElement(RoomAvatar, { ...props, avatar: { kind: 'uploaded', attachmentId: 'good' } })))
  expect(renderer.root.findByType('img').props.src).toBe('data:image/jpeg;base64,good')
  act(() => renderer.root.findByType('img').props.onError())
  expect(renderer.root.findAllByType('img')).toHaveLength(0)
  expect(renderer.root.findByProps({ 'data-avatar-id': 'coder' })).toBeTruthy()
  act(() => renderer.update(createElement(RoomAvatar, { ...props, avatar: { kind: 'builtin', id: 'explorer' } })))
  expect(renderer.root.findByProps({ 'data-avatar-id': 'explorer' })).toBeTruthy()
})
it('keeps a visible identity for unknown, missing and loading portraits', () => {
  const props = { id: 'developer', label: 'My Agent' }
  for (const avatar of [undefined, null, { kind: 'builtin', id: 'unknown' }, { kind: 'uploaded', attachmentId: 'missing' }]) {
    act(() => {
      if (renderer) renderer.unmount()
      renderer = create(createElement(RoomAvatar, { ...props, avatar: avatar as Parameters<typeof RoomAvatar>[0]['avatar'] }))
    })
    expect(renderer.root.findByProps({ 'data-avatar-id': 'coder' })).toBeTruthy()
    expect(renderer.root.findByProps({ role: 'img' }).props['aria-label']).toBe('My Agent')
  }
})
it('does not cycle between a broken upload and a broken user fallback image', () => {
  act(() => { renderer = create(createElement(RoomAvatar, { id: 'user', label: 'You', avatar: { kind: 'uploaded', attachmentId: 'good' } })) })
  act(() => renderer.root.findByType('img').props.onError())
  expect(renderer.root.findByType('img').props.src).toContain('kun_greet.png')
  act(() => renderer.root.findByType('img').props.onError())
  expect(renderer.root.findAllByType('img')).toHaveLength(0)
  expect(renderer.root.findAllByProps({ className: 'rooms-avatar-art' })).toHaveLength(1)
})
it('crops list-sized avatars to the face and keeps large portraits whole', () => {
  act(() => { renderer = create(createElement(Fragment, null,
    createElement(RoomAvatar, { id: 'agent', label: 'List', size: 34, avatar: { kind: 'builtin', id: 'detective' } }),
    createElement(RoomAvatar, { id: 'agent', label: 'Profile', size: 96, avatar: { kind: 'builtin', id: 'detective' } }))) })
  const [list, profile] = renderer.root.findAll((node) => node.type === 'span' && node.props.className === 'rooms-avatar')
  expect(list!.props['data-compact']).toBe(true)
  expect(profile!.props['data-compact']).toBeUndefined()
})
