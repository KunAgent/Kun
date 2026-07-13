import type { SetStateAction } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: <T>(callback: T): T => callback
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string): string => key
  })
}))

import { useChatStore } from '../../store/chat-store'
import { clearWriteWorkspaceSaveQueueForTests } from '../../write/write-save-coordinator'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWorkbenchComposerSubmitController } from './useWorkbenchComposerSubmitController'

type ControllerParams = Parameters<typeof useWorkbenchComposerSubmitController>[0]

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function inputHarness(initial: string): {
  getValue: () => string
  setInput: ControllerParams['setInput']
} {
  let value = initial
  const setInput = vi.fn((next: SetStateAction<string>) => {
    value = typeof next === 'function' ? next(value) : next
  })
  return { getValue: () => value, setInput }
}

function controllerParams(overrides: Partial<ControllerParams> = {}): ControllerParams {
  return {
    activeClawChannelId: '',
    activeSddDraft: false,
    activeThreadId: 'thr_mapped',
    attachmentUploadEnabled: true,
    buildCodeCanvasOutboundPrompt: vi.fn(async () => ''),
    clearComposerAttachments: vi.fn(),
    removeComposerAttachments: vi.fn(),
    clearComposerFileReferences: vi.fn(),
    composerAttachments: [],
    composerFileReferences: [],
    composerMode: 'agent',
    composerModelGroups: [],
    composerReasoningEffort: 'auto',
    getAttachmentScope: () => 'write',
    handleGuiPlanCommand: vi.fn(),
    input: 'keep this prompt',
    resetClawChannelSession: vi.fn(async () => undefined),
    rightPanelMode: null,
    route: 'write',
    selectClawChannel: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => true),
    sendPlanTurn: vi.fn(async () => false),
    sendSddAssistantPrompt: vi.fn(async () => undefined),
    setAttachmentUploadError: vi.fn(),
    setClawChannelModel: vi.fn(async () => undefined),
    setError: vi.fn(),
    setInput: vi.fn(),
    threads: [],
    workspaceRoot: '/tmp/write',
    appendLocalClawTurn: vi.fn(),
    ...overrides
  }
}

function activateTextFile(): void {
  useWriteWorkspaceStore.setState({
    workspaceRoot: '/tmp/write',
    activeFilePath: '/tmp/write/draft.md',
    activeFileKind: 'text',
    fileContent: 'saved draft',
    persistedContent: 'saved draft',
    fileTruncated: false,
    documentEpoch: 1,
    contentRevision: 0,
    saveStatus: 'saved',
    fileError: null,
    reviewActive: false,
    pendingAgentReview: null,
    quotedSelections: [],
    agentPresets: [],
    assistantAgentPresetId: '',
    assistantModel: '',
    assistantProviderId: ''
  })
}

