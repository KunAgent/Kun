import type { AttachmentReference } from '../agent/types'
import type { SendMessageOverrides } from '../store/chat-store-types'
import { canvasOpErrorKey, takeLastCanvasOpErrors } from './canvas/apply-shape-ops'
import { useCanvasSelectionStore } from './canvas/canvas-selection-store'
import { useCanvasShapeStore } from './canvas/canvas-shape-store'
import { useCanvasViewportStore } from './canvas/canvas-viewport-store'
import { resolveGeneratedImagePlacementTarget } from './canvas/canvas-generated-image-replay'
import { useDesignSystemStore } from './canvas/design-system-store'
import {
  ensureDesignBoardArtifact,
  findDesignBoardArtifact,
  findDesignBoardArtifactById
} from './design-board'
import type { DesignHtmlElementContext } from './design-composer-context'
import { useProjectDesignSystemStore } from './canvas/project-design-system-store'
import type { DesignPromptSource } from './design-quality-repair-dispatch'
import type { DesignArtifact } from './design-types'
import {
  buildDesignTurnSendOverrides,
  type DesignTurnPromptState
} from './design-turn-dispatch'
import {
  buildDesignTurnPromptPayload,
  type BuildDesignTurnPromptPayloadOptions,
  type DesignTurnPromptPayload
} from './design-turn-prompt/payload'
import {
  prepareDesignTurnFiles,
  type PrepareDesignTurnFilesOptions,
  type PrepareDesignTurnFilesResult
} from './design-turn-prompt/setup'
import {
  resolveDesignTurnTarget,
  type ResolvedDesignTurnTarget
} from './design-turn-prompt/target'
import { useDesignTokensStore } from './design-tokens-store'
import { useDesignWorkspaceStore } from './design-workspace-store'
import type { DesignWorkspaceState } from './design-workspace-store-types'
import type {
  DesignDocumentTarget,
  DesignTaskProfileInput
} from '../agent/design-task-profile'
import {
  applyDesignTaskProfileContract,
  designContextFromTaskProfile
} from './design-task-profile-input'

export type DesignTurnSubmitSendMessage = (
  text: string,
  mode?: string,
  overrides?: SendMessageOverrides
) => Promise<boolean>

export type SubmitDesignTurnResult =
  | { status: 'sent'; target: ResolvedDesignTurnTarget['target']; clearAttachments: boolean }
  | { status: 'send-failed'; target: ResolvedDesignTurnTarget['target'] }
  | { status: 'missing-board' }
  | { status: 'file-error'; message: string }

type StoreGetter<T> = () => T

export type SubmitDesignTurnDeps = {
  getDesignState?: StoreGetter<DesignWorkspaceState>
  getCanvasShapeState?: typeof useCanvasShapeStore.getState
  getCanvasSelectionState?: typeof useCanvasSelectionStore.getState
  getCanvasViewportState?: typeof useCanvasViewportStore.getState
  getDesignSystemState?: typeof useDesignSystemStore.getState
  getDesignTokensState?: typeof useDesignTokensStore.getState
  ensureBoardArtifact?: typeof ensureDesignBoardArtifact
  resolveTarget?: typeof resolveDesignTurnTarget
  prepareTurnFiles?: (options: PrepareDesignTurnFilesOptions) => Promise<PrepareDesignTurnFilesResult>
  buildPromptPayload?: (options: BuildDesignTurnPromptPayloadOptions) => Promise<DesignTurnPromptPayload>
  takeLastCanvasErrors?: typeof takeLastCanvasOpErrors
}

