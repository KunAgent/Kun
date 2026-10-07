import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import type { NormalizedThread } from '../../agent/types'
import {
  emptyDesignThreadRegistry,
  markDesignThread,
  readDesignThreadRegistry,
  saveDesignThreadRegistry
} from '../../design/design-thread-registry'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import { markSddAssistantThread } from '../../sdd/sdd-thread-registry'
import type { SddDraft } from '../../sdd/sdd-draft-store'
import { useSddDraftStore } from '../../sdd/sdd-draft-store'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import {
  designDocumentRefForWorkbenchThread,
  isWorkbenchDesignThread,
  useWorkbenchNavigationController,
  type UseWorkbenchNavigationControllerParams
} from './useWorkbenchNavigationController'

function thread(agentSurface?: NormalizedThread['agentSurface']): NormalizedThread {
  return {
    id: 'thr_design',
    title: 'A drawing',
    ...(agentSurface ? { agentSurface } : {}),
    updatedAt: '2026-08-01T00:00:00.000Z',
    model: 'gpt-5.6-luna',
    mode: 'agent',
    workspace: '/workspace/project'
  }
}

describe('workbench thread navigation surface', () => {
  it('identifies a legacy standalone Design task without a local registry', () => {
    expect(isWorkbenchDesignThread(
      'thr_design',
      thread('design'),
      emptyDesignThreadRegistry()
    )).toBe(true)
  })

  it('identifies legacy registered Design threads without changing the registry', () => {
    const registry = markDesignThread(
      '/workspace/project',
      'drawing-1',
      'thr_design',
      emptyDesignThreadRegistry()
    )

    expect(isWorkbenchDesignThread('thr_design', thread(), registry)).toBe(true)
  })

  it('leaves Code and Write threads on their own navigation paths', () => {
    expect(isWorkbenchDesignThread(
      'thr_design',
      thread('code'),
      emptyDesignThreadRegistry()
    )).toBe(false)
    expect(isWorkbenchDesignThread(
      'thr_design',
      thread('write'),
      emptyDesignThreadRegistry()
    )).toBe(false)
  })

  it('identifies Code-owned Design tasks from their locked profile', () => {
    // A stale legacy lockedTaskSurface never classifies a Code-owned
    // conversation; only the locked Design profile does.
    expect(isWorkbenchDesignThread(
      'thr_design',
      { ...thread('code'), lockedTaskSurface: 'design' },
      emptyDesignThreadRegistry()
    )).toBe(false)
    expect(isWorkbenchDesignThread(
      'thr_design',
      { ...thread('code'), lockedTaskSurface: 'code', designProfile: {
        version: 1,
        documentTarget: { documentId: 'runtime-document', boardArtifactId: 'board-1' },
        outputMedium: 'html',
        target: 'web',
        preset: 'none',
        context: { tone: [] },
        lockedAtTurnId: 'turn-1'
      } },
      emptyDesignThreadRegistry()
    )).toBe(true)
  })

  it('resolves the runtime profile document for a Code-owned Design turn', () => {
    const designTask: NormalizedThread = {
      ...thread('code'),
      designProfile: {
        version: 1,
        documentTarget: { documentId: 'runtime-document', boardArtifactId: 'board-1' },
        outputMedium: 'html',
        target: 'web',
        preset: 'none',
        context: { tone: [] },
        lockedAtTurnId: 'turn-1'
      }
    }

    expect(designDocumentRefForWorkbenchThread(
      designTask.id,
      designTask,
      emptyDesignThreadRegistry()
    )).toEqual({
      workspaceRoot: '/workspace/project',
      docId: 'runtime-document',
      boardArtifactId: 'board-1'
    })
  })
})

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

type NavigationProps = UseWorkbenchNavigationControllerParams