describe('useWorkbenchComposerSubmitController', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { kunGui: {} })
    useChatStore.setState({ route: 'write', runtimeConnection: 'ready' })
    activateTextFile()
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    clearWriteWorkspaceSaveQueueForTests()
    vi.unstubAllGlobals()
  })

  it('restores the Write prompt when the send is rejected', async () => {
    const input = inputHarness('keep this prompt')
    const sendMessage = vi.fn(async () => false)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      sendMessage,
      setInput: input.setInput
    }))

    controller.sendWritePrompt('keep this prompt')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(input.getValue()).toBe('keep this prompt'))
  })

  it('keeps a chat draft and attachments when the runtime rejects a send', async () => {
    const input = inputHarness('keep this chat prompt')
    const sendMessage = vi.fn(async () => false)
    const removeComposerAttachments = vi.fn()
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'keep this chat prompt',
      route: 'chat',
      composerAttachments: [{
        id: 'attachment-1',
        kind: 'image',
        name: 'screen.png',
        mimeType: 'image/png'
      }],
      removeComposerAttachments,
      sendMessage,
      setInput: input.setInput
    }))

    controller.handleSend()

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    expect(input.getValue()).toBe('keep this chat prompt')
    expect(removeComposerAttachments).not.toHaveBeenCalled()
  })

  it('saves the captured draft before sending it to the writing assistant', async () => {
    const write = deferred<{ ok: true; path: string; savedAt: string }>()
    const writeWorkspaceFile = vi.fn(() => write.promise)
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })
    useWriteWorkspaceStore.getState().setFileContent('latest local draft')
    const input = inputHarness('revise it')
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'revise it',
      sendMessage,
      setInput: input.setInput
    }))

    controller.sendWritePrompt('revise it')

    await vi.waitFor(() => expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: '/tmp/write/draft.md',
      workspaceRoot: '/tmp/write',
      content: 'latest local draft'
    }))
    expect(sendMessage).not.toHaveBeenCalled()
    write.resolve({
      ok: true,
      path: '/tmp/write/draft.md',
      savedAt: '2026-07-12T00:00:00.000Z'
    })

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('revise it'),
      'agent',
      expect.objectContaining({
        writeContext: {
          workspaceRoot: '/tmp/write',
          activeFilePath: '/tmp/write/draft.md',
          documentEpoch: 1,
          contentRevision: 1
        }
      })
    )
  })

  it('waits for an older save and persists an undo before sending', async () => {
    const firstWrite = deferred<{ ok: true; path: string; savedAt: string }>()
    const writeWorkspaceFile = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue({
        ok: true,
        path: '/tmp/write/draft.md',
        savedAt: '2026-07-12T00:00:02.000Z'
      })
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })
    useWriteWorkspaceStore.getState().setFileContent('temporary edit')
    const olderSave = useWriteWorkspaceStore.getState().flushSave('/tmp/write')
    await vi.waitFor(() => expect(writeWorkspaceFile).toHaveBeenCalledTimes(1))
    useWriteWorkspaceStore.getState().setFileContent('saved draft')
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'summarize the undo',
      sendMessage,
      setInput: inputHarness('summarize the undo').setInput
    }))

    controller.sendWritePrompt('summarize the undo')
    firstWrite.resolve({
      ok: true,
      path: '/tmp/write/draft.md',
      savedAt: '2026-07-12T00:00:01.000Z'
    })

    await expect(olderSave).resolves.toBe(true)
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    expect(writeWorkspaceFile.mock.calls.map(([payload]) => payload.content)).toEqual([
      'temporary edit',
      'saved draft'
    ])
  })

  it('restores the prompt and does not send when the draft save fails', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        writeWorkspaceFile: vi.fn(async () => ({ ok: false as const, message: 'disk full' }))
      }
    })
    useWriteWorkspaceStore.getState().setFileContent('unsaved draft')
    const input = inputHarness('keep me')
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'keep me',
      sendMessage,
      setInput: input.setInput
    }))

    controller.sendWritePrompt('keep me')

    await vi.waitFor(() => expect(input.getValue()).toBe('keep me'))
    expect(sendMessage).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState()).toMatchObject({
      fileContent: 'unsaved draft',
      saveStatus: 'error',
      fileError: 'disk full'
    })
  })

  it('does not overwrite text typed while a failed send was pending', async () => {
    const sending = deferred<boolean>()
    const input = inputHarness('first prompt')
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'first prompt',
      sendMessage: vi.fn(() => sending.promise),
      setInput: input.setInput
    }))

    controller.sendWritePrompt('first prompt')
    await vi.waitFor(() => expect(input.getValue()).toBe(''))
    input.setInput('new prompt typed while waiting')
    sending.resolve(false)

    await vi.waitFor(() => expect(input.getValue()).toBe(
      'first prompt\n\nnew prompt typed while waiting'
    ))
  })

  it('aborts when the active file changes while saving', async () => {
    const write = deferred<{ ok: true; path: string; savedAt: string }>()
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile: vi.fn(() => write.promise) } })
    useWriteWorkspaceStore.getState().setFileContent('draft A')
    const input = inputHarness('edit A')
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'edit A',
      sendMessage,
      setInput: input.setInput
    }))

    controller.sendWritePrompt('edit A')
    useWriteWorkspaceStore.setState({
      activeFilePath: '/tmp/write/b.md',
      fileContent: 'draft B',
      persistedContent: 'draft B',
      documentEpoch: 2,
      contentRevision: 0,
      saveStatus: 'saved'
    })
    write.resolve({
      ok: true,
      path: '/tmp/write/draft.md',
      savedAt: '2026-07-12T00:00:00.000Z'
    })

    await vi.waitFor(() => expect(input.getValue()).toBe('edit A'))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('aborts instead of sending stale retrieval when the document changes mid-retrieval', async () => {
    const retrieval = deferred<{ ok: false; message: string }>()
    vi.stubGlobal('window', {
      kunGui: { retrieveWriteContext: vi.fn(() => retrieval.promise) }
    })
    const input = inputHarness('summarize')
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'summarize',
      sendMessage,
      setInput: input.setInput
    }))

    controller.sendWritePrompt('summarize')
    await vi.waitFor(() => expect(window.kunGui.retrieveWriteContext).toHaveBeenCalledOnce())
    useWriteWorkspaceStore.getState().setFileContent('edit typed during retrieval')
    retrieval.resolve({ ok: false, message: 'no retrieval result' })

    await vi.waitFor(() => expect(input.getValue()).toBe('summarize'))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('does not restore a stale Write prompt into another route composer', async () => {
    const retrieval = deferred<{ ok: false; message: string }>()
    vi.stubGlobal('window', {
      kunGui: { retrieveWriteContext: vi.fn(() => retrieval.promise) }
    })
    const input = inputHarness('write prompt')
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'write prompt',
      sendMessage,
      setInput: input.setInput
    }))

    controller.sendWritePrompt('write prompt')
    await vi.waitFor(() => expect(window.kunGui.retrieveWriteContext).toHaveBeenCalledOnce())
    useChatStore.setState({ route: 'chat' })
    input.setInput('new chat prompt')
    retrieval.resolve({ ok: false, message: 'no retrieval result' })
    await retrieval.promise
    await Promise.resolve()

    expect(input.getValue()).toBe('new chat prompt')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('allows asking about a clean truncated document without trying to write it', async () => {
    useWriteWorkspaceStore.setState({ fileTruncated: true })
    const input = inputHarness('what is this?')
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'what is this?',
      sendMessage,
      setInput: input.setInput
    }))

    controller.sendWritePrompt('what is this?')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
  })

  it('consumes only captured quote and attachment ids after a successful send', async () => {
    const sending = deferred<boolean>()
    const removeComposerAttachments = vi.fn()
    const oldQuote = {
      id: 'quote-old',
      text: 'old quote',
      sourceTitle: 'draft.md',
      sourceFilePath: '/tmp/write/draft.md',
      charCount: 9,
      createdAt: '2026-07-12T00:00:00.000Z'
    }
    const newQuote = { ...oldQuote, id: 'quote-new', text: 'new quote' }
    useWriteWorkspaceStore.setState({ quotedSelections: [oldQuote] })
    const sendMessage = vi.fn(() => sending.promise)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      composerAttachments: [{
        id: 'attachment-old',
        kind: 'image',
        name: 'old.png',
        mimeType: 'image/png'
      }],
      input: 'use these',
      removeComposerAttachments,
      sendMessage,
      setInput: inputHarness('use these').setInput
    }))

    controller.sendWritePrompt('use these')
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    useWriteWorkspaceStore.setState({ quotedSelections: [oldQuote, newQuote] })
    sending.resolve(true)

    await vi.waitFor(() => expect(removeComposerAttachments).toHaveBeenCalledWith(
      ['attachment-old'],
      'write'
    ))
    expect(useWriteWorkspaceStore.getState().quotedSelections).toEqual([newQuote])
  })
})
