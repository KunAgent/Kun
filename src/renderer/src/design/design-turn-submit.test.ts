import { describe, expect, it, vi } from 'vitest'
import type { AttachmentReference } from '../agent/types'
import { createDefaultShape, createEmptyDocument } from './canvas/canvas-types'
import { createEmptyDesignSystem } from './canvas/design-system-types'
import { submitDesignTurn } from './design-turn-submit'
import type { DesignArtifact } from './design-types'
import type { DesignWorkspaceState } from './design-workspace-store-types'
import type {
  BuildDesignTurnPromptPayloadOptions,
  DesignTurnPromptPayload
} from './design-turn-prompt/payload'
import type {
  PrepareDesignTurnFilesOptions,
  PrepareDesignTurnFilesResult
} from './design-turn-prompt/setup'
import type {
  ResolveDesignTurnTargetOptions,
  ResolvedDesignTurnTarget
} from './design-turn-prompt/target'

const now = '2026-07-02T00:00:00.000Z'

const boardArtifact: DesignArtifact & { kind: 'canvas' } = {
  id: 'board',
  kind: 'canvas',
  title: 'Design board',
  relativePath: '.kun-design/doc/board/canvas.json',
  createdAt: now,
  updatedAt: now,
  versions: [{ id: 'board-v1', relativePath: '.kun-design/doc/board/canvas.json', createdAt: now, summary: '' }]
}

const attachment: AttachmentReference = {
  id: 'att_1',
  kind: 'image',
  name: 'reference.png'
}

function makeDesignState(patch: Partial<DesignWorkspaceState> = {}): DesignWorkspaceState {
  const state = {
    workspaceRoot: '/workspace',
    artifacts: [boardArtifact],
    activeArtifactId: null,
    assistantModel: ' deepseek-chat ',
    assistantProviderId: ' ',
    designContext: { designTarget: 'web' },
    generationPrompt: '',
    documents: [],
    activeDocumentId: 'doc',
    setActiveArtifact: vi.fn((artifactId: string | null) => {
      state.activeArtifactId = artifactId
    }),
    setDesignIntentMode: vi.fn(),
    setFileError: vi.fn(),
    ...patch
  } as unknown as DesignWorkspaceState
  return state
}

function resolvedTarget(patch: Partial<ResolvedDesignTurnTarget> = {}): ResolvedDesignTurnTarget {
  return {
    target: 'canvas',
    artifactRelativePath: boardArtifact.relativePath,
    visibleTargets: [],
    targetAutoRepairKey: 'artifact:board',
    nextIntentMode: 'modify',
    ...patch
  }
}