function makeProps(overrides: Partial<NavigationProps> = {}): NavigationProps {
  return {
    activeSddDraft: false,
    activeThreadId: null,
    pluginHostRoute: 'chat',
    rightPanelMode: null,
    route: 'chat',
    sddDraftContent: '',
    threads: [],
    useWorktreePool: false,
    workspaceRoot: '/workspace',
    worktreeBranch: '',
    clearFilePreviewTargets: vi.fn(),
    createConversation: vi.fn(async () => undefined),
    createThread: vi.fn(async () => 'thr_new'),
    dismissActiveSddDraft: vi.fn(),
    findSddDraftForSidebarThread: vi.fn(async () => null),
    openClaw: vi.fn(),
    openCode: vi.fn(async () => undefined),
    openPlugins: vi.fn(),
    openSchedule: vi.fn(),
    openWorkflow: vi.fn(),
    openWrite: vi.fn(async () => undefined),
    selectThread: vi.fn(async () => undefined),
    setConnectPhoneSidebarOpen: vi.fn(),
    setDesignAssistantOpen: vi.fn(),
    setFilePreviewTarget: vi.fn(),
    setInput: vi.fn(),
    setRightPanelMode: vi.fn(),
    setRoute: vi.fn(),
    setUseWorktreePool: vi.fn(),
    setWriteAssistantOpen: vi.fn(),
    ...overrides
  } as NavigationProps
}

const sddDraft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: '/Users/zxy/project',
  relativePath: '.kunsdd/requirements/draft-1/requirement.md',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const requirementThread: NormalizedThread = {
  id: 'thr_sdd',
  title: 'Requirement session',
  updatedAt: '2026-01-02T00:00:00.000Z',
  model: 'deepseek-v4-pro',
  mode: 'agent',
  workspace: '/Users/zxy/project'
}

let latestController: ReturnType<typeof useWorkbenchNavigationController>

function ControllerHarness(props: NavigationProps): null {
  latestController = useWorkbenchNavigationController(props)
  return null
}

async function renderController(props: NavigationProps): Promise<{
  renderer: ReactTestRenderer
  rerender: (next: NavigationProps) => Promise<void>
}> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(ControllerHarness, props))
  })
  return {
    renderer,
    rerender: async (next) => {
      await act(async () => {
        renderer.update(createElement(ControllerHarness, next))
      })
    }
  }
}

