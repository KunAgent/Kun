import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { RoomHeader } from './RoomHeader'
import type { Room } from '@shared/rooms-api'

vi.mock('./RoomAvatar', () => ({ RoomAvatarGroup: () => null }))
vi.mock('./RoomManagementControls', () => ({
  RoomAppearanceMenu: () => null,
  RoomNotificationMenu: () => null
}))
vi.mock('./RoomPopover', () => ({
  RoomPopover: ({ children }: { children: (close: () => void) => ReactNode }) =>
    createElement('div', { 'data-testid': 'room-popover' }, children(() => undefined))
}))

const room = {
  id: 'room-1',
  name: 'Project Alpha',
  description: '',
  collaborationMode: 'peer',
  conversationKind: 'group',
  pinned: false,
  archivedAt: undefined,
  members: []
} as unknown as Room

const baseProps = () => ({
  room: room as Room,
  busy: false,
  searchOpen: false,
  onSidebar: vi.fn(),
  onSearch: vi.fn(),
  onDetails: vi.fn(),
  onMembers: vi.fn(),
  onSettings: vi.fn(),
  onUpdate: vi.fn()
})

describe('RoomHeader inline rename', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()) })

  it('enters edit mode with the current name when the pencil is clicked', async () => {
    await act(async () => { renderer = create(createElement(RoomHeader, baseProps())) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Rename' }).props.onClick() })
    expect(renderer.root.findByType('input').props.value).toBe('Project Alpha')
  })

  it('submits a trimmed new name on Enter and exits edit mode', async () => {
    const onUpdate = vi.fn()
    await act(async () => { renderer = create(createElement(RoomHeader, { ...baseProps(), onUpdate })) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Rename' }).props.onClick() })
    const input = renderer.root.findByType('input')
    await act(async () => { input.props.onChange({ target: { value: '  New Name  ' } }) })
    await act(async () => { input.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() }) })
    expect(onUpdate).toHaveBeenCalledWith({ name: 'New Name' })
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
  })

  it('cancels on Escape without updating and restores the title', async () => {
    const onUpdate = vi.fn()
    await act(async () => { renderer = create(createElement(RoomHeader, { ...baseProps(), onUpdate })) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Rename' }).props.onClick() })
    const input = renderer.root.findByType('input')
    await act(async () => { input.props.onKeyDown({ key: 'Escape', preventDefault: vi.fn() }) })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    expect(renderer.root.findByType('h1')).toBeTruthy()
  })

  it('ignores blank and unchanged submissions', async () => {
    const onUpdate = vi.fn()
    await act(async () => { renderer = create(createElement(RoomHeader, { ...baseProps(), onUpdate })) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Rename' }).props.onClick() })
    let input = renderer.root.findByType('input')
    await act(async () => { input.props.onChange({ target: { value: '   ' } }) })
    await act(async () => { input.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() }) })
    expect(onUpdate).not.toHaveBeenCalled()

    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Rename' }).props.onClick() })
    input = renderer.root.findByType('input')
    await act(async () => { input.props.onChange({ target: { value: 'Project Alpha' } }) })
    await act(async () => { input.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() }) })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
  })

  it('starts editing from the more-actions menu', async () => {
    await act(async () => { renderer = create(createElement(RoomHeader, baseProps())) })
    const renameItem = renderer.root.findAllByType('button')
      .find((button) => Array.isArray(button.children) && button.children.includes('Rename'))!
    await act(async () => { renameItem.props.onClick() })
    expect(renderer.root.findByType('input').props.value).toBe('Project Alpha')
  })
})
