import { defaultFrameSizeForDesignTarget, type DesignContext } from '../design-context'
import { buildCodeCanvasTurnPrompt } from '../design-turn-prompt'
import { peekLastCanvasOpErrors } from './apply-shape-ops'
import type { CanvasSnapshot } from './canvas-snapshot'
import type { CanvasDocument, ViewBox } from './canvas-types'
import {
  codeCanvasErrorKey,
  CODE_CANVAS_DIR,
  codeCanvasArtifactId,
  loadCodeCanvasDesignSystemForPrompt,
  resolveCodeCanvasEngine,
  snapshotCodeCanvasForPrompt
} from './code-canvas'
import type { DesignSystem } from './design-system-types'
import type { OpError } from './shape-ops'
import { resolveExcalidrawSceneForPrompt } from '../../whiteboard/excalidraw-persistence'

export type CodeCanvasOutboundDeps = {
  snapshotForPrompt?: typeof snapshotCodeCanvasForPrompt
  loadDesignSystemForPrompt?: typeof loadCodeCanvasDesignSystemForPrompt
  takeLastErrors?: (key: string) => OpError[]
  peekLastErrors?: (key: string) => OpError[]
}

export type BuildCodeCanvasOutboundTextOptions = CodeCanvasOutboundDeps & {
  baseText: string
  canvasBrief: string
  workspaceRoot: string
  threadId?: string | null
  currentDocument: CanvasDocument
  currentDocumentKey?: string | null
  selectedIds: ReadonlySet<string>
  viewBox: ViewBox
  designContext: DesignContext
}

async function readCodeCanvasSnapshot(
  options: BuildCodeCanvasOutboundTextOptions
): Promise<CanvasSnapshot | undefined> {
  if (!options.threadId) return undefined
  const snapshotForPrompt = options.snapshotForPrompt ?? snapshotCodeCanvasForPrompt
  return snapshotForPrompt({
    workspaceRoot: options.workspaceRoot,
    threadId: options.threadId,
    currentDocument: options.currentDocument,
    currentDocumentKey: options.currentDocumentKey,
    selectedIds: options.selectedIds,
    viewBox: options.viewBox,
    defaultScreenSize: defaultFrameSizeForDesignTarget(options.designContext.designTarget)
  })
}

async function readCodeCanvasDesignSystem(
  options: BuildCodeCanvasOutboundTextOptions
): Promise<DesignSystem | undefined> {
  if (!options.threadId) return undefined
  const loadDesignSystemForPrompt =
    options.loadDesignSystemForPrompt ?? loadCodeCanvasDesignSystemForPrompt
  return loadDesignSystemForPrompt({
    workspaceRoot: options.workspaceRoot,
    threadId: options.threadId
  })
}

export async function buildCodeCanvasOutboundText(
  options: BuildCodeCanvasOutboundTextOptions
): Promise<string> {
  const engine = options.threadId
    ? await resolveCodeCanvasEngine(options.workspaceRoot, options.threadId)
    : 'kun'
  if (engine === 'excalidraw') {
    const scene = options.threadId
      ? await resolveExcalidrawSceneForPrompt(
          options.workspaceRoot,
          codeCanvasArtifactId(options.threadId),
          CODE_CANVAS_DIR
        )
      : null
    return `${options.baseText}\n\n${buildCodeCanvasTurnPrompt({
      workspaceRoot: options.workspaceRoot,
      text: options.canvasBrief,
      canvasEngine: 'excalidraw',
      ...(scene ? { excalidrawScene: scene } : {})
    })}`
  }
  const snapshot = await readCodeCanvasSnapshot(options)
  const canvasFeedbackKey = options.threadId ? codeCanvasErrorKey(options.threadId) : undefined
  const canvasDesignSystem = await readCodeCanvasDesignSystem(options)
  const previousOpErrors = canvasFeedbackKey
    ? (options.peekLastErrors ?? options.takeLastErrors ?? peekLastCanvasOpErrors)(canvasFeedbackKey)
    : undefined
  const canvasPrompt = buildCodeCanvasTurnPrompt({
    workspaceRoot: options.workspaceRoot,
    text: options.canvasBrief,
    designContext: options.designContext,
    ...(previousOpErrors ? { previousOpErrors } : {}),
    ...(canvasFeedbackKey ? { canvasFeedbackKey } : {}),
    ...(canvasDesignSystem ? { canvasDesignSystem } : {}),
    ...(snapshot ? { canvasSnapshot: snapshot } : {})
  })
  return `${options.baseText}\n\n${canvasPrompt}`
}