async function openThreadAndFlush(threadId: string): Promise<void> {
  await act(async () => {
    latestController.openThread(threadId)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

function expectSelected(selectThread: NavigationProps['selectThread'], threadId: string): void {
  expect(selectThread).toHaveBeenCalledWith(threadId, {
    selectionGuard: expect.any(Function)
  })
}

describe('workbench navigation controller Design tasks', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useSddDraftStore.getState().clearActiveDraft()
    useCodeCanvasDesignSurface.setState({ surface: null })
    useDesignWorkspaceStore.setState({
      workspaceRoot: '',
      documents: [],
      activeDocumentId: null
    })
  })

  afterEach(() => {
    useCodeCanvasDesignSurface.setState({ surface: null })
    useSddDraftStore.getState().clearActiveDraft()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens a locked Design task in Code and restores its runtime document target', async () => {
    const storage = new MemoryStorage()
    const dispatchEvent = vi.fn(() => true)
    vi.stubGlobal('window', { localStorage: storage, dispatchEvent })
    const rehydrateArtifacts = vi
      .spyOn(useDesignWorkspaceStore.getState(), 'rehydrateArtifacts')
      .mockResolvedValue()
    const designTask: NormalizedThread = {
      ...thread('code'),
      lockedTaskSurface: 'design',
      designProfile: {
        version: 1,
        documentTarget: { documentId: 'runtime-document', boardArtifactId: 'board-1' },
        outputMedium: 'html',
        target: 'web',
        preset: 'none',
        context: { tone: ['quiet'] },
        lockedAtTurnId: 'turn-1'
      }
    }
    const props = makeProps({ threads: [designTask] })

    await renderController(props)
    await openThreadAndFlush(designTask.id)

    expect(props.setRoute).toHaveBeenCalledWith('chat')
    expectSelected(props.selectThread, designTask.id)
    expect(useCodeCanvasDesignSurface.getState().surface).toEqual({
      surfaceKind: 'kun-design',
      threadId: designTask.id,
      workspaceRoot: '/workspace/project',
      documentId: 'runtime-document'
    })
    expect(rehydrateArtifacts).toHaveBeenCalledTimes(1)
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
  })

  it('keeps an unlocked Design task in Code before it has a profile', async () => {
    const dispatchEvent = vi.fn(() => true)
    vi.stubGlobal('window', { localStorage: new MemoryStorage(), dispatchEvent })
    const designTask = thread('design')
    const props = makeProps({ threads: [designTask] })

    await renderController(props)
    await openThreadAndFlush(designTask.id)

    expect(props.setRoute).toHaveBeenCalledWith('chat')
    expectSelected(props.selectThread, designTask.id)
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
  })

  it('opens a legacy registry-owned thread without rewriting its binding', async () => {
    const storage = new MemoryStorage()
    const registry = markDesignThread(
      '/workspace/project',
      'legacy-document',
      'thr_design',
      emptyDesignThreadRegistry()
    )
    saveDesignThreadRegistry(registry, storage)
    vi.stubGlobal('window', { localStorage: storage, dispatchEvent: vi.fn(() => true) })
    vi.spyOn(useDesignWorkspaceStore.getState(), 'rehydrateArtifacts').mockResolvedValue()
    const props = makeProps({ threads: [thread()] })

    await renderController(props)
    await openThreadAndFlush('thr_design')

    expect(props.setRoute).toHaveBeenCalledWith('chat')
    expectSelected(props.selectThread, 'thr_design')
    expect(useCodeCanvasDesignSurface.getState().surface).toEqual({
      surfaceKind: 'kun-design',
      threadId: 'thr_design',
      workspaceRoot: '/workspace/project',
      documentId: 'legacy-document'
    })
    expect(readDesignThreadRegistry(storage)).toEqual(registry)
  })

  it('restores a legacy default drawing after the pre-document registry hydrates', async () => {
    const storage = new MemoryStorage()
    const registry = markDesignThread(
      '/workspace/project',
      '',
      'thr_design',
      emptyDesignThreadRegistry()
    )
    saveDesignThreadRegistry(registry, storage)
    vi.stubGlobal('window', { localStorage: storage, dispatchEvent: vi.fn(() => true) })
    vi.spyOn(useDesignWorkspaceStore.getState(), 'rehydrateArtifacts').mockImplementation(async () => {
      useDesignWorkspaceStore.setState({
        workspaceRoot: '/workspace/project',
        documents: [{
          id: 'legacy-default',
          title: 'Legacy drawing',
          titleOrigin: 'generated',
          createdAt: '2026-08-13T00:00:00.000Z',
          updatedAt: '2026-08-13T00:00:00.000Z',
          order: 0,
          artifacts: [],
          activeArtifactId: null
        }],
        activeDocumentId: 'legacy-default'
      })
    })
    const props = makeProps({ threads: [thread()] })

    await renderController(props)
    await openThreadAndFlush('thr_design')

    expectSelected(props.selectThread, 'thr_design')
    expect(useCodeCanvasDesignSurface.getState().surface).toEqual({
      surfaceKind: 'kun-design',
      threadId: 'thr_design',
      workspaceRoot: '/workspace/project',
      documentId: 'legacy-default'
    })
  })
})

