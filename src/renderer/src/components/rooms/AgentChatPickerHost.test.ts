// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  chat: { route: 'chat', activeThreadId: 'thread' as string | null },
  navigation: { roomId: 'dm-alpha' as string | null },
  openRoom: vi.fn(), openAgent: vi.fn(),
  picker: [] as Array<{ selectionMode: string; initialGroup: boolean }>
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('../../store/chat-store', () => ({ useChatStore: { getState: () => mocks.chat } }))
vi.mock('./agent-chat-navigation', () => ({
  useAgentChatNavigationStore: { getState: () => mocks.navigation },
  openAgentConversationRoom: mocks.openRoom,
  openAgentConversation: mocks.openAgent
}))
vi.mock('./RoomNewChat', () => ({
  RoomNewChat: ({ selectionMode, initialGroup, onAgent, onOpen, onFill, onClose }: {
    selectionMode: string; initialGroup: boolean; onAgent: (id: string) => void; onOpen: (id: string) => void
    onFill: () => void; onClose: () => void
  }) => {
    mocks.picker.push({ selectionMode, initialGroup })
    return createElement('div', { 'data-new-chat': selectionMode },
      createElement('button', { onClick: () => { onAgent('agent-a'); onClose() } }, 'Choose agent'),
      createElement('button', { onClick: () => { onFill(); onClose() } }, 'Fill agent profile'),
      createElement('button', { onClick: () => { onOpen('group-room'); onClose() } }, 'Created room'))
  }
}))
vi.mock('./RoomModal', () => ({
  RoomModal: ({ children, title }: { children: ReactNode; title: string }) => createElement('div', { 'data-modal-title': title }, children)
}))
vi.mock('./AgentProfileForm', () => ({
  AgentProfileForm: ({ onSaved }: { onSaved: (agent: { id: string }) => void }) =>
    createElement('button', { onClick: () => onSaved({ id: 'manual-agent' }) }, 'Save agent profile')
}))
vi.mock('./AgentDirectory', () => ({
  AgentDirectory: ({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) =>
    createElement('div', { 'data-directory': true },
      createElement('button', { onClick: () => onOpen('agent-b') }, 'Open agent'),
      createElement('button', { onClick: onCreate }, 'Create agent'))
}))
import { AgentChatPickerHost } from './AgentChatPickerHost'
import { openAgentChatDialog, useAgentChatPicker } from './agent-chat-picker'

let root: Root
let host: HTMLDivElement
const click = async (label: string): Promise<void> => {
  await act(async () => [...host.querySelectorAll('button')].find((item) => item.textContent === label)!.click())
}
async function render(): Promise<void> {
  await act(async () => root.render(createElement(AgentChatPickerHost)))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.chat = { route: 'chat', activeThreadId: 'thread' }
  mocks.navigation = { roomId: 'dm-alpha' }
  mocks.openRoom.mockReset(); mocks.openAgent.mockReset().mockResolvedValue(undefined); mocks.picker = []
  useAgentChatPicker.setState({ dialog: null, group: false, origin: null, serial: 0 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('Code conversation picker host', () => {
  it('renders nothing until a picker is requested, then offers private and group creation', async () => {
    await render()
    expect(host.innerHTML).toBe('')
    act(() => openAgentChatDialog('picker', { group: true }))
    await render()
    expect(host.querySelector('[data-new-chat="all"]')).not.toBeNull()
    expect(mocks.picker.at(-1)).toEqual({ selectionMode: 'all', initialGroup: true })
  })

  it('opens a chosen Agent and closes the picker', async () => {
    act(() => openAgentChatDialog('picker'))
    await render()
    await click('Choose agent')
    expect(mocks.openAgent).toHaveBeenCalledWith('agent-a')
    expect(useAgentChatPicker.getState().dialog).toBeNull()
  })

  it('opens a newly created group conversation while the user is still where they started', async () => {
    act(() => openAgentChatDialog('picker'))
    await render()
    await click('Created room')
    expect(mocks.openRoom).toHaveBeenCalledWith('group-room')
  })

  it('does not let a late creation result override a newer task, even after navigating back', async () => {
    act(() => openAgentChatDialog('picker'))
    await render()
    mocks.chat = { route: 'chat', activeThreadId: 'another-task' }
    await click('Created room')
    expect(mocks.openRoom).not.toHaveBeenCalled()
  })

  it('moves from the picker to Agent creation and opens the new private conversation after saving', async () => {
    act(() => openAgentChatDialog('picker'))
    await render()
    await click('Fill agent profile')
    expect(useAgentChatPicker.getState().dialog).toBe('profile')
    await render()
    expect(host.querySelector('[data-modal-title="agentsCreate"]')).not.toBeNull()
    await click('Save agent profile')
    expect(mocks.openAgent).toHaveBeenCalledWith('manual-agent')
    expect(useAgentChatPicker.getState().dialog).toBeNull()
  })

  it('opens Agents from the directory and can switch to Agent creation', async () => {
    act(() => openAgentChatDialog('directory'))
    await render()
    expect(host.querySelector('[data-modal-title="agentDirectoryTitle"] [data-directory]')).not.toBeNull()
    await click('Open agent')
    expect(mocks.openAgent).toHaveBeenCalledWith('agent-b')
    expect(useAgentChatPicker.getState().dialog).toBeNull()
    act(() => openAgentChatDialog('directory'))
    await render()
    await click('Create agent')
    expect(useAgentChatPicker.getState().dialog).toBe('profile')
  })
})
