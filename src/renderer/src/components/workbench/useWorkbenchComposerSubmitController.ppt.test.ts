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
import { canvasDocumentKey } from '../../design/canvas/canvas-persistence'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { createDefaultShape, createEmptyDocument } from '../../design/canvas/canvas-types'
import { clearWriteWorkspaceSaveQueueForTests } from '../../write/write-save-coordinator'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { workWhiteboardArtifactId, workWhiteboardBaseDir } from '../../write/work-whiteboard'
import { useWorkbenchComposerSubmitController } from './useWorkbenchComposerSubmitController'

type ControllerParams = Parameters<typeof useWorkbenchComposerSubmitController>[0]

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
    restoreComposerAttachments: vi.fn(async () => undefined),
    restoreComposerFileReferences: vi.fn(),
    composerAttachments: [],
    composerFileReferences: [],
    composerMode: 'agent',
    composerModel: '',
    composerProviderId: '',
    composerModelGroups: [],
    composerReasoningEffort: 'auto',
    composerFastMode: false,
    getAttachmentScope: () => 'write',
    handleGuiPlanCommand: vi.fn(),
    input: 'keep this prompt',
    resetClawChannelSession: vi.fn(async () => undefined),
    requestAutoPlanBuild: vi.fn(async () => 'rejected' as const),
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

function activatePptReviewCanvas(): void {
  const document = createEmptyDocument()
  const reviewRef = {
    workflowId: 'workflow-a', childId: 'child-a', slideId: 'slide-2',
    revision: 3, parentThreadId: 'thr_mapped'
  }
  const frame = {
    ...createDefaultShape('frame', 0, 0), id: 'review-frame', width: 480, height: 318,
    pptReviewRef: { ...reviewRef, role: 'slide-frame' as const }
  }
  const preview = {
    ...createDefaultShape('image', 0, 0), id: 'review-preview', imageUrl: '/tmp/write/preview.png',
    pptReviewRef: { ...reviewRef, role: 'preview-image' as const }
  }
  const annotation = {
    ...createDefaultShape('text', 20, 20), id: 'review-note', width: 180, height: 40,
    textContent: 'Make the headline larger'
  }
  useCanvasShapeStore.setState({
    document: {
      ...document,
      objects: { ...document.objects, [frame.id]: frame, [preview.id]: preview, [annotation.id]: annotation }
    }
  })
}

function activatePptDirectionCanvas(selectDirection = true): void {
  const document = createEmptyDocument()
  const directions = ['editorial', 'signal', 'warm'].map((directionId, index) => ({
    ...createDefaultShape('frame', index * 504, 0),
    id: `direction-${directionId}`,
    pptDirectionRef: {
      workflowId: 'workflow-a', childId: 'child-a', directionId,
      revision: directionId === 'signal' ? 2 : 1,
      parentThreadId: 'thr_mapped', role: 'direction-card' as const
    }
  }))
  useCanvasShapeStore.setState({
    document: {
      ...document,
      objects: Object.fromEntries([
        ...Object.entries(document.objects),
        ...directions.map((shape) => [shape.id, shape] as const)
      ])
    }
  })
  if (selectDirection) useCanvasSelectionStore.getState().select(['direction-signal'])
}

function activateWorkPptWhiteboard(
  workflowId = 'workflow-a',
  phase: 'directions' | 'review' = 'review'
): void {
  const boardId = 'board-ppt-review'
  const now = '2026-08-13T00:00:00.000Z'
  useWriteWorkspaceStore.setState({
    activeFilePath: null,
    activeFileKind: null,
    activeWhiteboardId: boardId,
    whiteboards: {
      [boardId]: {
        id: boardId,
        title: 'Presentation review',
        workspaceRoot: '/tmp/write',
        threadId: 'thr_mapped',
        workflowId,
        childId: 'child-a',
        phase,
        revision: 3,
        createdAt: now,
        updatedAt: now
      }
    }
  })
  useCanvasShapeStore.getState().loadDocument(
    useCanvasShapeStore.getState().document,
    canvasDocumentKey('/tmp/write', workWhiteboardArtifactId(boardId), workWhiteboardBaseDir())
  )
}