describe('workbench navigation controller requirement sessions', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useSddDraftStore.getState().clearActiveDraft()
    vi.stubGlobal('window', { localStorage: new MemoryStorage() })
  })

  afterEach(() => {
    useSddDraftStore.getState().clearActiveDraft()
    vi.unstubAllGlobals()
  })

  it('opens only the clicked requirement AI session without opening its draft', async () => {
    const storage = new MemoryStorage()
    markSddAssistantThread(sddDraft, requirementThread.id, storage)
    vi.stubGlobal('window', { localStorage: storage })
    const props = makeProps({
      threads: [requirementThread],
      findSddDraftForSidebarThread: vi.fn(async () => sddDraft)
    })

    await renderController(props)
    await act(async () => {
      latestController.openThread(requirementThread.id)
    })

    expectSelected(props.selectThread, requirementThread.id)
    expect(props.setRoute).toHaveBeenCalledWith('chat')
    // 点击需求会话不得自动展开草稿编辑器。
    expect(useSddDraftStore.getState().activeDraft).toBeNull()
  })

  it('dismisses an unrelated open draft when clicking a requirement session', async () => {
    const storage = new MemoryStorage()
    markSddAssistantThread(sddDraft, requirementThread.id, storage)
    vi.stubGlobal('window', { localStorage: storage })
    const props = makeProps({
      threads: [requirementThread],
      findSddDraftForSidebarThread: vi.fn(async () => sddDraft)
    })
    useSddDraftStore.getState().setActiveDraft(sddDraft, '# other draft')

    await renderController(props)
    await act(async () => {
      latestController.openThread(requirementThread.id)
    })

    expect(props.dismissActiveSddDraft).toHaveBeenCalledWith({ closeAssistant: true })
    expectSelected(props.selectThread, requirementThread.id)
  })

  it('opens a plain Code thread through the ordinary path', async () => {
    const codeThread = {
      ...thread(),
      id: 'thr_code',
      title: 'Code task',
      workspace: '/workspace/project'
    }
    const props = makeProps({
      threads: [codeThread]
    })

    await renderController(props)
    await act(async () => {
      latestController.openThread('thr_code')
    })

    expectSelected(props.selectThread, 'thr_code')
    expect(props.setRoute).toHaveBeenCalledWith('chat')
    expect(props.findSddDraftForSidebarThread).toHaveBeenCalledWith('thr_code', codeThread)
  })

  it('does not let a stale thread lookup take over a newer navigation intent', async () => {
    let resolveDraft!: (draft: SddDraft | null) => void
    const draftLookup = new Promise<SddDraft | null>((resolve) => { resolveDraft = resolve })
    const props = makeProps({
      threads: [requirementThread],
      findSddDraftForSidebarThread: vi.fn(() => draftLookup)
    })

    await renderController(props)
    act(() => {
      latestController.openThread(requirementThread.id)
      latestController.openWriteMode()
    })
    await act(async () => {
      resolveDraft(sddDraft)
      await draftLookup
    })

    expect(props.openWrite).toHaveBeenCalledWith({
      activationGuard: expect.any(Function)
    })
    expect(props.selectThread).not.toHaveBeenCalled()
    expect(props.setRoute).not.toHaveBeenCalledWith('chat')
  })
})

describe('workbench navigation controller Connect Phone return', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useSddDraftStore.getState().clearActiveDraft()
    vi.stubGlobal('window', { localStorage: new MemoryStorage() })
  })

  afterEach(() => {
    useSddDraftStore.getState().clearActiveDraft()
    vi.unstubAllGlobals()
  })

  it('keeps the requirement draft when opening Connect Phone and restores Code on return', async () => {
    const props = makeProps({ activeSddDraft: true, route: 'chat' })
    const { rerender } = await renderController(props)

    await act(async () => {
      latestController.toggleConnectPhone()
    })
    expect(props.openClaw).toHaveBeenCalled()
    expect(props.setConnectPhoneSidebarOpen).toHaveBeenCalledWith(true)
    // 打开 Connect Phone 不清空需求草稿。
    expect(props.dismissActiveSddDraft).not.toHaveBeenCalled()

    ;(props.openCode as ReturnType<typeof vi.fn>).mockClear()
    await rerender({ ...props, route: 'claw' })
    await act(async () => {
      latestController.toggleConnectPhone()
    })
    expect(props.setConnectPhoneSidebarOpen).toHaveBeenCalledWith(false)
    expect(props.openCode).toHaveBeenCalled()
    expect(props.openWrite).not.toHaveBeenCalled()
  })

  it.each([
    ['write', 'openWrite'],
    ['plugins', 'setRoute'],
    ['schedule', 'setRoute'],
    ['extensions', 'setRoute'],
    ['workflow', 'setRoute']
  ] as const)('restores %s after closing Connect Phone', async (returnRoute, expectedCall) => {
    const props = makeProps({ route: returnRoute })
    const { rerender } = await renderController(props)
    // 先进入 Connect Phone,再切到 claw 路由后关闭。
    await act(async () => {
      latestController.toggleConnectPhone()
    })
    await rerender({ ...props, route: 'claw' })

    await act(async () => {
      latestController.toggleConnectPhone()
    })

    if (expectedCall === 'openWrite') {
      expect(props.openWrite).toHaveBeenCalled()
    } else {
      expect(props.setRoute).toHaveBeenCalledWith(returnRoute)
    }
  })

  it('normalizes a legacy Design return to the shared Code workbench', async () => {
    const props = makeProps({ route: 'design' })
    const { rerender } = await renderController(props)
    await act(async () => latestController.toggleConnectPhone())
    await rerender({ ...props, route: 'claw' })
    await act(async () => latestController.toggleConnectPhone())
    expect(props.openCode).toHaveBeenCalled()
  })

  it('does not leave a Claw thread active on the Code route after returning', async () => {
    const props = makeProps({ route: 'chat' })
    const { rerender } = await renderController(props)
    await act(async () => {
      latestController.toggleConnectPhone()
    })

    ;(props.openCode as ReturnType<typeof vi.fn>).mockClear()
    await rerender({ ...props, route: 'claw' })
    await act(async () => {
      latestController.toggleConnectPhone()
    })
    expect(props.openCode).toHaveBeenCalled()
    expect(props.setRoute).not.toHaveBeenCalledWith('claw')
  })
})

