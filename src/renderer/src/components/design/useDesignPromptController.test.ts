import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import type { DesignDocument } from '../../design/design-types'
import { submitDesignTurn } from '../../design/design-turn-submit'
import { useDesignPromptController } from './useDesignPromptController'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../../design/design-turn-submit', () => ({ submitDesignTurn: vi.fn() }))

describe('useDesignPromptController', () => {
  beforeEach(() => {
    vi.mocked(submitDesignTurn).mockReset()
    useCodeCanvasDesignSurface.getState().clearDesignSurface()
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      activeDocumentId: 'doc',
      drawingCreationOpen: false,
      drawingCreationDocumentId: null,
      drawingCreationSubmitting: false,
      drawingHistoryMutation: {
        workspaceRoot: '/workspace',
        documentId: 'doc',
        kind: 'clear'
      }
    })
  })

  afterEach(() => {
    useDesignWorkspaceStore.setState({ drawingHistoryMutation: null })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects sends before creating or rebinding a thread while history is mutating', async () => {
    const ensureDesignThreadForWorkspace = vi.fn(async () => 'thread-new')
    const sendMessage = vi.fn(async () => true)
    const setDesignAssistantOpen = vi.fn()
    const controller = useDesignPromptController({
      route: 'design',
      runtimeConnection: 'ready',
      busy: false,
      workspaceRoot: '/workspace',
      composerAttachments: [],
      attachmentUploadEnabled: true,
      composerReasoningEffort: 'auto',
      composerFastMode: false,
      composerModelGroups: [],
      designContextSuppressedIds: new Set(),
      designHtmlElementContext: null,
      setInput: vi.fn(),
      setAttachmentUploadError: vi.fn(),
      setError: vi.fn(),
      setDesignAssistantOpen,
      ensureDesignThreadForWorkspace,
      clearDesignHistory: vi.fn(async () => ({
        cleared: true,
        deletedThreadIds: [],
        retainedThreadIds: [],
        recreatedThreadId: null
      })),
      sendMessage,
      getAttachmentScope: () => 'design',
      clearComposerAttachments: vi.fn(),
      clearHtmlElementContext: vi.fn()
    })

    await expect(controller.sendDesignPrompt('Draw a dashboard')).resolves.toBe(false)
    expect(ensureDesignThreadForWorkspace).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(setDesignAssistantOpen).not.toHaveBeenCalled()
  })

  it('blocks a locked AI-image lane without a provider before creating task state', async () => {
    useDesignWorkspaceStore.setState({ drawingHistoryMutation: null })
    const ensureDesignThreadForWorkspace = vi.fn(async () => 'thread-new')
    const sendMessage = vi.fn(async () => true)
    const setError = vi.fn()
    const controller = useDesignPromptController({
      route: 'chat', runtimeConnection: 'ready', busy: false, workspaceRoot: '/workspace',
      composerAttachments: [], attachmentUploadEnabled: true, composerReasoningEffort: 'auto',
      composerFastMode: false, composerModelGroups: [], designContextSuppressedIds: new Set(),
      designHtmlElementContext: null, setInput: vi.fn(), setAttachmentUploadError: vi.fn(),
      setError, setDesignAssistantOpen: vi.fn(), ensureDesignThreadForWorkspace,
      clearDesignHistory: vi.fn(async () => ({
        cleared: true, deletedThreadIds: [], retainedThreadIds: [], recreatedThreadId: null
      })),
      designTaskProfileSelection: { outputMedium: 'image', target: 'web', preset: 'none' },
      imageGenerationAvailable: false, imageGenerationReason: 'Configure an image provider',
      sendMessage, getAttachmentScope: () => 'chat', clearComposerAttachments: vi.fn(),
      clearHtmlElementContext: vi.fn()
    })

    await expect(controller.sendDesignPrompt('Create a poster')).resolves.toBe(false)
    expect(setError).toHaveBeenCalledWith('Configure an image provider')
    expect(ensureDesignThreadForWorkspace).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('gives an unlocked Design task a new document instead of reusing the global active drawing', async () => {
    const existing: DesignDocument = {
      id: 'doc-existing', title: 'Existing', createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z', order: 0, artifacts: [], activeArtifactId: null
    }
    vi.stubGlobal('window', {
      kunGui: {
        createWorkspaceDirectory: vi.fn(async () => ({ ok: true })),
        writeWorkspaceFile: vi.fn(async () => ({ ok: true }))
      }
    })
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace', documents: [existing], activeDocumentId: existing.id,
      artifacts: [], activeArtifactId: null, drawingCreationOpen: false,
      drawingCreationReturnDocumentId: null, drawingCreationDocumentId: null,
      drawingCreationSubmitting: false, drawingHistoryMutation: null,
      designIntentMode: 'generate', multiPageMode: false, pagesRun: null
    })
    vi.mocked(submitDesignTurn).mockImplementation(async () => {
      expect(useDesignWorkspaceStore.getState().activeDocumentId).not.toBe(existing.id)
      return { status: 'sent', target: 'canvas', clearAttachments: false }
    })
    const ensureDesignThreadForWorkspace = vi.fn(async () => 'thread-existing-empty')
    const controller = useDesignPromptController({
      route: 'chat', runtimeConnection: 'ready', busy: false, workspaceRoot: '/workspace',
      composerAttachments: [], attachmentUploadEnabled: true, composerReasoningEffort: 'auto',
      composerFastMode: false, composerModelGroups: [], designContextSuppressedIds: new Set(),
      designHtmlElementContext: null, setInput: vi.fn(), setAttachmentUploadError: vi.fn(),
      setError: vi.fn(), setDesignAssistantOpen: vi.fn(), ensureDesignThreadForWorkspace,
      clearDesignHistory: vi.fn(async () => ({
        cleared: true, deletedThreadIds: [], retainedThreadIds: [], recreatedThreadId: null
      })),
      rollbackProvisionalThread: vi.fn(async () => true),
      designTaskProfileSelection: { outputMedium: 'image', target: 'web', preset: 'none' },
      lockedDesignProfile: null, imageGenerationAvailable: true,
      sendMessage: vi.fn(async () => true), getAttachmentScope: () => 'chat',
      clearComposerAttachments: vi.fn(), clearHtmlElementContext: vi.fn()
    })

    await expect(controller.sendDesignPrompt('Create a product hero')).resolves.toBe(true)
    const state = useDesignWorkspaceStore.getState()
    expect(state.activeDocumentId).not.toBe(existing.id)
    expect(state.documents.map((document) => document.id)).toContain(existing.id)
    expect(state.documents).toHaveLength(2)
    expect(ensureDesignThreadForWorkspace).toHaveBeenCalledWith(
      '/workspace', state.activeDocumentId
    )
  })

  it('returns a locked task from a read-only preview to its canonical document before sending', async () => {
    const board = {
      id: 'board-a', kind: 'canvas' as const, title: 'Board A',
      relativePath: '.kun-design/doc-a/board-a/canvas.json',
      createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
      versions: []
    }
    const canonical: DesignDocument = {
      id: 'doc-a', title: 'Canonical', createdAt: board.createdAt, updatedAt: board.updatedAt,
      order: 0, artifacts: [board], activeArtifactId: board.id
    }
    const preview: DesignDocument = {
      id: 'doc-b', title: 'Preview', createdAt: board.createdAt, updatedAt: board.updatedAt,
      order: 1, artifacts: [], activeArtifactId: null
    }
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace', documents: [canonical, preview], activeDocumentId: preview.id,
      artifacts: preview.artifacts, activeArtifactId: null, drawingCreationOpen: false,
      drawingCreationDocumentId: null, drawingCreationSubmitting: false,
      drawingHistoryMutation: null, multiPageMode: false, designIntentMode: 'modify'
    })
    const ensureDesignThreadForWorkspace = vi.fn(async () => 'thread-code')
    const setError = vi.fn()
    vi.mocked(submitDesignTurn).mockImplementation(async () => {
      expect(useDesignWorkspaceStore.getState().activeDocumentId).toBe(canonical.id)
      return { status: 'sent', target: 'canvas', clearAttachments: false }
    })
    const controller = useDesignPromptController({
      route: 'chat', runtimeConnection: 'ready', busy: false, workspaceRoot: '/workspace',
      composerAttachments: [], attachmentUploadEnabled: true, composerReasoningEffort: 'auto',
      composerFastMode: false, composerModelGroups: [], designContextSuppressedIds: new Set(),
      designHtmlElementContext: null, setInput: vi.fn(), setAttachmentUploadError: vi.fn(),
      setError, setDesignAssistantOpen: vi.fn(), ensureDesignThreadForWorkspace,
      clearDesignHistory: vi.fn(async () => ({
        cleared: true, deletedThreadIds: [], retainedThreadIds: [], recreatedThreadId: null
      })),
      designTaskProfileSelection: { outputMedium: 'html', target: 'web', preset: 'none' },
      lockedDesignProfile: {
        version: 1, documentTarget: { documentId: canonical.id, boardArtifactId: board.id },
        outputMedium: 'html', target: 'web', preset: 'none', context: { tone: [] },
        lockedAtTurnId: 'turn-design'
      },
      sendMessage: vi.fn(async () => true), getAttachmentScope: () => 'chat',
      clearComposerAttachments: vi.fn(), clearHtmlElementContext: vi.fn()
    })

    const sent = await controller.sendDesignPrompt('Revise the canonical board')
    expect(setError).not.toHaveBeenCalled()
    expect(ensureDesignThreadForWorkspace).toHaveBeenCalledWith('/workspace', canonical.id)
    expect(submitDesignTurn).toHaveBeenCalledTimes(1)
    expect(sent).toBe(true)
  })

  it('rolls back a provisional document when queued runtime admission is cancelled', async () => {
    const existing: DesignDocument = {
      id: 'doc-existing', title: 'Existing', createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z', order: 0, artifacts: [], activeArtifactId: null
    }
    let resolveAdmission!: (accepted: boolean) => void
    const admission = new Promise<boolean>((resolve) => { resolveAdmission = resolve })
    vi.stubGlobal('window', {
      kunGui: {
        createWorkspaceDirectory: vi.fn(async () => ({ ok: true })),
        writeWorkspaceFile: vi.fn(async () => ({ ok: true })),
        readWorkspaceFile: vi.fn(async () => ({ ok: false })),
        deleteWorkspaceEntry: vi.fn(async () => ({ ok: true }))
      }
    })
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace', documents: [existing], activeDocumentId: existing.id,
      artifacts: [], activeArtifactId: null, drawingCreationOpen: false,
      drawingCreationReturnDocumentId: null, drawingCreationDocumentId: null,
      drawingCreationSubmitting: false, drawingHistoryMutation: null,
      designIntentMode: 'generate', multiPageMode: false, pagesRun: null
    })
    vi.mocked(submitDesignTurn).mockImplementation(async (options) => {
      expect(options.waitForRuntimeAdmission).toBe(true)
      const sent = await options.sendMessage('runtime prompt', 'agent', {
        waitForRuntimeAdmission: true
      })
      return sent
        ? { status: 'sent', target: 'canvas', clearAttachments: false }
        : { status: 'send-failed', target: 'canvas' }
    })
    const rollbackProvisionalThread = vi.fn(async () => true)
    const controller = useDesignPromptController({
      route: 'chat', runtimeConnection: 'ready', busy: false, workspaceRoot: '/workspace',
      composerAttachments: [], attachmentUploadEnabled: true, composerReasoningEffort: 'auto',
      composerFastMode: false, composerModelGroups: [], designContextSuppressedIds: new Set(),
      designHtmlElementContext: null, setInput: vi.fn(), setAttachmentUploadError: vi.fn(),
      setError: vi.fn(), setDesignAssistantOpen: vi.fn(),
      ensureDesignThreadForWorkspace: vi.fn(async () => 'thread-existing-empty'),
      clearDesignHistory: vi.fn(async () => ({
        cleared: true, deletedThreadIds: [], retainedThreadIds: [], recreatedThreadId: null
      })),
      rollbackProvisionalThread,
      designTaskProfileSelection: { outputMedium: 'image', target: 'web', preset: 'none' },
      lockedDesignProfile: null, imageGenerationAvailable: true,
      sendMessage: vi.fn(() => admission), getAttachmentScope: () => 'chat',
      clearComposerAttachments: vi.fn(), clearHtmlElementContext: vi.fn()
    })

    const sending = controller.sendDesignPrompt('Create a product hero')
    await vi.waitFor(() => expect(useDesignWorkspaceStore.getState().documents).toHaveLength(2))
    expect(useDesignWorkspaceStore.getState().drawingCreationSubmitting).toBe(true)

    resolveAdmission(false)
    await expect(sending).resolves.toBe(false)
    expect(useDesignWorkspaceStore.getState().documents).toEqual([existing])
    expect(rollbackProvisionalThread).toHaveBeenCalledWith('thread-existing-empty')
  })

  it('restores the code whiteboard surface after a failed first Design send', async () => {
    // Existing Code conversation: no Design documents yet, no cached surface.
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace', documents: [], activeDocumentId: null,
      artifacts: [], activeArtifactId: null, drawingCreationOpen: false,
      drawingCreationReturnDocumentId: null, drawingCreationDocumentId: null,
      drawingCreationSubmitting: false, drawingHistoryMutation: null,
      designIntentMode: 'generate', multiPageMode: false, pagesRun: null
    })
    vi.stubGlobal('window', {
      kunGui: {
        createWorkspaceDirectory: vi.fn(async () => ({ ok: true })),
        writeWorkspaceFile: vi.fn(async () => ({ ok: true })),
        readWorkspaceFile: vi.fn(async () => ({ ok: false })),
        deleteWorkspaceEntry: vi.fn(async () => ({ ok: true }))
      }
    })
    expect(useCodeCanvasDesignSurface.getState().surface).toBeNull()
    const ensureDesignThreadForWorkspace = vi.fn(async (root: string, docId: string) => {
      // Mirrors useWorkbenchTaskSurface.ensureDesignThread: binds the surface
      // to the existing Code thread before the first Design turn is sent.
      useCodeCanvasDesignSurface.getState().showDesignDocument('thread-code', root, docId)
      return 'thread-code'
    })
    vi.mocked(submitDesignTurn).mockImplementation(async (options) => {
      const sent = await options.sendMessage('runtime prompt', 'agent', {
        waitForRuntimeAdmission: true
      })
      return sent
        ? { status: 'sent', target: 'canvas', clearAttachments: false }
        : { status: 'send-failed', target: 'canvas' }
    })
    const controller = useDesignPromptController({
      route: 'chat', runtimeConnection: 'ready', busy: false, workspaceRoot: '/workspace',
      composerAttachments: [], attachmentUploadEnabled: true, composerReasoningEffort: 'auto',
      composerFastMode: false, composerModelGroups: [], designContextSuppressedIds: new Set(),
      designHtmlElementContext: null, setInput: vi.fn(), setAttachmentUploadError: vi.fn(),
      setError: vi.fn(), setDesignAssistantOpen: vi.fn(), ensureDesignThreadForWorkspace,
      clearDesignHistory: vi.fn(async () => ({
        cleared: true, deletedThreadIds: [], retainedThreadIds: [], recreatedThreadId: null
      })),
      rollbackProvisionalThread: vi.fn(async () => true),
      designTaskProfileSelection: { outputMedium: 'image', target: 'web', preset: 'none' },
      lockedDesignProfile: null, imageGenerationAvailable: true,
      sendMessage: vi.fn(async () => false), getAttachmentScope: () => 'chat',
      clearComposerAttachments: vi.fn(), clearHtmlElementContext: vi.fn()
    })

    await expect(controller.sendDesignPrompt('Create a hero')).resolves.toBe(false)
    // The provisional target was written during thread ensure, then atomically
    // restored (cleared) once the temporary document was deleted: the Code
    // panel must not stay mounted on a deleted Design document.
    expect(useCodeCanvasDesignSurface.getState().surface).toBeNull()
    expect(useDesignWorkspaceStore.getState().documents).toEqual([])
  })
})