export type SubmitDesignTurnOptions = SubmitDesignTurnDeps & {
  promptText: string
  displayText: string
  workspaceRoot: string
  source: DesignPromptSource
  sendMessage: DesignTurnSubmitSendMessage
  resolveProviderId: (model: string) => string
  model?: string
  providerId?: string
  reasoningEffort?: string
  serviceTier?: 'priority'
  expectedThreadId?: string
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  suppressedIds?: ReadonlySet<string>
  htmlElementContext?: DesignHtmlElementContext | null
  explicitScreenShapeId?: string | null
  explicitSvgArtifactId?: string | null
  imageEditReferencePath?: string
  clearAutoRepairScope?: (scopeKey: string) => void
  designTaskProfileForTarget?: (target: DesignDocumentTarget) => DesignTaskProfileInput
  /**
   * When a locked task cannot rebuild an identity profile, omit both
   * designProfile and designDocumentTarget so admission reuses the lock.
   */
  omitDesignProfileWhenUnavailable?: boolean
  /**
   * Board pinned by a locked task target. When present the board is resolved by
   * id and a missing board is reported instead of re-selecting the most
   * recently updated canvas artifact.
   */
  boardArtifactId?: string
  waitForRuntimeAdmission?: boolean
  /** Called after local preparation but immediately before the runtime request. */
  onBeforeSend?: () => void | Promise<void>
}