describe('workbench navigation controller Work whiteboards', () => {
  // New conversation now runs through the shared Work session entry, which
  // creates whiteboard sessions via the chat store rather than a controller prop.
  const initialChat = useChatStore.getState()
  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    useChatStore.setState(initialChat, true)
    vi.restoreAllMocks()
  })

  it('rebinds New conversation to the active whiteboard without racing a board switch', async () => {
    const now = '2026-08-13T00:00:00.000Z'
    const bindWhiteboardThread = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      activeFilePath: null,
      activeWhiteboardId: 'board-1',
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Pitch', workspaceRoot: '/workspace', threadId: 'thread-old',
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      },
      bindWhiteboardThread
    })
    const createWriteThread = vi.fn(async () => 'thread-new')
    useChatStore.setState({ createWriteThread })
    await renderController(makeProps({ route: 'write' }))

    await act(async () => {
      latestController.startNewWriteAssistantConversation()
      await Promise.resolve()
    })

    expect(createWriteThread).toHaveBeenCalledWith('/workspace', undefined, {
      title: 'Pitch',
      titleAuto: false
    })
    expect(bindWhiteboardThread).toHaveBeenCalledWith('board-1', 'thread-new')
  })

  it('keeps a workflow-bound PPT board on its original parent task', async () => {
    const now = '2026-08-13T00:00:00.000Z'
    const bindWhiteboardThread = vi.fn(async () => true)
    const createWriteThread = vi.fn(async () => 'thread-new')
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      activeFilePath: null,
      activeWhiteboardId: 'board-ppt',
      whiteboards: {
        'board-ppt': {
          id: 'board-ppt', title: 'Pitch review', workspaceRoot: '/workspace', threadId: 'thread-parent',
          workflowId: 'workflow-pitch', phase: 'review', revision: 2,
          createdAt: now, updatedAt: now
        }
      },
      bindWhiteboardThread
    })
    useChatStore.setState({ createWriteThread })
    await renderController(makeProps({ route: 'write' }))

    await act(async () => latestController.startNewWriteAssistantConversation())

    expect(createWriteThread).not.toHaveBeenCalled()
    expect(bindWhiteboardThread).not.toHaveBeenCalled()
  })

  it('does not bind a newly created task after the Write workspace changes', async () => {
    const now = '2026-08-13T00:00:00.000Z'
    const creatingThread = deferred<string | null>()
    const createWriteThread = vi.fn(() => creatingThread.promise)
    const bindWhiteboardThread = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      activeFilePath: null,
      activeWhiteboardId: 'board-1',
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Notes', workspaceRoot: '/workspace', threadId: 'thread-old',
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      },
      bindWhiteboardThread
    })
    useChatStore.setState({ createWriteThread })
    await renderController(makeProps({ route: 'write' }))

    await act(async () => latestController.startNewWriteAssistantConversation())
    expect(createWriteThread).toHaveBeenCalledWith('/workspace', undefined, {
      title: 'Notes',
      titleAuto: false
    })

    // Reusing the same id models a restored board in the newly selected
    // workspace; the captured workspace scope must still block the old task.
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/other-workspace',
      activeWhiteboardId: 'board-1',
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Other notes', workspaceRoot: '/other-workspace', threadId: 'thread-other',
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      }
    })
    creatingThread.resolve('thread-new')
    await act(async () => { await Promise.resolve() })

    expect(bindWhiteboardThread).not.toHaveBeenCalled()
  })
})
