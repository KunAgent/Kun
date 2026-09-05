import type { SetStateAction } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: <T>(callback: T): T => callback
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string): string => key })
}))

import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { createWriteDocumentSession } from '../../write/write-editor-layout'
import { clearWriteWorkspaceSaveQueueForTests } from '../../write/write-save-coordinator'
import { useWorkbenchComposerSubmitController } from './useWorkbenchComposerSubmitController'

type ControllerParams = Parameters<typeof useWorkbenchComposerSubmitController>[0]

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function controllerParams(overrides: Partial<ControllerParams>): ControllerParams {
  return {
    activeClawChannelId: '', activeSddDraft: false, activeThreadId: 'thr_write',
    attachmentUploadEnabled: true, buildCodeCanvasOutboundPrompt: vi.fn(async () => ''),
    clearComposerAttachments: vi.fn(), removeComposerAttachments: vi.fn(),
    clearComposerFileReferences: vi.fn(), restoreComposerAttachments: vi.fn(async () => undefined), restoreComposerFileReferences: vi.fn(), composerAttachments: [], composerFileReferences: [],
    composerMode: 'agent', composerModel: '', composerProviderId: '', composerModelGroups: [],
    composerReasoningEffort: 'auto', composerFastMode: false, getAttachmentScope: () => 'write',
    handleGuiPlanCommand: vi.fn(), input: 'explain this slide',
    resetClawChannelSession: vi.fn(async () => undefined),
    requestAutoPlanBuild: vi.fn(async () => 'rejected' as const), rightPanelMode: null, route: 'write',
    selectClawChannel: vi.fn(async () => undefined), sendMessage: vi.fn(async () => true),
    sendPlanTurn: vi.fn(async () => false), sendSddAssistantPrompt: vi.fn(async () => undefined),
    setAttachmentUploadError: vi.fn(), setClawChannelModel: vi.fn(async () => undefined),
    setError: vi.fn(), setInput: vi.fn((_next: SetStateAction<string>) => undefined), threads: [],
    workspaceRoot: '/workspace', appendLocalClawTurn: vi.fn(), ...overrides
  }
}

function activatePresentation(): void {
  const path = '/workspace/deck.pptx'
  const preview = {
    ok: true as const, path, name: 'deck.pptx', sourceFormat: 'pptx' as const,
    renderFormat: 'pptx' as const, viewer: 'presentation' as const, size: 128,
    mtimeMs: 1, sourceSha256: 'a'.repeat(64), data: new Uint8Array([1])
  }
  useWriteWorkspaceStore.setState({
    workspaceRoot: '/workspace', activeFilePath: path, activeFileKind: 'office',
    fileContent: '', persistedContent: '', fileTruncated: false, documentEpoch: 4,
    contentRevision: 0, saveStatus: 'saved', fileError: null, reviewActive: false,
    pendingAgentReview: null, quotedSelections: [], agentPresets: [],
    assistantAgentPresetId: '', assistantModel: '', assistantProviderId: '',
    documentsByPath: {
      [path]: createWriteDocumentSession({ path, kind: 'office', officePreview: preview, documentEpoch: 4 })
    },
    editorLayout: {
      version: 1, orientation: 'single', ratio: 0.5, focusedGroupId: 'primary',
      groups: [{ id: 'primary', activePath: path, tabs: [{ path, viewMode: 'preview' }] }]
    },
    presentationViewByGroup: {
      primary: {
        kind: 'presentation', path, sourceName: 'deck.pptx', sourceFormat: 'pptx',
        sourceSha256: preview.sourceSha256, slide: 3, slideCount: 9
      }
    }
  })
}

describe('Work presentation view submission', () => {
  beforeEach(() => {
    useChatStore.setState({ route: 'write', runtimeConnection: 'ready' })
    activatePresentation()
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    clearWriteWorkspaceSaveQueueForTests()
    vi.unstubAllGlobals()
  })

  it('freezes the current slide before asynchronous Office context loading', async () => {
    const semantic = deferred<{
      ok: true; path: string; name: string; sourceFormat: 'pptx';
      sourceSha256: string; text: string; truncated: false
    }>()
    const readWorkspaceOfficeSemantic = vi.fn(() => semantic.promise)
    vi.stubGlobal('window', { kunGui: { readWorkspaceOfficeSemantic } })
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({ sendMessage }))

    controller.sendWritePrompt('explain this slide')
    await vi.waitFor(() => expect(readWorkspaceOfficeSemantic).toHaveBeenCalledOnce())
    const currentView = useWriteWorkspaceStore.getState().presentationViewByGroup.primary!
    useWriteWorkspaceStore.setState({
      presentationViewByGroup: { primary: { ...currentView, slide: 7 } }
    })
    semantic.resolve({
      ok: true, path: '/workspace/deck.pptx', name: 'deck.pptx', sourceFormat: 'pptx',
      sourceSha256: 'a'.repeat(64), text: 'Whole presentation outline', truncated: false
    })

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const [prompt, , options] = sendMessage.mock.calls[0] as unknown as Parameters<ControllerParams['sendMessage']>
    expect(prompt).toBe('explain this slide')
    expect(options?.composerContexts).toHaveLength(3)
    expect(options?.composerContexts?.find((context) => (
      context.reference.kind === 'work-reference-resource'
    ))?.reference).toMatchObject({
      locator: 'deck.pptx', resourceKind: 'office', access: 'read-only'
    })
    expect(options?.composerContexts?.find((context) => (
      context.reference.kind === 'office-view-position'
    ))?.reference).toMatchObject({
      kind: 'office-view-position', sourceName: 'deck.pptx',
      sourceSha256: 'a'.repeat(64),
      location: { kind: 'presentation', slide: 3, slideCount: 9 }
    })
    expect(options?.composerContexts?.find((context) => (
      context.reference.kind === 'work-reference-office'
    ))?.reference).toMatchObject({
      kind: 'work-reference-office',
      sourceName: 'deck.pptx',
      segments: ['Whole presentation outline']
    })
    expect(JSON.stringify(options?.composerContexts)).not.toContain('/workspace/deck.pptx')
  })

  it('restores the prompt when creating the presentation view context fails', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        readWorkspaceOfficeSemantic: vi.fn(async () => ({
          ok: true as const,
          path: '/workspace/deck.pptx',
          name: 'deck.pptx',
          sourceFormat: 'pptx' as const,
          sourceSha256: 'a'.repeat(64),
          text: 'Whole presentation outline',
          truncated: false
        }))
      }
    })
    vi.stubGlobal('crypto', {
      subtle: { digest: vi.fn(async () => { throw new Error('view context digest failed') }) }
    })
    const setInput = vi.fn()
    const setError = vi.fn()
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'Keep this prompt', setInput, setError, sendMessage
    }))

    controller.sendWritePrompt('Keep this prompt')

    await vi.waitFor(() => expect(setError).toHaveBeenCalledWith('view context digest failed'))
    expect(sendMessage).not.toHaveBeenCalled()
    expect(setInput).toHaveBeenCalledWith('')
    const restore = setInput.mock.calls.find(([value]) => typeof value === 'function')?.[0]
    expect(restore).toBeTypeOf('function')
    expect(restore('')).toBe('Keep this prompt')
  })
})
