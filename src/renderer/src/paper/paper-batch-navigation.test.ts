import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { useChatStore } from '../store/chat-store'
import { useWorkAssistantNavigation } from '../write/work-assistant-navigation'
import { createWriteDocumentSession } from '../write/write-editor-layout'
import { MemoryStorage } from '../write/write-workspace-file-actions-test-support'
import { emptyWriteThreadRegistry, markWriteThread, readWriteThreadRegistry, saveWriteThreadRegistry } from '../write/write-thread-registry'
import { useWorkbenchWriteAssistantRuntime } from '../components/workbench/useWorkbenchWriteAssistantRuntime'
import { usePaperStore } from '../write/paper/paper-store'
import { usePaperBatchStore } from './paper-batch-store'
import { focusPaperBatchLibrary, selectPaperBatchConversation } from './paper-batch-navigation'
import { paperModeView } from './paper-view'
import { entry, deferred } from '../components/paper/evidence/paper-evidence-test-support'

const mocks = vi.hoisted(() => ({ summary: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: () => ({ getThreadSummary: mocks.summary }) }))

let tree: ReactTestRenderer | undefined
const path = '/library/papers/a/article.md'
const now = '2026-10-06T00:00:00Z'
const threads = ['paper-thread', 'batch-thread', 'other-history'].map((id) => ({
  id, title: id, workspace: '/library', agentSurface: 'write' as const, updatedAt: now, mode: 'agent', model: 'test'
}))
const originalChat = useChatStore.getState()
const originalWorkspace = useWriteWorkspaceStore.getState()
function Harness(): null { useWorkbenchWriteAssistantRuntime({ composerPickList: [], composerModelGroups: [] }); return null }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.summary.mockResolvedValue(threads[1])
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { localStorage: new MemoryStorage(), kunGui: { writeWorkspaceFile: vi.fn() } })
  useChatStore.setState(originalChat, true)
  useWriteWorkspaceStore.setState(originalWorkspace, true)
  useWriteWorkspaceStore.getState().resetWorkspace()
  useWriteWorkspaceStore.setState({ workspaceRoot: '/library', workSurface: 'papers',
    activeFilePath: path, activeFileKind: 'text', fileContent: 'Unsaved latest edits', persistedContent: 'Saved text', saveStatus: 'dirty',
    documentsByPath: { [path]: createWriteDocumentSession({ path, kind: 'text', fileContent: 'Old projection', persistedContent: 'Saved text', saveStatus: 'dirty' }) },
    editorLayout: { version: 1, orientation: 'single', ratio: 0.5, focusedGroupId: 'primary', groups: [{ id: 'primary', activePath: path, tabs: [{ path, viewMode: 'rich' }] }] }
  })
  usePaperStore.setState({ unitsByDir: { 'papers/a': entry.meta } })
  usePaperBatchStore.setState({ batch: null })
  usePaperBatchStore.getState().stage('/library', [entry], 'Batch')
  usePaperBatchStore.getState().update(usePaperBatchStore.getState().batch!.id, { threadId: 'batch-thread', resourcePath: '' })
  let registry = markWriteThread('/library', 'batch-thread', emptyWriteThreadRegistry(), '')
  registry = markWriteThread('/library', 'paper-thread', registry, '/library/papers/a')
  saveWriteThreadRegistry(registry)
  useChatStore.setState({ route: 'write', runtimeConnection: 'ready', activeThreadId: 'paper-thread', threads,
    selectThread: vi.fn(async (id, options) => { if (options?.selectionGuard?.() !== false) useChatStore.setState({ activeThreadId: id }) }),
    selectWriteThread: vi.fn(async (id, root, resource, options) => {
      if (options?.activationGuard?.() === false) return
      saveWriteThreadRegistry(markWriteThread(root!, id, readWriteThreadRegistry(), resource))
      await useChatStore.getState().selectThread(id, options?.activationGuard ? { selectionGuard: options.activationGuard } : undefined)
    }),
    clearActiveThreadSelection: vi.fn(() => useChatStore.setState({ activeThreadId: null }))
  })
  useWorkAssistantNavigation.setState({ surface: 'assistant', previous: null, docked: false })
})
afterEach(async () => {
  await act(async () => tree?.unmount()); tree = undefined
  useChatStore.setState(originalChat, true)
  useWriteWorkspaceStore.setState(originalWorkspace, true)
  vi.unstubAllGlobals()
})

