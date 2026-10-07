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
  members: [],
  repositories: []
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

  it('shows the collaboration mode in the header and summarizes members and the linked project', async () => {
    const onUpdate = vi.fn()
    const groupRoom = { ...room, members: [{ id: 'a', displayName: 'Avery', enabled: true }, { id: 'b', displayName: 'Codex', enabled: true }],
      repositories: [{ id: 'repo', displayName: 'DeepSeek-GUI' }] } as unknown as Room
    await act(async () => { renderer = create(createElement(RoomHeader, { ...baseProps(), room: groupRoom, onUpdate })) })
    const select = renderer.root.findByProps({ 'aria-label': i18n.t('roomsMode') })
    expect(select.props.value).toBe('peer')
    await act(async () => { select.props.onChange({ target: { value: 'directed' } }) })
    expect(onUpdate).toHaveBeenCalledWith({ collaborationMode: 'directed' })
    expect(renderer.root.findByType('p').children.join('')).toBe(`${i18n.t('conversationMemberCount', { count: 2 })} · DeepSeek-GUI`)
  })

  it('toggles the Code sidebar and keeps pair transcripts without a mode control', async () => {
    const onSidebar = vi.fn()
    const pair = { ...room, conversationKind: 'agent_agent' } as unknown as Room
    await act(async () => { renderer = create(createElement(RoomHeader, { ...baseProps(), room: pair, onSidebar })) })
    await act(async () => { renderer.root.findByProps({ 'aria-label': i18n.t('sidebarToggle') }).props.onClick() })
    expect(onSidebar).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByProps({ 'aria-label': i18n.t('roomsMode') })).toHaveLength(0)
  })

  it('starts editing from the more-actions menu', async () => {
    await act(async () => { renderer = create(createElement(RoomHeader, baseProps())) })
    const renameItem = renderer.root.findAllByType('button')
      .find((button) => Array.isArray(button.children) && button.children.includes('Rename'))!
    await act(async () => { renameItem.props.onClick() })
    expect(renderer.root.findByType('input').props.value).toBe('Project Alpha')
  })
})

describe('RoomHeader conversation management', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => { await i18n.changeLanguage('en') })
  afterEach(() => { if (renderer) act(() => renderer.unmount()) })

  it('opens group info first and keeps group deletion last in the menu', async () => {
    const onInfo = vi.fn(), onRemove = vi.fn()
    await act(async () => { renderer = create(createElement(RoomHeader, { ...baseProps(), onInfo, onRemove })) })
    const actions = renderer.root.findAllByType('button').map((button) => button.props['data-conversation-action']).filter(Boolean)
    expect(actions).toEqual(['info', 'group'])
    const remove = renderer.root.findByProps({ 'data-conversation-action': 'group' })
    expect(remove.props.className).toBe('is-danger')
    await act(async () => { renderer.root.findByProps({ 'data-conversation-action': 'info' }).props.onClick() })
    await act(async () => { remove.props.onClick() })
    expect(onInfo).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('offers neither the board nor removal for an Agent pair transcript', async () => {
    await act(async () => { renderer = create(createElement(RoomHeader, { ...baseProps(),
      room: { ...room, conversationKind: 'agent_agent' } as Room, onInfo: vi.fn(), onRemove: vi.fn() })) })
    expect(renderer.root.findAllByProps({ 'data-conversation-action': 'info' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-conversation-action': 'group' })).toHaveLength(0)
  })
})