describe('useWorkbenchComposerSubmitController PPT context', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      kunGui: {
        readWorkspaceFile: vi.fn(async () => ({ ok: false as const, message: 'missing' }))
      }
    })
    useChatStore.setState({ route: 'write', runtimeConnection: 'ready' })
    activateTextFile()
    useCanvasSelectionStore.getState().clearSelection()
  })

  afterEach(() => {
    useCanvasShapeStore.getState().resetDocument()
    useCanvasSelectionStore.getState().clearSelection()
    useWriteWorkspaceStore.getState().resetWorkspace()
    clearWriteWorkspaceSaveQueueForTests()
    vi.unstubAllGlobals()
  })

  it('sends Chat PPT review as structured context without mutating the prompt', async () => {
    useChatStore.setState({ route: 'chat' })
    activatePptReviewCanvas()
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      route: 'chat', input: '把第二页标题再大一点', getAttachmentScope: () => 'chat', sendMessage
    }))

    controller.handleSend()

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const [prompt, , options] = sendMessage.mock.calls[0] as unknown as Parameters<ControllerParams['sendMessage']>
    const contexts = options?.composerContexts
    expect(prompt).toBe('把第二页标题再大一点')
    expect(prompt).not.toContain('PPT visual review context')
    expect(contexts).toHaveLength(1)
    expect(contexts?.[0]?.reference).toEqual({
      kind: 'ppt-review', schemaVersion: 1, workflowId: 'workflow-a', childId: 'child-a',
      slides: [{ slideId: 'slide-2', revision: 3, annotations: ['Make the headline larger'] }]
    })
    expect(JSON.stringify(contexts)).not.toContain('preview.png')
  })

  it('sends only the selected Chat PPT direction identity', async () => {
    useChatStore.setState({ route: 'chat' })
    activatePptDirectionCanvas()
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      route: 'chat', input: '采用这个方向', getAttachmentScope: () => 'chat', sendMessage
    }))

    controller.handleSend()

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const [prompt, , options] = sendMessage.mock.calls[0] as unknown as Parameters<ControllerParams['sendMessage']>
    expect(prompt).toBe('采用这个方向')
    expect(options?.composerContexts?.[0]?.reference).toEqual({
      kind: 'ppt-direction', schemaVersion: 1, workflowId: 'workflow-a', childId: 'child-a',
      directions: [{ directionId: 'signal', revision: 2 }]
    })
  })

  it('keeps Work review feedback structured and fences the whiteboard thread', async () => {
    activatePptReviewCanvas()
    activateWorkPptWhiteboard()
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: '批准当前版本', sendMessage
    }))

    controller.sendWritePrompt('批准当前版本')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const [prompt, , options] = sendMessage.mock.calls[0] as unknown as Parameters<ControllerParams['sendMessage']>
    expect(prompt).toBe('批准当前版本')
    expect(prompt).not.toContain('Work central whiteboard override:')
    expect(prompt).not.toContain('Make the headline larger')
    expect(options?.guiDesignCanvas).toBe(true)
    expect(options?.composerContexts?.find((context) => (
      context.reference.kind === 'ppt-review'
    ))?.reference).toMatchObject({
      kind: 'ppt-review', workflowId: 'workflow-a', childId: 'child-a',
      slides: [{ slideId: 'slide-2', revision: 3, annotations: ['Make the headline larger'] }]
    })
    expect(options?.composerContexts?.find((context) => (
      context.reference.kind === 'work-reference-whiteboard'
    ))?.reference).toMatchObject({
      kind: 'work-reference-whiteboard', boardId: 'board-ppt-review'
    })
    expect(options?.writeContext).toMatchObject({
      whiteboardId: 'board-ppt-review', whiteboardRevision: 3, threadId: 'thr_mapped'
    })
  })

  it('sends only the active Work whiteboard direction context', async () => {
    activatePptDirectionCanvas()
    activateWorkPptWhiteboard('workflow-a', 'directions')
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: '采用这个方向', sendMessage
    }))

    controller.sendWritePrompt('采用这个方向')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const [, , options] = sendMessage.mock.calls[0] as unknown as Parameters<ControllerParams['sendMessage']>
    expect(options?.composerContexts?.find((context) => (
      context.reference.kind === 'ppt-direction'
    ))?.reference).toEqual({
      kind: 'ppt-direction', schemaVersion: 1, workflowId: 'workflow-a', childId: 'child-a',
      directions: [{ directionId: 'signal', revision: 2 }]
    })
  })

  it('lets Work confirm a numbered direction in chat without selecting the whiteboard', async () => {
    activatePptDirectionCanvas(false)
    activateWorkPptWhiteboard('workflow-a', 'directions')
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: '采用第 3 个方向，继续生成逐页预览。', sendMessage
    }))

    controller.sendWritePrompt('采用第 3 个方向，继续生成逐页预览。')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const [prompt, , options] = sendMessage.mock.calls[0] as unknown as Parameters<ControllerParams['sendMessage']>
    expect(prompt).toBe('采用第 3 个方向，继续生成逐页预览。')
    expect(options?.composerContexts?.find((context) => (
      context.reference.kind === 'ppt-direction'
    ))?.reference).toEqual({
      kind: 'ppt-direction', schemaVersion: 1, workflowId: 'workflow-a', childId: 'child-a',
      directions: []
    })
  })

  it('does not attach a hidden whiteboard review while a Work file is active', async () => {
    activatePptReviewCanvas()
    const sendMessage = vi.fn(async () => true)
    const controller = useWorkbenchComposerSubmitController(controllerParams({
      input: 'polish this paragraph', sendMessage
    }))

    controller.sendWritePrompt('polish this paragraph')

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    const [, , options] = sendMessage.mock.calls[0] as unknown as Parameters<ControllerParams['sendMessage']>
    expect(options?.composerContexts).toHaveLength(1)
    expect(options?.composerContexts?.[0]?.reference).toMatchObject({
      kind: 'work-reference-resource', locator: 'draft.md', access: 'read-write'
    })
  })
})