describe('submitDesignTurn', () => {
  it('resolves the target, builds the prompt payload, and sends the design turn', async () => {
    const designState = makeDesignState()
    const canvasDocument = createEmptyDocument()
    const target = resolvedTarget()
    const resolveTarget = vi.fn(async (_options: ResolveDesignTurnTargetOptions) => target)
    const prepareTurnFiles = vi.fn(async (
      _options: PrepareDesignTurnFilesOptions
    ): Promise<PrepareDesignTurnFilesResult> => ({ ok: true, notesWritten: false }))
    const buildPromptPayload = vi.fn(async (
      _options: BuildDesignTurnPromptPayloadOptions
    ): Promise<DesignTurnPromptPayload> => ({
      prompt: 'DESIGN PROMPT',
      promptState: designState
    }))
    const takeLastCanvasErrors = vi.fn(() => [])
    const sendMessage = vi.fn(async () => true)
    const clearAutoRepairScope = vi.fn()

    const result = await submitDesignTurn({
      promptText: 'Create a dashboard',
      displayText: 'Create a dashboard',
      workspaceRoot: '/workspace',
      source: 'user',
      sendMessage,
      resolveProviderId: () => 'deepseek',
      reasoningEffort: 'medium',
      serviceTier: 'priority',
      expectedThreadId: 'thr_design',
      attachmentIds: [attachment.id],
      attachments: [attachment],
      suppressedIds: new Set(['hidden']),
      htmlElementContext: null,
      explicitScreenShapeId: 'frame_1',
      clearAutoRepairScope,
      getDesignState: () => designState,
      getCanvasShapeState: () => ({ document: canvasDocument }) as never,
      getCanvasSelectionState: () => ({ selectedIds: new Set(['shape_1']) }) as never,
      getCanvasViewportState: () => ({ vbox: { x: 0, y: 0, width: 1200, height: 800 } }) as never,
      getDesignSystemState: () => ({ system: createEmptyDesignSystem() }) as never,
      getDesignTokensState: () => ({ byArtifact: {} }) as never,
      takeLastCanvasErrors,
      resolveTarget,
      prepareTurnFiles,
      buildPromptPayload
    })

    expect(result).toEqual({ status: 'sent', target: 'canvas', clearAttachments: true })
    expect(resolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      promptText: 'Create a dashboard',
      boardArtifact,
      selectedShapeIds: new Set(['shape_1']),
      explicitScreenShapeId: 'frame_1'
    }))
    expect(designState.setDesignIntentMode).toHaveBeenCalledWith('modify')
    expect(clearAutoRepairScope).toHaveBeenCalledWith('artifact:board')
    expect(prepareTurnFiles).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/workspace',
      resolvedTarget: target
    }))
    expect(buildPromptPayload).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'image',
      target: 'canvas',
      runtimeModePolicy: true,
      previousOpErrors: []
    }))
    expect(takeLastCanvasErrors).toHaveBeenCalledWith('/workspace:doc:board')
    expect(sendMessage).toHaveBeenCalledWith('DESIGN PROMPT', 'agent', {
      displayText: 'Create a dashboard',
      agentSurface: 'design',
      model: 'deepseek-chat',
      providerId: 'deepseek',
      reasoningEffort: 'medium',
      serviceTier: 'priority',
      expectedThreadId: 'thr_design',
      guiDesignCanvas: true,
      guiDesignMode: true,
      attachmentIds: [attachment.id],
      attachments: [attachment]
    })
  })

  it.each([
    ['reserves the page and lets Kun supply its rules', 'page_1', '.kun-design/doc/page_1/v2.html', true],
    ['keeps the rules inline when the page cannot be reserved', undefined, '.kun-design/doc/page_1/v2.html', false]
  ] as const)('%s', async (_label, htmlArtifactId, artifactRelativePath, reserved) => {
    const designState = makeDesignState()
    const buildPromptPayload = vi.fn(async (
      _options: BuildDesignTurnPromptPayloadOptions
    ): Promise<DesignTurnPromptPayload> => ({ prompt: 'PAGE PROMPT', promptState: designState }))
    const sendMessage = vi.fn(async (..._args: unknown[]) => true)
    await submitDesignTurn({
      promptText: 'Build the page', displayText: 'Build the page', workspaceRoot: '/workspace', source: 'user',
      sendMessage, resolveProviderId: () => 'deepseek', suppressedIds: new Set(), htmlElementContext: null,
      getDesignState: () => designState,
      getCanvasShapeState: () => ({ document: createEmptyDocument() }) as never,
      getCanvasSelectionState: () => ({ selectedIds: new Set() }) as never,
      getCanvasViewportState: () => ({ vbox: { x: 0, y: 0, width: 1200, height: 800 } }) as never,
      getDesignSystemState: () => ({ system: createEmptyDesignSystem() }) as never,
      getDesignTokensState: () => ({ byArtifact: {} }) as never,
      takeLastCanvasErrors: vi.fn(() => []),
      resolveTarget: vi.fn(async () => resolvedTarget({
        target: 'screen', artifactRelativePath, designNotesPath: '.kun-design/doc/page_1/DESIGN.md',
        ...(htmlArtifactId ? { htmlArtifactId } : {})
      })),
      prepareTurnFiles: vi.fn(async (): Promise<PrepareDesignTurnFilesResult> => ({ ok: true, notesWritten: false })),
      buildPromptPayload
    })
    const payloadOptions = buildPromptPayload.mock.calls[0]?.[0]
    expect(payloadOptions?.runtimeModePolicy === true).toBe(reserved)
    const overrides = sendMessage.mock.calls[0]?.[2] as { guiDesignArtifact?: unknown }
    expect(overrides.guiDesignArtifact).toEqual(reserved ? {
      kind: 'html', artifactId: 'page_1', relativePath: artifactRelativePath,
      designMdPath: '.kun-design/doc/page_1/DESIGN.md'
    } : undefined)
  })

  it('carries the bound profile and target while enforcing the AI-image output lane', async () => {
    const designState = makeDesignState()
    designState.designContext = { designTarget: 'web', brandColor: '#global' }
    designState.generationPrompt = 'mutable prompt from another task'
    const sendMessage = vi.fn(async () => true)
    const resolveTarget = vi.fn(async () => resolvedTarget())
    const prepareTurnFiles = vi.fn(async () => ({ ok: true as const, notesWritten: false }))
    const buildPromptPayload = vi.fn(async () => ({ prompt: 'DESIGN PROMPT', promptState: designState }))
    const designTaskProfileForTarget = vi.fn((documentTarget: {
      documentId: string
      boardArtifactId: string
    }) => ({
      version: 1 as const,
      documentTarget,
      outputMedium: 'image' as const,
      target: 'app' as const,
      preset: 'ios' as const,
      context: { tone: ['bold'], brandColor: '#locked' }
    }))
    const canvasDocument = createEmptyDocument()
    const imageHolder = createDefaultShape('rect', 80, 120)
    canvasDocument.objects[imageHolder.id] = imageHolder

    const result = await submitDesignTurn({
      promptText: 'Create a launch poster',
      displayText: 'Create a launch poster',
      workspaceRoot: '/workspace',
      source: 'user',
      sendMessage,
      resolveProviderId: () => 'deepseek',
      expectedThreadId: 'thr_design',
      designTaskProfileForTarget,
      getDesignState: () => designState,
      getCanvasShapeState: () => ({ document: canvasDocument }) as never,
      getCanvasSelectionState: () => ({ selectedIds: new Set([imageHolder.id]) }) as never,
      getCanvasViewportState: () => ({ vbox: { x: 0, y: 0, width: 1200, height: 800 } }) as never,
      getDesignSystemState: () => ({ system: createEmptyDesignSystem() }) as never,
      getDesignTokensState: () => ({ byArtifact: {} }) as never,
      resolveTarget,
      prepareTurnFiles,
      buildPromptPayload
    })

    const profile = {
      version: 1,
      documentTarget: { documentId: 'doc', boardArtifactId: 'board' },
      outputMedium: 'image',
      target: 'app',
      preset: 'ios',
      context: { tone: ['bold'], brandColor: '#locked' }
    }
    expect(result).toEqual({ status: 'sent', target: 'canvas', clearAttachments: false })
    expect(designTaskProfileForTarget).toHaveBeenCalledWith(profile.documentTarget)
    expect(resolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      workspaceState: expect.objectContaining({
        designContext: expect.objectContaining({
          designTarget: 'app',
          brandColor: '#locked'
        })
      })
    }))
    expect(prepareTurnFiles).toHaveBeenCalledWith(expect.objectContaining({
      designContext: expect.objectContaining({ designTarget: 'app', brandColor: '#locked' })
    }))
    expect(buildPromptPayload).toHaveBeenCalledWith(expect.objectContaining({
      promptState: expect.objectContaining({
        designContext: expect.objectContaining({ designTarget: 'app', brandColor: '#locked' }),
        generationPrompt: ''
      })
    }))
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringMatching(
        /AI-generated raster image[\s\S]*generate_image[\s\S]*Do not create an HTML screen[\s\S]*DESIGN PROMPT/
      ),
      'agent',
      expect.objectContaining({
        displayText: 'Create a launch poster',
        agentSurface: 'design',
        expectedThreadId: 'thr_design',
        designProfile: profile,
        designDocumentTarget: profile.documentTarget,
        designImagePlacementTarget: {
          shapeId: imageHolder.id,
          expectedHolderKind: 'implicit-rect'
        },
        guiDesignCanvas: true,
        guiDesignMode: true
      })
    )
  })

  it('sets the design file error and skips send when setup fails', async () => {
    const designState = makeDesignState()
    const rollbackPreparedVersion = vi.fn(async () => undefined)
    const prepareTurnFiles = vi.fn(async (): Promise<PrepareDesignTurnFilesResult> => ({
      ok: false,
      phase: 'preview',
      message: 'Design preview setup failed'
    }))
    const sendMessage = vi.fn(async () => true)

    const result = await submitDesignTurn({
      promptText: 'Refine the page',
      displayText: 'Refine the page',
      workspaceRoot: '/workspace',
      source: 'manual-quality-repair',
      sendMessage,
      resolveProviderId: () => '',
      getDesignState: () => designState,
      getCanvasShapeState: () => ({ document: createEmptyDocument() }) as never,
      getCanvasSelectionState: () => ({ selectedIds: new Set<string>() }) as never,
      getCanvasViewportState: () => ({ vbox: { x: 0, y: 0, width: 1200, height: 800 } }) as never,
      resolveTarget: vi.fn(async () => resolvedTarget({ target: 'html', rollbackPreparedVersion })),
      prepareTurnFiles
    })

    expect(result).toEqual({ status: 'file-error', message: 'Design preview setup failed' })
    expect(designState.setFileError).toHaveBeenCalledWith('Design preview setup failed')
    expect(rollbackPreparedVersion).toHaveBeenCalledOnce()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('surfaces resolve failures instead of leaking an unhandled rejection', async () => {
    const designState = makeDesignState()
    const sendMessage = vi.fn(async () => true)

    const result = await submitDesignTurn({
      promptText: 'Refine SVG',
      displayText: 'Refine SVG',
      workspaceRoot: '/workspace',
      source: 'user',
      sendMessage,
      resolveProviderId: () => '',
      getDesignState: () => designState,
      getCanvasShapeState: () => ({ document: createEmptyDocument() }) as never,
      getCanvasSelectionState: () => ({ selectedIds: new Set<string>() }) as never,
      getCanvasViewportState: () => ({ vbox: { x: 0, y: 0, width: 1200, height: 800 } }) as never,
      resolveTarget: vi.fn(async () => { throw new Error('version allocation failed') })
    })

    expect(result).toEqual({ status: 'file-error', message: 'version allocation failed' })
    expect(designState.setFileError).toHaveBeenCalledWith('version allocation failed')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('cancels before send if the active document changes after target resolution', async () => {
    const designState = makeDesignState()
    const rollbackPreparedVersion = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async () => true)
    const buildPromptPayload = vi.fn(async (): Promise<DesignTurnPromptPayload> => {
      designState.activeDocumentId = 'other-doc'
      return { prompt: 'STALE PROMPT', promptState: designState }
    })

    const result = await submitDesignTurn({
      promptText: 'Refine SVG',
      displayText: 'Refine SVG',
      workspaceRoot: '/workspace',
      source: 'user',
      sendMessage,
      resolveProviderId: () => '',
      getDesignState: () => designState,
      getCanvasShapeState: () => ({ document: createEmptyDocument() }) as never,
      getCanvasSelectionState: () => ({ selectedIds: new Set<string>() }) as never,
      getCanvasViewportState: () => ({ vbox: { x: 0, y: 0, width: 1200, height: 800 } }) as never,
      resolveTarget: vi.fn(async () => resolvedTarget({ rollbackPreparedVersion })),
      prepareTurnFiles: vi.fn(async () => ({ ok: true as const, notesWritten: false })),
      buildPromptPayload
    })

    expect(result).toMatchObject({ status: 'file-error', message: expect.stringContaining('active workspace') })
    expect(rollbackPreparedVersion).toHaveBeenCalledOnce()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('rolls back the prepared version when runtime dispatch returns false', async () => {
    const designState = makeDesignState()
    const rollbackPreparedVersion = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async () => false)

    const result = await submitDesignTurn({
      promptText: 'Refine SVG',
      displayText: 'Refine SVG',
      workspaceRoot: '/workspace',
      source: 'user',
      sendMessage,
      resolveProviderId: () => '',
      getDesignState: () => designState,
      getCanvasShapeState: () => ({ document: createEmptyDocument() }) as never,
      getCanvasSelectionState: () => ({ selectedIds: new Set<string>() }) as never,
      getCanvasViewportState: () => ({ vbox: { x: 0, y: 0, width: 1200, height: 800 } }) as never,
      resolveTarget: vi.fn(async () => resolvedTarget({ rollbackPreparedVersion })),
      prepareTurnFiles: vi.fn(async () => ({ ok: true as const, notesWritten: false })),
      buildPromptPayload: vi.fn(async () => ({ prompt: 'SVG PROMPT', promptState: designState }))
    })

    expect(result).toEqual({ status: 'file-error', message: 'Design turn could not be sent.' })
    expect(rollbackPreparedVersion).toHaveBeenCalledOnce()
  })

  it('returns missing-board when no canvas board can be found or created', async () => {
    const designState = makeDesignState({ artifacts: [] })
    const sendMessage = vi.fn(async () => true)
    const ensureBoardArtifact = vi.fn(async () => null)

    const result = await submitDesignTurn({
      promptText: 'Create a screen',
      displayText: 'Create a screen',
      workspaceRoot: '/workspace',
      source: 'user',
      sendMessage,
      resolveProviderId: () => '',
      getDesignState: () => designState,
      ensureBoardArtifact
    })

    expect(result).toEqual({ status: 'missing-board' })
    expect(ensureBoardArtifact).toHaveBeenCalledWith('/workspace', designState.activeDocumentId)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('targets the locked board id even when another board was updated more recently', async () => {
    const olderBoard: DesignArtifact & { kind: 'canvas' } = {
      ...boardArtifact,
      id: 'board-locked',
      updatedAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z'
    }
    const newerBoard: DesignArtifact & { kind: 'canvas' } = {
      ...boardArtifact,
      id: 'board-newest',
      updatedAt: '2026-07-03T00:00:00.000Z'
    }
    const designState = makeDesignState({ artifacts: [olderBoard, newerBoard] })
    const sendMessage = vi.fn(async () => true)
    const resolveTarget = vi.fn(async () => resolvedTarget())
    const prepareTurnFiles = vi.fn(async () => ({ ok: true as const, notesWritten: false }))
    const buildPromptPayload = vi.fn(async () => ({ prompt: 'DESIGN PROMPT', promptState: designState }))
    const designTaskProfileForTarget = vi.fn((documentTarget: {
      documentId: string
      boardArtifactId: string
    }) => ({
      version: 1 as const,
      documentTarget,
      outputMedium: 'html' as const,
      target: 'web' as const,
      preset: 'none' as const,
      context: { tone: [] }
    }))

    const result = await submitDesignTurn({
      promptText: 'Refine the locked board',
      displayText: 'Refine the locked board',
      workspaceRoot: '/workspace',
      source: 'user',
      sendMessage,
      resolveProviderId: () => '',
      boardArtifactId: 'board-locked',
      designTaskProfileForTarget,
      getDesignState: () => designState,
      getCanvasShapeState: () => ({ document: createEmptyDocument() }) as never,
      getCanvasSelectionState: () => ({ selectedIds: new Set<string>() }) as never,
      getCanvasViewportState: () => ({ vbox: { x: 0, y: 0, width: 1200, height: 800 } }) as never,
      getDesignSystemState: () => ({ system: createEmptyDesignSystem() }) as never,
      getDesignTokensState: () => ({ byArtifact: {} }) as never,
      resolveTarget,
      prepareTurnFiles,
      buildPromptPayload
    })

    expect(result).toEqual({ status: 'sent', target: 'canvas', clearAttachments: false })
    expect(resolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      boardArtifact: expect.objectContaining({ id: 'board-locked' })
    }))
    expect(designTaskProfileForTarget).toHaveBeenCalledWith({
      documentId: 'doc',
      boardArtifactId: 'board-locked'
    })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      'agent',
      expect.objectContaining({
        designDocumentTarget: { documentId: 'doc', boardArtifactId: 'board-locked' }
      })
    )
  })

  it('returns missing-board when the locked board id is absent instead of switching boards', async () => {
    const designState = makeDesignState() // only "board" exists, the locked id does not
    const sendMessage = vi.fn(async () => true)
    const ensureBoardArtifact = vi.fn(async () => null)

    const result = await submitDesignTurn({
      promptText: 'Refine the locked board',
      displayText: 'Refine the locked board',
      workspaceRoot: '/workspace',
      source: 'user',
      sendMessage,
      resolveProviderId: () => '',
      boardArtifactId: 'board-locked-missing',
      getDesignState: () => designState,
      ensureBoardArtifact
    })

    expect(result).toEqual({ status: 'missing-board' })
    expect(ensureBoardArtifact).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
