// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileCodeHome } from './MobileCodeHome'

const state = vi.hoisted(() => ({
  codeWorkspaceRoots: ['/projects/alpha', '/projects/beta'], workspaceRoot: '/projects/alpha',
  threads: [
    { id: 'a', title: 'Alpha task', workspace: '/projects/alpha', updatedAt: '', model: '' },
    { id: 'b', title: 'Beta task', workspace: '/projects/beta', updatedAt: '', model: '' },
    { id: 'w', title: 'Write task', workspace: '/projects/alpha', agentSurface: 'write', updatedAt: '', model: '' }
  ],
  threadListCursorByWorkspace: {}, threadListStatus: 'ready', threadListError: null, error: '', activeThreadId: '',
  selectWorkspaceRoot: vi.fn(async (root: string) => root), chooseWorkspace: vi.fn(async () => null),
  refreshThreads: vi.fn(), loadMoreThreads: vi.fn(), createConversation: vi.fn(),
  openSettings: vi.fn(), selectThread: vi.fn(async () => undefined)
}))
vi.mock('../../store/chat-store', () => ({useChatStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {getState: () => state})}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.clearAllMocks()
  state.selectWorkspaceRoot.mockResolvedValue('/projects/alpha')
})
afterEach(() => { act(() => root.unmount()); host.remove() })
it('starts with projects, selects the real workspace, and never mixes projects or surfaces', async () => {
  act(() => root.render(createElement(MobileCodeHome, {onOpen: vi.fn()})))
  expect(host.querySelectorAll('.kun-mobile-project-row')).toHaveLength(2)
  expect(host.textContent).not.toContain('Alpha task')
  await act(async () => { (host.querySelector('.kun-mobile-project-row') as HTMLButtonElement).click() })
  expect(state.selectWorkspaceRoot).toHaveBeenCalledWith('/projects/alpha')
  expect(host.textContent).toContain('Alpha task')
  expect(host.textContent).not.toContain('Beta task')
  expect(host.textContent).not.toContain('Write task')
  act(() => { (host.querySelector('.kun-mobile-workspace') as HTMLButtonElement).click() })
  expect(host.querySelectorAll('.kun-mobile-project-row')).toHaveLength(2)
})
it('does not enter a project when switching fails', async () => {
  state.selectWorkspaceRoot.mockRejectedValueOnce(new Error('Offline'))
  act(() => root.render(createElement(MobileCodeHome, {onOpen: vi.fn()})))
  await act(async () => { (host.querySelector('.kun-mobile-project-row') as HTMLButtonElement).click() })
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Offline')
  expect(host.querySelector('.kun-mobile-thread')).toBeNull()
})
