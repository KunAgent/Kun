import { findDesignBoardArtifact } from '../design-board'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import { useChatStore } from '../../store/chat-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { CODE_CANVAS_DIR } from './code-canvas'
import { useCanvasShapeStore } from './canvas-shape-store'
import {
  buildImageAnnotationPrompt,
  imageAnnotationDisplayText
} from './image-annotation-prompt'

export type ImageAnnotationApplyResult = {
  dataBase64: string
  mimeType: string
  textNotes?: string[]
  instruction?: string
}

export type SaveWorkspaceImageBytes = (payload: {
  workspaceRoot: string
  dataBase64: string
  mimeType: string
}) => Promise<
  | { ok: true; workspaceRelativePath: string }
  | { ok: false; message: string }
>

export type ApplyImageAnnotationStatus =
  | 'ignored-no-shape'
  | 'missing-workspace'
  | 'unsupported-save'
  | 'save-failed'
  | 'shape-missing'
  | 'document-changed'
  | 'sent-code'
  | 'sent-design'

export type ApplyImageAnnotationOptions = {
  result: ImageAnnotationApplyResult
  shapeId?: string | null
  currentDocumentKey?: string | null
  route: string
  activeCodeCanvasWorkspace: string
  designWorkspaceRoot?: string | null
  workspaceRequiredMessage: string
  unsupportedSaveMessage: string
  saveFailedMessage: (message: string) => string
  setError: (message: string) => void
  setDesignFileError?: (message: string) => void
  setAnnotationBusy: (busy: boolean) => void
  closeImageAnnotation: () => void
  sendCodeCanvasPrompt: (prompt: string, options: { displayText: string }) => void | Promise<void>
  sendDesignPrompt: (prompt: string, options: {
    displayText: string
    imageEditReferencePath?: string
  }) => void
  initiatingThreadId?: string | null
  getActiveThreadId?: () => string | null
  saveWorkspaceImageBytes?: SaveWorkspaceImageBytes
  getCanvasShapeState?: typeof useCanvasShapeStore.getState
  getDesignState?: typeof useDesignWorkspaceStore.getState
  selectCanvasShapes?: (ids: string[]) => void
  setTimeout?: (callback: () => void, delayMs: number) => number
}

export function isCodeCanvasDocumentKey(documentKey: string | null | undefined): boolean {
  return Boolean(documentKey?.includes(`\0${CODE_CANVAS_DIR}/`))
}

export function isDesignCanvasDocumentKey(documentKey: string | null | undefined): boolean {
  return Boolean(
    documentKey?.includes('\0.kun-design/') ||
    documentKey?.includes('/.kun-design/')
  )
}

function defaultSaveWorkspaceImageBytes(): SaveWorkspaceImageBytes | undefined {
  return window.kunGui?.saveWorkspaceImageBytes
}

function defaultSetDesignFileError(message: string): void {
  useDesignWorkspaceStore.getState().setFileError(message)
}

export async function applyImageAnnotationResult(
  options: ApplyImageAnnotationOptions
): Promise<ApplyImageAnnotationStatus> {
  const shapeId = options.shapeId?.trim()
  if (!shapeId) return 'ignored-no-shape'

  const isCodeCanvasAnnotation = options.currentDocumentKey
    ? isCodeCanvasDocumentKey(options.currentDocumentKey)
    : options.route === 'chat'
  const root = isCodeCanvasAnnotation
    ? options.activeCodeCanvasWorkspace
    : options.designWorkspaceRoot
  if (!root) {
    options.setError(options.workspaceRequiredMessage)
    return 'missing-workspace'
  }

  const saveWorkspaceImageBytes = options.saveWorkspaceImageBytes ?? defaultSaveWorkspaceImageBytes()
  const setDesignFileError = options.setDesignFileError ?? defaultSetDesignFileError
  if (typeof saveWorkspaceImageBytes !== 'function') {
    setDesignFileError(options.unsupportedSaveMessage)
    return 'unsupported-save'
  }

  options.setAnnotationBusy(true)
  try {
    const saved = await saveWorkspaceImageBytes({
      workspaceRoot: root,
      dataBase64: options.result.dataBase64,
      mimeType: options.result.mimeType
    })
    if (!saved.ok) {
      setDesignFileError(options.saveFailedMessage(saved.message))
      return 'save-failed'
    }

    const shapeStore = (options.getCanvasShapeState ?? useCanvasShapeStore.getState)()
    if (
      options.currentDocumentKey &&
      shapeStore.documentKey !== options.currentDocumentKey
    ) {
      return 'document-changed'
    }
    const shape = shapeStore.document.objects[shapeId]
    if (!shape) return 'shape-missing'

    if (isCodeCanvasAnnotation) {
      shapeStore.updateShape(shapeId, { imageUrl: saved.workspaceRelativePath })
    }
    const selectCanvasShapes =
      options.selectCanvasShapes ?? ((ids: string[]) => useCanvasSelectionStore.getState().select(ids))
    selectCanvasShapes([shapeId])

    if (!isCodeCanvasAnnotation) {
      const designState = (options.getDesignState ?? useDesignWorkspaceStore.getState)()
      const board = findDesignBoardArtifact(designState.artifacts)
      if (board) designState.setActiveArtifact(board.id)
    }

    options.closeImageAnnotation()
    const prompt = buildImageAnnotationPrompt({
      annotatedRelativePath: saved.workspaceRelativePath,
      textNotes: options.result.textNotes,
      instruction: options.result.instruction
    })
    const displayText = imageAnnotationDisplayText({
      textNotes: options.result.textNotes,
      instruction: options.result.instruction
    })
    const setTimer =
      options.setTimeout ?? ((callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs))
    const initiatingThreadId = options.initiatingThreadId?.trim() || null
    const getActiveThreadId = options.getActiveThreadId ?? (() => useChatStore.getState().activeThreadId)
    const sendIfDocumentUnchanged = (send: () => void): void => {
      if (
        options.currentDocumentKey &&
        (options.getCanvasShapeState ?? useCanvasShapeStore.getState)().documentKey !==
          options.currentDocumentKey
      ) return
      if (initiatingThreadId && getActiveThreadId() !== initiatingThreadId) return
      send()
    }
    if (isCodeCanvasAnnotation) {
      setTimer(() => {
        sendIfDocumentUnchanged(() => {
          void options.sendCodeCanvasPrompt(prompt, { displayText })
        })
      }, 60)
      return 'sent-code'
    }
    setTimer(() => sendIfDocumentUnchanged(
      () => options.sendDesignPrompt(prompt, {
        displayText,
        imageEditReferencePath: saved.workspaceRelativePath
      })
    ), 60)
    return 'sent-design'
  } finally {
    options.setAnnotationBusy(false)
  }
}
