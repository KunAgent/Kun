import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignTaskProfile } from '../../agent/design-task-profile'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import type { DesignDocument } from '../../design/design-types'
import { submitDesignTurn } from '../../design/design-turn-submit'
import { useChatStore } from '../../store/chat-store'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { createEmptyDocument } from '../../design/canvas/canvas-types'
import { canvasDocumentKey } from '../../design/canvas/canvas-persistence'
import { useDesignPromptController } from './useDesignPromptController'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('./useDesignQualityRepair', () => ({
  useDesignQualityRepair: () => ({
    clearDesignAutoRepairScope: vi.fn(),
    handleDesignRuntimeQualityFindings: vi.fn(),
    handleDesignQualityRepairRequest: vi.fn()
  })
}))

vi.mock('../../design/design-turn-submit', () => ({ submitDesignTurn: vi.fn() }))

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: registryMock.getProvider }))

function lockedProfile(documentId: string, boardId: string): DesignTaskProfile {
  return {
    version: 1,
    documentTarget: { documentId, boardArtifactId: boardId },
    outputMedium: 'html',
    target: 'web',
    preset: 'none',
    context: { tone: [] },
    lockedAtTurnId: 'turn_design_1'
  }
}

describe('useDesignPromptController locked follow-up', () => {
  beforeEach(() => {
    vi.mocked(submitDesignTurn).mockReset()
    registryMock.getProvider.mockReset()
    useCodeCanvasDesignSurface.getState().clearDesignSurface()
    useChatStore.setState({
      activeThreadId: 'thr_locked',
      threads: [{
        id: 'thr_locked',
        title: 'Locked',
        updatedAt: '2026-08-17T00:00:00.000Z',
        model: 'deepseek-v4-pro',
        mode: 'agent',
        workspace: '/workspace'
      }]
    } as never)
  })

  afterEach(() => {
    useDesignWorkspaceStore.setState({ drawingHistoryMutation: null })
    useCanvasShapeStore.getState().resetDocument()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reuses the authoritative lock instead of creating a new drawing', async () => {
    const board = {
      id: 'board-a',
      kind: 'canvas' as const,
      title: 'Board A',
      relativePath: '.kun-design/doc-a/board-a/canvas.json',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
      versions: []
    }
    const canonical: DesignDocument = {
      id: 'doc-a',
      title: 'Canonical',
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      order: 0,
      artifacts: [board],
      activeArtifactId: board.id
    }
    const preview: DesignDocument = {
      id: 'doc-preview',
      title: 'Preview',
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      order: 1,
      artifacts: [],
      activeArtifactId: null
    }
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      documents: [canonical, preview],
      activeDocumentId: preview.id,
      artifacts: preview.artifacts,
      activeArtifactId: null,
      drawingCreationOpen: false,
      drawingCreationDocumentId: null,
      drawingCreationSubmitting: false,
      drawingHistoryMutation: null,
      multiPageMode: false,
      designIntentMode: 'modify'
    })
    useCanvasShapeStore.getState().loadDocument(
      createEmptyDocument(),
      canvasDocumentKey('/workspace', board.id, `.kun-design/${canonical.id}`)
    )
    const fetched = lockedProfile(canonical.id, board.id)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(async () => ({ designProfile: fetched }))
    })
    vi.mocked(submitDesignTurn).mockImplementation(async (options) => {
      expect(useDesignWorkspaceStore.getState().activeDocumentId).toBe(canonical.id)
      expect(options.boardArtifactId).toBe(board.id)
      expect(options.omitDesignProfileWhenUnavailable).toBe(true)
      const profile = options.designTaskProfileForTarget?.({
        documentId: canonical.id,
        boardArtifactId: board.id
      })
      expect(profile).toMatchObject({
        documentTarget: { documentId: canonical.id, boardArtifactId: board.id },
        outputMedium: 'html'
      })
      return { status: 'sent', target: 'canvas', clearAttachments: false }
    })
    const ensureDesignThreadForWorkspace = vi.fn(async () => 'thr_locked')
    const controller = useDesignPromptController({
      route: 'chat',
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
      setDesignAssistantOpen: vi.fn(),
      ensureDesignThreadForWorkspace,
      clearDesignHistory: vi.fn(async () => ({
        cleared: true, deletedThreadIds: [], retainedThreadIds: [], recreatedThreadId: null
      })),
      designTaskProfileSelection: { outputMedium: 'html', target: 'web', preset: 'none' },
      lockedDesignProfile: null,
      expectedThreadId: 'thr_locked',
      sendMessage: vi.fn(async () => true),
      getAttachmentScope: () => 'chat',
      clearComposerAttachments: vi.fn(),
      clearHtmlElementContext: vi.fn()
    })

    await expect(controller.sendDesignPrompt('Revise the original board')).resolves.toBe(true)
    expect(useDesignWorkspaceStore.getState().documents).toHaveLength(2)
    expect(useDesignWorkspaceStore.getState().activeDocumentId).toBe(canonical.id)
    expect(useCodeCanvasDesignSurface.getState().surface).toMatchObject({
      threadId: 'thr_locked', documentId: canonical.id, boardArtifactId: board.id
    })
    expect(ensureDesignThreadForWorkspace).toHaveBeenCalledWith('/workspace', canonical.id)
    expect(useChatStore.getState().threads[0]?.designProfile).toEqual(fetched)
  })
})