export async function submitDesignTurn(
  options: SubmitDesignTurnOptions
): Promise<SubmitDesignTurnResult> {
  const getDesignState = options.getDesignState ?? useDesignWorkspaceStore.getState
  const getCanvasShapeState = options.getCanvasShapeState ?? useCanvasShapeStore.getState
  const getCanvasSelectionState = options.getCanvasSelectionState ?? useCanvasSelectionStore.getState
  const getCanvasViewportState = options.getCanvasViewportState ?? useCanvasViewportStore.getState
  const getDesignSystemState = options.getDesignSystemState ?? useDesignSystemStore.getState
  const getDesignTokensState = options.getDesignTokensState ?? useDesignTokensStore.getState
  const ensureBoard = options.ensureBoardArtifact ?? ensureDesignBoardArtifact
  const resolveTarget = options.resolveTarget ?? resolveDesignTurnTarget
  const prepareTurn = options.prepareTurnFiles ?? prepareDesignTurnFiles
  const buildPayload = options.buildPromptPayload ?? buildDesignTurnPromptPayload
  const takeCanvasErrors = options.takeLastCanvasErrors ?? takeLastCanvasOpErrors

  const initialDesignState = getDesignState()
  const turnContext = {
    workspaceRoot: initialDesignState.workspaceRoot || options.workspaceRoot,
    documentId: initialDesignState.activeDocumentId,
    boardArtifactId: options.boardArtifactId
  }
  const fail = (message: string): SubmitDesignTurnResult => {
    getDesignState().setFileError(message)
    return { status: 'file-error', message }
  }
  let boardArtifact: (DesignArtifact & { kind: 'canvas' }) | null = null
  const contextMatches = (boardId?: string): boolean => {
    const state = getDesignState()
    if (
      !turnContext.documentId ||
      (state.workspaceRoot || options.workspaceRoot) !== turnContext.workspaceRoot ||
      state.activeDocumentId !== turnContext.documentId
    ) {
      return false
    }
    if (!boardId) return true
    // A locked board compares against the resolved target id; an unlocked
    // target re-selects the current board so a board swap during the async
    // ensure step is still detected.
    if (turnContext.boardArtifactId) return boardArtifact?.id === boardId
    return findDesignBoardArtifact(state.artifacts)?.id === boardId
  }
  const contextError = 'Design turn was cancelled because the active workspace or drawing changed.'
  if (!turnContext.documentId || !contextMatches()) return fail(contextError)

  let latestDesignState = initialDesignState
  boardArtifact = turnContext.boardArtifactId
    ? findDesignBoardArtifactById(latestDesignState.artifacts, turnContext.boardArtifactId)
    : findDesignBoardArtifact(latestDesignState.artifacts)
  try {
    if (!boardArtifact) {
      // A locked board that no longer exists must fail loudly instead of
      // silently retargeting the task to a different whiteboard.
      if (turnContext.boardArtifactId) return { status: 'missing-board' }
      boardArtifact = await ensureBoard(options.workspaceRoot, turnContext.documentId)
      if (!contextMatches(boardArtifact?.id)) return fail(contextError)
      latestDesignState = getDesignState()
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  if (!boardArtifact) return { status: 'missing-board' }
  const designDocumentTarget = {
    documentId: turnContext.documentId,
    boardArtifactId: boardArtifact.id
  }
  const designProfile = options.designTaskProfileForTarget?.(designDocumentTarget)
  const omitLockedProfile = Boolean(options.omitDesignProfileWhenUnavailable && !designProfile)
  const turnDesignContext = designProfile
    ? designContextFromTaskProfile(designProfile)
    : latestDesignState.designContext
  const targetWorkspaceState = designProfile
    ? { ...latestDesignState, designContext: turnDesignContext }
    : latestDesignState
  if (latestDesignState.activeArtifactId !== boardArtifact.id) {
    getDesignState().setActiveArtifact(boardArtifact.id)
  }

  const canvasDoc = getCanvasShapeState().document
  const selectedShapeIds = getCanvasSelectionState().selectedIds
  const designImagePlacementTarget = designProfile?.outputMedium === 'image'
    ? resolveGeneratedImagePlacementTarget({
        document: canvasDoc,
        selectedIds: selectedShapeIds,
        userText: options.displayText || options.promptText
      })
    : null
  let resolvedTarget: ResolvedDesignTurnTarget
  try {
    resolvedTarget = await resolveTarget({
      promptText: options.promptText,
      workspaceState: targetWorkspaceState,
      boardArtifact,
      canvasDocument: canvasDoc,
      selectedShapeIds,
      suppressedIds: options.suppressedIds,
      htmlElementContext: options.htmlElementContext,
      explicitScreenShapeId: options.explicitScreenShapeId,
      explicitSvgArtifactId: options.explicitSvgArtifactId,
      viewBox: getCanvasViewportState().vbox
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  const failAfterResolve = async (message: string): Promise<SubmitDesignTurnResult> => {
    try {
      await resolvedTarget.rollbackPreparedVersion?.()
    } catch (rollbackError) {
      const detail = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      return fail(`${message} Rollback failed: ${detail}`)
    }
    return fail(message)
  }
  if (!contextMatches(boardArtifact.id)) return failAfterResolve(contextError)
  if (resolvedTarget.nextIntentMode) {
    getDesignState().setDesignIntentMode(resolvedTarget.nextIntentMode)
  }
  if (options.source === 'user') {
    options.clearAutoRepairScope?.(resolvedTarget.targetAutoRepairKey)
  }
  getDesignState().setActiveArtifact(boardArtifact.id)

  let turnFiles: PrepareDesignTurnFilesResult
  try {
    turnFiles = await prepareTurn({
      workspaceRoot: options.workspaceRoot,
      promptText: options.promptText,
      resolvedTarget,
      artifacts: getDesignState().artifacts,
      designContext: turnDesignContext
    })
  } catch (error) {
    return failAfterResolve(error instanceof Error ? error.message : String(error))
  }
  if (!contextMatches(boardArtifact.id)) return failAfterResolve(contextError)
  if (!turnFiles.ok) {
    return failAfterResolve(turnFiles.message)
  }

  const livePromptState = getDesignState()
  const promptState = designProfile
    ? {
        ...livePromptState,
        designContext: turnDesignContext,
        // This mutable workspace preference is intentionally not allowed to
        // restyle an already profiled task.
        generationPrompt: ''
      }
    : livePromptState
  const projectDesignMd = useProjectDesignSystemStore.getState()
  const canvasErrorKey = canvasOpErrorKey(options.workspaceRoot, promptState.activeDocumentId, boardArtifact.id)
  let promptPayload: DesignTurnPromptPayload
  try {
    promptPayload = await buildPayload({
      target: resolvedTarget.target,
      mode: (options.attachmentIds?.length ?? 0) > 0 ? 'image' : 'text',
      promptText: options.promptText,
      artifactRelativePath: resolvedTarget.artifactRelativePath,
      workspaceRoot: options.workspaceRoot,
      promptState,
      boardArtifact,
      visibleTargets: resolvedTarget.visibleTargets,
      canvasDocument: getCanvasShapeState().document,
      designSystem: getDesignSystemState().system,
      ...(projectDesignMd.workspaceRoot === options.workspaceRoot && projectDesignMd.status === 'ready' && projectDesignMd.sourceHash
        ? { projectDesignMdSourceHash: projectDesignMd.sourceHash }
        : {}),
      tokensByArtifact: getDesignTokensState().byArtifact,
      ...(resolvedTarget.designNotesPath ? { designNotesPath: resolvedTarget.designNotesPath } : {}),
      ...(resolvedTarget.basePath ? { basePath: resolvedTarget.basePath } : {}),
      ...(resolvedTarget.htmlArtifactId ? { htmlArtifactId: resolvedTarget.htmlArtifactId } : {}),
      ...(resolvedTarget.htmlElementContext ? { htmlElementContext: resolvedTarget.htmlElementContext } : {}),
      ...(resolvedTarget.canvasSnapshot ? { canvasSnapshot: resolvedTarget.canvasSnapshot } : {}),
      ...(resolvedTarget.htmlFrameContext ? { frameContext: resolvedTarget.htmlFrameContext } : {}),
      ...(resolvedTarget.selectedFrame ? { selectedFrame: resolvedTarget.selectedFrame } : {}),
      ...(resolvedTarget.target === 'canvas' ? { previousOpErrors: takeCanvasErrors(canvasErrorKey) } : {}),
      ...(options.imageEditReferencePath
        ? { imageEditReferencePath: options.imageEditReferencePath }
        : {})
    })
  } catch (error) {
    return failAfterResolve(error instanceof Error ? error.message : String(error))
  }
  if (!contextMatches(boardArtifact.id)) return failAfterResolve(contextError)
  let sent: boolean
  try {
    await options.onBeforeSend?.()
    sent = await options.sendMessage(
      designProfile
        ? applyDesignTaskProfileContract(promptPayload.prompt, designProfile)
        : promptPayload.prompt,
      'agent',
      buildDesignTurnSendOverrides({
        displayText: options.displayText,
        promptState: promptState as DesignTurnPromptState,
        resolveProviderId: options.resolveProviderId,
        ...(options.model ? { model: options.model } : {}),
        ...(options.providerId ? { providerId: options.providerId } : {}),
        ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
        ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
        ...(options.expectedThreadId ? { expectedThreadId: options.expectedThreadId } : {}),
        target: resolvedTarget.target,
        ...(!omitLockedProfile && designProfile ? { designProfile, designDocumentTarget } : {}),
        ...(designImagePlacementTarget ? { designImagePlacementTarget } : {}),
        ...(options.waitForRuntimeAdmission ? { waitForRuntimeAdmission: true } : {}),
        attachmentIds: options.attachmentIds ?? [],
        attachments: options.attachments ?? [],
        ...(resolvedTarget.svgArtifactId ? {
          guiDesignArtifact: {
            kind: 'svg' as const,
            artifactId: resolvedTarget.svgArtifactId,
            relativePath: resolvedTarget.artifactRelativePath
          }
        } : {})
      })
    )
  } catch (error) {
    return failAfterResolve(error instanceof Error ? error.message : String(error))
  }
  if (!sent) return failAfterResolve('Design turn could not be sent.')
  return sent
    ? {
        status: 'sent',
        target: resolvedTarget.target,
        clearAttachments: (options.attachmentIds?.length ?? 0) > 0
      }
    : { status: 'send-failed', target: resolvedTarget.target }
}