describe('batch library conversation navigation', () => {
  it('restores the library resource before results selection and survives the production rebinding hook', async () => {
    await act(async () => { tree = create(createElement(Harness)) })
    expect(useChatStore.getState().activeThreadId).toBe('paper-thread')
    await act(async () => {
      const batch = usePaperBatchStore.getState().batch!
      await selectPaperBatchConversation(batch, focusPaperBatchLibrary(batch))
    })
    expect(paperModeView(useWriteWorkspaceStore.getState())).toBe('library')
    expect(useChatStore.getState().activeThreadId).toBe('batch-thread')
    await act(async () => useChatStore.setState({ threads: [...threads] }))
    expect(useChatStore.getState().activeThreadId).toBe('batch-thread')
    const document = useWriteWorkspaceStore.getState().documentsByPath[path]
    expect(document).toMatchObject({ fileContent: 'Unsaved latest edits', persistedContent: 'Saved text', saveStatus: 'dirty' })
    expect(useWriteWorkspaceStore.getState().editorLayout.groups[0].tabs.some((tab) => 'path' in tab && tab.path === path)).toBe(true)
    expect(window.kunGui.writeWorkspaceFile).not.toHaveBeenCalled()
  })

  it('recovers a stale-created thread by exact summary only on explicit Open results', async () => {
    useChatStore.setState({ threads: threads.filter((thread) => thread.id !== 'batch-thread') })
    const batch = usePaperBatchStore.getState().batch!
    await selectPaperBatchConversation(batch, focusPaperBatchLibrary(batch))
    expect(mocks.summary).toHaveBeenCalledWith('batch-thread')
    expect(useChatStore.getState().threads.some((thread) => thread.id === 'batch-thread')).toBe(true)
    expect(useChatStore.getState().activeThreadId).toBe('batch-thread')
  })

  it('does not invalidate activation when docking or expanding the same conversation', () => {
    const batch = usePaperBatchStore.getState().batch!
    const guard = focusPaperBatchLibrary(batch)
    expect(guard('batch-thread')).toBe(true)
    useWorkAssistantNavigation.getState().dockAssistant()
    expect(guard('batch-thread')).toBe(true)
    useWorkAssistantNavigation.getState().openAssistant()
    expect(guard('batch-thread')).toBe(true)
  })

  it('rejects a different conversation chosen during creation while allowing its own target', () => {
    const guard = focusPaperBatchLibrary(usePaperBatchStore.getState().batch!)
    useChatStore.setState({ activeThreadId: 'other-history' })
    expect(guard('new-batch')).toBe(false)
    useChatStore.setState({ activeThreadId: 'new-batch' })
    expect(guard('new-batch')).toBe(true)
  })

  it('does not reopen or select results after newer document navigation during hydration', async () => {
    const ready = deferred<void>()
    useChatStore.setState({ selectThread: vi.fn(async (id, options) => {
      await ready.promise
      if (options?.selectionGuard?.() !== false) useChatStore.setState({ activeThreadId: id })
    }) })
    const batch = usePaperBatchStore.getState().batch!
    const selecting = selectPaperBatchConversation(batch, focusPaperBatchLibrary(batch))
    useWriteWorkspaceStore.getState().activateTab('primary', path)
    useWorkAssistantNavigation.getState().openWorkspace()
    ready.resolve()
    await selecting
    expect(useWriteWorkspaceStore.getState().activeFilePath).toBe(path)
    expect(useWorkAssistantNavigation.getState().surface).toBe('workspace')
    expect(useChatStore.getState().activeThreadId).toBe('paper-thread')
  })
})
