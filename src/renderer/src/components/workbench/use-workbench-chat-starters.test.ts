// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import type { ChatState } from '../../store/chat-store-types'
import { OPEN_WORKERS_PANEL_EVENT } from '../chat/FloatingComposerWorkersPill'
import { useWorkbenchChatStarters, type WorkbenchChatStarterDeps } from './use-workbench-chat-starters'

const original = useChatStore.getState()
let renderer: Root
let host: HTMLDivElement
let starters: ReturnType<typeof useWorkbenchChatStarters>
let createThread: ReturnType<typeof vi.fn>
let startAdeDraft: ReturnType<typeof vi.fn>
let setComposerHarness: ReturnType<typeof vi.fn>
let setComposerIsolation: ReturnType<typeof vi.fn>
const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
const storageItems = new Map<string, string>()

function Harness({ deps }: { deps: WorkbenchChatStarterDeps }) {
  starters = useWorkbenchChatStarters(deps)
  return null
}

beforeEach(async () => {
  storageItems.clear()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storageItems.get(key) ?? null,
    setItem: (key: string, value: string) => { storageItems.set(key, value) },
    removeItem: (key: string) => { storageItems.delete(key) }
  } })
  host = document.createElement('div')
  document.body.appendChild(host)
  renderer = createRoot(host)
  createThread = vi.fn(async () => 'created')
  startAdeDraft = vi.fn(() => useChatStore.setState({
    route: 'ade', activeThreadId: null, adeDraftOpen: true
  }))
  setComposerHarness = vi.fn()
  setComposerIsolation = vi.fn()
  useChatStore.setState({
    route: 'chat', activeThreadId: null, adeDraftOpen: false, adeThreads: [],
    composerModel: 'old-model', composerProviderId: 'old-provider',
    startAdeDraft: startAdeDraft as ChatState['startAdeDraft'],
    setComposerHarness: setComposerHarness as ChatState['setComposerHarness'],
    setComposerIsolation: setComposerIsolation as ChatState['setComposerIsolation']
  })
  const deps: WorkbenchChatStarterDeps = {
    activeSddDraft: false,
    beginNavigation: vi.fn(() => 1),
    createThread: createThread as ChatState['createThread'],
    dismissActiveSddDraft: vi.fn(),
    navigationIsCurrent: vi.fn(() => true),
    setConnectPhoneSidebarOpen: vi.fn(),
    setRoute: vi.fn(),
    setUseWorktreePool: vi.fn(),
    useWorktreePool: false,
    worktreeBranch: 'main'
  }
  await act(async () => { renderer.render(createElement(Harness, { deps })) })
})

afterEach(async () => {
  await act(async () => renderer.unmount())
  host.remove()
  useChatStore.setState(original)
  if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
})

describe('ADE chat starters', () => {
  it('opens an unsent manager draft and opens Workers only after its thread exists', async () => {
    window.localStorage.setItem('kun.composerIsolation', 'worktree')
    const opened = vi.fn()
    window.addEventListener(OPEN_WORKERS_PANEL_EVENT, opened)
    try {
      await act(async () => starters.startNewAdeChat())
      expect(startAdeDraft).toHaveBeenCalledTimes(1)
      expect(createThread).not.toHaveBeenCalled()
      expect(setComposerHarness).toHaveBeenCalledWith('', '')
      expect(setComposerIsolation).toHaveBeenCalledWith('worktree', { kind: 'default-branch' })
      expect(useChatStore.getState().composerModel).toBe('')
      expect(opened).not.toHaveBeenCalled()

      await act(async () => useChatStore.setState({
        activeThreadId: 'created', adeDraftOpen: false,
        adeThreads: [{ id: 'created' } as ChatState['adeThreads'][number]]
      }))
      expect(opened).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(OPEN_WORKERS_PANEL_EVENT, opened)
    }
  })

  it('applies one-on-one choices to the draft without creating a thread', async () => {
    await act(async () => starters.startNewAdeOneOnOne({
      harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-6-sol', isolation: 'local'
    }))
    expect(startAdeDraft).toHaveBeenCalledTimes(1)
    expect(createThread).not.toHaveBeenCalled()
    expect(setComposerHarness).toHaveBeenCalledWith('codex', 'native-login')
    expect(useChatStore.getState()).toMatchObject({
      composerModel: 'gpt-6-sol', composerIsolation: 'local', composerWorktreeStartFrom: undefined
    })
  })

  it('does not open Workers when an existing ADE thread is selected from a manager draft', async () => {
    useChatStore.setState({ adeThreads: [{ id: 'existing' } as ChatState['adeThreads'][number]] })
    const opened = vi.fn()
    window.addEventListener(OPEN_WORKERS_PANEL_EVENT, opened)
    try {
      await act(async () => starters.startNewAdeChat())
      await act(async () => useChatStore.setState({ activeThreadId: 'existing', adeDraftOpen: false }))
      expect(opened).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(OPEN_WORKERS_PANEL_EVENT, opened)
    }
  })
})
