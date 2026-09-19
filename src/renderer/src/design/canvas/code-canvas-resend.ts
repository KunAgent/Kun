import type { DesignContext } from '../design-context'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasViewportStore } from './canvas-viewport-store'
import {
  resolveCodeCanvasComposerRoute,
  resolveCodeCanvasEngine,
  resolveCodeCanvasWorkspaceRoot
} from './code-canvas'
import {
  buildCodeCanvasOutboundText,
  type BuildCodeCanvasOutboundTextOptions
} from './code-canvas-outbound'
import type { CanvasDocument, ViewBox } from './canvas-types'

export type CodeCanvasResendLiveState = {
  currentDocument: CanvasDocument
  currentDocumentKey: string | null
  selectedIds: ReadonlySet<string>
  viewBox: ViewBox
  designContext: DesignContext
}

export type PrepareCodeCanvasResendOptions = {
  route: string
  text: string
  previousCanvasTurn: boolean
  fallbackWorkspaceRoot: string
  threadWorkspaceRoot?: string
  threadId: string
}

export type PreparedCodeCanvasResend = {
  text: string
  displayText: string
  guiDesignCanvas?: true
  guiExcalidrawCanvas?: true
}

export type PrepareCodeCanvasResendDependencies = {
  buildOutboundText?: (options: BuildCodeCanvasOutboundTextOptions) => Promise<string>
  readLiveState?: () => CodeCanvasResendLiveState
}

function readLiveCodeCanvasState(): CodeCanvasResendLiveState {
  const shapeState = useCanvasShapeStore.getState()
  return {
    currentDocument: shapeState.document,
    currentDocumentKey: shapeState.documentKey,
    selectedIds: useCanvasSelectionStore.getState().selectedIds,
    viewBox: useCanvasViewportStore.getState().vbox,
    designContext: useDesignWorkspaceStore.getState().designContext
  }
}

/**
 * Rebuild a Code-whiteboard turn after message rewind/edit. The original
 * enriched prompt must never be replayed verbatim because its canvas snapshot
 * may be stale; classify the edited display text again and capture live state.
 */
export async function prepareCodeCanvasResend(
  options: PrepareCodeCanvasResendOptions,
  dependencies: PrepareCodeCanvasResendDependencies = {}
): Promise<PreparedCodeCanvasResend | null> {
  const text = options.text.trim()
  if (!text) return null

  const liveState = (dependencies.readLiveState ?? readLiveCodeCanvasState)()
  const route = resolveCodeCanvasComposerRoute({
    route: options.route,
    composerMode: 'agent',
    userText: text,
    preparedText: text,
    emptyPrompt: text,
    whiteboardOpen: options.previousCanvasTurn,
    hasSelection: liveState.selectedIds.size > 0
  })
  if (!route) return null

  const workspaceRoot = resolveCodeCanvasWorkspaceRoot(
    options.threadWorkspaceRoot,
    options.fallbackWorkspaceRoot
  )
  const buildOutboundText = dependencies.buildOutboundText ?? buildCodeCanvasOutboundText
  const outboundText = await buildOutboundText({
    baseText: route.baseText,
    canvasBrief: route.canvasBrief,
    workspaceRoot,
    threadId: options.threadId,
    currentDocument: liveState.currentDocument,
    currentDocumentKey: liveState.currentDocumentKey,
    selectedIds: liveState.selectedIds,
    viewBox: liveState.viewBox,
    designContext: liveState.designContext
  })

  const engine = await resolveCodeCanvasEngine(workspaceRoot, options.threadId)
  return {
    text: outboundText,
    displayText: route.displayText,
    ...(engine === 'excalidraw' ? { guiExcalidrawCanvas: true as const } : { guiDesignCanvas: true as const })
  }
}
