// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileCodeHome } from './MobileCodeHome'
import { saveThreadWorktreeRegistry } from '../../lib/thread-worktree-registry'

const state = vi.hoisted(() => ({
  codeWorkspaceRoots: ['/projects/alpha', '/projects/beta'], workspaceRoot: '/projects/alpha',
  conversationWorkspaceRoot: '/conversations',
  removedCodeWorkspaces: { version: 1, removed: [] as never[] },
  threads: [
    { id: 'a', title: 'Alpha task', workspace: '/projects/alpha', updatedAt: '', model: '' },
    { id: 'b', title: 'Beta task', workspace: '/projects/beta', updatedAt: '', model: '' },
    { id: 'w', title: 'Write task', workspace: '/projects/alpha', agentSurface: 'write', updatedAt: '', model: '' }
  ],
  threadListCursorByWorkspace: {} as Record<string, unknown>,
  threadListStatus: 'ready', threadListError: null, error: '',
  activeThreadId: null as string | null, runtimeConnection: 'ready',
  clawChannels: [], showArchivedThreads: false,
  composerModel: '', composerProviderId: '', composerPickList: [] as string[],
  composerModelGroups: [], composerMode: 'auto', composerReasoningEffort: 'auto',
  selectWorkspaceRoot: vi.fn(async (root: string) => root),
  chooseWorkspace: vi.fn(async () => null),
  refreshThreads: vi.fn(async () => undefined),
  loadMoreThreads: vi.fn(async () => undefined),
  createThread: vi.fn(async () => 'created-thread'),
  selectThread: vi.fn(async () => undefined),
  openSettings: vi.fn(),
  setComposerModel: vi.fn(async () => undefined),
  setComposerMode: vi.fn(), setComposerReasoningEffort: vi.fn(),
  renameThread: vi.fn(async () => undefined), archiveThread: vi.fn(async () => undefined)
}))
vi.mock('../../store/chat-store', () => ({useChatStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {getState: () => state})}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key, i18n: {language: 'en'}}),
  initReactI18next: {type: '3rdParty', init: () => undefined}
}))
vi.mock('../../agent/registry', () => ({getProvider: () => ({})}))
function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() { return items.size },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key) },
    setItem: (key, value) => { items.set(key, value) }
  }
}
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
  vi.stubGlobal('localStorage', createMemoryStorage())
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.clearAllMocks()
  state.codeWorkspaceRoots = ['/projects/alpha', '/projects/beta']
  state.workspaceRoot = '/projects/alpha'
  state.threadListCursorByWorkspace = {}
  state.threadListStatus = 'ready'
  state.threads = [
    { id: 'a', title: 'Alpha task', workspace: '/projects/alpha', updatedAt: '', model: '' },
    { id: 'b', title: 'Beta task', workspace: '/projects/beta', updatedAt: '', model: '' },
    { id: 'w', title: 'Write task', workspace: '/projects/alpha', agentSurface: 'write', updatedAt: '', model: '' }
  ]
  state.selectWorkspaceRoot.mockImplementation(async (root: string) => root)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

async function openFirstProject(): Promise<void> {
  await act(async () => { (host.querySelector('.kun-mobile-project-row') as HTMLButtonElement).click() })
}

it('starts with projects, selects the real workspace, and never mixes projects or surfaces', async () => {
  act(() => root.render(createElement(MobileCodeHome, {onOpen: vi.fn()})))
  expect(host.querySelectorAll('.kun-mobile-project-row')).toHaveLength(2)
  expect(host.textContent).toContain('mobileCodeProjects')
  expect(host.textContent).not.toContain('/projects/alpha')
  // The recent strip surfaces code threads only — never other surfaces.
  expect(host.querySelector('.kun-mobile-recent')?.textContent).toContain('Alpha task')
  expect(host.textContent).not.toContain('Write task')
  expect(host.querySelector('.kun-mobile-project-add')).toBeNull()
  expect(host.querySelector('[aria-label="selectWorkspace"]')).toBeTruthy()
  await openFirstProject()
  expect(state.selectWorkspaceRoot).toHaveBeenCalledWith('/projects/alpha', { persist: false })
  expect(host.textContent).toContain('Alpha task')
  expect(host.textContent).not.toContain('Beta task')
  expect(host.textContent).not.toContain('Write task')
  act(() => { (host.querySelector('.kun-mobile-back') as HTMLButtonElement).click() })
  expect(host.querySelectorAll('.kun-mobile-project-row')).toHaveLength(2)
})
it('does not enter a project when switching fails', async () => {
  state.selectWorkspaceRoot.mockRejectedValueOnce(new Error('Offline'))
  act(() => root.render(createElement(MobileCodeHome, {onOpen: vi.fn()})))
  await act(async () => { (host.querySelector('.kun-mobile-project-row') as HTMLButtonElement).click() })
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Offline')
  // Still on the projects screen — no per-project thread list mounted.
  expect(host.querySelector('.kun-mobile-home')).toBeNull()
})
it('auto-loads the selected project page and creates new threads inside it', async () => {
  const onOpen = vi.fn()
  act(() => root.render(createElement(MobileCodeHome, {onOpen})))
  await openFirstProject()
  // A cold project (no cursor entry) must fetch its own first page instead of
  // relying on the global 100-thread inventory.
  expect(state.loadMoreThreads).toHaveBeenCalledWith('/projects/alpha')
  // Simulate the store finishing the project page so the composer unlocks.
  // The store mock is not reactive — re-render to re-read it.
  act(() => {
    state.threadListCursorByWorkspace = {
      '/projects/alpha': { workspaceKey: '/projects/alpha', mode: 'active', status: 'complete', hasMore: false }
    }
    root.render(createElement(MobileCodeHome, {onOpen}))
  })
  await act(async () => {
    (host.querySelector('[aria-label="newChat"]') as HTMLButtonElement).click()
  })
  expect(state.createThread).toHaveBeenCalledWith({
    workspaceRoot: '/projects/alpha', forceNew: true, agentSurface: 'code'
  })
  expect(onOpen).toHaveBeenCalledWith('created-thread')
})
it('groups registered worktree conversations under their owning project', async () => {
  state.threads = [
    ...state.threads,
    { id: 'wt', title: 'Worktree task', workspace: '/home/u/.kun/worktrees/ab12/alpha', updatedAt: '', model: '' }
  ]
  saveThreadWorktreeRegistry({
    version: 1,
    worktrees: {
      wt: { projectPath: '/projects/alpha', worktreePath: '/home/u/.kun/worktrees/ab12/alpha', branch: 'kun-ab12' }
    }
  })
  act(() => root.render(createElement(MobileCodeHome, {onOpen: vi.fn()})))
  await openFirstProject()
  expect(host.textContent).toContain('Worktree task')
  // The worktree itself is not a separate project row.
  const labels = [...host.querySelectorAll('.kun-mobile-project-row')].map((row) => row.textContent)
  expect(labels.join()).not.toContain('worktrees')
})
it('shows an empty choose-project state and opens a working directory from there', async () => {
  state.codeWorkspaceRoots = []
  state.workspaceRoot = ''
  state.threads = []
  act(() => root.render(createElement(MobileCodeHome, {onOpen: vi.fn()})))
  expect(host.querySelector('.kun-mobile-project-empty')?.textContent).toContain('mobileCodeChooseProject')
  await act(async () => { (host.querySelector('.kun-mobile-project-add') as HTMLButtonElement).click() })
  expect(state.chooseWorkspace).toHaveBeenCalledWith({ createThreadAfter: false, selectThreadAfter: false, persist: false })
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
