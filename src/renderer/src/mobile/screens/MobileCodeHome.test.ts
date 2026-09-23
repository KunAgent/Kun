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
  state.codeWorkspaceRoots = ['/projects/alpha', '/projects/beta']
  state.workspaceRoot = '/projects/alpha'
  state.selectWorkspaceRoot.mockResolvedValue('/projects/alpha')
})
afterEach(() => { act(() => root.unmount()); host.remove() })
it('starts with projects, selects the real workspace, and never mixes projects or surfaces', async () => {
  act(() => root.render(createElement(MobileCodeHome, {onOpen: vi.fn()})))
  expect(host.querySelectorAll('.kun-mobile-project-row')).toHaveLength(2)
  expect(host.textContent).toContain('projects')
  expect(host.textContent).not.toContain('/projects/alpha')
  expect(host.textContent).not.toContain('Alpha task')
  expect(host.querySelector('.kun-mobile-project-add')).toBeNull()
  expect(host.querySelector('[aria-label="selectWorkspace"]')).toBeTruthy()
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
it('shows an empty choose-project state and opens a working directory from there', async () => {
  state.codeWorkspaceRoots = []
  state.workspaceRoot = ''
  act(() => root.render(createElement(MobileCodeHome, {onOpen: vi.fn()})))
  expect(host.querySelector('.kun-mobile-project-empty')?.textContent).toContain('mobileCodeChooseProject')
  await act(async () => { (host.querySelector('.kun-mobile-project-add') as HTMLButtonElement).click() })
  expect(state.chooseWorkspace).toHaveBeenCalledWith({ createThreadAfter: false, selectThreadAfter: false })
})
it('hides unmatched projects and keeps the header add action', async () => {
  act(() => root.render(createElement(MobileCodeHome, {onOpen: vi.fn()})))
  act(() => {
    const input = host.querySelector('input[type="search"]') as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'zzz')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(host.querySelectorAll('.kun-mobile-project-row')).toHaveLength(0)
  expect(host.textContent).toContain('composerWorkspaceNoMatch')
  expect(host.querySelector('.kun-mobile-project-add')).toBeNull()
  await act(async () => { (host.querySelector('[aria-label="selectWorkspace"]') as HTMLButtonElement).click() })
  expect(state.chooseWorkspace).toHaveBeenCalled()
})
