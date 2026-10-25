import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../store/chat-store'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { currentWorkSessionId, useWorkSessionStore } from './work-session-store'
import { rememberWorkSessionTabs } from './work-session-tabs'
import type { WriteEditorLayoutV1 } from './write-workspace-store-types'
import {
  nextUntitledDocumentName,
  openWorkSession,
  prepareWorkSessionForSend,
  startWorkSession,
  submitWorkAssistantPrompt
} from './work-session-actions'

const ROOT = '/Users/me/Work'
const now = '2026-08-13T00:00:00.000Z'
const RESEARCH_SESSION = 'rs-test-000001'

function discoverLayout(): WriteEditorLayoutV1 {
  return {
    version: 1,
    orientation: 'single',
    ratio: 1,
    focusedGroupId: 'primary',
    groups: [{
      id: 'primary',
      tabs: [{ kind: 'paper-view', view: 'discover:search', viewMode: 'rich' }],
      activePath: 'paper-view:discover:search'
    }]
  }
}

function installMemoryStorage(): () => void {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, String(value)) },
    removeItem: (key: string) => { data.delete(key) },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size }
  })
  return () => vi.unstubAllGlobals()
}

describe('Work session actions', () => {
  const createWriteThread = vi.fn(async () => 'thr_new')
  const selectWriteThread = vi.fn(async (threadId: string) => {
    useChatStore.setState({ activeThreadId: threadId })
  })
  const openFile = vi.fn(async () => undefined)
  const initialChat = useChatStore.getState()
  const initialWrite = useWriteWorkspaceStore.getState()

  beforeEach(() => {
    createWriteThread.mockClear()
    selectWriteThread.mockClear()
    openFile.mockClear()
    useChatStore.setState({ route: 'write', activeThreadId: null, createWriteThread, selectWriteThread })
    useWriteWorkspaceStore.setState({
      workSurface: 'docs',
      workspaceRoot: ROOT,
      activeFilePath: null,
      activeWhiteboardId: null,
      whiteboards: {},
      openFile,
      setAssistantOpen: vi.fn()
    })
    useWorkSessionStore.setState({ current: {}, transitions: 0 })
  })

  afterEach(() => {
    useChatStore.setState(initialChat, true)
    useWriteWorkspaceStore.setState(initialWrite, true)
  })

  it('turns a draft into a new session anchored to the open document on the first send', async () => {
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/README.md` })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, `${ROOT}/README.md`, { route: expect.any(Object) })
  })

  it('anchors a session started with nothing open to the space', async () => {
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, undefined, { route: expect.any(Object) })
  })

  it('starts the session with the Kun model and reasoning level the draft showed', async () => {
    useChatStore.setState({ composerHarnessId: '', composerModel: 'deepseek-chat', composerProviderId: 'deepseek',
      composerModelGroups: [{ providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-chat'] }],
      composerReasoningEffort: 'high' })
    createWriteThread.mockImplementationOnce(async () => {
      // Selecting a new thread restores its own selection (here: a reset level).
      useChatStore.setState({ activeThreadId: 'thr_new', composerReasoningEffort: 'auto' })
      return 'thr_new'
    })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, undefined,
      { route: { model: 'deepseek-chat', providerId: 'deepseek' } })
    expect(useChatStore.getState().composerReasoningEffort).toBe('high')
  })

  it('pins a new session to the external Agent picked in the composer, like a new Code task', async () => {
    useChatStore.setState({ composerHarnessId: 'codex', composerCredentialMode: 'native-login',
      composerModel: 'gpt-5.5-codex', composerProviderId: '' })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, undefined, {
      route: expect.objectContaining({ harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-5.5-codex', providerId: 'default' })
    })
  })

  it('asks the assistant straight away from paper and editor shortcuts', async () => {
    const submit = vi.fn()
    const setAssistantOpen = vi.fn()
    useWriteWorkspaceStore.setState({ setAssistantOpen })
    expect(await submitWorkAssistantPrompt('  Summarize the paper  ', submit)).toBe(true)
    expect(setAssistantOpen).toHaveBeenCalledWith(true)
    expect(createWriteThread).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith('Summarize the paper')
    expect(await submitWorkAssistantPrompt('   ', submit)).toBe(false)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('keeps the text in the composer when no session could be prepared', async () => {
    const submit = vi.fn()
    createWriteThread.mockResolvedValueOnce(null as unknown as string)
    expect(await submitWorkAssistantPrompt('Summarize', submit)).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })

  it('keeps the current session whatever document is open', async () => {
    useWorkSessionStore.getState().select(ROOT, 'thr_current')
    useChatStore.setState({ activeThreadId: 'thr_current' })
    useWriteWorkspaceStore.setState({ activeFilePath: `${ROOT}/other.md` })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).not.toHaveBeenCalled()
    expect(selectWriteThread).not.toHaveBeenCalled()
  })

  it('selects the current session when it is not the active thread yet', async () => {
    useWorkSessionStore.getState().select(ROOT, 'thr_current')
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(selectWriteThread).toHaveBeenCalledWith('thr_current', ROOT)
    expect(createWriteThread).not.toHaveBeenCalled()
  })

  it('reports a session that could not be created', async () => {
    createWriteThread.mockResolvedValueOnce(null as unknown as string)
    expect(await prepareWorkSessionForSend()).toBe(false)
  })

  it('starts a draft instead of creating a thread up front', async () => {
    useWorkSessionStore.getState().select(ROOT, 'thr_current')
    await startWorkSession()
    expect(currentWorkSessionId(ROOT)).toBe('')
    expect(Object.values(useWorkSessionStore.getState().current)).toEqual([''])
    expect(createWriteThread).not.toHaveBeenCalled()
  })

  it('binds an ordinary whiteboard to the session its first send creates', async () => {
    const bindWhiteboardThread = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      activeWhiteboardId: 'board-1',
      bindWhiteboardThread,
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Pitch', workspaceRoot: ROOT, threadId: null,
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      }
    })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).toHaveBeenCalledWith(ROOT, undefined, { route: expect.any(Object) })
    expect(bindWhiteboardThread).toHaveBeenCalledWith('board-1', 'thr_new')
  })

  it('neither sends nor binds a board when the space changes while the session is created', async () => {
    const bindWhiteboardThread = vi.fn(async () => true)
    let finish: (id: string) => void = () => undefined
    createWriteThread.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve }))
    useWriteWorkspaceStore.setState({
      activeWhiteboardId: 'board-1',
      bindWhiteboardThread,
      whiteboards: {
        'board-1': {
          id: 'board-1', title: 'Notes', workspaceRoot: ROOT, threadId: null,
          phase: 'blank', revision: 0, createdAt: now, updatedAt: now
        }
      }
    })
    const ready = prepareWorkSessionForSend()
    useWriteWorkspaceStore.setState({ workspaceRoot: '/Users/me/Other' })
    finish('thr_new')
    expect(await ready).toBe(false)
    expect(bindWhiteboardThread).not.toHaveBeenCalled()
  })

  it('leaves a PPT review board with the task session that owns it', async () => {
    useWriteWorkspaceStore.setState({
      activeWhiteboardId: 'board-ppt',
      whiteboards: {
        'board-ppt': {
          id: 'board-ppt', title: 'Deck', workspaceRoot: ROOT, threadId: 'thr_task', workflowId: 'wf-1',
          phase: 'review', revision: 1, createdAt: now, updatedAt: now
        }
      }
    })
    expect(await prepareWorkSessionForSend()).toBe(true)
    expect(createWriteThread).not.toHaveBeenCalled()
  })

  it('opens a session as the current one and brings back what it is attached to', async () => {
    await openWorkSession({ id: 'thr_doc', title: 'Plan', updatedAt: now, anchor: { kind: 'file', path: `${ROOT}/plan.md` } })
    expect(currentWorkSessionId(ROOT)).toBe('thr_doc')
    expect(selectWriteThread).toHaveBeenCalledWith('thr_doc', ROOT)
    expect(openFile).toHaveBeenCalledWith(ROOT, `${ROOT}/plan.md`)
  })

  it('opens a research session onto its conversation when the discover tab is already remembered', async () => {
    const restoreStorage = installMemoryStorage()
    try {
      const openPaperViewTab = vi.fn()
      useWriteWorkspaceStore.setState({
        openPaperViewTab,
        paperResearch: { agentTab: false, sessionId: null }
      })
      rememberWorkSessionTabs('thr_research', ROOT, discoverLayout())
      await openWorkSession({
        id: 'thr_research',
        title: 'Find agents',
        updatedAt: now,
        anchor: { kind: 'research', sessionId: RESEARCH_SESSION }
      })
      expect(currentWorkSessionId(ROOT)).toBe('thr_research')
      // Once while restoring the remembered tab, again when the research run is applied.
      expect(openPaperViewTab).toHaveBeenCalledTimes(2)
      expect(openPaperViewTab).toHaveBeenCalledWith('discover:search')
      expect(useWriteWorkspaceStore.getState().paperResearch).toEqual({
        agentTab: true,
        sessionId: RESEARCH_SESSION
      })
    } finally {
      restoreStorage()
    }
  })

  it('opens a research session that has no remembered tabs onto its conversation', async () => {
    const openPaperViewTab = vi.fn()
    useWriteWorkspaceStore.setState({
      openPaperViewTab,
      paperResearch: { agentTab: false, sessionId: null }
    })
    await openWorkSession({
      id: 'thr_research_fresh',
      title: 'Find agents',
      updatedAt: now,
      anchor: { kind: 'research', sessionId: RESEARCH_SESSION }
    })
    expect(openPaperViewTab).toHaveBeenCalledTimes(1)
    expect(openPaperViewTab).toHaveBeenCalledWith('discover:search')
    expect(useWriteWorkspaceStore.getState().paperResearch).toEqual({
      agentTab: true,
      sessionId: RESEARCH_SESSION
    })
  })

  it('names new documents untitled, then untitled-2 and so on', () => {
    expect(nextUntitledDocumentName([])).toBe('untitled.md')
    expect(nextUntitledDocumentName(['Untitled.md', 'notes.md'])).toBe('untitled-2.md')
    expect(nextUntitledDocumentName(['untitled.md', 'untitled-2.md'])).toBe('untitled-3.md')
  })
})
